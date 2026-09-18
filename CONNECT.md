# Jivadaya Payment Gateway
## Developer Connection Guide

**Version:** 1.0  
**Date:** September 2026  
**Gateway URL:** https://payment.jivadaya.org  

---

## Overview

The Jivadaya Payment Gateway is a unified payment connector that routes donation
and payment requests to **CCAvenue** or **Razorpay** through a single endpoint.

External developers can connect using a plain HTML form, the JavaScript SDK,
or a direct server-side HTTP POST — no API keys required on your side.

---

## Connection Endpoint

```
POST https://payment.jivadaya.org/api/payment/initiate
Content-Type: application/x-www-form-urlencoded
```

---

## Required Fields

You only need **two fields** to make a payment work:

| Field | Type | Description |
|:---|:---|:---|
| `amount` | Number | Amount in INR — e.g. `1100` |
| `billing_name` | String | Full name of the donor / payer |

---

## Optional Fields

| Field | Type | Default | Description |
|:---|:---|:---|:---|
| `billing_email` | String | — | Donor email for receipt |
| `billing_tel` | String | — | 10-digit mobile number |
| `pg` | String | `ccavenue` | Payment gateway: `ccavenue` or `razorpay` |
| `order_id` | String | Auto-generated | Your unique order / reference ID |
| `campaign_slug` | String | `default` | Campaign identifier e.g. `GitaDindi2026` |
| `need_80g` | String | `No` | 80G tax benefit: `Yes` or `No` |
| `pan_number` | String | — | Donor PAN for 80G certificate |
| `callback_url` | URL | Portal default | Redirect URL after payment completes |
| `webhook_url` | URL | — | Your server endpoint to receive payment result |

---

## Integration Methods

---

### Method 1 — HTML Form  
*Simplest — no JavaScript needed*

```html
<form action="https://payment.jivadaya.org/api/payment/initiate" method="POST">

  <!-- Required -->
  <input type="number"  name="amount"       value="1100"         required>
  <input type="text"    name="billing_name" value="Donor Name"   required>

  <!-- Recommended -->
  <input type="email"   name="billing_email" placeholder="email@example.com">
  <input type="tel"     name="billing_tel"   placeholder="9876543210">

  <!-- Configuration -->
  <input type="hidden"  name="pg"            value="ccavenue">
  <input type="hidden"  name="order_id"      value="YOUR_ORDER_ID">
  <input type="hidden"  name="callback_url"  value="https://your-site.com/thank-you">
  <input type="hidden"  name="webhook_url"   value="https://your-site.com/payment/webhook">

  <button type="submit">Pay Now</button>

</form>
```

---

### Method 2 — JavaScript SDK  
*For dynamic / single-page applications*

**Step 1 — Load the SDK**

```html
<script src="https://payment.jivadaya.org/payment-connector.js"></script>
```

**Step 2 — Initiate payment on button click**

```javascript
document.getElementById('pay-btn').addEventListener('click', function () {

  JivadayaPayment.initiate({
    amount:        "1100",
    billing_name:  "Radha Sharma",
    billing_email: "radha@example.com",
    billing_tel:   "9876543210",
    pg:            "ccavenue",         // or "razorpay"
    order_id:      "MY_ORDER_001",
    campaign_slug: "GitaDindi2026",
    callback_url:  "https://your-site.com/thank-you",
    webhook_url:   "https://your-site.com/payment/webhook",
    openInNewTab:  false
  });

});
```

---

### Method 3 — Server-Side POST  
*For Node.js or PHP backends*

**Node.js (using axios)**

```javascript
const axios = require('axios');

const response = await axios.post(
  'https://payment.jivadaya.org/api/payment/initiate',
  {
    amount:        "1100",
    billing_name:  "Radha Sharma",
    billing_email: "radha@example.com",
    pg:            "razorpay",
    order_id:      "SERVER_ORDER_001",
    callback_url:  "https://your-site.com/thank-you",
    webhook_url:   "https://your-site.com/payment/webhook"
  },
  {
    headers: { 'Content-Type': 'application/json' },
    maxRedirects: 0   // handle redirect in your app
  }
);
```

**PHP (using cURL)**

```php
<?php
$data = [
    'amount'       => '1100',
    'billing_name' => 'Radha Sharma',
    'pg'           => 'ccavenue',
    'order_id'     => 'PHP_ORDER_001',
    'callback_url' => 'https://your-site.com/thank-you',
    'webhook_url'  => 'https://your-site.com/payment/webhook',
];

$ch = curl_init('https://payment.jivadaya.org/api/payment/initiate');
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($data));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
curl_close($ch);
?>
```

---

## Webhook — Receiving Payment Results

When a payment completes, Jivadaya will send a `POST` request to your `webhook_url`
with the following JSON body:

```json
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
```

**Status values**

| Status | Meaning |
|:---|:---|
| `Success` | Payment completed successfully |
| `Failure` | Payment was declined or failed |
| `Aborted` | Donor cancelled before completing |

**Minimal webhook handler — Node.js / Express**

```javascript
app.post('/payment/webhook', express.json(), (req, res) => {
  const { status, order_id, amount, gateway } = req.body;

  if (status === 'Success') {
    // ✅ Mark order as paid in your database
    console.log(`✅ Order ${order_id} — ₹${amount} via ${gateway}`);
  } else {
    // ❌ Log the failure
    console.warn(`❌ Order ${order_id} — Status: ${status}`);
  }

  res.sendStatus(200); // Always return 200 OK
});
```

> **Important:** Always return `HTTP 200` from your webhook endpoint,
> even for failed payments — otherwise the gateway may retry the call.

---

## Switch Between Gateways

Change the `pg` field to switch the payment gateway:

```html
<!-- Use CCAvenue -->
<input type="hidden" name="pg" value="ccavenue">

<!-- Use Razorpay -->
<input type="hidden" name="pg" value="razorpay">
```

---

## Go-Live Checklist

- [ ] Replace `order_id` with a **unique ID** from your system on every request
- [ ] Set `callback_url` to your live **thank-you or success page**
- [ ] Set `webhook_url` to a **publicly accessible HTTPS endpoint**
- [ ] Validate payment on your server via **webhook** before fulfilling the order
- [ ] Test end-to-end with a **small amount (₹1)** before going live

---

## Support & Resources

| Resource | Link |
|:---|:---|
| Payment Portal | https://payment.jivadaya.org |
| Gateway Tester | https://payment.jivadaya.org (built-in test tool) |
| JS SDK | https://payment.jivadaya.org/payment-connector.js |
| Full Integration Guide | `INTEGRATION_GUIDE.md` in this repository |

---

*Jivadaya Payment Gateway · Developer Connection Guide · v1.0 · September 2026*

---

## Security — Signed Webhooks (Required)

> **Never trust the redirect URL to confirm payments.**

The `callback_url` redirect (e.g. `https://your-site.com/thank-you?status=Success`) is for **donor UX only**. Anyone can craft that URL manually. Your server must **never** use it to mark an order as paid.

### How Signed Webhooks Work

Every webhook POST from `payment.jivadaya.org` includes:

```
POST /your/webhook
X-Jivadaya-Signature: sha256=<HMAC-SHA256 hex>
Content-Type: application/json
```

You verify the signature using your **per-client secret** (provided by Jivadaya for your domain, stored in the `ph_clients` table).

### Verify in Node.js

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const received = sigHeader.slice(7);
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(received, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// In your Express route — use express.raw() to get rawBody as Buffer
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const valid = verifyWebhookSignature(req.body, req.headers['x-jivadaya-signature'], WEBHOOK_SECRET);
  if (!valid) return res.status(401).json({ error: 'Invalid signature' });

  const { status, order_id } = JSON.parse(req.body.toString('utf8'));
  if (status === 'Success') { /* mark order paid */ }
  res.sendStatus(200);
});
```

### Verify in PHP

```php
$rawBody   = file_get_contents('php://input');
$sigHeader = $_SERVER['HTTP_X_JIVADAYA_SIGNATURE'] ?? '';
$received  = substr($sigHeader, 7);
$expected  = hash_hmac('sha256', $rawBody, JIVADAYA_WEBHOOK_SECRET);

if (!hash_equals($expected, $received)) {
  http_response_code(401);
  exit;
}
$data = json_decode($rawBody, true);
// safe to use $data now
```

### Security Rules

| Rule | Details |
|:---|:---|
| ❌ Never trust | `?status=Success` in the redirect URL |
| ✅ Always verify | `X-Jivadaya-Signature` header on every webhook |
| 🔒 Keep secret | Your `JIVADAYA_WEBHOOK_SECRET` in `.env` only |
| ⚡ Raw body | Parse body as raw bytes for HMAC — not re-serialized JSON |

For a complete working example → see [`examples/verify-webhook.js`](./examples/verify-webhook.js)
