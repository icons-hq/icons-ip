#!/usr/bin/env bash
# Local task DB only. This script must never be pointed at a shared or production DB.
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 || -z "$1" || -z "$2" || "$1" == -* || "$2" == -* ]]; then
  printf '%s\n' 'Usage: bash supabase/tests/sales_category_hierarchy_concurrency.sh <explicit-test-container> <explicit-test-database> [/absolute/evidence-directory]' >&2
  exit 64
fi

category_test_container="$1"
category_test_database="$2"
if [[ -n "${3:-}" ]]; then
  if [[ "$3" != /* ]]; then printf '%s\n' 'Evidence directory must be absolute.' >&2; exit 64; fi
  mkdir -p "$3"
  category_test_tmp="$(mktemp -d "${3%/}/category-race.XXXXXX")"
else
  category_test_tmp="$(mktemp -d /tmp/icons-category-race-0474.XXXXXX)"
fi
category_race_pid=''

category_db() {
  docker exec -i "$category_test_container" psql -X -q -U postgres -d "$category_test_database" -v ON_ERROR_STOP=1 "$@"
}

category_cleanup() {
  local category_exit_status=$?
  if [[ -n "$category_race_pid" ]]; then wait "$category_race_pid" 2>/dev/null || true; fi
  if ! category_db >"$category_test_tmp/cleanup.log" 2>&1 <<'SQL'
begin;
delete from public.audit_log
 where actor_id in ('00000000-0000-4000-8000-000000047481','00000000-0000-4000-8000-000000047482')
    or target = 'goods:category-race-good-0474';
delete from public.goods where id = 'category-race-good-0474';
delete from public.catalog_categories where code in ('category-race-a-0474','category-race-b-0474','category-race-idempotent-0474');
delete from public.ips where id = 'category-race-0474';
delete from public.verticals where key = 'category-race-0474';
delete from auth.users where id in ('00000000-0000-4000-8000-000000047481','00000000-0000-4000-8000-000000047482');
commit;
SQL
  then
    printf 'Category race cleanup failed; see %s/cleanup.log\n' "$category_test_tmp" >&2
    category_exit_status=1
  fi
  printf 'Evidence preserved: %s\n' "$category_test_tmp"
  exit "$category_exit_status"
}
trap category_cleanup EXIT

category_db >"$category_test_tmp/setup.log" <<'SQL'
begin;
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000047481','authenticated','authenticated','category-race-staff-a@example.test',now(),'{}','{}',now(),now()),
  ('00000000-0000-4000-8000-000000047482','authenticated','authenticated','category-race-staff-b@example.test',now(),'{}','{}',now(),now());
update public.profiles set role = 'staff' where id in ('00000000-0000-4000-8000-000000047481','00000000-0000-4000-8000-000000047482');
insert into public.verticals(key, label, color) values ('category-race-0474','카테고리 경합 검증','#000000');
insert into public.ips(id, title, vertical_key) values ('category-race-0474','카테고리 경합 검증','category-race-0474');
insert into public.goods(id, ip_id, name, type, price, stock) values ('category-race-good-0474','category-race-0474','카테고리 경합 상품','문구',1000,'ok');
commit;
SQL

category_db >"$category_test_tmp/prep.log" <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047481',true);
select (public.admin_upsert_category('00000000-0000-4000-8000-000000047483',null,'category-race-a-0474','경합 A',null,1,null)::jsonb->>'id') as category_a \gset
select (public.admin_upsert_category('00000000-0000-4000-8000-000000047484',null,'category-race-b-0474','경합 B',null,2,null)::jsonb->>'id') as category_b \gset
commit;
SQL
IFS='|' read -r category_a category_b good_updated_at <<< "$(category_db -A -t -c "select (select id from public.catalog_categories where code='category-race-a-0474'),(select id from public.catalog_categories where code='category-race-b-0474'),updated_at from public.goods where id='category-race-good-0474';")"

category_wait_marker() {
  local category_log="$1" category_marker="$2"
  for ((category_attempt=0; category_attempt<100; category_attempt++)); do
    if rg --quiet "$category_marker" "$category_log"; then return 0; fi
    sleep 0.1
  done
  cat "$category_log" >&2
  printf 'Missing test marker: %s\n' "$category_marker" >&2
  return 1
}

# The second session reuses the first operation id while the first transaction is
# uncommitted. It must wait on the operation lock and return the original row.
category_db >"$category_test_tmp/idempotent-a.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout='15s';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047481',true);
select public.admin_upsert_category('00000000-0000-4000-8000-000000047485',null,'category-race-idempotent-0474','동시 재시도',null,3,null);
\echo CATEGORY_OPERATION_A
select pg_sleep(3);
commit;
SQL
category_race_pid=$!
category_wait_marker "$category_test_tmp/idempotent-a.log" CATEGORY_OPERATION_A
category_db >"$category_test_tmp/idempotent-b.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='15s';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047481',true);
select public.admin_upsert_category('00000000-0000-4000-8000-000000047485',null,'category-race-idempotent-0474','동시 재시도',null,3,null);
commit;
SQL
wait "$category_race_pid"; category_race_pid=''
category_db <<'SQL'
select 1 / case when (select count(*) from public.catalog_categories where code='category-race-idempotent-0474')=1
 and (select count(*) from public.audit_log where id='00000000-0000-4000-8000-000000047485')=1
then 1 else 0 end as assert_concurrent_operation_retries_are_idempotent;
SQL

# A stale goods version is a business conflict after the first assignment
# commits. The global category lock also makes the wait ordering observable.
category_db >"$category_test_tmp/assign-a.log" 2>&1 <<SQL &
begin;
set local statement_timeout='15s';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047481',true);
select public.admin_assign_good_category('00000000-0000-4000-8000-000000047486','category-race-good-0474','${category_a}'::uuid,'${good_updated_at}'::timestamptz);
\echo CATEGORY_ASSIGNMENT_A
select pg_sleep(3);
commit;
SQL
category_race_pid=$!
category_wait_marker "$category_test_tmp/assign-a.log" CATEGORY_ASSIGNMENT_A
set +e
category_db >"$category_test_tmp/assign-b.log" 2>&1 <<SQL
begin;
set local statement_timeout='15s';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047482',true);
select public.admin_assign_good_category('00000000-0000-4000-8000-000000047487','category-race-good-0474','${category_b}'::uuid,'${good_updated_at}'::timestamptz);
commit;
SQL
category_assign_b_status=$?
set -e
wait "$category_race_pid"; category_race_pid=''
if [[ "$category_assign_b_status" -eq 0 ]] || ! rg --quiet 'goods_changed' "$category_test_tmp/assign-b.log"; then
  cat "$category_test_tmp/assign-b.log" >&2
  printf '%s\n' 'Expected stale goods assignment to be rejected.' >&2
  exit 1
fi
category_db <<'SQL'
select 1 / case when (select category_id from public.goods where id='category-race-good-0474')=(select id from public.catalog_categories where code='category-race-a-0474')
then 1 else 0 end as assert_assignment_race_keeps_first_commit;
SQL
printf '%s\n' 'PASS: category operation idempotency and stale assignment race.'
