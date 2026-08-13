#!/bin/bash

# ==============================================================================
# payment.jivadaya.org API Endpoint Test Script (cURL)
# ==============================================================================

ENDPOINT="https://payment.jivadaya.org/api/payment/initiate"

echo "=========================================="
echo "1. Testing CCAvenue Gateway Initiation"
echo "=========================================="

curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "amount=1100.00" \
  -d "billing_name=Test Donor" \
  -d "billing_email=test@jivadaya.org" \
  -d "billing_tel=9999999999" \
  -d "pg=ccavenue" \
  -d "order_id=CURL_CCAV_TEST_001" \
  -d "webhook_url=https://httpbin.org/post" \
  -d "callback_url=https://httpbin.org/get"

echo -e "\n\n=========================================="
echo "2. Testing Razorpay Gateway Initiation"
echo "=========================================="

curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "amount=2500.00" \
  -d "billing_name=Test Donor Razor" \
  -d "billing_email=razor@jivadaya.org" \
  -d "billing_tel=8888888888" \
  -d "pg=razorpay" \
  -d "order_id=CURL_RAZOR_TEST_002" \
  -d "webhook_url=https://httpbin.org/post" \
  -d "callback_url=https://httpbin.org/get"

echo -e "\n\nTest Execution Complete."
