#!/usr/bin/env bash
set -euo pipefail
container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
work_dir="$(mktemp -d)"
app_prefix="goods-identifiers-$$"
actor="00000000-0000-4000-8000-000000042031"
psql_exec() {
  if [[ -n "${PSQL_BIN:-}" ]]; then
    "$PSQL_BIN" -X -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" -v ON_ERROR_STOP=1 "$@"
  else
    docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
  fi
}
cleanup() {
  local result=$?
  trap - EXIT
  if ! psql_exec -q <<SQL > "$work_dir/cleanup.log" 2>&1
select pg_terminate_backend(pid) from pg_stat_activity where application_name like '${app_prefix}-%' and pid<>pg_backend_pid();
begin;
delete from public.audit_log where actor_id='${actor}';
delete from public.goods where ip_id in ('zz-code-race-a','zz-code-repeat-a');
delete from public.ips where id in ('zz-code-race-a','zz-code-repeat-a');
delete from public.verticals where key='zz-code-race';
delete from auth.users where id='${actor}';
delete from private.goods_code_counters where prefix='ZCRA';
commit;
SQL
  then cat "$work_dir/cleanup.log" >&2; result=1; fi
  rm -rf "$work_dir"
  exit "$result"
}
trap cleanup EXIT
psql_exec -q <<SQL >/dev/null
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('${actor}','authenticated','authenticated','goods-code-race@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='${actor}';
insert into public.verticals(key,label,color) values ('zz-code-race','상품 식별자 동시성','#000000');
insert into public.ips(id,title,vertical_key) values
('zz-code-race-a','코드 경합 A','zz-code-race'),('zz-code-repeat-a','코드 경합 B','zz-code-race');
commit;
SQL
save_good() {
  local ip_id="$1" pause="$2" app="$3"
  psql_exec -q <<SQL
set application_name='${app}';
begin;
set local lock_timeout='5s';
set local role authenticated;
select set_config('request.jwt.claim.sub','${actor}',true);
select public.admin_save_good(jsonb_build_object(
 'ip_id','${ip_id}','name','Concurrent Code Product','type','키링','price',12000,'stock','ok',
 'notice_maker','제조사','notice_origin','한국','notice_material','아크릴','notice_size','5cm',
 'notice_made_on','2026-09','notice_as_manager','고객센터','notice_as_contact','02-000-0000'
));
select pg_sleep(${pause});
commit;
SQL
}
wait_state() {
  local app="$1" state="$2" pid="$3" log="$4" observed=""
  for _ in $(seq 1 200); do
    observed="$(psql_exec -qAt -c "select coalesce(wait_event_type,'') from pg_stat_activity where application_name='${app}'")"
    if [[ "$observed" == "$state" ]]; then return 0; fi
    if ! kill -0 "$pid" 2>/dev/null; then cat "$log" >&2; return 1; fi
    sleep 0.025
  done
  cat "$log" >&2; echo "expected ${state}, got ${observed}" >&2; return 1
}
save_good zz-code-race-a 1.5 "${app_prefix}-first" > "$work_dir/first.log" 2>&1 &
first_pid=$!
wait_state "${app_prefix}-first" Timeout "$first_pid" "$work_dir/first.log"
save_good zz-code-repeat-a 0 "${app_prefix}-second" > "$work_dir/second.log" 2>&1 &
second_pid=$!
wait_state "${app_prefix}-second" Lock "$second_pid" "$work_dir/second.log"
wait "$first_pid" || { cat "$work_dir/first.log" >&2; exit 1; }
wait "$second_pid" || { cat "$work_dir/second.log" >&2; exit 1; }
psql_exec -q <<SQL >/dev/null
select 1 / case when
 exists(select 1 from public.goods where id='concurrent-code-product' and code='ZCRA-0001')
 and exists(select 1 from public.goods where id='concurrent-code-product-2' and code='ZCRA-0002')
 and (select count(*) from public.goods_variants where code in ('ZCRA-0001-01','ZCRA-0002-01'))=2
then 1 else 0 end;
SQL
echo 'PASS simultaneous automatic goods identifiers get distinct slugs and codes'
