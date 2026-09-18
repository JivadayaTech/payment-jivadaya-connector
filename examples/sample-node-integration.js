/**
 * Node.js / Express Server Integration Example for payment.jivadaya.org
 *
 * Demonstrates:
 * 1. Initiating a payment request via an HTML form.
 * 2. Receiving and verifying the HMAC-signed S2S Webhook.
 * 3. A thank-you page (display only — real fulfillment happens in the webhook).
 */

import 'dotenv/config';
import express from 'express';
import crypto  from 'crypto';

const app  = express();
const PORT = process.env.PORT || 4000;
const PAYMENTS_INITIATE_URL = 'https://payment.jivadaya.org/api/payment/initiate';

// ── Your per-client webhook secret (set by Jivadaya in ph_clients table) ───────
// Store this in your .env file — never expose in frontend code.
const WEBHOOK_SECRET = process.env.JIVADAYA_WEBHOOK_SECRET || 'REPLACE_WITH_YOUR_SECRET';

// ── Parse raw body for the webhook route (needed for exact HMAC verification) ──
app.use('/api/webhooks/jivadaya-payment', express.raw({ type: 'application/json' }));

// Parse everything else normally
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// ── Signature Verification Helper ─────────────────────────────────────────────
function verifyWebhookSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const receivedSig  = sigHeader.slice(7);
  const expectedSig  = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(receivedSig, 'hex');
  const b = Buffer.from(expectedSig, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}


// ── 1. Donation Form ───────────────────────────────────────────────────────────
app.get('/donate', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head><title>Donate to Jivadaya</title></head>
      <body>
        <h2>Support Jivadaya Initiatives</h2>
        <form action="${PAYMENTS_INITIATE_URL}" method="POST">
          <label>Amount (₹):</label>
          <input type="number" name="amount" value="1100" required><br><br>

          <label>Name:</label>
          <input type="text" name="billing_name" placeholder="Full Name" required><br><br>

          <label>Email:</label>
          <input type="email" name="billing_email" placeholder="email@example.com"><br><br>

          <label>Gateway:</label>
          <select name="pg">
            <option value="ccavenue">CCAvenue</option>
            <option value="razorpay">Razorpay</option>
          </select><br><br>

          <input type="hidden" name="order_id"     value="MYAPP_${Date.now()}">
          <input type="hidden" name="webhook_url"  value="https://your-site.com/api/webhooks/jivadaya-payment">
          <input type="hidden" name="callback_url" value="https://your-site.com/thank-you">

          <button type="submit">Proceed to Pay</button>
        </form>
      </body>
    </html>
  `);
});


// ── 2. Signed Webhook Receiver ─────────────────────────────────────────────────
app.post('/api/webhooks/jivadaya-payment', (req, res) => {
  const rawBody   = req.body;   // Buffer — preserved by express.raw()
  const sigHeader = req.headers['x-jivadaya-signature'];

  // Step 1: Verify HMAC signature
  if (!verifyWebhookSignature(rawBody, sigHeader, WEBHOOK_SECRET)) {
    console.error('[Webhook] ❌ Signature mismatch — request rejected.');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Step 2: Parse verified payload
  const { status, order_id, payment_id, amount, gateway } = JSON.parse(rawBody.toString('utf8'));

  console.log(`[Webhook] ✅ Verified | Order: ${order_id} | Status: ${status} | ₹${amount} via ${gateway}`);

  // Step 3: Act on verified result
  if (status === 'Success') {
    // ✅ Mark order as paid in YOUR database here
    // e.g. await db.orders.update({ status: 'PAID', payment_id }, { where: { order_id } });
    console.log(`[Webhook] ✅ Order ${order_id} marked PAID.`);
  } else {
    console.log(`[Webhook] ❌ Order ${order_id} — ${status}`);
  }

  // Step 4: Always return 200 OK
  return res.status(200).json({ received: true });
});


// ── 3. Thank You Page (display only — NOT used for fulfillment) ────────────────
app.get('/thank-you', (req, res) => {
  const { order_id, order_status } = req.query;
  res.send(`
    <h2>Thank You!</h2>
    <p>Order Reference: <strong>${order_id || 'N/A'}</strong></p>
    <p><em>Note: This page is for display only. Your order will be confirmed via
    a secure server-side webhook from payment.jivadaya.org.</em></p>
  `);
  // ⚠️  DO NOT use order_status from the URL to grant access or mark orders paid.
  //      Trust only the signed webhook above.
});


app.listen(PORT, () => {
  console.log(`Sample Integration App running at http://localhost:${PORT}/donate`);
});
