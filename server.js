import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, insertInitiatedTransaction, updateTransactionStatus, ensureClientsTable, getClientWebhookSecret, getTransactionStatus } from './db.js';


// Use native fetch (Node 18+) with dynamic fallback
const fetch = globalThis.fetch || (async (...args) => {
  try {
    const nodeFetch = (await import('node-fetch')).default;
    return nodeFetch(...args);
  } catch (e) {
    console.error('[Fetch Error] No fetch implementation found:', e.message);
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Enable CORS for all origins
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files (index.html, payment-connector.js, etc.)
app.use(express.static(__dirname));

const PORT = process.env.PORT || 4000;
const APP_URL = process.env.APP_URL || 'https://payment.jivadaya.org';

// CCAvenue Helper: AES-128-CBC Encryption
function encryptCCAvenue(plainText, workingKey) {
  const keyHash = crypto.createHash('md5').update(workingKey.trim()).digest();
  const iv = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f]);
  const cipher = crypto.createCipheriv('aes-128-cbc', keyHash, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

// CCAvenue Helper: AES-128-CBC Decryption
function decryptCCAvenue(encText, workingKey) {
  const keyHash = crypto.createHash('md5').update(workingKey.trim()).digest();
  const iv = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f]);
  const decipher = crypto.createDecipheriv('aes-128-cbc', keyHash, iv);
  let decrypted = decipher.update(encText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Helper to dynamically extract originating host from callback_url, referer, or origin header
function getOriginHost(req, callback_url) {
  let host = '';
  if (callback_url && callback_url.startsWith('http')) {
    try { host = new URL(callback_url).hostname; } catch(e){}
  }
  if (!host && req.headers.referer) {
    try { host = new URL(req.headers.referer).hostname; } catch(e){}
  }
  if (!host && req.headers.origin) {
    try { host = new URL(req.headers.origin).hostname; } catch(e){}
  }
  return host || 'donate.jivadaya.org';
}

// ==============================================================================
// HMAC-SHA256 Webhook Signature
// ==============================================================================
/**
 * Generate an HMAC-SHA256 signature for a webhook payload.
 * The resulting header value is:  sha256=<hex>
 *
 * @param {string} payloadString  JSON.stringify(body) — exact string that will be sent
 * @param {string} secret         Per-client webhook secret from ph_clients table
 * @returns {string}              e.g. "sha256=abc123..."
 */
function generateWebhookSignature(payloadString, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payloadString, 'utf8');
  return 'sha256=' + hmac.digest('hex');
}

// Ensure ph_clients table is present on startup
ensureClientsTable().catch(err => console.error('[Startup] ensureClientsTable error:', err.message));


function handlePaymentInitiation(req, res) {
  const body = req.body || {};
  
  const rawCallbackUrl = body.callback_url || body.redirect_url || body.return_url || '';
  const originHost = getOriginHost(req, rawCallbackUrl);

  // 1. Dynamic Order ID Prefix based on originating site (if order_id omitted)
  let defaultPrefix = 'Donate';
  if (originHost.includes('pay.jivadaya')) defaultPrefix = 'JDSA';
  else if (originHost.includes('shastradaan')) defaultPrefix = 'Shastradaan';
  else if (originHost.includes('vec') || originHost.includes('valuesforall')) defaultPrefix = 'VEC';
  else if (originHost.includes('donate')) defaultPrefix = 'Donate';

  const order_id = body.order_id || `${defaultPrefix}_${Date.now()}`;
  
  // 2. Dynamic Callback URL based on originating site (if callback_url omitted)
  const callback_url = rawCallbackUrl || `https://${originHost}/thank-you`;
  const webhook_url = body.webhook_url || body.notify_url || '';

  const amount = body.amount || '100.00';
  const billing_name = body.billing_name || 'Donor';
  const billing_email = body.billing_email || '';
  const billing_tel = body.billing_tel || '';
  const pg = (body.pg || 'ccavenue').toLowerCase();
  const payment_option = (body.payment_option || body.sub_pg || body.payment_type || '').toLowerCase();

  console.log(`[Payment Initiate] Site: ${originHost}, Order: ${order_id}, Amount: ₹${amount}, Gateway: ${pg}, Option: ${payment_option || 'all'}`);

  // Persist transaction directly into ph_transactions (No fallback to jd_donations)
  insertInitiatedTransaction({
    order_id,
    amount,
    currency: 'INR',
    status: 'initiated',
    campaign_slug: body.campaign_slug || 'default',
    billing_name,
    billing_email,
    billing_tel,
    gateway_name: pg,
    origin_host: originHost,
    raw_payload: body
  }).catch(err => console.error('[DB ph_transactions initiate error]:', err.message));

  if (pg === 'ccavenue' || pg === 'razorpay' || pg === 'upi') {
    const merchantId = (process.env.CCAVENUE_MERCHANT_ID || '').trim();
    const accessCode = (process.env.CCAVENUE_ACCESS_CODE || '').trim();
    const workingKey = (process.env.CCAVENUE_WORKING_KEY || '').trim();
    const isLive = process.env.CCAVENUE_ENV === 'live';

    const gatewayUrl = isLive
      ? 'https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction'
      : 'https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction';

    if (!merchantId || !accessCode || !workingKey || merchantId.includes('YOUR_')) {
      return res.status(500).send(`
        <h3>Configuration Error</h3>
        <p>CCAvenue credentials are missing or invalid in .env on payment.jivadaya.org server.</p>
      `);
    }

    const ccavenueParams = {
      merchant_id: merchantId,
      order_id: order_id,
      currency: 'INR',
      amount: parseFloat(amount).toFixed(2),
      redirect_url: `${APP_URL}/api/payment/ccavenue-response`,
      cancel_url: `${APP_URL}/api/payment/ccavenue-response`,
      language: 'EN',
      billing_name: billing_name,
      billing_email: billing_email,
      billing_tel: billing_tel,
      merchant_param1: callback_url,
      merchant_param2: webhook_url
    };

    // 3. Conditional Payment Option Filtering:
    // ONLY filter for UPI if client explicitly requested UPI (e.g. payment_option="upi" or pg="upi")
    const isUpiSpecific = payment_option.includes('upi') || pg === 'upi';
    if (isUpiSpecific) {
      ccavenueParams.payment_option = 'OPTUPI';
      ccavenueParams.card_type = 'UPI';
      ccavenueParams.card_name = 'UPI';
    } else if (payment_option.includes('netbank') || payment_option === 'optnbk') {
      ccavenueParams.payment_option = 'OPTNBK';
    } else if (payment_option.includes('card') || payment_option === 'optcrdc') {
      ccavenueParams.payment_option = 'OPTCRDC';
    }



    const plainTextQuery = Object.keys(ccavenueParams)
      .map(k => `${k}=${encodeURIComponent(ccavenueParams[k])}`)
      .join('&');

    try {
      const encRequest = encryptCCAvenue(plainTextQuery, workingKey);

      // Auto-submitting HTML form to CCAvenue
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Redirecting to CCAvenue Payment Gateway...</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding-top: 50px; background: #0f172a; color: white; }
            .spinner { border: 4px solid rgba(255,255,255,0.1); width: 40px; height: 40px; border-radius: 50%; border-left-color: #ea580c; animation: spin 1s linear infinite; margin: 20px auto; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <h2>Redirecting to Secure Gateway...</h2>
          <div class="spinner"></div>
          <p>Please wait while we redirect you to CCAvenue.</p>
          <form id="ccavenueForm" method="POST" action="${gatewayUrl}">
            <input type="hidden" name="encRequest" value="${encRequest}">
            <input type="hidden" name="access_code" value="${accessCode}">
          </form>
          <script>
            document.getElementById('ccavenueForm').submit();
          </script>
        </body>
        </html>
      `);
    } catch (err) {
      console.error('[CCAvenue Encryption Error]:', err);
      res.status(500).send('Error initiating payment encryption.');
    }
  } else {
    // Razorpay fallback / initiation
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Razorpay Payment</title></head>
      <body style="font-family: Arial; padding: 40px; text-align: center;">
        <h2>Razorpay Gateway Selected</h2>
        <p>Order ID: ${order_id}</p>
        <p>Amount: ₹${amount}</p>
        <a href="${callback_url}?order_id=${order_id}&status=success">Click to Complete Test Payment</a>
      </body>
      </html>
    `);
  }
}

// Support both /api/payment/initiate and /payment/initiate
app.post('/api/payment/initiate', handlePaymentInitiation);
app.post('/payment/initiate', handlePaymentInitiation);
app.get('/api/payment/initiate', (req, res) => res.redirect('/'));

// CCAvenue Redirect Response Handler
function handleCCAvenueResponse(req, res) {
  const workingKey = (process.env.CCAVENUE_WORKING_KEY || '').trim();
  const encResp = req.body?.encResp || req.body?.enc_response || req.query?.encResp || '';

  if (!encResp) {
    console.error('[CCAvenue Response Error] Missing encResp in request body or query.');
    return res.status(400).send('Invalid or missing response payload from CCAvenue.');
  }

  try {
    const decrypted = decryptCCAvenue(encResp.trim(), workingKey);
    const params = new URLSearchParams(decrypted);

    const order_id = params.get('order_id') || '';
    const order_status = params.get('order_status') || 'Failed';
    const amount = params.get('amount') || '';
    const tracking_id = params.get('tracking_id') || '';
    
    // Default fallback to central hub thank-you page ONLY if client site passed no callback URL
    let rawCallbackUrl = params.get('merchant_param1') || 'https://pay.jivadaya.org/status';
    const webhook_url = params.get('merchant_param2') || '';

    // Safely decode callback URL
    try {
      rawCallbackUrl = decodeURIComponent(rawCallbackUrl);
    } catch (e) {}

    // Bulletproof URL cleaning: Fix malformed strings like "/https/pay.jivadaya.org/status", "https/pay.jivadaya.org/status", "pay.jivadaya.org/status"
    let cleanUrl = rawCallbackUrl.trim();
    cleanUrl = cleanUrl.replace(/^[\/\:\s]+/, ''); // Strip leading slashes/spaces
    cleanUrl = cleanUrl.replace(/^(https?)\/*/, '$1://'); // Ensure "https://" format
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl.replace(/^:\/*/, '');
    }

    console.log(`[CCAvenue Callback Received] Order: ${order_id}, Status: ${order_status}, Txn: ${tracking_id}`);
    console.log(`[Repaired Callback URL]: ${cleanUrl}`);

    const bank_ref_no = params.get('bank_ref_no') || '';
    const payment_mode = params.get('payment_mode') || '';

    // Directly update ph_transactions (No fallback to jd_donations)
    updateTransactionStatus({
      order_id,
      status: order_status,
      tracking_id,
      bank_ref_no,
      payment_mode,
      response_payload: Object.fromEntries(params.entries())
    }).catch(err => console.error('[DB ph_transactions update error]:', err.message));

    // If webhook_url was provided by client site, post HMAC-signed JSON in background
    if (webhook_url && webhook_url.startsWith('http')) {
      let webhookHost = '';
      try { webhookHost = new URL(webhook_url).hostname; } catch(e){}
      let callbackHost = '';
      try { callbackHost = new URL(cleanUrl).hostname; } catch(e){}

      // Retrieve per-client secret (checks both webhookHost and callbackHost)
      getClientWebhookSecret(webhookHost, callbackHost).then(secret => {
        const webhookPayload = {
          status: order_status,
          order_status: order_status,
          order_id,
          payment_id: tracking_id,
          tracking_id: tracking_id,
          amount,
          gateway: 'CCAvenue',
          timestamp: new Date().toISOString()
        };
        const payloadString = JSON.stringify(webhookPayload);
        const signature = generateWebhookSignature(payloadString, secret);

        console.log(`[Signed Webhook Firing] URL: ${webhook_url} | Order: ${order_id} | Host: ${webhookHost || callbackHost}`);

        return fetch(webhook_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Jivadaya-Signature': signature   // HMAC-SHA256 — verify this on your server
          },
          body: payloadString
        }).then(async (response) => {
          const resText = await response.text().catch(() => '');
          if (response.ok) {
            console.log(`[Signed Webhook Delivered] Order: ${order_id} -> ${webhook_url} returned HTTP ${response.status}`);
          } else {
            console.error(`[Signed Webhook Rejected] Order: ${order_id} -> ${webhook_url} returned HTTP ${response.status}: ${resText.substring(0, 250)}`);
          }
        });
      }).catch(err => console.error('[Signed Webhook Post Error]:', err.message));
    } else {
      console.warn(`[Webhook Skipped] No webhook_url provided for Order ${order_id}. merchant_param2 was: "${webhook_url}"`);
    }


    // Construct 100% absolute redirect URL back to client site (e.g. https://pay.jivadaya.org/status)
    let redirectTarget = 'https://pay.jivadaya.org/status';
    try {
      const parsedUrl = new URL(cleanUrl);
      parsedUrl.searchParams.set('order_id', order_id);
      parsedUrl.searchParams.set('order_status', order_status);
      parsedUrl.searchParams.set('status', order_status);
      parsedUrl.searchParams.set('amount', amount);
      parsedUrl.searchParams.set('txn_id', tracking_id);
      parsedUrl.searchParams.set('tracking_id', tracking_id);
      parsedUrl.searchParams.set('payment_id', tracking_id);
      redirectTarget = parsedUrl.toString();
    } catch (e) {
      console.warn('[Callback URL Parse Fallback]:', cleanUrl);
      const joiner = cleanUrl.includes('?') ? '&' : '?';
      redirectTarget = `${cleanUrl}${joiner}order_id=${encodeURIComponent(order_id)}&order_status=${encodeURIComponent(order_status)}&status=${encodeURIComponent(order_status)}&amount=${encodeURIComponent(amount)}&txn_id=${encodeURIComponent(tracking_id)}&tracking_id=${encodeURIComponent(tracking_id)}`;
    }

    // Double-check target is 100% absolute URL (never relative)
    if (!redirectTarget.startsWith('http://') && !redirectTarget.startsWith('https://')) {
      redirectTarget = 'https://' + redirectTarget.replace(/^[\/\:\s]+/, '');
    }

    console.log(`[Redirecting Donor Back to Origin Site]: ${redirectTarget}`);
    res.redirect(redirectTarget);




  } catch (err) {
    console.error('[CCAvenue Response Decryption Error]:', err.message);
    res.status(500).send('Error processing CCAvenue response. Decryption failed.');
  }
}

app.post('/api/payment/ccavenue-response', handleCCAvenueResponse);
app.post('/payment/ccavenue-response', handleCCAvenueResponse);
app.get('/api/payment/ccavenue-response', (req, res) => res.redirect('/'));

// Razorpay Response / Webhook Handler
async function handleRazorpayResponse(req, res) {
  const body = req.body || {};
  const order_id = body.razorpay_order_id || body.order_id || '';
  const payment_id = body.razorpay_payment_id || body.payment_id || body.tracking_id || '';
  const status = (body.status || 'Success');

  console.log(`[Razorpay Callback Received] Order: ${order_id}, Status: ${status}, Txn: ${payment_id}`);

  // Directly update ph_transactions (No fallback to jd_donations)
  if (order_id) {
    try {
      await updateTransactionStatus({
        order_id,
        status,
        tracking_id: payment_id,
        bank_ref_no: body.bank_ref_no || '',
        payment_mode: body.method || 'razorpay',
        response_payload: body
      });
    } catch (err) {
      console.error('[Razorpay DB Update Error]:', err.message);
    }
  }

  const rawCallbackUrl = body.callback_url || body.redirect_url || 'https://pay.jivadaya.org/status';
  const joiner = rawCallbackUrl.includes('?') ? '&' : '?';
  const redirectTarget = `${rawCallbackUrl}${joiner}order_id=${encodeURIComponent(order_id)}&status=${encodeURIComponent(status)}&payment_id=${encodeURIComponent(payment_id)}`;
  
  if (req.headers['content-type']?.includes('application/json')) {
    return res.json({ success: true, order_id, status });
  }
  return res.redirect(redirectTarget);
}

app.post('/api/payment/razorpay-response', handleRazorpayResponse);
app.post('/payment/razorpay-response', handleRazorpayResponse);
app.post('/api/payment/webhook', handleRazorpayResponse);


// Thank You Page Handler — DB-verified, never trusts URL params alone
app.get('/thank-you', async (req, res) => {
  const { order_id } = req.query;

  // ----------------------------------------------------------------
  // 1. Always look up the real status from DB (never trust URL params)
  // ----------------------------------------------------------------
  let dbRow = null;
  if (order_id) {
    dbRow = await getTransactionStatus(order_id).catch(() => null);
  }

  // 2. Determine what to show
  const verifiedStatus = dbRow ? (dbRow.status || 'Unknown') : null;
  const amount         = dbRow ? dbRow.amount         : req.query.amount  || '';
  const billing_name   = dbRow ? dbRow.billing_name   : '';
  const txn_id         = dbRow ? dbRow.tracking_id    : req.query.txn_id  || '';

  const isSuccess = verifiedStatus === 'Success';
  const isFailed  = verifiedStatus === 'Failure' || verifiedStatus === 'Aborted';
  const isUnknown = !dbRow; // DB not available or order not found yet

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Donation Completed - Jivadaya</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #0f172a; color: white; }
        .card { background: #1e293b; max-width: 500px; margin: auto; padding: 30px; border-radius: 12px; border: 1px solid #334155; }
        .badge-success { color: #22c55e; font-size: 1.2rem; font-weight: bold; }
        .badge-fail    { color: #ef4444; font-size: 1.2rem; font-weight: bold; }
        .badge-pending { color: #f59e0b; font-size: 1.2rem; font-weight: bold; }
        .notice { background: #1e3a5f; border: 1px solid #3b82f6; border-radius: 6px; padding: 10px 14px; font-size: 0.82rem; color: #93c5fd; margin-top: 18px; text-align: left; }
        a.btn { display: inline-block; margin-top: 20px; background: #ea580c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="card">
        ${isSuccess ? '<h2>🙏 Thank You for Your Support!</h2>' : ''}
        ${isFailed  ? '<h2>Payment Not Completed</h2>' : ''}
        ${isUnknown ? '<h2>Payment Status</h2>' : ''}

        ${isSuccess ? `<p class="badge-success">✅ Payment Confirmed</p>` : ''}
        ${isFailed  ? `<p class="badge-fail">❌ Status: ${verifiedStatus}</p>` : ''}
        ${isUnknown ? `<p class="badge-pending">⏳ Status: Pending Verification</p>` : ''}

        ${order_id    ? `<p>Order Reference: <strong>${order_id}</strong></p>` : ''}
        ${billing_name ? `<p>Name: <strong>${billing_name}</strong></p>` : ''}
        ${amount      ? `<p>Amount: <strong>₹${amount}</strong></p>` : ''}
        ${txn_id      ? `<p>Gateway Txn ID: <strong>${txn_id}</strong></p>` : ''}

        ${isUnknown ? `
          <div class="notice">
            ℹ️ Your payment is being verified. This page is for display only — your server will
            receive a signed webhook confirmation once the gateway confirms the transaction.
          </div>
        ` : ''}

        <a href="/" class="btn">Return to Home</a>
      </div>
    </body>
    </html>
  `);
});


// Healthcheck / Status endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'payment.jivadaya.org Central Hub', time: new Date() });
});

// Transaction Status check by Order ID
app.get('/api/payment/status/:order_id', async (req, res) => {
  const { order_id } = req.params;
  if (!order_id) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  try {
    const txn = await getTransactionStatus(order_id);
    if (!txn) {
      return res.status(404).json({ error: 'Order not found', status: 'NOT_FOUND', order_id });
    }

    return res.json({
      order_id,
      status: txn.status,
      order_status: txn.status,
      amount: txn.amount,
      tracking_id: txn.tracking_id || '',
      payment_id: txn.tracking_id || '',
      payment_mode: txn.payment_mode || '',
      billing_name: txn.billing_name || ''
    });
  } catch (err) {
    console.error('[API Status Check Error]:', err.message);
    return res.status(500).json({ error: 'Internal server error checking status' });
  }
});

// ==============================================================================
// ADMIN API — Protected by ADMIN_API_KEY env variable
// Set ADMIN_API_KEY=your_secret_admin_key in .env
// ==============================================================================

function cleanKey(k) {
  if (!k) return '';
  return String(k).trim().replace(/^["']|["']$/g, '').trim();
}

function requireAdminKey(req, res, next) {
  const adminKey = cleanKey(process.env.ADMIN_API_KEY);
  const rawProvided = req.headers['x-admin-key'] || req.query.admin_key || '';
  const provided = cleanKey(rawProvided);

  if (!adminKey) {
    console.error('[Admin Auth] ⚠️ ADMIN_API_KEY is not set in .env on the server!');
    return res.status(503).json({
      error: 'ADMIN_API_KEY is not configured in the server .env file. Please add ADMIN_API_KEY to your .env on payment.jivadaya.org and restart the server.'
    });
  }

  if (!provided || provided !== adminKey) {
    return res.status(403).json({
      error: 'Forbidden — invalid admin key. The key entered in your browser does not match ADMIN_API_KEY in the server .env file.'
    });
  }
  next();
}

// ------------------------------------------------------------------------------
// POST /api/admin/clients/register
// Register a new client. Auto-generates a strong webhook secret.
//
// Request body (JSON):
//   { "origin_host": "mytemple.org", "label": "My Temple" }
//
// Response:
//   { "origin_host": "mytemple.org", "webhook_secret": "<generated>", "label": "My Temple" }
//
// The client puts webhook_secret in their .env as JIVADAYA_WEBHOOK_SECRET
// ------------------------------------------------------------------------------
app.post('/api/admin/clients/register', requireAdminKey, async (req, res) => {
  const { origin_host, label } = req.body || {};

  if (!origin_host) {
    return res.status(400).json({ error: 'origin_host is required (e.g. "mytemple.org")' });
  }

  // Auto-generate a cryptographically strong 64-char hex secret
  const webhook_secret = crypto.randomBytes(32).toString('hex');

  try {
    await query(
      `INSERT INTO ph_clients (origin_host, webhook_secret, label)
       VALUES ($1, $2, $3)
       ON CONFLICT (origin_host)
       DO UPDATE SET webhook_secret = EXCLUDED.webhook_secret,
                     label          = COALESCE(EXCLUDED.label, ph_clients.label),
                     active         = TRUE;`,
      [origin_host.trim().toLowerCase(), webhook_secret, label || origin_host]
    );

    console.log(`[Admin] ✅ Client registered/updated: ${origin_host}`);

    return res.json({
      success:        true,
      origin_host:    origin_host.trim().toLowerCase(),
      label:          label || origin_host,
      webhook_secret,                          // ← share this with the client
      note: 'Client must set JIVADAYA_WEBHOOK_SECRET in their .env with this value.'
    });
  } catch (err) {
    console.error('[Admin] Register client error:', err.message);
    return res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ------------------------------------------------------------------------------
// GET /api/admin/clients
// List all registered clients (secrets masked for safety)
// ------------------------------------------------------------------------------
app.get('/api/admin/clients', requireAdminKey, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, origin_host, label, active, created_at,
              LEFT(webhook_secret, 8) || '...' AS secret_preview
       FROM ph_clients ORDER BY created_at DESC;`
    );
    return res.json({ clients: result?.rows || [] });
  } catch (err) {
    return res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ------------------------------------------------------------------------------
// POST /api/admin/webhook-test
// Fire a real signed test webhook to any URL — use this to verify a client's
// webhook endpoint is working correctly.
//
// Request body (JSON):
//   { "webhook_url": "https://mytemple.org/webhook", "origin_host": "mytemple.org" }
// ------------------------------------------------------------------------------
app.post('/api/admin/webhook-test', requireAdminKey, async (req, res) => {
  const { webhook_url, origin_host } = req.body || {};

  if (!webhook_url) {
    return res.status(400).json({ error: 'webhook_url is required' });
  }

  let host = origin_host || '';
  if (!host) {
    try { host = new URL(webhook_url).hostname; } catch(e){}
  }

  const secret = await getClientWebhookSecret(host);

  const testPayload = {
    status:       'Success',
    order_status: 'Success',
    order_id:     'TEST_' + Date.now(),
    payment_id:   'TEST_TXN_' + Date.now(),
    tracking_id:  'TEST_TXN_' + Date.now(),
    amount:       '1.00',
    gateway:      'TestGateway',
    timestamp:    new Date().toISOString(),
    _test:        true   // flag so client knows this is a test ping
  };

  const payloadString = JSON.stringify(testPayload);
  const signature     = generateWebhookSignature(payloadString, secret);

  try {
    const response = await fetch(webhook_url, {
      method:  'POST',
      headers: {
        'Content-Type':           'application/json',
        'X-Jivadaya-Signature':   signature,
        'X-Jivadaya-Test':        'true'
      },
      body: payloadString
    });

    const responseText = await response.text().catch(() => '');
    console.log(`[Admin] Webhook test → ${webhook_url} | HTTP ${response.status}`);

    return res.json({
      success:      response.ok,
      webhook_url,
      http_status:  response.status,
      signature,
      payload_sent: testPayload,
      client_response: responseText
    });
  } catch (err) {
    return res.status(500).json({ error: 'Webhook delivery failed: ' + err.message });
  }
});


app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 payment.jivadaya.org Central Hub running on Port ${PORT}`);
  console.log(`====================================================`);
});
