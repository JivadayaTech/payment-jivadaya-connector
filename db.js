import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

let pool = null;

// Initialize PostgreSQL pool if configuration is provided
const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DB_URL;
const dbHost = process.env.PGHOST || process.env.DB_HOST || process.env.POSTGRES_HOST;
const dbUser = process.env.PGUSER || process.env.DB_USER || process.env.POSTGRES_USER || process.env.DB_USERNAME;
const dbPass = process.env.PGPASSWORD || process.env.DB_PASSWORD || process.env.DB_PASS || process.env.POSTGRES_PASSWORD || process.env.DATABASE_PASSWORD;
const dbName = process.env.PGDATABASE || process.env.DB_NAME || process.env.POSTGRES_DB || process.env.POSTGRES_DATABASE || 'postgres';
const dbPort = parseInt(process.env.PGPORT || process.env.DB_PORT || process.env.POSTGRES_PORT || '5432', 10);

if (dbUrl || dbHost) {
  const connectionConfig = dbUrl
    ? {
        connectionString: dbUrl,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : (process.env.DB_SSL === 'false' ? false : undefined)
      }
    : {
        host: dbHost || 'localhost',
        port: dbPort,
        user: String(dbUser || 'postgres'),
        password: String(dbPass !== undefined && dbPass !== null ? dbPass : ''),
        database: String(dbName),
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
      };

  pool = new Pool(connectionConfig);

  pool.on('error', (err) => {
    console.error('[PostgreSQL Pool Error]:', err.message);
  });
} else {
  console.warn('[PostgreSQL Warning]: No PostgreSQL environment variables configured (DATABASE_URL or DB_HOST).');
}

/**
 * Execute a query on PostgreSQL
 * @param {string} text SQL query
 * @param {Array} params Parameter bindings
 */
export async function query(text, params = []) {
  if (!pool) {
    console.warn('[PostgreSQL] Database pool not initialized, skipping query.');
    return null;
  }
  try {
    const res = await pool.query(text, params);
    return res;
  } catch (err) {
    console.error('[PostgreSQL Query Error]:', err.message, { query: text });
    throw err;
  }
}

// ==============================================================================
// ph_clients table — per-client webhook secret store
// Schema (auto-created on first use):
//   id            SERIAL PRIMARY KEY
//   origin_host   TEXT UNIQUE NOT NULL   -- e.g. "pay.jivadaya.org"
//   webhook_secret TEXT NOT NULL         -- HMAC signing secret for this client
//   label         TEXT                   -- friendly name
//   active        BOOLEAN DEFAULT TRUE
//   created_at    TIMESTAMPTZ DEFAULT NOW()
// ==============================================================================

/**
 * Ensure ph_clients table exists. Called once at server startup.
 */
export async function ensureClientsTable() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ph_clients (
        id             SERIAL PRIMARY KEY,
        origin_host    TEXT UNIQUE NOT NULL,
        webhook_secret TEXT NOT NULL,
        label          TEXT,
        active         BOOLEAN DEFAULT TRUE,
        created_at     TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('[PostgreSQL] ph_clients table ready.');
  } catch (err) {
    console.error('[PostgreSQL] Could not ensure ph_clients table:', err.message);
  }
}

// Simple in-process cache: host -> secret (TTL: 5 minutes)
const secretCache = new Map(); // { host: { secret, expiresAt } }
const SECRET_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Get per-client webhook secret by origin host.
 * Checks primaryHost (e.g. from webhook_url) and secondaryHost (e.g. from callback_url).
 * Falls back to global S2S_WEBHOOK_SECRET env var if no row found.
 *
 * @param {string} primaryHost   e.g. "api.valuesforall.org" or "vec.jivadaya.org"
 * @param {string} secondaryHost e.g. "vec.jivadaya.org"
 * @returns {Promise<string>}   HMAC secret for this client
 */
export async function getClientWebhookSecret(primaryHost, secondaryHost) {
  const globalFallback = process.env.S2S_WEBHOOK_SECRET || 'change_this_to_a_secure_random_string_123';

  if (!pool) return globalFallback;

  const h1 = String(primaryHost || '').trim().toLowerCase().replace(/:[0-9]+$/, '');
  const h2 = String(secondaryHost || '').trim().toLowerCase().replace(/:[0-9]+$/, '');

  for (const host of [h1, h2]) {
    if (!host) continue;
    const cached = secretCache.get(host);
    if (cached && cached.expiresAt > Date.now()) return cached.secret;
  }

  try {
    const res = await pool.query(
      `SELECT origin_host, webhook_secret FROM ph_clients 
       WHERE (LOWER(origin_host) = $1 OR LOWER(origin_host) = $2) AND active = TRUE 
       ORDER BY (LOWER(origin_host) = $1) DESC LIMIT 1;`,
      [h1 || '', h2 || '']
    );
    if (res && res.rows && res.rows.length > 0) {
      const secret = res.rows[0].webhook_secret;
      const matchedHost = res.rows[0].origin_host.toLowerCase();
      secretCache.set(matchedHost, { secret, expiresAt: Date.now() + SECRET_CACHE_TTL_MS });
      if (h1) secretCache.set(h1, { secret, expiresAt: Date.now() + SECRET_CACHE_TTL_MS });
      if (h2) secretCache.set(h2, { secret, expiresAt: Date.now() + SECRET_CACHE_TTL_MS });
      return secret;
    }
  } catch (err) {
    console.error('[DB getClientWebhookSecret Error]:', err.message);
  }

  // No row found → return global fallback and cache it briefly
  if (h1) secretCache.set(h1, { secret: globalFallback, expiresAt: Date.now() + SECRET_CACHE_TTL_MS });
  return globalFallback;
}

/**
 * Look up a transaction's confirmed status directly from DB.
 * Used by the /status page to avoid trusting URL query params.
 *
 * @param {string} order_id
 * @returns {Promise<{status:string, amount:string, billing_name:string}|null>}
 */
export async function getTransactionStatus(order_id) {
  if (!pool || !order_id) return null;
  try {
    const res = await pool.query(
      `SELECT status, amount, billing_name, billing_email, tracking_id, payment_mode
       FROM ph_transactions WHERE order_id = $1 LIMIT 1;`,
      [order_id]
    );
    if (res && res.rows && res.rows.length > 0) return res.rows[0];
  } catch (err) {
    console.error('[DB getTransactionStatus Error]:', err.message);
  }
  return null;
}

// ==============================================================================
// Cache of table columns
let tableColumnsCache = null;

async function getTableColumns(tableName = 'ph_transactions') {
  if (tableColumnsCache) return tableColumnsCache;
  try {
    const res = await query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1;`,
      [tableName]
    );
    if (res && res.rows && res.rows.length > 0) {
      tableColumnsCache = new Set(res.rows.map(r => r.column_name.toLowerCase()));
      console.log(`[PostgreSQL] Detected columns for ${tableName}:`, Array.from(tableColumnsCache).join(', '));
      return tableColumnsCache;
    }
  } catch (err) {
    console.warn('[PostgreSQL] Could not fetch table schema:', err.message);
  }
  return null;
}

/**
 * Insert new transaction into ph_transactions table dynamically matching existing columns
 */
export async function insertInitiatedTransaction({
  order_id,
  amount,
  currency = 'INR',
  status = 'initiated',
  campaign_slug = 'default',
  billing_name = '',
  billing_email = '',
  billing_tel = '',
  gateway_name = 'ccavenue',
  origin_host = '',
  raw_payload = null
}) {
  const cols = await getTableColumns('ph_transactions');
  
  const insertMap = {};

  const setIfExists = (candidates, value) => {
    if (!cols) {
      // If schema fetch wasn't possible, use first candidate
      insertMap[candidates[0]] = value;
      return;
    }
    for (const c of candidates) {
      if (cols.has(c.toLowerCase())) {
        insertMap[c] = value;
        return;
      }
    }
  };

  setIfExists(['order_id'], order_id);
  setIfExists(['amount'], parseFloat(amount) || 0);
  if (cols && cols.has('currency')) {
    setIfExists(['currency'], currency);
  }
  setIfExists(['status', 'order_status', 'payment_status'], status);
  setIfExists(['campaign_slug', 'campaign', 'campaign_id'], campaign_slug);
  setIfExists(['billing_name', 'donor_name', 'name'], billing_name);
  setIfExists(['billing_email', 'donor_email', 'email'], billing_email);
  setIfExists(['billing_tel', 'billing_phone', 'donor_phone', 'phone', 'mobile'], billing_tel);
  setIfExists(['gateway_name', 'gateway', 'pg'], gateway_name);
  setIfExists(['origin_host', 'site', 'host'], origin_host);
  setIfExists(['raw_payload', 'payload', 'raw_data'], raw_payload ? JSON.stringify(raw_payload) : null);

  const columnNames = Object.keys(insertMap);
  const placeholders = columnNames.map((_, i) => `$${i + 1}`);
  const values = Object.values(insertMap);

  let onConflictClause = '';
  if (columnNames.includes('order_id')) {
    const updateClauses = [];
    if (columnNames.includes('amount')) updateClauses.push('amount = EXCLUDED.amount');
    if (columnNames.includes('status')) updateClauses.push('status = EXCLUDED.status');
    if (cols && cols.has('updated_at')) updateClauses.push('updated_at = NOW()');

    if (updateClauses.length > 0) {
      onConflictClause = `ON CONFLICT (order_id) DO UPDATE SET ${updateClauses.join(', ')}`;
    } else {
      onConflictClause = `ON CONFLICT (order_id) DO NOTHING`;
    }
  }

  // Handle created_at & updated_at if they exist in table
  const finalCols = [...columnNames];
  const finalPlaceholders = [...placeholders];
  if (cols && cols.has('created_at')) {
    finalCols.push('created_at');
    finalPlaceholders.push('NOW()');
  }
  if (cols && cols.has('updated_at')) {
    finalCols.push('updated_at');
    finalPlaceholders.push('NOW()');
  }

  const sql = `
    INSERT INTO ph_transactions (${finalCols.join(', ')})
    VALUES (${finalPlaceholders.join(', ')})
    ${onConflictClause};
  `;

  try {
    return await query(sql, values);
  } catch (err) {
    console.error(`[DB Insert ph_transactions Error for ${order_id}]:`, err.message);
    return null;
  }
}

/**
 * Update transaction status in ph_transactions dynamically matching existing columns
 */
export async function updateTransactionStatus({
  order_id,
  status,
  tracking_id = '',
  bank_ref_no = '',
  payment_mode = '',
  response_payload = null
}) {
  const cols = await getTableColumns('ph_transactions');
  const updateFields = [];
  const values = [];

  const addFieldIfExists = (candidates, value) => {
    if (!cols) {
      values.push(value);
      updateFields.push(`${candidates[0]} = $${values.length}`);
      return;
    }
    for (const c of candidates) {
      if (cols.has(c.toLowerCase())) {
        values.push(value);
        updateFields.push(`${c} = $${values.length}`);
        return;
      }
    }
  };

  addFieldIfExists(['status', 'order_status', 'payment_status'], status);
  if (tracking_id) {
    addFieldIfExists(['tracking_id', 'gateway_txn_id', 'payment_id', 'txn_id', 'gateway_payment_id'], tracking_id);
  }
  if (bank_ref_no) {
    addFieldIfExists(['bank_ref_no', 'bank_reference', 'bank_ref'], bank_ref_no);
  }
  if (payment_mode) {
    addFieldIfExists(['payment_mode', 'payment_option', 'payment_type', 'mode'], payment_mode);
  }
  if (response_payload) {
    addFieldIfExists(['response_payload', 'gateway_response', 'raw_response', 'payload'], JSON.stringify(response_payload));
  }

  if (cols && cols.has('updated_at')) {
    updateFields.push('updated_at = NOW()');
  }

  if (updateFields.length === 0) {
    console.warn(`[DB Update] No matching columns found to update for order ${order_id}`);
    return null;
  }

  values.push(order_id);
  const sql = `
    UPDATE ph_transactions
    SET ${updateFields.join(', ')}
    WHERE order_id = $${values.length};
  `;

  try {
    return await query(sql, values);
  } catch (err) {
    console.error(`[DB Update ph_transactions Error for ${order_id}]:`, err.message);
    return null;
  }
}

export default {
  query,
  ensureClientsTable,
  getClientWebhookSecret,
  getTransactionStatus,
  insertInitiatedTransaction,
  updateTransactionStatus
};
