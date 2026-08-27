import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

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

// Payment Initiation Handler function
function handlePaymentInitiation(req, res) {
  const body = req.body || {};
  
  const amount = body.amount || '100.00';
  const billing_name = body.billing_name || 'Donor';
  const billing_email = body.billing_email || '';
  const billing_tel = body.billing_tel || '';
  const pg = (body.pg || 'ccavenue').toLowerCase();
  const payment_option = (body.payment_option || body.sub_pg || body.payment_type || '').toLowerCase();
  const order_id = body.order_id || `JDSA_${Date.now()}`;
  const callback_url = body.callback_url || `${APP_URL}/thank-you`;
  const webhook_url = body.webhook_url || '';

  console.log(`[Payment Initiate] Order: ${order_id}, Amount: ₹${amount}, Gateway: ${pg}, Option: ${payment_option || 'default'}`);

  if (pg === 'ccavenue' || pg === 'upi') {
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

    // If client requested UPI explicitly, set direct UPI options
    if (pg === 'upi' || payment_option === 'upi' || payment_option === 'optupi') {
      ccavenueParams.payment_option = 'OPTUPI';
      ccavenueParams.card_type = 'UPI';
      ccavenueParams.card_name = 'UPI';
    } else if (payment_option === 'netbanking' || payment_option === 'optnbk') {
      ccavenueParams.payment_option = 'OPTNBK';
    } else if (payment_option === 'card' || payment_option === 'optcrdc') {
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
    let rawCallbackUrl = params.get('merchant_param1') || `${APP_URL}/thank-you`;
    const webhook_url = params.get('merchant_param2') || '';

    // Safely decode callback URL
    try {
      rawCallbackUrl = decodeURIComponent(rawCallbackUrl);
    } catch (e) {}

    console.log(`[CCAvenue Callback Received] Order: ${order_id}, Status: ${order_status}, Txn: ${tracking_id}`);
    console.log(`[Origin Client Callback URL]: ${rawCallbackUrl}`);

    // If webhook_url was provided by client site, post JSON signal in background
    if (webhook_url && webhook_url.startsWith('http')) {
      fetch(webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: order_status === 'Success' ? 'Success' : 'Failed',
          order_id,
          payment_id: tracking_id,
          amount,
          gateway: 'CCAvenue',
          timestamp: new Date().toISOString()
        })
      }).catch(err => console.error('[Webhook Post Error]:', err.message));
    }

    // Dynamically construct redirect back to whatever client site initiated payment (pay.jivadaya.org, donate.jivadaya.org, etc.)
    let redirectTarget = `${APP_URL}/thank-you`;
    try {
      const parsedUrl = new URL(rawCallbackUrl);
      parsedUrl.searchParams.set('order_id', order_id);
      parsedUrl.searchParams.set('order_status', order_status);
      parsedUrl.searchParams.set('status', order_status);
      parsedUrl.searchParams.set('amount', amount);
      parsedUrl.searchParams.set('txn_id', tracking_id);
      parsedUrl.searchParams.set('tracking_id', tracking_id);
      parsedUrl.searchParams.set('payment_id', tracking_id);
      redirectTarget = parsedUrl.toString();
    } catch (e) {
      console.warn('[Callback URL Parse Fallback]:', rawCallbackUrl);
      if (rawCallbackUrl.startsWith('http')) {
        const joiner = rawCallbackUrl.includes('?') ? '&' : '?';
        redirectTarget = `${rawCallbackUrl}${joiner}order_id=${encodeURIComponent(order_id)}&order_status=${encodeURIComponent(order_status)}&status=${encodeURIComponent(order_status)}&amount=${encodeURIComponent(amount)}&txn_id=${encodeURIComponent(tracking_id)}&tracking_id=${encodeURIComponent(tracking_id)}`;
      } else {
        redirectTarget = `${APP_URL}/thank-you?order_id=${encodeURIComponent(order_id)}&order_status=${encodeURIComponent(order_status)}&status=${encodeURIComponent(order_status)}&amount=${encodeURIComponent(amount)}`;
      }
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


// Thank You Page Handler
app.get('/thank-you', (req, res) => {
  const { order_id, status, amount, txn_id } = req.query;
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Donation Completed - Jivadaya</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #0f172a; color: white; }
        .card { background: #1e293b; max-width: 500px; margin: auto; padding: 30px; border-radius: 12px; border: 1px solid #334155; }
        .badge-success { color: #22c55e; font-size: 1.2rem; font-weight: bold; }
        .badge-fail { color: #ef4444; font-size: 1.2rem; font-weight: bold; }
        a.btn { display: inline-block; margin-top: 20px; background: #ea580c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>${status === 'Success' ? '🙏 Thank You for Your Support!' : 'Payment Result'}</h2>
        <p class="${status === 'Success' ? 'badge-success' : 'badge-fail'}">Status: ${status || 'Completed'}</p>
        <p>Order Reference: <strong>${order_id || 'N/A'}</strong></p>
        ${amount ? `<p>Amount: <strong>₹${amount}</strong></p>` : ''}
        ${txn_id ? `<p>Gateway Txn ID: <strong>${txn_id}</strong></p>` : ''}
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


app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 payment.jivadaya.org Central Hub running on Port ${PORT}`);
  console.log(`====================================================`);
});
