# payment.jivadaya.org - Central Payment Integration Connector

Welcome to the official integration module for connecting external web applications and portals to **`payment.jivadaya.org`**.

This connector enables third-party applications and Jivadaya campaign sites to route payment requests dynamically to multiple payment gateways (**CCAvenue** & **Razorpay**) via a single unified endpoint:

`POST https://payment.jivadaya.org/api/payment/initiate`

---

## 🚀 Quick Features

1. **Multi-Gateway Support**: Toggle between `ccavenue` and `razorpay` using `pg` parameter.
2. **Server-to-Server Webhook Support**: Receive payment status signals on your server (`webhook_url`).
3. **Automated Donor Redirection**: Direct donors seamlessly back to your thank-you page (`callback_url`).
4. **80G & Pan Tax Benefit Support**: Collect donor PAN and address details directly in the payload.

---

## 📁 Directory Structure

```
payment-jivadaya-connector/
├── README.md                           # This Documentation
├── index.html                          # Interactive Payment Portal & Gateway Tester
├── payment-connector.js                # Frontend JS SDK / Helper Module
└── examples/
    ├── sample-node-integration.js      # Express / Node.js Server Integration
    ├── sample-php-integration.php        # PHP Server Webhook & Order Handler
    └── curl-test.sh                    # Command-line cURL test scripts
```

---

## ⚡ HTML Form Integration

```html
<form action="https://payment.jivadaya.org/api/payment/initiate" method="POST">
    <!-- Payment Details -->
    <input type="number" name="amount" value="1100" required>
    <input type="text" name="billing_name" placeholder="Full Name" required>
    <input type="email" name="billing_email" placeholder="Email Address" required>
    <input type="tel" name="billing_tel" placeholder="Phone Number" required>
    
    <!-- Select Gateway: 'ccavenue' or 'razorpay' -->
    <input type="hidden" name="pg" value="ccavenue">
    
    <!-- Tracking & Callbacks -->
    <input type="hidden" name="order_id" value="MY_UNIQUE_ORDER_123">
    <input type="hidden" name="webhook_url" value="https://api.your-domain.com/webhooks/payment">
    <input type="hidden" name="callback_url" value="https://your-domain.com/thank-you">
    
    <button type="submit">Donate Now</button>
</form>
```

---

## 🛠️ API Payload Specification

| Field Name | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `amount` | String/Number | **Yes** | Amount in INR (e.g., `"1100.00"`) |
| `billing_name` | String | **Yes** | Full name of the donor |
| `billing_email` | String | No | Donor email for e-receipts |
| `billing_tel` | String | No | 10-digit mobile number |
| `pg` | String | No | Gateway selection: `ccavenue` (default) or `razorpay` |
| `order_id` | String | No | Custom internal order ID (auto-generated if omitted) |
| `campaign_slug` | String | No | Campaign slug identifier (e.g. `GitaDindi2026`) |
| `need_80g` | String | No | `"Yes"` or `"No"` |
| `pan_number` | String | No | Donor PAN for 80G tax benefit certificate |
| `webhook_url` | String | No | S2S endpoint receiving `JSON` payment result signal |
| `callback_url` | String | No | Browser redirection URL after payment completion |

---

## 📡 S2S Webhook JSON Payload

When a payment completes, `payment.jivadaya.org` posts JSON data to your `webhook_url`:

```json
{
  "status": "Success",
  "order_id": "PayA1B2C3",
  "payment_id": "312009845612",
  "amount": "1100.00",
  "billing_name": "Radhika Sharma",
  "billing_email": "radhika@example.com",
  "gateway": "CCAvenue",
  "timestamp": "2026-08-13T15:00:00.000Z"
}
```

---

## 🛡️ Best Practices & Security
- Always verify the transaction status on your backend using the `webhook_url` before granting digital access or generating tax receipts.
- Pass a unique `order_id` from your system to ensure idempotency.
