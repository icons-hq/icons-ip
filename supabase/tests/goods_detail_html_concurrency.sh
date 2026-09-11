#!/usr/bin/env bash
# Explicit isolated task database only. This exercises real editor, clone and
# category RPCs; no storage upload, customer message, or external call occurs.
set -euo pipefail
if [[ $# -lt 2 || $# -gt 3 || ! "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ || ! "$2" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
  printf '%s\n' 'Usage: bash supabase/tests/goods_detail_html_concurrency.sh <explicit-test-container> <explicit-test-database> [/absolute/evidence-directory]' >&2
  exit 64
fi
html_test_container="$1"
html_test_database="$2"
if [[ -n "${3:-}" ]]; then
  if [[ "$3" != /* ]]; then printf '%s\n' 'Evidence directory must be absolute.' >&2; exit 64; fi
  mkdir -p "$3"
  html_test_logs="$(mktemp -d "${3%/}/goods-html-race.XXXXXX")"
else
  html_test_logs="$(mktemp -d /tmp/icons-goods-html-race.XXXXXX)"
fi
html_fixture_created=false
html_background_pid=''
html_db() { docker exec -i "$html_test_container" psql -X -q -U postgres -d "$html_test_database" -v ON_ERROR_STOP=1 "$@"; }
html_cleanup() {
  local html_status=$?
  if [[ -n "$html_background_pid" ]]; then wait "$html_background_pid" 2>/dev/null || true; fi
  if [[ "$html_fixture_created" == true ]]; then
    if ! html_db >"$html_test_logs/cleanup.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='20s';
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  if exists(select 1 from auth.users where id='00000000-0000-4000-8000-000000478111' and raw_app_meta_data->>'testFixture' is distinct from 'goods-html-race')
    or exists(select 1 from public.goods where id in ('goods-html-race-source','goods-html-race-copy') and ip_id is distinct from 'goods-html-race')
    or exists(select 1 from public.catalog_categories where id='00000000-0000-4000-8000-000000478112' and code<>'goods-html-race')
  then raise exception 'Refusing to clean up data outside the HTML concurrency fixture'; end if;
end $$;
delete from public.audit_log where actor_id='00000000-0000-4000-8000-000000478111' or target in ('goods:goods-html-race-source','goods:goods-html-race-copy');
delete from public.goods where id in ('goods-html-race-source','goods-html-race-copy');
delete from public.catalog_categories where id='00000000-0000-4000-8000-000000478112';
delete from public.ips where id='goods-html-race';
delete from public.verticals where key='goods-html-race';
delete from auth.users where id='00000000-0000-4000-8000-000000478111';
commit;
SQL
    then html_status=1; printf 'Owned fixture cleanup failed: %s/cleanup.log\n' "$html_test_logs" >&2; fi
  fi
  if [[ "$html_status" != 0 ]]; then
    for html_log in "$html_test_logs"/*.log; do
      if rg --quiet 'ERROR|FATAL' "$html_log"; then tail -20 "$html_log" >&2; fi
    done
  fi
  printf 'Evidence preserved: %s\n' "$html_test_logs"
  exit "$html_status"
}
trap html_cleanup EXIT
html_db >"$html_test_logs/setup.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='20s';
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  if exists(select 1 from auth.users where id='00000000-0000-4000-8000-000000478111')
    or exists(select 1 from public.goods where id in ('goods-html-race-source','goods-html-race-copy'))
    or exists(select 1 from public.ips where id='goods-html-race')
    or exists(select 1 from public.verticals where key='goods-html-race')
    or exists(select 1 from public.catalog_categories where id='00000000-0000-4000-8000-000000478112' or code='goods-html-race')
  then raise exception 'HTML race fixture already exists; no overwrite or cleanup attempted'; end if;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('00000000-0000-4000-8000-000000478111','authenticated','authenticated','goods-html-race@example.test',now(),'{"testFixture":"goods-html-race"}','{}',now(),now());
update public.profiles set role='staff',nickname='HTML경합검증' where id='00000000-0000-4000-8000-000000478111';
insert into public.verticals(key,label,color) values('goods-html-race','HTML 경합 검증','#000000');
insert into public.ips(id,title,vertical_key) values('goods-html-race','HTML 경합 검증','goods-html-race');
insert into public.catalog_categories(id,code,name,sort_order) values('00000000-0000-4000-8000-000000478112','goods-html-race','HTML 경합 분류',1);
insert into public.goods(id,ip_id,name,type,price,stock,description,description_format)
 values('goods-html-race-source','goods-html-race','HTML 경합 상품','문구',1000,'ok','<h2>원본 설명</h2>','html');
commit;
SQL
html_fixture_created=true
html_wait_marker() {
  local html_log="$1" html_marker="$2"
  for ((html_attempt=0; html_attempt<100; html_attempt++)); do
    if rg --quiet "$html_marker" "$html_log"; then return 0; fi
    sleep 0.05
  done
  cat "$html_log" >&2
  printf 'Missing barrier marker: %s\n' "$html_marker" >&2
  return 1
}

# Session A takes the real clone/category prefix lock. It advances only after
# session B is blocked on that exact lock, avoiding a sleep-based race guess.
for html_case in clone category; do
  html_db -v race_case="$html_case" >"$html_test_logs/$html_case-owner.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout='15s';
set local deadlock_timeout='500ms';
select set_config('test.html_race_case',:'race_case',true);
select private.lock_catalog_category_tree();
\echo HTML_TREE_LOCKED
do $$ declare attempt integer; begin
  for attempt in 1..160 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity activity join pg_locks waiting on waiting.pid=activity.pid
      where activity.application_name='goods-html-race-save-'||current_setting('test.html_race_case')
        and waiting.locktype='advisory' and not waiting.granted
        and pg_backend_pid()=any(pg_blocking_pids(activity.pid))) then return; end if;
    perform pg_sleep(0.05);
  end loop;
  raise exception 'HTML editor did not reach the category-tree lock barrier';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000478111',true);
select :'race_case'='clone' as run_clone \gset
\if :run_clone
select public.admin_clone_good('00000000-0000-4000-8000-000000478113','goods-html-race-source','goods-html-race-copy','HTML-RACE-COPY','경합 복사');
\else
select public.admin_assign_good_category('00000000-0000-4000-8000-000000478114','goods-html-race-source','00000000-0000-4000-8000-000000478112',
 (select updated_at from public.goods where id='goods-html-race-source'));
\endif
commit;
SQL
  html_background_pid=$!
  html_wait_marker "$html_test_logs/$html_case-owner.log" HTML_TREE_LOCKED
  html_case_status=0
  if html_db -v race_case="$html_case" >"$html_test_logs/$html_case-save.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='15s';
set local deadlock_timeout='500ms';
select set_config('application_name','goods-html-race-save-'||:'race_case',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000478111',true);
select public.admin_save_good(jsonb_build_object('id','goods-html-race-source','previous_id','goods-html-race-source',
 'ip_id','goods-html-race','name','HTML 경합 상품','type','문구','price',1000,'stock','ok',
 'category_id',case when :'race_case'='category' then '00000000-0000-4000-8000-000000478112' else null end,
 'description','<h2>'||:'race_case'||' 저장 완료</h2>','description_format','html','description_image_paths','[]'::jsonb));
commit;
SQL
  then :; else html_case_status=1; fi
  if wait "$html_background_pid"; then :; else html_case_status=1; fi
  html_background_pid=''
  if [[ "$html_case_status" != 0 ]]; then printf 'FAIL: HTML save and %s must both finish without deadlock.\n' "$html_case" >&2; exit 1; fi
  printf 'HTML_%s_RACE_PASS\n' "$html_case"
done
html_db >"$html_test_logs/final-assert.log" 2>&1 <<'SQL'
select 1/case when exists(select 1 from public.goods where id='goods-html-race-copy' and description='<h2>원본 설명</h2>'
 and description_format='html' and published_at is null and stock_qty=0)
 and exists(select 1 from public.goods where id='goods-html-race-source' and description='<h2>category 저장 완료</h2>'
 and category_id='00000000-0000-4000-8000-000000478112')
 and exists(select 1 from public.audit_log where id='00000000-0000-4000-8000-000000478114')
 and not exists(select 1 from private.goods_artwork_copy_authorizations where target_good_id in ('goods-html-race-source','goods-html-race-copy'))
 then 1 else 0 end as assert_both_business_operations_and_authorization_cleanup;
SQL
printf '%s\n' 'PASS: HTML editor serializes with clone and category assignment.'
