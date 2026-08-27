/**
 * CCAvenue AES-128-CBC Encryption & Credential Diagnostic Tool
 * 
 * Usage:
 * 1. Update CCAVENUE_MERCHANT_ID, CCAVENUE_ACCESS_CODE, and CCAVENUE_WORKING_KEY below.
 * 2. Run: node examples/test-ccavenue-credentials.js
 */

import crypto from 'crypto';

// -----------------------------------------------------------------------------
// YOUR CCAVENUE CREDENTIALS FROM DASHBOARD
// -----------------------------------------------------------------------------
const MERCHANT_ID = process.env.CCAVENUE_MERCHANT_ID || 'YOUR_MERCHANT_ID';
const ACCESS_CODE = process.env.CCAVENUE_ACCESS_CODE || 'YOUR_ACCESS_CODE';
const WORKING_KEY = process.env.CCAVENUE_WORKING_KEY || 'YOUR_WORKING_KEY';
const ENVIRONMENT = process.env.CCAVENUE_ENV || 'live'; // 'live' or 'test'

// CCAvenue API Endpoints
const GATEWAY_URL = ENVIRONMENT === 'live'
  ? 'https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction'
  : 'https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction';

// -----------------------------------------------------------------------------
// CCAVENUE AES-128-CBC ENCRYPTION HELPER
// -----------------------------------------------------------------------------
function encryptCCAvenue(plainText, workingKey) {
  // Generate MD5 hash of working key (16 bytes)
  const keyHash = crypto.createHash('md5').update(workingKey.trim()).digest();
  
  // CCAvenue standard IV byte array (0x00 to 0x0f)
  const iv = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f]);
  
  const cipher = crypto.createCipheriv('aes-128-cbc', keyHash, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

// -----------------------------------------------------------------------------
// TEST PAYLOAD GENERATION
// -----------------------------------------------------------------------------
const params = {
  merchant_id: MERCHANT_ID.trim(),
  order_id: 'TEST_ORDER_' + Date.now(),
  currency: 'INR',
  amount: '1.00',
  redirect_url: 'https://payment.jivadaya.org/api/payment/callback',
  cancel_url: 'https://payment.jivadaya.org/api/payment/callback',
  language: 'EN',
  billing_name: 'Test Donor',
  billing_address: 'Main Street',
  billing_city: 'Mumbai',
  billing_state: 'Maharashtra',
  billing_zip: '400001',
  billing_country: 'India',
  billing_tel: '9876543210',
  billing_email: 'test@jivadaya.org'
};

const plainTextQuery = Object.keys(params)
  .map(key => `${key}=${encodeURIComponent(params[key])}`)
  .join('&');

console.log('====================================================');
console.log('CCAvenue Integration Diagnostic Tool');
console.log('====================================================');
console.log(`Environment : ${ENVIRONMENT}`);
console.log(`Target URL  : ${GATEWAY_URL}`);
console.log(`Merchant ID : ${MERCHANT_ID}`);
console.log(`Access Code : ${ACCESS_CODE}`);
console.log(`Working Key : ${WORKING_KEY.substring(0, 4)}... (Length: ${WORKING_KEY.length} chars)`);
console.log('----------------------------------------------------');

if (MERCHANT_ID.includes('YOUR_') || ACCESS_CODE.includes('YOUR_') || WORKING_KEY.includes('YOUR_')) {
  console.error('❌ ERROR: Please set actual credentials in .env or script before running!');
  process.exit(1);
}

try {
  const encRequest = encryptCCAvenue(plainTextQuery, WORKING_KEY);
  console.log('✅ Encryption Successful!');
  console.log(`Encrypted Payload Length: ${encRequest.length} characters`);
  console.log('\n--- Form Payload to POST to CCAvenue ---');
  console.log(`URL         : ${GATEWAY_URL}`);
  console.log(`access_code : ${ACCESS_CODE}`);
  console.log(`encRequest  : ${encRequest.substring(0, 30)}...`);
  console.log('====================================================');
} catch (err) {
  console.error('❌ Encryption Failed:', err.message);
}
