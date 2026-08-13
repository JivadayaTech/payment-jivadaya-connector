/**
 * Node.js / Express Server Integration Example for payment.jivadaya.org
 * 
 * Demonstrates:
 * 1. Initiating a payment request programmatically or rendering a form.
 * 2. Receiving and processing S2S Webhook signals (`webhook_url`).
 */

import express from 'express';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 4000;
const PAYMENTS_INITIATE_URL = 'https://payment.jivadaya.org/api/payment/initiate';

// 1. Endpoint on your app to render payment button
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
          <input type="text" name="billing_name" value="Amit Patel" required><br><br>
          
          <label>Email:</label>
          <input type="email" name="billing_email" value="amit@example.com"><br><br>
          
          <label>Gateway:</label>
          <select name="pg">
            <option value="ccavenue">CCAvenue</option>
            <option value="razorpay">Razorpay</option>
          </select><br><br>
          
          <!-- Custom Tracking Parameters -->
          <input type="hidden" name="order_id" value="MYAPP_${Date.now()}">
          <input type="hidden" name="webhook_url" value="http://localhost:${PORT}/api/webhooks/jivadaya-payment">
          <input type="hidden" name="callback_url" value="http://localhost:${PORT}/thank-you">
          
          <button type="submit">Proceed to Pay</button>
        </form>
      </body>
    </html>
  `);
});

// 2. Server-to-Server Webhook Receiver (called by payment.jivadaya.org upon payment completion)
app.post('/api/webhooks/jivadaya-payment', (req, res) => {
  console.log('----------------------------------------------------');
  console.log('[Webhook Received] Payment Signal from payment.jivadaya.org:');
  console.log(req.body);
  console.log('----------------------------------------------------');

  const { status, order_id, payment_id, amount } = req.body;

  if (status === 'Success') {
    // UPDATE YOUR DATABASE HERE:
    // e.g. await db.orders.update({ status: 'PAID', payment_id }, { where: { order_id } });
    console.log(`✅ Order ${order_id} marked as PAID. Amount: ₹${amount}. Gateway ID: ${payment_id}`);
    
    // Always return 200 OK or JSON response back to payment.jivadaya.org
    return res.status(200).json({ received: true, status: 'PROCESSED' });
  } else {
    console.log(`❌ Order ${order_id} payment failed or pending.`);
    return res.status(200).json({ received: true, status: 'FAILED' });
  }
});

// 3. User Thank You Page (Redirect target from payment.jivadaya.org)
app.get('/thank-you', (req, res) => {
  const { order_id, order_status, amount } = req.query;
  res.send(`
    <h2>Thank You for Your Donation!</h2>
    <p>Status: <strong>${order_status || 'Success'}</strong></p>
    <p>Order Reference: ${order_id}</p>
    <p>Amount: ₹${amount}</p>
  `);
});

app.listen(PORT, () => {
  console.log(`Sample Integration App running at http://localhost:${PORT}/donate`);
});
