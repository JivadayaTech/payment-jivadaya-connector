/**
 * Jivadaya Payment Gateway — Signed Webhook Verifier
 * ====================================================
 * Drop this file into your Node.js / Express server.
 *
 * How it works:
 *   1. payment.jivadaya.org fires a POST to your webhook_url after payment
 *   2. Every POST includes the header:  X-Jivadaya-Signature: sha256=<hex>
 *   3. You compute the expected HMAC-SHA256 using your shared secret
 *   4. If signatures match → payment result is genuine
 *   5. If they don't match → reject the request (someone is trying to fake it)
 *
 * Setup:
 *   npm install express
 *   JIVADAYA_WEBHOOK_SECRET=<your_secret_from_jivadaya> node verify-webhook.js
 */

import 'dotenv/config';
import express from 'express';
import crypto  from 'crypto';

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Your webhook secret ────────────────────────────────────────────────────────
// This is set for your site in the ph_clients table on payment.jivadaya.org.
// Keep this secret. Never expose it in frontend code.
const WEBHOOK_SECRET = process.env.JIVADAYA_WEBHOOK_SECRET || 'REPLACE_WITH_YOUR_SECRET';

// ── Parse raw body so we can verify the exact bytes that were signed ───────────
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// ── Signature Verification Helper ─────────────────────────────────────────────
/**
 * Verify the X-Jivadaya-Signature header.
 *
 * @param {Buffer|string} rawBody     The raw request body bytes
 * @param {string}        sigHeader   Value of X-Jivadaya-Signature header
 * @param {string}        secret      Your per-client webhook secret
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !sigHeader.startsWith('sha256=')) {
    console.warn('[Webhook] Missing or malformed X-Jivadaya-Signature header.');
    return false;
  }

  const receivedSig = sigHeader.split('sha256=')[1];
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(rawBody)      // must be the raw bytes — not re-parsed JSON
    .digest('hex');

  // Use timingSafeEqual to prevent timing attacks
  const receivedBuf = Buffer.from(receivedSig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');

  if (receivedBuf.length !== expectedBuf.length) return false;

  return crypto.timingSafeEqual(receivedBuf, expectedBuf);
}


// ── Webhook Endpoint ───────────────────────────────────────────────────────────
app.post('/webhook', (req, res) => {
  const rawBody  = req.body;                                // Buffer (raw middleware)
  const sigHeader = req.headers['x-jivadaya-signature'];   // e.g. "sha256=abc123..."

  // ── Step 1: Verify signature ─────────────────────────────────────────────
  const isValid = verifyWebhookSignature(rawBody, sigHeader, WEBHOOK_SECRET);

  if (!isValid) {
    console.error('[Webhook] ❌ SIGNATURE MISMATCH — Request rejected.');
    // Return 401 so payment.jivadaya.org knows it failed (it will log the error)
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // ── Step 2: Parse the verified body ──────────────────────────────────────
  let data;
  try {
    data = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { status, order_id, payment_id, amount, gateway, timestamp } = data;

  console.log('─'.repeat(60));
  console.log('[Webhook] ✅ Signature verified — genuine Jivadaya payment signal');
  console.log(`  Order ID  : ${order_id}`);
  console.log(`  Status    : ${status}`);
  console.log(`  Amount    : ₹${amount}`);
  console.log(`  Gateway   : ${gateway}`);
  console.log(`  Payment ID: ${payment_id}`);
  console.log(`  Timestamp : ${timestamp}`);
  console.log('─'.repeat(60));

  // ── Step 3: Act on the verified payment result ────────────────────────────
  if (status === 'Success') {
    // ✅ Safe to fulfil the order
    // e.g. await db.orders.update({ status: 'PAID', payment_id }, { where: { order_id } });
    console.log(`[Webhook] ✅ Order ${order_id} marked as PAID in your DB.`);

  } else if (status === 'Failure') {
    // ❌ Payment failed
    console.log(`[Webhook] ❌ Order ${order_id} — payment failed.`);

  } else if (status === 'Aborted') {
    // 🚫 Donor cancelled
    console.log(`[Webhook] 🚫 Order ${order_id} — donor aborted payment.`);
  }

  // ── Step 4: Always return 200 OK ─────────────────────────────────────────
  // payment.jivadaya.org expects 200. Any other code means the webhook failed.
  return res.status(200).json({ received: true });
});


// ── Start server ───────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Jivadaya Webhook Receiver running at http://localhost:${PORT}/webhook`);
  console.log(`Expecting secret: ${WEBHOOK_SECRET === 'REPLACE_WITH_YOUR_SECRET' ? '⚠️  NOT SET — set JIVADAYA_WEBHOOK_SECRET in .env' : '✅ Set'}`);
});
