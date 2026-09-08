#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="variant-stock-race-$$"
first_user="00000000-0000-4000-8000-000000041931"
second_user="00000000-0000-4000-8000-000000041932"
work_dir="$(mktemp -d)"

psql_exec() {
  if [[ -n "${PSQL_BIN:-}" ]]; then
    "$PSQL_BIN" -X -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" -v ON_ERROR_STOP=1 "$@"
  else
    docker exec -i "$db_container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
  fi
}

cleanup() {
  set +e
  psql_exec -q <<SQL >/dev/null 2>&1
select pg_terminate_backend(pid) from pg_stat_activity
where application_name like '${test_prefix}-%' and pid <> pg_backend_pid();
delete from public.order_items where order_id in (select id from public.orders where user_id in ('${first_user}','${second_user}'));
delete from public.orders where user_id in ('${first_user}','${second_user}');
delete from public.cart_items where user_id in ('${first_user}','${second_user}');
delete from public.goods where id='variant-expand-race';
delete from public.ips where id='variant-expand-race';
delete from public.verticals where key='variant-expand-race';
delete from auth.users where id in ('${first_user}','${second_user}');
SQL
  rm -rf "$work_dir"
}
trap cleanup EXIT

wait_for_wait() {
  local app="$1" expected="$2" client_pid="$3" log="$4" observed=""
  for _ in $(seq 1 200); do
    observed="$(psql_exec -qAt -c "select coalesce(wait_event_type,'') from pg_stat_activity where application_name='${app}'")"
    if [[ "$observed" == "$expected" ]]; then return 0; fi
    if ! kill -0 "$client_pid" 2>/dev/null; then cat "$log" >&2; return 1; fi
    sleep 0.025
  done
  cat "$log" >&2
  echo "${app}: expected ${expected}, got ${observed}" >&2
  return 1
}

psql_exec -q <<SQL >/dev/null
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('${first_user}','authenticated','authenticated','variant-race-first@example.test',now(),'{}','{}',now(),now()),
 ('${second_user}','authenticated','authenticated','variant-race-second@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname=case when id='${first_user}' then 'variant_race_first' else 'variant_race_second' end,
 birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now()
 where id in ('${first_user}','${second_user}');
insert into public.verticals(key,label,color) values ('variant-expand-race','옵션 경합','#000000');
insert into public.ips(id,title,vertical_key,published_at) values ('variant-expand-race','옵션 경합','variant-expand-race',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty)
values ('variant-expand-race','variant-expand-race','마지막 옵션 상품','문구',12000,'ok',1);
insert into public.cart_items(user_id,good_id,qty) values
 ('${first_user}','variant-expand-race',1),('${second_user}','variant-expand-race',1);
SQL

holder_app="${test_prefix}-holder"
waiter_app="${test_prefix}-waiter"
holder_log="${work_dir}/holder.log"
waiter_log="${work_dir}/waiter.log"
address='{"recipientName":"구매자","phone":"01012345678","postalCode":"12345","address1":"서울시"}'

psql_exec -q >"$holder_log" 2>&1 <<SQL &
set application_name='${holder_app}';
begin;
set local lock_timeout='5s';
select public.place_order('${first_user}','${address}'::jsonb,extensions.gen_random_uuid(),'card');
select pg_sleep(1.5);
commit;
SQL
holder_pid=$!
wait_for_wait "$holder_app" Timeout "$holder_pid" "$holder_log"

psql_exec -q >"$waiter_log" 2>&1 <<SQL &
set application_name='${waiter_app}';
begin;
set local lock_timeout='5s';
select public.place_order('${second_user}','${address}'::jsonb,extensions.gen_random_uuid(),'card');
commit;
SQL
waiter_pid=$!
wait_for_wait "$waiter_app" Lock "$waiter_pid" "$waiter_log"
wait "$holder_pid" || { cat "$holder_log" >&2; exit 1; }
if wait "$waiter_pid"; then echo 'both orders bought the last option' >&2; exit 1; fi
if ! grep -q 'out of stock' "$waiter_log"; then cat "$waiter_log" >&2; exit 1; fi

psql_exec -q <<SQL >/dev/null
select 1 / case when
 (select count(*)=1 from public.orders where user_id in ('${first_user}','${second_user}'))
 and (select stock_qty=0 from public.goods where id='variant-expand-race')
 and (select count(*)=1 and min(stock_qty)=0 from public.goods_variants where good_id='variant-expand-race')
 then 1 else 0 end as assert_last_default_variant_is_sold_once;
SQL
echo 'PASS competing checkouts serialize: one order, default option and cache both zero'
