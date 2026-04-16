#!/bin/bash
# Deploy the expense-query edge function to Supabase
# Run: bash deploy-expense-query.sh

set -e

export PATH="/usr/local/bin:$PATH"

echo "🚀 Deploying expense-query edge function..."

# Check if logged in
if ! npx supabase projects list >/dev/null 2>&1; then
  echo "❌ Not logged in. Please run:"
  echo "   npx supabase login"
  echo "   Then re-run this script."
  exit 1
fi

npx supabase functions deploy expense-query --project-ref iykqsdiochxtfrtmuzdr

echo "✅ expense-query deployed successfully!"
