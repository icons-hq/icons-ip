#!/usr/bin/env bash
set -euo pipefail
# 미사용 IP 초안 삭제(admin_delete_draft_ip)와 쿠폰 대상 IP 저장이 어느 순서로 겹쳐도
# 지운 IP를 가리키는 쿠폰이 남지 않는다(ADR-0039). 쿠폰 쓰기는 대상 IP 행을 FOR KEY SHARE로,
# 삭제는 FOR UPDATE로 잠가 두 쓰기가 직렬화된다. 쿠폰 쪽은 저장 RPC가 아니라 표 쓰기로 겹친다 —
# 보장이 트리거(coupons_lock_target_ips)에 있어 RPC·직접 쓰기가 같은 길을 지나기 때문이다.
# 명시한 CI·격리 로컬 DB에서만 돌리고, 고정 접두어 픽스처는 끝나면 지운다.
container="${SUPABASE_DB_CONTAINER:?Select a CI or isolated local Supabase DB container}"
scope="${IP_DRAFT_DELETE_TEST_SCOPE:?Set ci or isolated-local}"
case "$scope" in ci|isolated-local) ;; *) echo 'Unsupported IP draft delete test scope' >&2; exit 1;; esac
case "$container" in supabase_db_*) ;; *) echo 'Expected an explicitly selected Supabase DB container' >&2; exit 1;; esac
work_dir="$(mktemp -d)"
app_prefix="ip-draft-coupon-race-$$"
actor="17c00000-0000-4000-8000-0000000c0001"
psql_exec() {
  docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}
cleanup() {
  local test_status=$?
  local cleanup_status=0
  set +e
  psql_exec -q <<SQL > "$work_dir/cleanup.log" 2>&1
select pg_terminate_backend(pid) from pg_stat_activity where application_name like '${app_prefix}-%' and pid<>pg_backend_pid();
begin;
delete from public.coupons where code like 'T17C-RACE-%';
delete from private.retired_ip_ids where id like 't17c-race-%';
delete from public.audit_log where actor_id='${actor}' or target like 'ips:t17c-race-%';
delete from public.ips where id like 't17c-race-%';
delete from public.verticals where key='t17c-race';
delete from auth.users where id='${actor}';
commit;
SQL
  if [[ $? -ne 0 ]]; then cleanup_status=1; fi
  if [[ "$cleanup_status" -ne 0 ]]; then
    cat "$work_dir/cleanup.log" >&2
    echo "IP draft delete coupon race cleanup failed; logs retained at $work_dir" >&2
    exit 1
  fi
  rm -rf "$work_dir"
  exit "$test_status"
}
trap cleanup EXIT
fail() {
  local message="$1"
  shift
  for log in "$@"; do cat "$log" >&2; done
  echo "$message" >&2
  exit 1
}

# Never-public drafts created through the issuing RPC by a legacy admin (an unconfigured CI database).
psql_exec -q <<SQL >/dev/null
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('${actor}','authenticated','authenticated','ip-draft-coupon-race@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin', nickname='ip_draft_coupon_race', birth_date='2000-01-01', onboarded_at=now() where id='${actor}';
insert into private.operator_legacy_cohort(profile_id,legacy_role) values ('${actor}','admin') on conflict (profile_id) do nothing;
insert into public.verticals(key,label,color) values ('t17c-race','쿠폰 경합 검증','#000000');
set local role authenticated;
select set_config('request.jwt.claim.sub','${actor}',true);
select public.admin_create_ip(slug,'쿠폰 경합 '||slug,null,'t17c-race',null,null,null,null,null)
from unnest(array['t17c-race-a','t17c-race-b','t17c-race-c','t17c-race-keep']) as slug;
commit;
SQL
psql_exec -q -c "insert into public.coupons(code,name,discount_type,discount_value,goods_scope,target_ip_ids)
 values ('T17C-RACE-C','경합 쿠폰 C','fixed',1000,'selected_ips',array['t17c-race-keep'])" >/dev/null

wait_state() {
  local app="$1" state="$2" pid="$3" log="$4" observed=""
  for _ in $(seq 1 200); do
    observed="$(psql_exec -qAt -c "select coalesce(wait_event_type,'') from pg_stat_activity where application_name='${app}'")"
    if [[ "$observed" == "$state" ]]; then return 0; fi
    if ! kill -0 "$pid" 2>/dev/null; then cat "$log" >&2; echo "${app} finished before waiting on ${state}" >&2; return 1; fi
    sleep 0.025
  done
  cat "$log" >&2; echo "expected ${state} for ${app}, got ${observed}" >&2; return 1
}
delete_session() {
  local name="$1" ip="$2" sleep_after="$3"
  psql_exec -q <<SQL
set application_name='${app_prefix}-${name}';
begin;
set local lock_timeout='10s';
set local role authenticated;
select set_config('request.jwt.claim.sub','${actor}',true);
select public.admin_delete_draft_ip('${ip}');
select pg_sleep(${sleep_after});
commit;
SQL
}

# 1. 삭제가 먼저: 쿠폰 추가는 삭제 커밋을 기다렸다가 사라진 IP를 보고 거절된다.
delete_session s1-delete t17c-race-a 1.5 > "$work_dir/s1-delete.log" 2>&1 &
s1_delete=$!
wait_state "${app_prefix}-s1-delete" Timeout "$s1_delete" "$work_dir/s1-delete.log"
psql_exec -q > "$work_dir/s1-coupon.log" 2>&1 <<SQL &
set application_name='${app_prefix}-s1-coupon';
begin;
set local lock_timeout='10s';
insert into public.coupons(code,name,discount_type,discount_value,goods_scope,target_ip_ids)
values ('T17C-RACE-A','경합 쿠폰 A','fixed',1000,'selected_ips',array['t17c-race-a']);
commit;
SQL
s1_coupon=$!
wait_state "${app_prefix}-s1-coupon" Lock "$s1_coupon" "$work_dir/s1-coupon.log"
wait "$s1_delete" || fail 'the first deletion failed' "$work_dir/s1-delete.log"
if wait "$s1_coupon"; then fail 'a coupon was saved for a deleted IP' "$work_dir/s1-coupon.log"; fi
grep -q 'coupon_target_ip_unavailable' "$work_dir/s1-coupon.log" || fail 'unexpected coupon rejection' "$work_dir/s1-coupon.log"

# 2. 쿠폰이 먼저: 삭제는 쿠폰 커밋을 기다렸다가 새 참조를 보고 거절된다.
psql_exec -q > "$work_dir/s2-coupon.log" 2>&1 <<SQL &
set application_name='${app_prefix}-s2-coupon';
begin;
set local lock_timeout='10s';
insert into public.coupons(code,name,discount_type,discount_value,goods_scope,target_ip_ids)
values ('T17C-RACE-B','경합 쿠폰 B','fixed',1000,'selected_ips',array['t17c-race-b']);
select pg_sleep(1.5);
commit;
SQL
s2_coupon=$!
wait_state "${app_prefix}-s2-coupon" Timeout "$s2_coupon" "$work_dir/s2-coupon.log"
delete_session s2-delete t17c-race-b 0 > "$work_dir/s2-delete.log" 2>&1 &
s2_delete=$!
wait_state "${app_prefix}-s2-delete" Lock "$s2_delete" "$work_dir/s2-delete.log"
wait "$s2_coupon" || fail 'the first coupon save failed' "$work_dir/s2-coupon.log"
if wait "$s2_delete"; then fail 'an IP targeted by a committed coupon was deleted' "$work_dir/s2-delete.log"; fi
grep -q 'ip_has_references' "$work_dir/s2-delete.log" || fail 'unexpected deletion rejection' "$work_dir/s2-delete.log"

# 3. 삭제가 먼저 + 기존 쿠폰에 대상 추가(UPDATE OF target_ip_ids)도 같은 길로 거절된다.
delete_session s3-delete t17c-race-c 1.5 > "$work_dir/s3-delete.log" 2>&1 &
s3_delete=$!
wait_state "${app_prefix}-s3-delete" Timeout "$s3_delete" "$work_dir/s3-delete.log"
psql_exec -q > "$work_dir/s3-coupon.log" 2>&1 <<SQL &
set application_name='${app_prefix}-s3-coupon';
begin;
set local lock_timeout='10s';
update public.coupons set target_ip_ids=array['t17c-race-keep','t17c-race-c'] where code='T17C-RACE-C';
commit;
SQL
s3_coupon=$!
wait_state "${app_prefix}-s3-coupon" Lock "$s3_coupon" "$work_dir/s3-coupon.log"
wait "$s3_delete" || fail 'the third deletion failed' "$work_dir/s3-delete.log"
if wait "$s3_coupon"; then fail 'a coupon update targeted a deleted IP' "$work_dir/s3-coupon.log"; fi
grep -q 'coupon_target_ip_unavailable' "$work_dir/s3-coupon.log" || fail 'unexpected coupon update rejection' "$work_dir/s3-coupon.log"

psql_exec -q -c "select 1 / case when
  not exists (select 1 from public.ips where id in ('t17c-race-a','t17c-race-c'))
  and not exists (select 1 from public.coupons where code='T17C-RACE-A')
  and exists (select 1 from public.ips where id='t17c-race-b')
  and (select target_ip_ids from public.coupons where code='T17C-RACE-B')=array['t17c-race-b']
  and (select target_ip_ids from public.coupons where code='T17C-RACE-C')=array['t17c-race-keep']
  and not exists (select 1 from public.coupons as coupon cross join unnest(coupon.target_ip_ids) as target(id)
    where coupon.code like 'T17C-RACE-%' and not exists (select 1 from public.ips as ip where ip.id=target.id))
  and (select count(*) from public.audit_log where action='catalog.ip.deleted' and target in ('ips:t17c-race-a','ips:t17c-race-c'))=2
  and not exists (select 1 from public.audit_log where action='catalog.ip.deleted' and target='ips:t17c-race-b')
 then 1 else 0 end" >/dev/null
echo 'PASS IP draft deletion and coupon IP targets serialize in both orders: no coupon points at a deleted IP'
