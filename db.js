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

/**
 * Insert new transaction into ph_transactions table (No fallback to jd_donations)
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
  const sql = `
    INSERT INTO ph_transactions (
      order_id,
      amount,
      currency,
      status,
      campaign_slug,
      billing_name,
      billing_email,
      billing_tel,
      gateway_name,
      origin_host,
      raw_payload,
      created_at,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
    )
    ON CONFLICT (order_id) DO UPDATE SET
      amount = EXCLUDED.amount,
      status = EXCLUDED.status,
      updated_at = NOW();
  `;

  const values = [
    order_id,
    parseFloat(amount) || 0,
    currency,
    status,
    campaign_slug,
    billing_name,
    billing_email,
    billing_tel,
    gateway_name,
    origin_host,
    raw_payload ? JSON.stringify(raw_payload) : null
  ];

  try {
    return await query(sql, values);
  } catch (err) {
    console.error(`[DB Insert ph_transactions Error for ${order_id}]:`, err.message);
    return null;
  }
}

/**
 * Update transaction status in ph_transactions (No fallback to jd_donations)
 */
export async function updateTransactionStatus({
  order_id,
  status,
  tracking_id = '',
  bank_ref_no = '',
  payment_mode = '',
  response_payload = null
}) {
  const sql = `
    UPDATE ph_transactions
    SET
      status = $1,
      gateway_txn_id = $2,
      bank_ref_no = $3,
      payment_mode = $4,
      response_payload = $5,
      updated_at = NOW()
    WHERE order_id = $6;
  `;

  const values = [
    status,
    tracking_id,
    bank_ref_no,
    payment_mode,
    response_payload ? JSON.stringify(response_payload) : null,
    order_id
  ];

  try {
    return await query(sql, values);
  } catch (err) {
    console.error(`[DB Update ph_transactions Error for ${order_id}]:`, err.message);
    return null;
  }
}

export default {
  query,
  insertInitiatedTransaction,
  updateTransactionStatus
};
