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
  const order_id = body.order_id || `JDSA_${Date.now()}`;
  const callback_url = body.callback_url || `${APP_URL}/thank-you`;
  const webhook_url = body.webhook_url || '';

  console.log(`[Payment Initiate] Order: ${order_id}, Amount: ₹${amount}, Gateway: ${pg}`);

  if (pg === 'ccavenue') {
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

// CCAvenue Redirect Response Handler
app.post('/api/payment/ccavenue-response', (req, res) => {
  const workingKey = (process.env.CCAVENUE_WORKING_KEY || '').trim();
  const encResp = req.body.encResp || '';

  if (!encResp) {
    return res.status(400).send('Invalid response from CCAvenue.');
  }

  try {
    const decrypted = decryptCCAvenue(encResp, workingKey);
    const params = new URLSearchParams(decrypted);

    const order_id = params.get('order_id') || '';
    const order_status = params.get('order_status') || 'Failed';
    const amount = params.get('amount') || '';
    const tracking_id = params.get('tracking_id') || '';
    const callback_url = params.get('merchant_param1') || `${APP_URL}/thank-you`;
    const webhook_url = params.get('merchant_param2') || '';

    console.log(`[CCAvenue Callback] Order: ${order_id}, Status: ${order_status}, Txn: ${tracking_id}`);

    // If webhook_url was provided, post JSON signal in background
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

    // Redirect donor back to client website callback_url
    const redirectUrl = new URL(callback_url);
    redirectUrl.searchParams.set('order_id', order_id);
    redirectUrl.searchParams.set('status', order_status);
    redirectUrl.searchParams.set('amount', amount);
    redirectUrl.searchParams.set('txn_id', tracking_id);

    res.redirect(redirectUrl.toString());
  } catch (err) {
    console.error('[CCAvenue Response Decryption Error]:', err);
    res.status(500).send('Error processing CCAvenue response.');
  }
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
