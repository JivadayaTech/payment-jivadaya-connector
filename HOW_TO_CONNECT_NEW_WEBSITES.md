# How to Connect Any Website to payment.jivadaya.org

This guide explains how **you** onboard any new website or portal, and what **they** need to implement.

---

## ⚡ Method 1: The Visual Web Admin (Easiest — No Commands Needed!)

You don't need to remember any commands or curl scripts.

1. Open in your browser:
   👉 **`https://payment.jivadaya.org/admin.html`**
2. Enter your `ADMIN_API_KEY` once (it saves in your browser so you never type it again).
3. Click **"➕ Connect New Website"**:
   - Enter their domain (e.g. `vec.jivadaya.org`, `donate.jivadaya.org`, `mytemple.org`)
   - Enter a friendly label (e.g. `VEC Platform`, `My Temple`)
   - Click **"Generate Secret & Register"**
4. Copy the generated secret and send the **pre-written Handover Message** (from Tab 4) to the developer!

---

## 💻 Method 2: Terminal Script (For CLI Users)

From inside the `payment-jivadaya-connector` folder:

```bash
./manage-clients.sh
```

It gives you an interactive menu:
```
1) List all registered clients
2) Register a new website (auto-generate webhook secret)
3) Send a live signed test ping to a webhook
4) Exit
```

---

## 📦 What the Client/Partner Website Does (Only 3 Steps!)

Send this to the developer connecting their website:

### 1. In their Server `.env`:
```bash
JIVADAYA_WEBHOOK_SECRET=the_secret_you_generated_for_them
```

### 2. On their Frontend (HTML Form to initiate payment):
```html
<form action="https://payment.jivadaya.org/api/payment/initiate" method="POST">
  <!-- Required Details -->
  <input type="number" name="amount" value="200" required>
  <input type="text" name="billing_name" placeholder="Full Name" required>
  <input type="tel" name="billing_tel" placeholder="Mobile Number" required>

  <!-- Routing & Callbacks -->
  <input type="hidden" name="order_id" value="ORDER_12345">
  <input type="hidden" name="callback_url" value="https://their-site.com/payment/status">
  <input type="hidden" name="webhook_url" value="https://their-site.com/api/webhook/payment">

  <button type="submit">Pay Securely</button>
</form>
```

### 3. On their Backend (Webhook Handler to verify and update DB):
Whenever a transaction finishes, `payment.jivadaya.org` sends an HMAC-SHA256 signed POST request to their `webhook_url` with header `X-Jivadaya-Signature: sha256=<hex>`.

They verify the signature using their `JIVADAYA_WEBHOOK_SECRET` before updating their database.

**Ready-to-use sample code files in this repository:**
- **Node.js / Express:** [`examples/sample-node-integration.js`](./examples/sample-node-integration.js)
- **Node.js Webhook Verifier:** [`examples/verify-webhook.js`](./examples/verify-webhook.js)
- **PHP:** [`examples/sample-php-integration.php`](./examples/sample-php-integration.php)

---

## 🧪 How to Verify the Connection

Once they have added their webhook endpoint, test it instantly:

1. On **`https://payment.jivadaya.org/admin.html`**, go to **"🚀 Test Live Webhook"**.
2. Enter their domain and webhook URL.
3. Click **"Send Signed Test Ping"**.
4. If it shows **`✅ Delivery Succeeded (HTTP 200)`**, the integration is 100% verified and secure!
