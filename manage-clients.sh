#!/usr/bin/env bash
# ==============================================================================
# Jivadaya Payment Gateway - Client Onboarding & Verification CLI
# ==============================================================================

SERVER_URL="${JIVADAYA_SERVER_URL:-https://payment.jivadaya.org}"

# Try to read ADMIN_API_KEY from .env if not set in environment
if [ -z "$ADMIN_API_KEY" ] && [ -f ".env" ]; then
  ADMIN_API_KEY=$(grep -E '^ADMIN_API_KEY=' .env | cut -d '=' -f2- | tr -d ' "\r\n')
fi

echo "============================================================"
echo "⚡ JIVADAYA CENTRAL PAYMENT GATEWAY - CLIENT MANAGER"
echo "============================================================"
echo "Server Target: $SERVER_URL"

if [ -z "$ADMIN_API_KEY" ]; then
  echo ""
  read -sp "Enter your ADMIN_API_KEY: " ADMIN_API_KEY
  echo ""
fi

if [ -z "$ADMIN_API_KEY" ]; then
  echo "❌ Error: ADMIN_API_KEY is required."
  exit 1
fi

echo ""
echo "Select an option:"
echo "  1) List all registered clients"
echo "  2) Register a new website (auto-generate webhook secret)"
echo "  3) Send a live signed test ping to a webhook"
echo "  4) Exit"
echo ""
read -p "Choice [1-4]: " choice

case "$choice" in
  1)
    echo ""
    echo "📋 Fetching registered clients from $SERVER_URL..."
    curl -s -X GET "$SERVER_URL/api/admin/clients" \
      -H "x-admin-key: $ADMIN_API_KEY" | jq . || curl -s -X GET "$SERVER_URL/api/admin/clients" -H "x-admin-key: $ADMIN_API_KEY"
    ;;
  2)
    echo ""
    read -p "Enter Website Domain (origin_host) [e.g. vec.jivadaya.org]: " host
    read -p "Enter Friendly Label [e.g. VEC Platform]: " label
    if [ -z "$host" ]; then
      echo "❌ Host is required."
      exit 1
    fi
    echo ""
    echo "⚡ Registering $host..."
    curl -s -X POST "$SERVER_URL/api/admin/clients/register" \
      -H "x-admin-key: $ADMIN_API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"origin_host\":\"$host\",\"label\":\"$label\"}" | jq . || curl -s -X POST "$SERVER_URL/api/admin/clients/register" -H "x-admin-key: $ADMIN_API_KEY" -H "Content-Type: application/json" -d "{\"origin_host\":\"$host\",\"label\":\"$label\"}"
    ;;
  3)
    echo ""
    read -p "Enter Origin Host [e.g. vec.jivadaya.org]: " host
    read -p "Enter Webhook URL [e.g. https://vec.jivadaya.org/api/v1/students/payment-webhook]: " url
    if [ -z "$url" ]; then
      echo "❌ Webhook URL is required."
      exit 1
    fi
    echo ""
    echo "🚀 Sending signed test ping..."
    curl -s -X POST "$SERVER_URL/api/admin/webhook-test" \
      -H "x-admin-key: $ADMIN_API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"origin_host\":\"$host\",\"webhook_url\":\"$url\"}" | jq . || curl -s -X POST "$SERVER_URL/api/admin/webhook-test" -H "x-admin-key: $ADMIN_API_KEY" -H "Content-Type: application/json" -d "{\"origin_host\":\"$host\",\"webhook_url\":\"$url\"}"
    ;;
  4)
    echo "Goodbye!"
    exit 0
    ;;
  *)
    echo "Invalid option."
    exit 1
    ;;
esac

echo ""
echo "============================================================"
