# Jivadaya Payment Gateway — Integration Guide

> **Endpoint:** `POST https://payment.jivadaya.org/api/payment/initiate`  
> **Supported Gateways:** CCAvenue · Razorpay

---

## Step 1 — Choose Your Integration Method

| Method | Best For |
|---|---|
| **HTML Form** | Simple websites, landing pages |
| **JavaScript SDK** | Dynamic single-page apps |
| **Server-side POST** | Node.js / PHP backends |

---

## Step 2 — Send the Payment Request

### Option A — Plain HTML Form

Copy this form into your page and update the highlighted fields:

\`\`\`html
<form action="https://payment.jivadaya.org/api/payment/initiate" method="POST">

  <!-- Required -->
  <input type="number"  name="amount"       value="1100"                  required>
  <input type="text"   name="billing_name"  placeholder="Donor Full Name" required>

  <!-- Recommended -->
  <input type="email"  name="billing_email" placeholder="donor@email.com">
  <input type="tel"    name="billing_tel"   placeholder="10-digit mobile">

  <!-- Gateway: 'ccavenue' (default) or 'razorpay' -->
  <input type="hidden" name="pg"           value="ccavenue">

  <!-- Your tracking & callbacks -->
  <input type="hidden" name="order_id"     value="YOUR_UNIQUE_ORDER_ID">
  <input type="hidden" name="callback_url" value="https://your-site.com/thank-you">
  <input type="hidden" name="webhook_url"  value="https://your-site.com/webhook">

  <button type="submit">Donate Now</button>
</form>
\`\`\`

---

### Option B — JavaScript SDK

1. Include the SDK script on your page:

\`\`\`html
<script src="https://payment.jivadaya.org/payment-connector.js"></script>
\`\`\`

2. Call `JivadayaPayment.initiate()` on button click:

\`\`\`javascript
JivadayaPayment.initiate({
  amount:        "1100",
  billing_name:  "Radha Sharma",
  billing_email: "radha@example.com",
  billing_tel:   "9876543210",
  pg:            "ccavenue",          // or "razorpay"
  order_id:      "MY_ORDER_001",
  callback_url:  "https://your-site.com/thank-you",
  webhook_url:   "https://your-site.com/webhook",
  openInNewTab:  false
});
\`\`\`

---

### Option C — Server-Side POST (Node.js)

\`\`\`javascript
const axios = require('axios');

const response = await axios.post(
  'https://payment.jivadaya.org/api/payment/initiate',
  {
    amount:       "1100",
    billing_name: "Radha Sharma",
    pg:           "ccavenue",
    order_id:     "SERVER_ORDER_001",
    callback_url: "https://your-site.com/thank-you",
    webhook_url:  "https://your-site.com/webhook"
  }
);
\`\`\`

---

## Step 3 — Full Payload Reference

| Field | Type | Required | Description |
|---|---|:---:|---|
| `amount` | Number | ✅ | Amount in INR (e.g. `1100`) |
| `billing_name` | String | ✅ | Donor's full name |
| `billing_email` | String | — | Donor email (for e-receipt) |
| `billing_tel` | String | — | 10-digit mobile number |
| `pg` | String | — | `ccavenue` (default) or `razorpay` |
| `order_id` | String | — | Your unique order ID (auto-generated if omitted) |
| `campaign_slug` | String | — | Campaign identifier e.g. `GitaDindi2026` |
| `need_80g` | String | — | `"Yes"` or `"No"` (default `"No"`) |
| `pan_number` | String | — | Donor PAN for 80G tax certificate |
| `callback_url` | String | — | URL where donor lands after payment |
| `webhook_url` | String | — | Your server URL to receive payment result |

---

## Step 4 — Handle the Webhook

Once a payment completes, Jivadaya sends a `POST` JSON to your `webhook_url`:

\`\`\`json
{
  "status":        "Success",
  "order_id":      "MY_ORDER_001",
  "payment_id":    "312009845612",
  "amount":        "1100.00",
  "billing_name":  "Radha Sharma",
  "billing_email": "radha@example.com",
  "gateway":       "CCAvenue",
  "timestamp":     "2026-09-11T13:00:00.000Z"
}
\`\`\`

**Possible `status` values:** `Success` · `Failure` · `Aborted`

**Minimal webhook handler (Node.js / Express):**

\`\`\`javascript
app.post('/webhook', (req, res) => {
  const { status, order_id, amount } = req.body;

  if (status === 'Success') {
    // Mark order as paid in your database
    console.log(`Order ${order_id} paid ₹${amount}`);
  }

  res.sendStatus(200); // Always respond 200 OK
});
\`\`\`

---

## Quick Checklist

- [ ] Replace `order_id` with a **unique ID** from your system on every request
- [ ] Set `callback_url` to your **thank-you / success page**
- [ ] Set `webhook_url` to a **publicly reachable HTTPS endpoint**
- [ ] Confirm payment on your server via the **webhook** before granting access
- [ ] Test with a small amount (₹1) before going live

---

## Support

| Channel | Details |
|---|---|
| **Payment Portal** | https://payment.jivadaya.org |
| **Test Tool** | https://payment.jivadaya.org (built-in gateway tester) |
| **Webhook Logs** | Check your server logs for incoming POST requests |

---

*Jivadaya Payment Connector — v1.0 · September 2026*

---

## Security — Signed Webhook Verification

> [!CAUTION]
> **Never use the `callback_url` redirect params to confirm a payment.**
> The URL `?status=Success` can be crafted by anyone. It is purely for showing the donor a result page.

### Architecture

```
CCAvenue/Razorpay
      │
      │  Encrypted POST (server-to-server)
      ▼
payment.jivadaya.org
      │
      │  Decrypts result → updates DB → fires signed webhook
      ▼
Your Server  (POST /your/webhook)
      │       Header: X-Jivadaya-Signature: sha256=<HMAC>
      │
      ├── Verify signature ──── ✅ Match → mark order paid
      │                         ❌ No match → reject (401)
      ▼
Your DB (order marked PAID)
      │
      ▼
Donor browser → your /thank-you page  (display only)
```

---

### Per-Client Secret Setup

Each site connecting to Jivadaya gets a unique webhook secret stored in the `ph_clients` table on `payment.jivadaya.org`:

```sql
INSERT INTO ph_clients (origin_host, webhook_secret, label)
VALUES ('pay.jivadaya.org', 'super_secret_xyz_123', 'Pay Portal');
```

Jivadaya provides you this secret. Store it as an environment variable:

```bash
# .env on YOUR server
JIVADAYA_WEBHOOK_SECRET=super_secret_xyz_123
```

---

### Step-by-Step Webhook Verification

#### Node.js / Express

```javascript
import express from 'express';
import crypto  from 'crypto';

const WEBHOOK_SECRET = process.env.JIVADAYA_WEBHOOK_SECRET;

// ⚠️  IMPORTANT: Must use express.raw() — not express.json()
// The HMAC is computed over the exact raw bytes that were sent.
app.use('/webhook', express.raw({ type: 'application/json' }));

app.post('/webhook', (req, res) => {
  const rawBody   = req.body;  // Buffer
  const sigHeader = req.headers['x-jivadaya-signature'];  // "sha256=abc123"

  // 1. Verify
  const received = sigHeader?.slice(7) ?? '';
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(received, 'hex');
  const b = Buffer.from(expected, 'hex');
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!valid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // 2. Parse verified payload
  const { status, order_id, payment_id, amount, gateway } = JSON.parse(rawBody.toString('utf8'));

  // 3. Act
  if (status === 'Success') {
    // await db.markPaid(order_id, payment_id);
  }

  // 4. Always return 200
  res.sendStatus(200);
});
```

#### PHP

```php
define('JIVADAYA_WEBHOOK_SECRET', getenv('JIVADAYA_WEBHOOK_SECRET'));

$rawBody   = file_get_contents('php://input');
$sigHeader = $_SERVER['HTTP_X_JIVADAYA_SIGNATURE'] ?? '';

if (strpos($sigHeader, 'sha256=') !== 0) { http_response_code(401); exit; }

$received = substr($sigHeader, 7);
$expected = hash_hmac('sha256', $rawBody, JIVADAYA_WEBHOOK_SECRET);

if (!hash_equals($expected, $received)) {
    http_response_code(401);
    exit;
}

$data = json_decode($rawBody, true);
if ($data['status'] === 'Success') {
    // mark order paid in your DB
}
http_response_code(200);
```

---

### Webhook Payload

```json
{
  "status":        "Success",
  "order_status":  "Success",
  "order_id":      "MY_ORDER_001",
  "payment_id":    "312009845612",
  "tracking_id":   "312009845612",
  "amount":        "1100.00",
  "gateway":       "CCAvenue",
  "timestamp":     "2026-09-18T10:00:00.000Z"
}
```

**Status values:** `Success` · `Failure` · `Aborted`

---

### Security Quick Reference

| What to do | How |
|:---|:---|
| Store secret | In `.env` as `JIVADAYA_WEBHOOK_SECRET` |
| Parse body | `express.raw()` / `file_get_contents('php://input')` |
| Compare | Use `crypto.timingSafeEqual()` / `hash_equals()` — never `===` |
| On failure | Return `401` — do not fulfil the order |
| On success | Return `200` — always, even for failed payments |

Full working example → [`examples/verify-webhook.js`](./examples/verify-webhook.js)

---

*Jivadaya Payment Connector — v1.1 · September 2026*
