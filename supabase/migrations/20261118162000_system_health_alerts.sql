-- 시스템 경보(원장 OPS-039·OPS-040·PAY-067·PAY-063·CUS-066).
--
-- 메일·정기결제·선물 만료·리워드·배송 추적 같은 자동 작업이 멈춰도 고객 문의로 처음 알던 빈틈을 닫는다.
--  * Vercel cron 라우트는 실행이 끝날 때마다 service_record_system_job_run으로 결과(작업, 시작·종료, 성공/실패, 상태 코드, 오류 코드)를
--    남긴다. 비밀·개인정보는 싣지 않는다(오류 코드는 형식이 정해진 짧은 코드뿐이고, 상세는 건수·단계 이름만). 실패는 실패 기록에
--    한 줄씩 쌓이고(30일 보존), 같은 작업의 운영 알림('시스템')은 한 시간에 하나만 남긴다.
--  * pg_cron 잡의 실패·멈춤은 cron.job_run_details에서 읽는다(최근 20,000회만 본다 — 하루 약 7천 회라 2.8일쯤이 들어온다).
--    cron.job에는 등록 시각이 없어 처음 본 시각을 private.system_pg_cron_jobs에 따로 남긴다(10분 주기 정리 잡). 처음 본 지
--    멈춤 기준(주기×2+10분)이 지나지 않은 잡은 실행 기록이 없어도 멈춤이 아니라 '기록 없음'이다 — 새 잡이 첫 실행 전에 경보로 뜨지 않는다.
--  * 결제 기한 만료 sweep(expire_stale_checkouts)은 한 주문의 오류가 매분 sweep 전체를 되돌리지 않게 주문마다 예외를 가둔다.
--    건너뛴 주문은 실패 기록(pg_cron)에 남는다 — pg_cron 실행은 성공으로 보이므로 이 기록이 유일한 흔적이다.
--  * 미종결 결제 시도(unknown·needs_review, 리스가 지난 confirming)는 재고·쿠폰을 무기한 잡는다. 운영 화면이 목록·건별 재확인
--    (sales.manage, 감사 기록)을 하고, 10분 주기 cron이 결과 불명(unknown)·멈춘 확인(confirming)만 조회 API로 다시 확인한다
--    (이 배포에 설정된 결제사만, 시도당 30분 쿨다운 — 뽑힐 때 표식을 남겨 조회하지 못한 후보도 큐를 막지 않는다, 마지막 확인이
--    오래된 순, 회차당 최대 5건, 7일 지난 시도는 사람에게 맡긴다). needs_review는 결제사와 원장이 어긋난 건이라 사람만 본다.
--  * 판정(admin_system_health, platform.manage)과 운영 할 일 '시스템 점검' 건수(platform.manage). 읽기 RPC는 STABLE이라
--    PostgREST가 읽기 전용 트랜잭션에서 연다 — 잠금이 없는 has_operator_capability만 쓴다(require_operator_capability는 FOR SHARE).
--  * 외부 알림(메일·메신저)은 붙이지 않는다. 붙일 자리는 앱의 lib/system-health/alert-sink.server.ts 한 함수다.
begin;

create function private.t7_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 't7 patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 1. 자동 작업 실행 기록 ------------------------------------------------------------------------------------------------
-- Vercel cron 작업별 마지막 상태(한 작업 한 행). 주기는 앱의 작업 목록(vercel.json과 시험으로 맞춘다)이 실행마다 알려준다.
create table private.system_job_status (
  job_key text primary key check (job_key ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'),
  label text not null check (char_length(label) between 1 and 60 and label = btrim(label)),
  expected_interval_minutes integer not null check (expected_interval_minutes between 1 and 10080),
  last_started_at timestamptz not null,
  last_finished_at timestamptz not null,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_status_code integer not null check (last_status_code between 100 and 599),
  last_error_code text check (last_error_code is null or last_error_code ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  updated_at timestamptz not null default clock_timestamp()
);
-- 실패 한 번에 한 줄(Vercel cron 실패, pg_cron 안에서 건너뛴 행). 오류 원문·개인정보는 싣지 않는다.
create table private.system_job_failures (
  id uuid primary key default gen_random_uuid(),
  job_key text not null check (job_key ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'),
  source text not null check (source in ('vercel_cron', 'pg_cron')),
  occurred_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  status_code integer check (status_code is null or status_code between 100 and 599),
  error_code text not null check (error_code ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 2000)
);
create index system_job_failures_recent on private.system_job_failures(occurred_at desc);
create index system_job_failures_job on private.system_job_failures(job_key, occurred_at desc);
-- pg_cron 잡을 처음 본 시각(cron.job에는 등록 시각이 없다). 10분 주기 정리 잡이 새 잡을 더하고 없어진 잡을 지운다.
-- '-infinity'는 이 migration 전부터 실행 기록이 있던 잡(처음 본 시각과 무관하게 멈춤을 판정한다).
create table private.system_pg_cron_jobs (
  jobname text primary key,
  first_seen_at timestamptz not null
);
-- 자동 재확인 cron이 후보로 뽑은 시각. 결제사 조회 전에 끝난 후보(설정 없음·claim 전 실패)도 30분 쿨다운에 들게 한다.
create table private.payment_reconciliation_auto_checks (
  attempt_id uuid primary key references public.payment_attempts(id) on delete cascade,
  last_picked_at timestamptz not null,
  picks integer not null default 1 check (picks >= 1)
);
alter table private.system_job_status enable row level security;
alter table private.system_job_failures enable row level security;
alter table private.system_pg_cron_jobs enable row level security;
alter table private.payment_reconciliation_auto_checks enable row level security;
revoke all on private.system_job_status, private.system_job_failures, private.system_pg_cron_jobs,
  private.payment_reconciliation_auto_checks from public, anon, authenticated, service_role;

-- 결제 재확인 쿨다운·마지막 확인 시각을 시도별로 찾는다(웹훅 재전송마다 한 줄씩 쌓이는 표).
create index if not exists goods_payment_reconciliation_audits_target
  on private.goods_payment_reconciliation_audits(target_id, requested_at desc);
create index if not exists ticket_payment_reconciliation_audits_target
  on private.ticket_payment_reconciliation_audits(target_id, requested_at desc);

-- 2. 운영 알림 '시스템' 분류 --------------------------------------------------------------------------------------------
alter table private.admin_operation_alerts drop constraint admin_operation_alerts_category_check;
alter table private.admin_operation_alerts add constraint admin_operation_alerts_category_check
  check (category in ('orders', 'claims', 'inquiries', 'questions', 'reviews', 'system'));

select private.t7_patch_function('private.operator_alert_capability(text)'::regprocedure, array[
$a$when 'reviews' then 'cs.manage' end$a$,
$a$when 'reviews' then 'cs.manage' when 'system' then 'platform.manage' end$a$
]);
select private.t7_patch_function('public.admin_operation_alerts(text,text,timestamp with time zone,uuid,integer)'::regprocedure, array[
$a$'questions','reviews')$a$,
$a$'questions','reviews','system')$a$
]);
select private.t7_patch_function('public.admin_update_operation_alerts(text,uuid[],timestamp with time zone,text,text)'::regprocedure, array[
$a$'questions','reviews')$a$,
$a$'questions','reviews','system')$a$
]);

-- 실패 한 줄을 남기고, 같은 작업의 '시스템' 운영 알림은 한 시간에 하나만 만든다. 알림을 새로 만들었으면 true(새 사건).
create function private.record_system_job_failure(p_job text, p_source text, p_label text, p_started_at timestamptz,
  p_status_code integer, p_error_code text, p_detail jsonb) returns boolean
language plpgsql set search_path = '' as $$
declare alert uuid;
begin
  insert into private.system_job_failures(job_key, source, started_at, status_code, error_code, detail)
  values (p_job, p_source, p_started_at, p_status_code, p_error_code, coalesce(p_detail, '{}'::jsonb));
  insert into private.admin_operation_alerts(event_key, category, title, href)
  values ('system_job:' || p_job || ':' || to_char(date_trunc('hour', clock_timestamp() at time zone 'UTC'), 'YYYYMMDDHH24'),
    'system', left('자동 작업이 실패했습니다 · ' || p_label, 120), '/admin/settings/system')
  on conflict (event_key) do nothing
  returning id into alert;
  return alert is not null;
end $$;
revoke all on function private.record_system_job_failure(text, text, text, timestamptz, integer, text, jsonb) from public, anon, authenticated, service_role;

-- Vercel cron 라우트가 실행 끝에 부른다(service_role). 응답 계약과 무관하게 기록만 한다.
create function public.service_record_system_job_run(p_job text, p_label text, p_expected_interval_minutes integer,
  p_started_at timestamptz, p_finished_at timestamptz, p_ok boolean, p_status_code integer,
  p_error_code text default null, p_detail jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare incident boolean := false;
begin
  if p_job is null or p_job !~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'
    or p_label is null or char_length(p_label) not between 1 and 60 or p_label <> btrim(p_label)
    or p_expected_interval_minutes is null or p_expected_interval_minutes not between 1 and 10080
    or p_started_at is null or p_finished_at is null or not isfinite(p_started_at) or not isfinite(p_finished_at)
    or p_finished_at < p_started_at or p_finished_at > clock_timestamp() + interval '5 minutes'
    or p_started_at < clock_timestamp() - interval '1 day'
    or p_ok is null or p_status_code is null or p_status_code not between 100 and 599
    or (p_ok and p_error_code is not null)
    or (not p_ok and (p_error_code is null or p_error_code !~ '^[A-Za-z0-9_.:-]{1,64}$'))
    or p_detail is null or jsonb_typeof(p_detail) <> 'object' or octet_length(p_detail::text) > 2000 then
    raise invalid_parameter_value using message = 'invalid_system_job_run';
  end if;
  insert into private.system_job_status as s(job_key, label, expected_interval_minutes, last_started_at, last_finished_at,
    last_success_at, last_failure_at, last_status_code, last_error_code, consecutive_failures)
  values (p_job, p_label, p_expected_interval_minutes, p_started_at, p_finished_at,
    case when p_ok then p_finished_at end, case when not p_ok then p_finished_at end, p_status_code,
    case when not p_ok then p_error_code end, case when p_ok then 0 else 1 end)
  on conflict (job_key) do update set
    label = excluded.label,
    expected_interval_minutes = excluded.expected_interval_minutes,
    last_started_at = greatest(s.last_started_at, excluded.last_started_at),
    last_finished_at = greatest(s.last_finished_at, excluded.last_finished_at),
    last_success_at = greatest(s.last_success_at, excluded.last_success_at),
    last_failure_at = greatest(s.last_failure_at, excluded.last_failure_at),
    -- 늦게 도착한 옛 실행이 최신 상태를 덮지 않는다.
    last_status_code = case when excluded.last_finished_at >= s.last_finished_at then excluded.last_status_code else s.last_status_code end,
    last_error_code = case when excluded.last_finished_at >= s.last_finished_at then excluded.last_error_code else s.last_error_code end,
    -- 연속 실패도 최신 실행만 바꾼다. 늦게 온 옛 성공이 최신 실패를 '정상'으로 되돌리지 않게 한다.
    consecutive_failures = case when excluded.last_finished_at < s.last_finished_at then s.consecutive_failures
      when p_ok then 0 else s.consecutive_failures + 1 end,
    updated_at = clock_timestamp();
  if not p_ok then
    incident := private.record_system_job_failure(p_job, 'vercel_cron', p_label, p_started_at, p_status_code, p_error_code, p_detail);
  end if;
  return jsonb_build_object('recorded', true, 'incident', incident);
end $$;
revoke all on function public.service_record_system_job_run(text, text, integer, timestamptz, timestamptz, boolean, integer, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.service_record_system_job_run(text, text, integer, timestamptz, timestamptz, boolean, integer, text, jsonb)
  to service_role;

-- 3. 판정 --------------------------------------------------------------------------------------------------------------
-- 단순 일정만 분 단위 주기로 읽는다(매분·N분마다·매시·N시간마다·매일). 그 밖의 일정은 null — 멈춤 판정을 하지 않는다.
create function private.cron_schedule_minutes(p_schedule text) returns integer
language sql immutable set search_path = '' as $$
  select case
    when p_schedule = '* * * * *' then 1
    when p_schedule ~ '^\*/[1-9][0-9]? \* \* \* \*$' then (pg_catalog.regexp_match(p_schedule, '^\*/([0-9]+) '))[1]::integer
    when p_schedule ~ '^[0-5]?[0-9] \* \* \* \*$' then 60
    when p_schedule ~ '^[0-5]?[0-9] \*/[1-9][0-9]? \* \* \*$' then 60 * (pg_catalog.regexp_match(p_schedule, ' \*/([0-9]+) '))[1]::integer
    when p_schedule ~ '^[0-5]?[0-9] ([01]?[0-9]|2[0-3]) \* \* \*$' then 1440
  end
$$;
revoke all on function private.cron_schedule_minutes(text) from public, anon, authenticated, service_role;

-- 주기의 두 배 + 10분 동안 성공이 없으면 멈춘 것으로 본다(매분 → 12분, 10분마다 → 30분, 매일 → 2일 10분).
create function private.system_job_stall_threshold(p_minutes integer) returns interval
language sql immutable set search_path = '' as $$
  select make_interval(mins => p_minutes * 2 + 10)
$$;
revoke all on function private.system_job_stall_threshold(integer) from public, anon, authenticated, service_role;

-- 결제 시도가 미종결인가: 결과 불명·확인 필요, 또는 확인 리스가 지난 확인 중.
create function private.payment_attempt_unresolved(p_state public.payment_attempt_state, p_claim_expires_at timestamptz, p_at timestamptz)
returns boolean language sql immutable set search_path = '' as $$
  select p_state in ('unknown', 'needs_review') or (p_state = 'confirming' and p_claim_expires_at is not null and p_claim_expires_at <= p_at)
$$;
revoke all on function private.payment_attempt_unresolved(public.payment_attempt_state, timestamptz, timestamptz) from public, anon, authenticated, service_role;

-- 시스템 상태 전체. 읽기만 한다(운영 할 일 건수도 이 판정을 쓴다).
create function private.system_health_report() returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  at timestamptz := now();
  vercel_jobs jsonb; cron_jobs jsonb; failures jsonb; payments jsonb; emails jsonb;
  failing integer; stalled integer; problem integer; unresolved integer; mail_failed integer; mail_bounced integer;
begin
  -- Vercel cron: 작업별 마지막 상태와 24시간 실패 수.
  select coalesce(jsonb_agg(row_json order by job_key), '[]'::jsonb) into vercel_jobs from (
    select s.job_key, jsonb_build_object('jobKey', s.job_key, 'source', 'vercel_cron', 'label', s.label, 'schedule', null,
      'expectedIntervalMinutes', s.expected_interval_minutes, 'lastRunAt', s.last_finished_at, 'lastSuccessAt', s.last_success_at,
      'lastFailureAt', s.last_failure_at, 'lastStatusCode', s.last_status_code, 'lastErrorCode', s.last_error_code,
      'consecutiveFailures', s.consecutive_failures,
      'failures24h', (select count(*) from private.system_job_failures f where f.job_key = s.job_key and f.source = 'vercel_cron'
        and f.occurred_at > at - interval '24 hours'),
      'failing', s.consecutive_failures > 0,
      -- 실행 기록 자체가 끊겼다(크론이 불리지 않거나 함수가 시간 초과로 끝나 기록하지 못함). 실패가 이어지는 것은 failing이다.
      'stalled', s.last_finished_at < at - private.system_job_stall_threshold(s.expected_interval_minutes),
      'active', true) row_json
    from private.system_job_status s) v;

  -- pg_cron: 최근 실행 표본(런 번호 역순 20,000회 ≈ 2.8일)에서 작업별 마지막 실행·성공·24시간 실패. 표본이 멈춤 기준보다 짧거나,
  -- 처음 본 지(private.system_pg_cron_jobs) 멈춤 기준이 지나지 않았거나 아직 정리 잡이 보지 못한 새 잡이면 멈춤을 판정하지 않는다
  -- (새 잡은 첫 실행 전까지 '기록 없음'). 실행 안에서 건너뛴 행(실패 기록의 pg_cron 줄)도 그 작업의 실패로 센다.
  with recent as materialized (
    select d.jobid, d.status, d.start_time, d.end_time from cron.job_run_details d order by d.runid desc limit 20000
  ), horizon as (
    select min(r.start_time) as since from recent r
  ), runs as (
    select r.jobid,
      max(r.end_time) filter (where r.status = 'succeeded') as last_success_at,
      max(coalesce(r.end_time, r.start_time)) filter (where r.status = 'failed') as last_failure_at,
      max(coalesce(r.end_time, r.start_time)) filter (where r.status in ('succeeded', 'failed')) as last_run_at,
      count(*) filter (where r.status = 'failed' and r.start_time > at - interval '24 hours') as failures,
      (array_agg(r.status order by r.start_time desc) filter (where r.status in ('succeeded', 'failed')))[1] as last_status
    from recent r group by r.jobid
  ), skipped as (
    select f.job_key, max(f.occurred_at) as last_at, count(*) filter (where f.occurred_at > at - interval '24 hours') as failures
    from private.system_job_failures f where f.source = 'pg_cron' group by f.job_key
  ), jobs as (
    select j.jobname, j.schedule, j.active, private.cron_schedule_minutes(j.schedule) as minutes,
      runs.last_success_at, runs.last_failure_at, runs.last_run_at, coalesce(runs.failures, 0) as run_failures, runs.last_status,
      skipped.last_at as skipped_at, coalesce(skipped.failures, 0) as skipped_failures, horizon.since, seen.first_seen_at
    from cron.job j
    left join runs on runs.jobid = j.jobid
    left join skipped on skipped.job_key = j.jobname
    left join private.system_pg_cron_jobs seen on seen.jobname = j.jobname
    cross join horizon
    where j.jobname is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('jobKey', r.jobname, 'source', 'pg_cron', 'label', null, 'schedule', r.schedule,
      'expectedIntervalMinutes', r.minutes, 'lastRunAt', r.last_run_at, 'lastSuccessAt', r.last_success_at,
      'lastFailureAt', nullif(greatest(coalesce(r.last_failure_at, '-infinity'::timestamptz), coalesce(r.skipped_at, '-infinity'::timestamptz)), '-infinity'::timestamptz),
      'lastStatusCode', null,
      'lastErrorCode', case when r.last_status = 'failed' then 'pg_cron_failed'
        when r.skipped_at > at - private.system_job_stall_threshold(coalesce(r.minutes, 60)) then 'rows_skipped' end,
      'consecutiveFailures', case when r.last_status = 'failed' then 1 else 0 end,
      'failures24h', r.run_failures + r.skipped_failures,
      'failing', r.active and (coalesce(r.last_status = 'failed', false)
        or coalesce(r.skipped_at > at - private.system_job_stall_threshold(coalesce(r.minutes, 60)), false)),
      'stalled', r.active and r.minutes is not null and r.since is not null and r.first_seen_at is not null
        and r.since < at - private.system_job_stall_threshold(r.minutes)
        and r.first_seen_at < at - private.system_job_stall_threshold(r.minutes)
        and coalesce(r.last_success_at, '-infinity'::timestamptz) < at - private.system_job_stall_threshold(r.minutes),
      'active', r.active) order by r.jobname), '[]'::jsonb)
  into cron_jobs from jobs r;

  -- 최근 24시간 실패(최신 50건): 기록된 실패 + pg_cron 실패 실행. 오류 원문(return_message)은 싣지 않는다.
  select coalesce(jsonb_agg(row_json order by occurred_at desc), '[]'::jsonb) into failures from (
    select x.occurred_at, jsonb_build_object('jobKey', x.job_key, 'source', x.source, 'occurredAt', x.occurred_at,
      'statusCode', x.status_code, 'errorCode', x.error_code) row_json
    from (
      select f.job_key, f.source, f.occurred_at, f.status_code, f.error_code from private.system_job_failures f
      where f.occurred_at > at - interval '24 hours'
      union all
      select j.jobname, 'pg_cron', coalesce(d.end_time, d.start_time), null::integer, 'pg_cron_failed'
      from (select * from cron.job_run_details order by runid desc limit 20000) d
      join cron.job j on j.jobid = d.jobid
      where d.status = 'failed' and d.start_time > at - interval '24 hours' and j.jobname is not null
    ) x order by x.occurred_at desc limit 50) l;

  -- 미종결 결제 시도(굿즈·티켓·그 밖).
  select jsonb_build_object(
      'goods', count(*) filter (where a.purpose = 'order'),
      'tickets', count(*) filter (where a.purpose = 'ticket'),
      'other', count(*) filter (where a.purpose not in ('order', 'ticket')),
      'oldestAt', min(a.created_at)),
    count(*)
  into payments, unresolved
  from public.payment_attempts a
  where a.state in ('unknown', 'needs_review', 'confirming') and private.payment_attempt_unresolved(a.state, a.claim_expires_at, at);

  -- 메일: 우리·발송사 쪽 실패(실패·결과 불명·확인 필요)와 반송(반송·수신 거부·발송사 차단). 최근 24시간.
  select (select count(*) from public.email_deliveries d where d.status = 'failed' and d.claimed_at > at - interval '24 hours')
    + (select count(*) from private.email_intents i where i.state in ('failed', 'unknown', 'needs_review') and i.updated_at > at - interval '24 hours'),
    (select count(*) from private.email_intents i where i.state in ('bounced', 'complained', 'suppressed') and i.updated_at > at - interval '24 hours')
  into mail_failed, mail_bounced;
  emails := jsonb_build_object('failed24h', mail_failed, 'bounced24h', mail_bounced);

  select count(*) filter (where (e->>'failing')::boolean), count(*) filter (where (e->>'stalled')::boolean),
    count(*) filter (where (e->>'failing')::boolean or (e->>'stalled')::boolean)
  into failing, stalled, problem
  from jsonb_array_elements(vercel_jobs || cron_jobs) e;

  return jsonb_build_object('asOf', at, 'jobs', vercel_jobs || cron_jobs, 'recentFailures', failures,
    'payments', payments, 'emails', emails,
    'counts', jsonb_build_object('failingJobs', failing, 'stalledJobs', stalled, 'problemJobs', problem,
      'unresolvedPayments', unresolved, 'emailFailures', mail_failed, 'emailBounces', mail_bounced,
      -- 운영 할 일 건수: 지금 문제가 있는 작업 + 미종결 결제 + 메일 발송 실패. 반송은 받는 주소 문제라 화면에서만 보인다.
      'issues', problem + unresolved + mail_failed));
end $$;
revoke all on function private.system_health_report() from public, anon, authenticated, service_role;

create function private.system_health_issue_count() returns integer
language sql stable set search_path = '' as $$
  select (private.system_health_report()->'counts'->>'issues')::integer
$$;
revoke all on function private.system_health_issue_count() from public, anon, authenticated, service_role;

-- 시스템 상태 화면(platform.manage). STABLE — 잠금 없는 권한 판정만 쓴다.
create function public.admin_system_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not public.has_operator_capability('platform.manage', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  return private.system_health_report();
end $$;
revoke all on function public.admin_system_health() from public, anon, authenticated, service_role;
grant execute on function public.admin_system_health() to authenticated;

-- 미종결 결제 시도 목록(sales.manage, 오래된 순). 주문번호·금액·상태·마지막 확인 시각. 구매자 정보는 싣지 않는다.
create function public.admin_unresolved_payment_attempts(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare at timestamptz := now(); result jsonb;
begin
  if (select auth.uid()) is null or not public.has_operator_capability('sales.manage', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    raise invalid_parameter_value using message = 'invalid_payment_attempt_filter';
  end if;
  with open_attempts as materialized (
    select a.* from public.payment_attempts a
    where a.state in ('unknown', 'needs_review', 'confirming') and private.payment_attempt_unresolved(a.state, a.claim_expires_at, at)
  ), page as (
    select a.* from open_attempts a order by a.created_at, a.id limit p_limit
  )
  select jsonb_build_object(
    'total', (select count(*) from open_attempts),
    'asOf', at,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'attemptId', a.id, 'purpose', a.purpose, 'provider', a.provider, 'state', a.state,
      'reason', case when a.state = 'confirming' then 'confirming_stalled' else a.state::text end,
      'amount', a.amount, 'currency', a.currency, 'refId', a.ref_id,
      'orderNumber', case when a.purpose = 'order' then (select o.order_number from public.orders o where o.id = a.ref_id) end,
      'createdAt', a.created_at, 'updatedAt', a.updated_at, 'claimExpiresAt', a.claim_expires_at,
      'lastCheckedAt', greatest(
        (select max(g.requested_at) from private.goods_payment_reconciliation_audits g where g.target_id = a.id and g.operation = 'payment'),
        (select max(t.requested_at) from private.ticket_payment_reconciliation_audits t where t.target_id = a.id and t.operation = 'payment')),
      'reconcilable', (a.purpose = 'order' and a.provider in ('toss', 'nicepay')) or (a.purpose = 'ticket' and a.provider = 'toss'))
      order by a.created_at, a.id) from page a), '[]'::jsonb))
  into result;
  return result;
end $$;
revoke all on function public.admin_unresolved_payment_attempts(integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_unresolved_payment_attempts(integer) to authenticated;

-- 4. 결제 상태 다시 확인(운영자) --------------------------------------------------------------------------------------
-- 감사 기록을 남기고 서버 액션이 재정합 seam에 넘길 caseRef를 돌려준다. 같은 요청번호의 재요청은 같은 caseRef를 돌려준다
-- (재정합 자체가 멱등이다). 결제사 조회 남용을 막아 같은 시도는 1분에 한 번만 새로 확인한다.
create function public.admin_begin_payment_reconciliation(p_attempt_id uuid, p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare actor uuid; attempt public.payment_attempts; prior_row public.audit_log; case_ref text;
begin
  actor := private.require_operator_capability('sales.manage', false);
  if p_attempt_id is null or p_operation_id is null then
    raise invalid_parameter_value using message = 'invalid_payment_reconciliation';
  end if;
  case_ref := 'admin-' || replace(p_operation_id::text, '-', '');
  select * into prior_row from public.audit_log where id = p_operation_id;
  if found then
    if prior_row.action is distinct from 'admin.payment_attempt.reconcile_requested' or prior_row.actor_id is distinct from actor
      or prior_row.target is distinct from 'payment_attempt:' || p_attempt_id::text then
      raise unique_violation using message = 'payment_reconciliation_operation_conflict';
    end if;
  else
    select * into attempt from public.payment_attempts where id = p_attempt_id;
    if not found then raise no_data_found using message = 'payment_attempt_not_found'; end if;
    if not private.payment_attempt_unresolved(attempt.state, attempt.claim_expires_at, clock_timestamp()) then
      raise object_not_in_prerequisite_state using message = 'payment_attempt_not_unresolved';
    end if;
    if exists(select 1 from private.goods_payment_reconciliation_audits g where g.target_id = p_attempt_id and g.requested_at > clock_timestamp() - interval '1 minute')
      or exists(select 1 from private.ticket_payment_reconciliation_audits t where t.target_id = p_attempt_id and t.requested_at > clock_timestamp() - interval '1 minute') then
      raise object_not_in_prerequisite_state using message = 'payment_reconciliation_cooldown';
    end if;
    insert into public.audit_log(id, actor_id, action, target, diff)
    values (p_operation_id, actor, 'admin.payment_attempt.reconcile_requested', 'payment_attempt:' || attempt.id::text,
      jsonb_build_object('purpose', attempt.purpose, 'provider', attempt.provider, 'stateBefore', attempt.state,
        'refId', attempt.ref_id, 'caseRef', case_ref));
  end if;
  select * into attempt from public.payment_attempts where id = p_attempt_id;
  if not found then raise no_data_found using message = 'payment_attempt_not_found'; end if;
  return jsonb_build_object('attemptId', attempt.id, 'purpose', attempt.purpose, 'provider', attempt.provider,
    'state', attempt.state, 'refId', attempt.ref_id, 'caseRef', case_ref);
end $$;
revoke all on function public.admin_begin_payment_reconciliation(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_begin_payment_reconciliation(uuid, uuid) to authenticated;

-- 5. 자동 재확인 후보(cron, service_role) -------------------------------------------------------------------------------
-- 결과 불명(unknown)·멈춘 확인(confirming 리스 만료)만. 조회 API가 있는 시도(굿즈 토스·나이스페이, 티켓 토스) 중 이 배포에 결제사
-- 설정이 있는 것(p_providers — 앱이 설정된 게이트웨이만 넘긴다)이고, 마지막 변경 뒤 10분이 지났고(콜백·웹훅 처리 중인 건을 건드리지
-- 않는다), 7일 안에 만든 시도이며, 30분 안에 누구도(웹훅·운영자·cron) 확인하거나 이 cron이 뽑지 않은 것. 뽑는 순간 표식을 남겨
-- 결제사 조회 전에 끝난 후보(설정 없음·claim 전 실패)도 30분 쿨다운에 들고, 마지막 확인·뽑힘이 오래된 순(없으면 맨 앞)으로 골라
-- 조회하지 못하는 후보가 큐 앞자리를 차지하지 못한다.
create function public.service_claim_payment_reconciliation_candidates(p_limit integer, p_providers text[]) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare at timestamptz := clock_timestamp(); result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5 or p_providers is null or cardinality(p_providers) > 4
    or array_position(p_providers, null) is not null or not (p_providers <@ array['toss', 'nicepay']::text[]) then
    raise invalid_parameter_value using message = 'invalid_reconciliation_candidate_filter';
  end if;
  with picked as (
    select c.id, c.purpose, c.provider, c.ref_id, c.last_checked_at, c.updated_at from (
      select a.id, a.purpose, a.provider, a.ref_id, a.updated_at,
        greatest(
          (select max(g.requested_at) from private.goods_payment_reconciliation_audits g where g.target_id = a.id),
          (select max(t.requested_at) from private.ticket_payment_reconciliation_audits t where t.target_id = a.id),
          (select m.last_picked_at from private.payment_reconciliation_auto_checks m where m.attempt_id = a.id)) as last_checked_at
      from public.payment_attempts a
      where a.state in ('unknown', 'confirming')
        and private.payment_attempt_unresolved(a.state, a.claim_expires_at, at)
        and ((a.purpose = 'order' and a.provider in ('toss', 'nicepay')) or (a.purpose = 'ticket' and a.provider = 'toss'))
        and a.provider::text = any(p_providers)
        and a.updated_at <= at - interval '10 minutes'
        and a.created_at >= at - interval '7 days'
    ) c
    where c.last_checked_at is null or c.last_checked_at <= at - interval '30 minutes'
    order by c.last_checked_at nulls first, c.updated_at, c.id
    limit p_limit
  ), marked as (
    insert into private.payment_reconciliation_auto_checks as m(attempt_id, last_picked_at)
    select id, at from picked
    on conflict (attempt_id) do update set last_picked_at = excluded.last_picked_at, picks = m.picks + 1
    returning m.attempt_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('attemptId', p.id, 'purpose', p.purpose, 'provider', p.provider, 'refId', p.ref_id)
    order by p.last_checked_at nulls first, p.updated_at, p.id), '[]'::jsonb)
  into result
  from picked p where p.id in (select attempt_id from marked);
  return result;
end $$;
revoke all on function public.service_claim_payment_reconciliation_candidates(integer, text[]) from public, anon, authenticated, service_role;
grant execute on function public.service_claim_payment_reconciliation_candidates(integer, text[]) to service_role;

-- 6. 결제 기한 만료 sweep: 주문마다 예외를 가둔다 ----------------------------------------------------------------------
-- 한 주문의 오류(데이터 이상·트리거 거절)가 매분 sweep 전체(최대 200건)를 되돌려 다른 주문의 재고·쿠폰까지 묶던 것을 막는다.
-- 블록 안의 변경만 되돌아가고 그 주문은 다음 회차에 다시 본다. 건너뛴 건수·SQLSTATE·대상(주문 id)만 실패 기록에 남긴다.
select private.t7_patch_function('public.expire_stale_checkouts()'::regprocedure, array[
$a$  v_attempt public.payment_attempts%rowtype;
begin$a$,
$a$  v_attempt public.payment_attempts%rowtype;
  v_failed integer := 0;
  v_failed_state text;
  v_failed_refs text[] := array[]::text[];
begin$a$,
$a$    for update of orders skip locked
  loop
    v_can_expire := true;$a$,
$a$    for update of orders skip locked
  loop
  begin
    v_can_expire := true;$a$,
$a$    v_count := v_count + 1;
  end loop;

  -- Ticket checkout follows$a$,
$a$    v_count := v_count + 1;
  exception when others then
    get stacked diagnostics v_failed_state = returned_sqlstate;
    v_failed := v_failed + 1;
    if cardinality(v_failed_refs) < 5 then v_failed_refs := v_failed_refs || ('order:' || r.id::text); end if;
  end;
  end loop;

  -- Ticket checkout follows$a$,
$a$    for update of ticket_orders skip locked
  loop
    v_can_expire := true;$a$,
$a$    for update of ticket_orders skip locked
  loop
  begin
    v_can_expire := true;$a$,
$a$    v_count := v_count + 1;
  end loop;
  return v_count;$a$,
$a$    v_count := v_count + 1;
  exception when others then
    get stacked diagnostics v_failed_state = returned_sqlstate;
    v_failed := v_failed + 1;
    if cardinality(v_failed_refs) < 5 then v_failed_refs := v_failed_refs || ('ticket_order:' || r.id::text); end if;
  end;
  end loop;
  if v_failed > 0 then
    begin
      perform private.record_system_job_failure('expire-stale-checkouts', 'pg_cron', '결제 기한 만료 정리', null, null,
        'sqlstate_' || coalesce(v_failed_state, 'unknown'),
        pg_catalog.jsonb_build_object('skipped', v_failed, 'targets', pg_catalog.to_jsonb(v_failed_refs)));
    exception when others then
      raise warning 'expire_stale_checkouts skipped % rows; failure record unavailable', v_failed;
    end;
  end if;
  return v_count;$a$
]);

-- 7. 운영 할 일 '시스템 점검'(platform.manage) ---------------------------------------------------------------------------
select private.t7_patch_function('public.admin_operation_tasks()'::regprocedure, array[
$a$'href','/admin/cs/reviews?reply=without&status=visible') where public.has_operator_capability('cs.manage')$a$,
$a$'href','/admin/cs/reviews?reply=without&status=visible') where public.has_operator_capability('cs.manage')
 union all
select 8,jsonb_build_object('id','system','label','시스템 점검','count',private.system_health_issue_count(),'href','/admin/settings/system') where public.has_operator_capability('platform.manage')$a$
]);

-- 8. 정리 잡(10분): pg_cron 잡을 처음 본 시각을 남기고(새 잡의 멈춤 오탐 방지), 실패 기록 30일·30일 동안 실행이 없던 작업 상태 행·
--    미종결이 아닌 시도의 자동 재확인 표식을 지운다.
create function private.maintain_system_job_records() returns void
language plpgsql set search_path = '' as $$
begin
  insert into private.system_pg_cron_jobs(jobname, first_seen_at)
  select j.jobname, clock_timestamp() from cron.job j where j.jobname is not null
  on conflict (jobname) do nothing;
  delete from private.system_pg_cron_jobs s where not exists(select 1 from cron.job j where j.jobname = s.jobname);
  delete from private.system_job_failures where occurred_at < now() - interval '30 days';
  delete from private.system_job_status where updated_at < now() - interval '30 days';
  delete from private.payment_reconciliation_auto_checks m using public.payment_attempts a
  where a.id = m.attempt_id and not private.payment_attempt_unresolved(a.state, a.claim_expires_at, clock_timestamp());
end $$;
revoke all on function private.maintain_system_job_records() from public, anon, authenticated, service_role;

select cron.schedule('system-job-records-maintenance', '*/10 * * * *', $job$select private.maintain_system_job_records()$job$);
-- 이 migration 전부터 표본 안에 실행 기록이 있던 잡은 처음 본 시각을 '-infinity'로 둔다(멈춤 판정을 미루지 않는다). 기록이 없는 잡
-- (이 migration이 막 만든 정리 잡 포함)은 지금을 처음 본 시각으로 남긴다 — 첫 실행 전에 멈춤으로 뜨지 않는다.
insert into private.system_pg_cron_jobs(jobname, first_seen_at)
select j.jobname, case when exists(select 1 from (select d.jobid from cron.job_run_details d order by d.runid desc limit 20000) recent
    where recent.jobid = j.jobid) then '-infinity'::timestamptz else clock_timestamp() end
from cron.job j where j.jobname is not null
on conflict (jobname) do nothing;

-- 9. 운영자 계약: 새 RPC와 재정의한 함수(분류는 기존 행 그대로).
select private.register_operator_rpc_contract('public.admin_system_health()'::regprocedure, 'platform.manage', 'read', false);
select private.register_operator_rpc_contract('public.admin_unresolved_payment_attempts(integer)'::regprocedure, 'sales.manage', 'read', false);
select private.register_operator_rpc_contract('public.admin_begin_payment_reconciliation(uuid,uuid)'::regprocedure, 'sales.manage', 'write', false);

do $$declare fn regprocedure; contract record; begin
  foreach fn in array array[
    'private.operator_alert_capability(text)'::regprocedure,
    'public.admin_operation_alerts(text,text,timestamp with time zone,uuid,integer)'::regprocedure,
    'public.admin_update_operation_alerts(text,uuid[],timestamp with time zone,text,text)'::regprocedure,
    'public.admin_operation_tasks()'::regprocedure,
    'public.expire_stale_checkouts()'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

drop function private.t7_patch_function(regprocedure, text[]);

commit;
notify pgrst, 'reload schema';
