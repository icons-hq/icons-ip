#!/usr/bin/env bash
set -euo pipefail

status_env="$(npx supabase status -o env 2>/dev/null)"
api_url="$(printf '%s\n' "$status_env" | sed -n 's/^API_URL="\([^"]*\)"$/\1/p')"
anon_key="$(printf '%s\n' "$status_env" | sed -n 's/^ANON_KEY="\([^"]*\)"$/\1/p')"
service_role_key="$(printf '%s\n' "$status_env" | sed -n 's/^SERVICE_ROLE_KEY="\([^"]*\)"$/\1/p')"
integration_suffix="$(date +%s)-$$"
integration_email="goods-route-${integration_suffix}@example.test"

if [[ -z "$api_url" || -z "$anon_key" || -z "$service_role_key" ]]; then
  echo "local Supabase API credentials are unavailable" >&2
  exit 1
fi

cleanup() {
  docker exec -i supabase_db_icons-ip psql \
    -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q >/dev/null <<SQL
do \$cleanup\$
declare
  target_user_id uuid;
begin
  select auth_user.id
  into target_user_id
  from auth.users as auth_user
  where auth_user.email = '${integration_email}';

  if target_user_id is null then
    return;
  end if;

  delete from private.payment_provider_evidence as evidence
  using public.payment_attempts as attempt
  where evidence.payment_attempt_id = attempt.id
    and attempt.user_id = target_user_id;
  delete from public.refunds as refund
  using public.payments as payment
  where refund.payment_id = payment.id
    and payment.user_id = target_user_id;
  delete from public.payment_attempts where user_id = target_user_id;
  delete from public.payments where user_id = target_user_id;
  delete from public.order_cancellation_requests
  where requested_by = target_user_id;
  delete from public.draw_tickets as ticket
  using public.orders as order_record
  where ticket.source = 'order_paid'
    and ticket.source_id = order_record.id
    and order_record.user_id = target_user_id;
  update public.goods as good
  set stock_qty = good.stock_qty + restored.qty
  from (
    select item.good_id, pg_catalog.sum(item.qty)::integer as qty
    from public.order_items as item
    join public.orders as order_record on order_record.id = item.order_id
    where order_record.user_id = target_user_id
    group by item.good_id
  ) as restored
  where good.id = restored.good_id;
  delete from public.order_items as item
  using public.orders as order_record
  where item.order_id = order_record.id
    and order_record.user_id = target_user_id;
  delete from public.orders where user_id = target_user_id;
  delete from public.cart_items where user_id = target_user_id;
  delete from public.profiles where id = target_user_id;
  delete from auth.users where id = target_user_id;
end;
\$cleanup\$;
SQL
}
trap cleanup EXIT

NEXT_PUBLIC_SUPABASE_URL="$api_url" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$anon_key" \
SUPABASE_SERVICE_ROLE_KEY="$service_role_key" \
RUN_LOCAL_GOODS_PAYMENT_INTEGRATION=true \
GOODS_PAYMENT_INTEGRATION_SUFFIX="$integration_suffix" \
  npx vitest run supabase/tests/goods_payment_route.integration.test.ts
