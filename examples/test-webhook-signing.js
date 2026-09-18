/**
 * LOCAL VERIFICATION TEST
 * =======================
 * Verifies the complete webhook signing flow works correctly — no server needed.
 *
 * Run:  node examples/test-webhook-signing.js
 */

import crypto from 'crypto';

// ── Replicate exactly what payment.jivadaya.org does ──────────────────────────
function generateWebhookSignature(payloadString, secret) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payloadString, 'utf8').digest('hex');
}

// ── Replicate exactly what the CLIENT does to verify ─────────────────────────
function verifyWebhookSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const received = sigHeader.slice(7);
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(received, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Test 1: Valid signature ───────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════');
console.log('  Jivadaya Webhook Signing — Verification Test');
console.log('══════════════════════════════════════════════\n');

const SECRET = crypto.randomBytes(32).toString('hex');
console.log('Test secret (auto-generated):', SECRET.slice(0, 16) + '...\n');

const payload = {
  status:      'Success',
  order_id:    'TEST_ORDER_001',
  payment_id:  'TXN123456',
  amount:      '1100.00',
  gateway:     'CCAvenue',
  timestamp:   new Date().toISOString()
};

const payloadString = JSON.stringify(payload);
const signature     = generateWebhookSignature(payloadString, SECRET);

console.log('📦 Payload:  ', payloadString);
console.log('🔏 Signature:', signature, '\n');

// Test 1 — Correct secret → should PASS
const test1 = verifyWebhookSignature(payloadString, signature, SECRET);
console.log(`Test 1 — Valid signature:     ${test1 ? '✅ PASS' : '❌ FAIL'}`);

// Test 2 — Wrong secret → should FAIL
const test2 = verifyWebhookSignature(payloadString, signature, 'wrong_secret');
console.log(`Test 2 — Wrong secret:        ${!test2 ? '✅ PASS (correctly rejected)' : '❌ FAIL (should have been rejected)'}`);

// Test 3 — Tampered payload → should FAIL
const tampered = JSON.stringify({ ...payload, status: 'Success', amount: '99999.00' });
const test3 = verifyWebhookSignature(tampered, signature, SECRET);
console.log(`Test 3 — Tampered payload:    ${!test3 ? '✅ PASS (correctly rejected)' : '❌ FAIL (should have been rejected)'}`);

// Test 4 — Missing signature header → should FAIL
const test4 = verifyWebhookSignature(payloadString, '', SECRET);
console.log(`Test 4 — Missing sig header:  ${!test4 ? '✅ PASS (correctly rejected)' : '❌ FAIL (should have been rejected)'}`);

// Test 5 — Fake URL trick (what the user was worried about)
const fakeUrlParams = 'order_id=TEST_ORDER_001&status=Success&amount=99999';
const test5 = verifyWebhookSignature(fakeUrlParams, signature, SECRET);
console.log(`Test 5 — Fake URL params:     ${!test5 ? '✅ PASS (correctly rejected)' : '❌ FAIL (should have been rejected)'}`);

console.log('\n══════════════════════════════════════════════');
const allPassed = test1 && !test2 && !test3 && !test4 && !test5;
console.log(allPassed
  ? '  ✅ ALL TESTS PASSED — Signing system is secure!'
  : '  ❌ SOME TESTS FAILED — Check the output above.');
console.log('══════════════════════════════════════════════\n');
