<?php
/**
 * PHP Server Integration & Webhook Handler Example for payment.jivadaya.org
 *
 * ⚠️  SECURITY NOTE:
 *   - The callback_url redirect (browser URL) must NEVER be trusted for order fulfillment.
 *   - Always verify payments using the signed webhook below.
 */

// ── Your per-client webhook secret ────────────────────────────────────────────
// Set in ph_clients table on payment.jivadaya.org for your domain.
// Store this in an environment variable — never hardcode in source.
define('JIVADAYA_WEBHOOK_SECRET', getenv('JIVADAYA_WEBHOOK_SECRET') ?: 'REPLACE_WITH_YOUR_SECRET');

// ── Signature Verification Helper ─────────────────────────────────────────────
function verifyJivadayaSignature(string $rawBody, string $sigHeader, string $secret): bool {
    if (empty($sigHeader) || strpos($sigHeader, 'sha256=') !== 0) {
        return false;
    }
    $receivedSig = substr($sigHeader, 7);
    $expectedSig = hash_hmac('sha256', $rawBody, $secret);
    // hash_equals() is timing-safe
    return hash_equals($expectedSig, $receivedSig);
}

// ── Handle Webhook Signal ──────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && strpos($_SERVER['REQUEST_URI'], 'jivadaya-webhook') !== false) {
    header('Content-Type: application/json');

    // Step 1: Read raw body bytes (must be raw for HMAC to match)
    $rawBody   = file_get_contents('php://input');
    $sigHeader = $_SERVER['HTTP_X_JIVADAYA_SIGNATURE'] ?? '';

    // Step 2: Verify HMAC signature
    if (!verifyJivadayaSignature($rawBody, $sigHeader, JIVADAYA_WEBHOOK_SECRET)) {
        http_response_code(401);
        echo json_encode(['error' => 'Invalid signature']);
        error_log('[Jivadaya Webhook] ❌ Signature mismatch — request rejected.');
        exit;
    }

    // Step 3: Parse verified JSON payload
    $data = json_decode($rawBody, true);
    if (!$data) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid JSON payload']);
        exit;
    }

    $order_id   = $data['order_id']   ?? '';
    $status     = $data['status']     ?? '';
    $payment_id = $data['payment_id'] ?? '';
    $amount     = $data['amount']     ?? '';
    $gateway    = $data['gateway']    ?? '';

    error_log("[Jivadaya Webhook] ✅ Verified | Order: $order_id | Status: $status | ₹$amount via $gateway");

    // Step 4: Act on verified result
    if ($status === 'Success') {
        // ✅ Mark order as paid in YOUR database here
        // mysqli_query($conn, "UPDATE orders SET status='PAID', payment_id='$payment_id' WHERE order_id='$order_id'");

        file_put_contents('payment_logs.txt',
            date('[Y-m-d H:i:s] ') . "✅ SUCCESS: Order $order_id paid ₹$amount (Txn: $payment_id via $gateway)\n",
            FILE_APPEND
        );
        echo json_encode(['status' => 'OK', 'message' => 'Order updated successfully']);

    } else {
        file_put_contents('payment_logs.txt',
            date('[Y-m-d H:i:s] ') . "❌ FAILED: Order $order_id — Status: $status\n",
            FILE_APPEND
        );
        echo json_encode(['status' => 'NOTED', 'message' => "Payment $status logged"]);
    }

    // Step 5: Always return 200 OK (even for failures — so Jivadaya knows we received it)
    http_response_code(200);
    exit;
}



// Render HTML Donation Form
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Jivadaya PHP Payment Connector</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 30px; background: #f4f6f8; }
        .card { background: white; max-width: 500px; margin: auto; padding: 25px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
        .form-control { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
        .btn { background: #ea580c; color: white; border: none; padding: 12px; width: 100%; border-radius: 4px; font-weight: bold; cursor: pointer; }
    </style>
</head>
<body>
    <div class="card">
        <h2>Donate via payment.jivadaya.org</h2>
        <form action="https://payment.jivadaya.org/api/payment/initiate" method="POST">
            
            <label>Donation Amount (INR):</label>
            <input type="number" name="amount" value="1100" class="form-control" required>
            
            <label>Full Name:</label>
            <input type="text" name="billing_name" placeholder="Enter Full Name" class="form-control" required>
            
            <label>Mobile Number:</label>
            <input type="tel" name="billing_tel" placeholder="10-digit mobile" class="form-control" required>
            
            <label>Select Payment Gateway:</label>
            <select name="pg" class="form-control">
                <option value="ccavenue">CCAvenue (Cards, NetBanking, UPI)</option>
                <option value="razorpay">Razorpay (UPI, QR, Wallets)</option>
            </select>
            
            <input type="hidden" name="order_id" value="PHP_ORDER_<?php echo time(); ?>">
            <input type="hidden" name="webhook_url" value="http://yourdomain.com/sample-php-integration.php?action=jivadaya-webhook">
            <input type="hidden" name="callback_url" value="http://yourdomain.com/thank-you.php">
            
            <button type="submit" class="btn">Proceed to Gateway</button>
        </form>
    </div>
</body>
</html>
