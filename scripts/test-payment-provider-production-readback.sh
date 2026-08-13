#!/usr/bin/env bash

set -euo pipefail

{
  cat supabase/tests/payment_provider_production_readback_contract.sql
  cat supabase/tests/payment_provider_production_readback.sql
  printf '%s\n' 'rollback;'
} | docker exec -i supabase_db_icons-ip \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1
