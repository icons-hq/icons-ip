#!/usr/bin/env bash
# Explicit isolated database only. A disposable fixture, no Storage file or network request.
set -euo pipefail
if [[ $# -ne 2 || ! "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ || ! "$2" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
  printf '%s\n' 'Usage: bash supabase/tests/goods_photo_library_concurrency.sh <test-container> <test-database>' >&2; exit 64
fi
photo_test_container="$1"; photo_test_database="$2"
photo_logs="$(mktemp -d /tmp/icons-photo-race.XXXXXX)"; photo_created=false; photo_pid=''
photo_db() { docker exec -i "$photo_test_container" psql -X -q -U postgres -d "$photo_test_database" -v ON_ERROR_STOP=1 "$@"; }
photo_cleanup() {
  local result=$?
  if [[ -n "$photo_pid" ]]; then wait "$photo_pid" 2>/dev/null || true; fi
  if [[ "$photo_created" == true ]]; then
    if ! photo_db >"$photo_logs/cleanup.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='15s';
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 if exists(select 1 from auth.users where id='00000000-0000-4000-8000-000000713111' and raw_app_meta_data->>'testFixture' is distinct from 'photo-library-race')
 or exists(select 1 from public.goods where id='photo-library-race-good' and ip_id is distinct from 'photo-library-race')
 or exists(select 1 from public.goods_photo_library where id='00000000-0000-4000-8000-000000713113' and created_by<>'00000000-0000-4000-8000-000000713111')
 then raise exception 'Refusing cleanup outside owned photo fixture'; end if;
end $$;
delete from public.goods where id='photo-library-race-good';
delete from public.goods_photo_library where id='00000000-0000-4000-8000-000000713113';
delete from public.admin_artwork_upload_claims where actor_id='00000000-0000-4000-8000-000000713111';
delete from public.audit_log where actor_id='00000000-0000-4000-8000-000000713111';
delete from public.ips where id='photo-library-race';
delete from public.verticals where key='photo-library-race';
delete from auth.users where id='00000000-0000-4000-8000-000000713111';
commit;
SQL
    then result=1; fi
  fi
  printf 'Evidence: %s\n' "$photo_logs"
  if [[ "$result" != 0 ]]; then for f in "$photo_logs"/*.log; do tail -12 "$f" >&2; done; fi
  exit "$result"
}
trap photo_cleanup EXIT
photo_db >"$photo_logs/setup.log" 2>&1 <<'SQL'
begin;
do $$ begin
 if exists(select 1 from auth.users where id='00000000-0000-4000-8000-000000713111') or exists(select 1 from public.ips where id='photo-library-race')
 or exists(select 1 from public.goods_photo_library where id='00000000-0000-4000-8000-000000713113')
 then raise exception 'Fixture already exists; no overwrite'; end if;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('00000000-0000-4000-8000-000000713111','authenticated','authenticated','photo-library-race@example.test',now(),'{"testFixture":"photo-library-race"}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000713111';
insert into public.verticals(key,label,color) values('photo-library-race','사진 경합 QA','#000000');
insert into public.ips(id,title,vertical_key) values('photo-library-race','사진 경합 QA','photo-library-race');
set local role service_role;
select public.service_prepare_admin_artwork_upload('00000000-0000-4000-8000-000000713111','catalog/good/00000000-0000-4000-8000-000000713112.webp','good','image/webp',100,now()+interval '10 minutes');
select * from public.service_begin_admin_artwork_verification('00000000-0000-4000-8000-000000713111','catalog/good/00000000-0000-4000-8000-000000713112.webp');
select public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000713111','catalog/good/00000000-0000-4000-8000-000000713112.webp',100);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000713111',true);
select public.admin_save_goods_photo('00000000-0000-4000-8000-000000713113','public-media/catalog/good/00000000-0000-4000-8000-000000713112.webp','경합 사진',0);
commit;
SQL
photo_created=true
for photo_case in attach archive; do
  photo_db -v race_case="$photo_case" >"$photo_logs/$photo_case-owner.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout='12s';
select set_config('test.photo_case',:'race_case',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000713111',true);
select :'race_case'='attach' as attach_first \gset
\if :attach_first
select public.admin_save_good('{"id":"photo-library-race-good","ip_id":"photo-library-race","name":"경합 상품","type":"문구","price":1000,"image_path":"public-media/catalog/good/00000000-0000-4000-8000-000000713112.webp"}');
\else
select public.admin_save_goods_photo('00000000-0000-4000-8000-000000713113','public-media/catalog/good/00000000-0000-4000-8000-000000713112.webp','경합 사진',1,true);
\endif
reset role;
\echo PHOTO_LOCK_READY
do $$ declare attempt int; begin
 for attempt in 1..150 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity a where a.application_name='photo-race-waiter-'||current_setting('test.photo_case') and pg_backend_pid()=any(pg_blocking_pids(a.pid))) then return; end if;
  perform pg_sleep(0.05);
 end loop;
 raise exception 'Competing writer did not wait for the photo lock';
end $$;
commit;
SQL
  photo_pid=$!
  for ((photo_attempt=0; photo_attempt<100; photo_attempt++)); do
    if rg --quiet PHOTO_LOCK_READY "$photo_logs/$photo_case-owner.log"; then break; fi
    sleep 0.05
  done
  if photo_db -v race_case="$photo_case" >"$photo_logs/$photo_case-waiter.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='12s';
select set_config('application_name','photo-race-waiter-'||:'race_case',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000713111',true);
select :'race_case'='attach' as attach_first \gset
\if :attach_first
select public.admin_save_goods_photo('00000000-0000-4000-8000-000000713113','public-media/catalog/good/00000000-0000-4000-8000-000000713112.webp','경합 사진',1,true);
\else
select public.admin_save_good('{"id":"photo-library-race-good","ip_id":"photo-library-race","name":"경합 상품","type":"문구","price":1000,"image_path":"public-media/catalog/good/00000000-0000-4000-8000-000000713112.webp"}');
\endif
commit;
SQL
  then printf '%s\n' 'Competing writer unexpectedly succeeded' >&2; exit 1; fi
  wait "$photo_pid"; photo_pid=''
  if [[ "$photo_case" == attach ]]; then
    rg --quiet goods_photo_in_use "$photo_logs/$photo_case-waiter.log"
    photo_db -c "delete from public.goods where id='photo-library-race-good';" >"$photo_logs/reset-good.log" 2>&1
  else
    rg --quiet unverified_artwork "$photo_logs/$photo_case-waiter.log"
  fi
  printf 'PHOTO_%s_RACE_PASS\n' "$photo_case"
done
