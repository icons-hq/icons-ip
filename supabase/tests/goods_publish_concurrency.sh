#!/usr/bin/env bash
set -euo pipefail

# PSQL_BIN plus PGHOST/PGPORT can select an isolated local database; CI uses its
# existing Supabase container. Every fixture and backend is owned by this script.
db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="goods-publish-race-$$"
user_id="00000000-0000-4000-8000-000000042111"
admin_id="00000000-0000-4000-8000-000000042112"
work_dir="$(mktemp -d)"

psql_exec() {
  if [[ -n "${PSQL_BIN:-}" ]]; then
    "$PSQL_BIN" -X -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" -v ON_ERROR_STOP=1 "$@"
  else
    docker exec -i "$db_container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
  fi
}
psql_scalar() { psql_exec -qAt -c "$1"; }
kc_fixture_sql="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/helpers/goods_kc_fixture.sql"
psql_exec_with_kc() { { cat "$kc_fixture_sql"; cat; } | psql_exec "$@"; }

cleanup() {
  local result=$?
  trap - EXIT
  if ! psql_exec_with_kc -q <<SQL >"$work_dir/cleanup.log" 2>&1
begin;
select pg_terminate_backend(pid) from pg_stat_activity
where application_name like '${test_prefix}-%' and pid <> pg_backend_pid();
delete from public.audit_log where actor_id='${admin_id}';
delete from public.order_items where order_id in (select id from public.orders where user_id='${user_id}');
delete from public.orders where user_id='${user_id}';
delete from public.cart_items where user_id='${user_id}';
select pg_temp.cleanup_goods_kc_fixture('goods-publish-race');
delete from public.goods where id='goods-publish-race';
delete from public.ips where id='goods-publish-race';
delete from public.verticals where key='goods-publish-race';
delete from auth.users where id in ('${user_id}','${admin_id}');
commit;
SQL
  then cat "$work_dir/cleanup.log" >&2; result=1; fi
  rm -rf "$work_dir"
  exit "$result"
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

psql_exec_with_kc -q <<SQL >/dev/null
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('${user_id}','authenticated','authenticated','goods-publish-race@example.test',now(),'{}','{}',now(),now()),
 ('${admin_id}','authenticated','authenticated','ip-publisher-race@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='ip_purchase_race',birth_date='2000-01-01',
 consents='{"terms":true,"privacy":true}',onboarded_at=now() where id='${user_id}';
update public.profiles set role='admin' where id='${admin_id}';
insert into public.verticals(key,label,color) values ('goods-publish-race','게시 경합','#000000');
insert into public.ips(id,title,vertical_key,published_at) values ('goods-publish-race','게시 경합','goods-publish-race',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at,image_path,notice_maker,notice_origin,notice_material,notice_size,notice_made_on,notice_as_manager,notice_as_contact)
values ('goods-publish-race','goods-publish-race','게시 경합 상품','문구',12000,'ok',10,null,'public-media/goods-race.webp','제조사','한국','종이','A5','2026-09','CS','02-000-0000');
select pg_temp.publish_goods_kc_fixture('goods-publish-race');
insert into public.cart_items(user_id,good_id,qty, variant_id) values ('${user_id}','goods-publish-race',1, (select id from public.goods_variants where good_id='goods-publish-race' and is_default));
SQL

purchase_kind=goods
purchase_sql="select public.place_order('${user_id}','{\"recipientName\":\"구매자\",\"phone\":\"01012345678\",\"postalCode\":\"12345\",\"address1\":\"서울시\"}'::jsonb,extensions.gen_random_uuid(),'card');"
  for first in unpublish purchase; do
    psql_exec -q <<SQL >/dev/null
select set_config('request.jwt.claim.sub','${admin_id}',false);
select public.admin_set_good_published('goods-publish-race',true);
SQL
    holder_app="${test_prefix}-${purchase_kind}-${first}-holder"
    waiter_app="${test_prefix}-${purchase_kind}-${first}-waiter"
    holder_log="${work_dir}/holder.log"
    waiter_log="${work_dir}/waiter.log"
    unpublish_sql="select set_config('request.jwt.claim.sub','${admin_id}',true); select public.admin_set_good_published('goods-publish-race',false);"
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

psql_exec -q <<SQL >/dev/null
select 1 / case when
 (select count(*)=1 from public.orders where user_id='${user_id}')
 and (select stock_qty=9 from public.goods where id='goods-publish-race')
 and (select published_at is null from public.goods where id='goods-publish-race')
 then 1 else 0 end as assert_only_purchases_that_locked_first_commit;
SQL
echo 'PASS frozen orders and inventory survive the subsequent unpublish'
