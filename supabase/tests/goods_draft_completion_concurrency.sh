#!/usr/bin/env bash
# Explicit disposable test database only. Creates and removes its own synthetic owner.
set -euo pipefail
exec 3>&1 4>&2
if [[ $# -ne 2 || ! "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ || ! "$2" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
  printf '%s\n' 'Usage: bash supabase/tests/goods_draft_completion_concurrency.sh <test-container> <test-database>' >&2; exit 64
fi
draft_test_container="$1"; draft_test_database="$2"
draft_logs="$(mktemp -d /tmp/icons-draft-completion-race.XXXXXX)"
draft_created=false; draft_pid=''
draft_db() { docker exec -i "$draft_test_container" psql -X -q -U postgres -d "$draft_test_database" -v ON_ERROR_STOP=1 "$@"; }
draft_cleanup() {
  local result=$?
  exec 1>&3 2>&4
  if [[ -n "$draft_pid" ]]; then wait "$draft_pid" 2>/dev/null || true; fi
  if [[ "$draft_created" == true ]]; then
    if ! draft_db >"$draft_logs/cleanup.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='15s';
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 if exists(select 1 from auth.users where id='a9a90000-0000-4000-8000-000000000001'
   and raw_app_meta_data->>'testFixture' is distinct from 'goods-draft-completion-race')
 or exists(select 1 from public.goods where id='goods-draft-completion-race-good' and ip_id<>'goods-draft-completion-race')
 then raise exception 'Refusing cleanup outside owned draft fixture'; end if;
end $$;
delete from public.admin_goods_drafts where owner_id='a9a90000-0000-4000-8000-000000000001';
delete from public.goods where id='goods-draft-completion-race-good';
delete from public.audit_log where actor_id='a9a90000-0000-4000-8000-000000000001';
delete from public.ips where id='goods-draft-completion-race';
delete from public.verticals where key='goods-draft-completion-race';
delete from auth.users where id='a9a90000-0000-4000-8000-000000000001';
commit;
SQL
    then result=1; fi
  fi
  printf 'Evidence: %s\n' "$draft_logs"
  if [[ "$result" != 0 ]]; then for draft_log in "$draft_logs"/*.log; do tail -12 "$draft_log" >&2; done; fi
  exit "$result"
}
trap draft_cleanup EXIT
draft_db >"$draft_logs/setup.log" 2>&1 <<'SQL'
begin;
do $$ begin
 if exists(select 1 from auth.users where id='a9a90000-0000-4000-8000-000000000001')
 or exists(select 1 from public.ips where id='goods-draft-completion-race')
 or exists(select 1 from public.verticals where key='goods-draft-completion-race')
 or exists(select 1 from public.goods where id='goods-draft-completion-race-good' or code='GDRACE-0001')
 or exists(select 1 from public.admin_goods_drafts where id::text like 'a9a90000-0000-4000-8000-%')
 then raise exception 'Fixture already exists; no overwrite'; end if;
end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
 values('a9a90000-0000-4000-8000-000000000001','authenticated','authenticated','goods-draft-completion-race@example.test',
 '{"testFixture":"goods-draft-completion-race"}','{}');
update public.profiles set role='staff' where id='a9a90000-0000-4000-8000-000000000001';
insert into public.verticals(key,label,color) values('goods-draft-completion-race','임시저장 경합 QA','#000000');
insert into public.ips(id,title,vertical_key) values('goods-draft-completion-race','임시저장 경합 QA','goods-draft-completion-race');
set local role authenticated;
select set_config('request.jwt.claim.sub','a9a90000-0000-4000-8000-000000000001',true);
do $$ begin for n in 1001..1040 loop
 perform public.admin_save_goods_draft(('a9a90000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,jsonb_build_object('name','경합 임시저장 '||n),0);
end loop; end $$;
commit;
SQL
draft_created=true
draft_db >"$draft_logs/completion.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout='15s';
set local application_name='goods-draft-completion-race-owner';
set local role authenticated;
select set_config('request.jwt.claim.sub','a9a90000-0000-4000-8000-000000000001',true);
select public.admin_save_good_from_draft('{"id":"goods-draft-completion-race-good","ip_id":"goods-draft-completion-race","name":"동시 등록 합성 상품","type":"문구","price":1000,"stock":"ok","code":"GDRACE-0001"}',
 'a9a90000-0000-4000-8000-000000001001',1);
reset role;
\echo DRAFT_COMPLETION_READY
do $$ declare attempt int; waiter_event text; begin
 for attempt in 1..200 loop
  perform pg_stat_clear_snapshot();
  select a.wait_event into waiter_event from pg_stat_activity a where a.application_name='goods-draft-completion-race-waiter'
    and pg_backend_pid()=any(pg_blocking_pids(a.pid));
  if found then
    raise notice 'Competing draft writer waited for completion: %',waiter_event; return;
  end if;
  perform pg_sleep(0.05);
 end loop;
 raise exception 'Competing draft writer did not wait for completion';
end $$;
commit;
SQL
draft_pid=$!
draft_ready=false
for ((draft_attempt=0; draft_attempt<100; draft_attempt++)); do
  if rg --quiet DRAFT_COMPLETION_READY "$draft_logs/completion.log"; then draft_ready=true; break; fi
  if ! kill -0 "$draft_pid" 2>/dev/null; then break; fi
  sleep 0.05
done
if [[ "$draft_ready" != true ]]; then printf '%s\n' 'Completion did not reach the transaction barrier' >&2; exit 1; fi
draft_db >"$draft_logs/save.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='15s';
set local application_name='goods-draft-completion-race-waiter';
set local role authenticated;
select set_config('request.jwt.claim.sub','a9a90000-0000-4000-8000-000000000001',true);
select public.admin_save_goods_draft('a9a90000-0000-4000-8000-000000001041','{"name":"동시 저장 41번째"}',0);
commit;
SQL
wait "$draft_pid"; draft_pid=''
draft_db >"$draft_logs/readback.log" 2>&1 <<'SQL'
begin;
select count(*) filter(where archived_at is null) as active_drafts,
 count(*) filter(where archived_at is not null and completed_result is null) as unnecessarily_archived,
 count(*) filter(where completed_result is not null) as completed_drafts
from public.admin_goods_drafts where owner_id='a9a90000-0000-4000-8000-000000000001';
do $$ begin
 if (select count(*) from public.admin_goods_drafts where owner_id='a9a90000-0000-4000-8000-000000000001' and archived_at is null)<>40
 or exists(select 1 from public.admin_goods_drafts where owner_id='a9a90000-0000-4000-8000-000000000001' and archived_at is not null and completed_result is null)
 then raise exception 'Concurrent completion must leave 40 active drafts without displacing another draft'; end if;
 if (select count(*) from public.audit_log where actor_id='a9a90000-0000-4000-8000-000000000001' and action='admin.goods.draft.completed')<>1
 or (select count(*) from public.goods where id='goods-draft-completion-race-good')<>1
 then raise exception 'Expected exactly one catalogue completion'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','a9a90000-0000-4000-8000-000000000001',true);
select 1/case when public.admin_save_good_from_draft('{"id":"must-not-create-another-good"}',
 'a9a90000-0000-4000-8000-000000001001',1)->>'draftAlreadyCompleted'='true' then 1 else 0 end as completion_retry_kept;
rollback;
SQL
cat "$draft_logs/readback.log"
printf '%s\n' 'PASS concurrent completion and save retain 40 active drafts and one completed product'
