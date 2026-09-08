#!/usr/bin/env bash
set -euo pipefail

# PSQL_BIN plus PGHOST/PGPORT can select an isolated local database; CI uses its
# existing Supabase container. Every fixture and backend is owned by this script.
db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="ip-purchase-race-$$"
user_id="00000000-0000-4000-8000-000000004111"
admin_id="00000000-0000-4000-8000-000000004112"
ticket_type_id="10000000-0000-4000-8000-000000004111"
work_dir="$(mktemp -d)"

psql_exec() {
  if [[ -n "${PSQL_BIN:-}" ]]; then
    "$PSQL_BIN" -X -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" -v ON_ERROR_STOP=1 "$@"
  else
    docker exec -i "$db_container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
  fi
}
psql_scalar() { psql_exec -qAt -c "$1"; }

cleanup() {
  set +e
  psql_exec -q <<SQL >/dev/null 2>&1
select pg_terminate_backend(pid) from pg_stat_activity
where application_name like '${test_prefix}-%' and pid <> pg_backend_pid();
delete from public.audit_log where actor_id='${admin_id}';
delete from public.order_items where order_id in (select id from public.orders where user_id='${user_id}');
delete from public.orders where user_id='${user_id}';
delete from public.ticket_orders where user_id='${user_id}';
delete from public.cart_items where user_id='${user_id}';
delete from public.ticket_types where id='${ticket_type_id}';
delete from public.events where id='ip-purchase-race';
delete from public.goods where id='ip-purchase-race';
delete from public.ips where id='ip-purchase-race';
delete from public.verticals where key='ip-purchase-race';
delete from auth.users where id in ('${user_id}','${admin_id}');
SQL
  rm -rf "$work_dir"
}
trap cleanup EXIT

wait_for_wait() {
  local app="$1" expected="$2" client_pid="$3" log="$4" observed=""
  for _ in $(seq 1 200); do
    observed="$(psql_scalar "select coalesce(wait_event_type,'') from pg_stat_activity where application_name='${app}'")"
    if [[ "$observed" == "$expected" ]]; then return 0; fi
    if ! kill -0 "$client_pid" 2>/dev/null; then
      cat "$log" >&2
      echo "${app} exited before ${expected} wait" >&2
      return 1
    fi
    sleep 0.025
  done
  cat "$log" >&2
  echo "${app}: expected ${expected}, got ${observed}" >&2
  return 1
}

psql_exec -q <<SQL >/dev/null
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('${user_id}','authenticated','authenticated','ip-purchase-race@example.test',now(),'{}','{}',now(),now()),
 ('${admin_id}','authenticated','authenticated','ip-publisher-race@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='ip_purchase_race',birth_date='2000-01-01',
 consents='{"terms":true,"privacy":true}',onboarded_at=now() where id='${user_id}';
update public.profiles set role='admin' where id='${admin_id}';
insert into public.verticals(key,label,color) values ('ip-purchase-race','게시 경합','#000000');
insert into public.ips(id,title,vertical_key,published_at) values ('ip-purchase-race','게시 경합','ip-purchase-race',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty)
values ('ip-purchase-race','ip-purchase-race','게시 경합 상품','문구',12000,'ok',10);
insert into public.events(id,title,mode,status,ip_id)
values ('ip-purchase-race','게시 경합 이벤트','오프라인','예매중','ip-purchase-race');
insert into public.ticket_types(id,event_id,name,price,capacity,sold,per_user_limit)
values ('${ticket_type_id}','ip-purchase-race','게시 경합 회차',12000,10,0,10);
insert into public.cart_items(user_id,good_id,qty) values ('${user_id}','ip-purchase-race',1);
SQL

for purchase_kind in goods ticket; do
  if [[ "$purchase_kind" == goods ]]; then
    purchase_sql="select public.place_order('${user_id}','{\"recipientName\":\"구매자\",\"phone\":\"01012345678\",\"postalCode\":\"12345\",\"address1\":\"서울시\"}'::jsonb,extensions.gen_random_uuid(),'card');"
  else
    purchase_sql="select public.reserve_tickets('${user_id}','${ticket_type_id}',1,extensions.gen_random_uuid());"
  fi
  for first in unpublish purchase; do
    psql_exec -q <<SQL >/dev/null
select set_config('request.jwt.claim.sub','${admin_id}',false);
select public.admin_set_ip_published('ip-purchase-race',true);
SQL
    holder_app="${test_prefix}-${purchase_kind}-${first}-holder"
    waiter_app="${test_prefix}-${purchase_kind}-${first}-waiter"
    holder_log="${work_dir}/holder.log"
    waiter_log="${work_dir}/waiter.log"
    unpublish_sql="select set_config('request.jwt.claim.sub','${admin_id}',true); select public.admin_set_ip_published('ip-purchase-race',false);"
    if [[ "$first" == unpublish ]]; then
      holder_sql="$unpublish_sql"
      waiter_sql="$purchase_sql"
    else
      holder_sql="$purchase_sql"
      waiter_sql="$unpublish_sql"
    fi

    psql_exec -q >"$holder_log" 2>&1 <<SQL &
set application_name='${holder_app}';
begin;
set local lock_timeout='5s';
${holder_sql}
select pg_sleep(1.5);
commit;
SQL
    holder_pid=$!
    wait_for_wait "$holder_app" Timeout "$holder_pid" "$holder_log"
    psql_exec -q >"$waiter_log" 2>&1 <<SQL &
set application_name='${waiter_app}';
begin;
set local lock_timeout='5s';
${waiter_sql}
commit;
SQL
    waiter_pid=$!
    wait_for_wait "$waiter_app" Lock "$waiter_pid" "$waiter_log"
    wait "$holder_pid" || { cat "$holder_log" >&2; exit 1; }
    if [[ "$first" == unpublish ]]; then
      if wait "$waiter_pid"; then echo 'stale purchase unexpectedly succeeded' >&2; exit 1; fi
      if ! grep -q 'catalog_item_unavailable' "$waiter_log"; then cat "$waiter_log" >&2; exit 1; fi
    else
      wait "$waiter_pid" || { cat "$waiter_log" >&2; exit 1; }
    fi
    echo "PASS ${purchase_kind}: ${first} wins, competing transaction serializes"
  done
done

psql_exec -q <<SQL >/dev/null
select 1 / case when
 (select count(*)=1 from public.orders where user_id='${user_id}')
 and (select count(*)=1 from public.ticket_orders where user_id='${user_id}')
 and (select stock_qty=9 from public.goods where id='ip-purchase-race')
 and (select sold=1 from public.ticket_types where id='${ticket_type_id}')
 and (select published_at is null from public.ips where id='ip-purchase-race')
 then 1 else 0 end as assert_only_purchases_that_locked_first_commit;
SQL
echo 'PASS frozen orders and inventory survive the subsequent unpublish'
