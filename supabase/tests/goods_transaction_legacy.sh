#!/usr/bin/env bash
set -euo pipefail
legacy_container="${SUPABASE_DB_CONTAINER:?Required}"
legacy_database="${SUPABASE_DB_DATABASE:?Required}"
[[ "$legacy_container" =~ ^[a-f0-9]{64}$ && "$legacy_database" =~ ^icons_goods_transaction_[a-f0-9]{32}$ ]] || { echo 'Owned disposable clone required' >&2; exit 1; }
for fixture in checkout_cart_snapshot coupon_targeting store_credit_checkout goods_preorders shipping_regions; do
 cat supabase/tests/helpers/goods_kc_fixture.sql "supabase/tests/$fixture.sql" | docker exec -i "$legacy_container" psql -X -U supabase_admin -d "$legacy_database" -v ON_ERROR_STOP=1 -q
 echo "PASS legacy fixture: $fixture"
done
