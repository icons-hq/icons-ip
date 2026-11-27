begin;

-- 초기화는 회원 한도 집계에서만 제외한다. 심사·발송 기록과 연락처/IP 공통 한도는 같은 행을 계속 쓴다.
alter table private.overseas_adult_requests add column counts_toward_member_limit boolean not null default true;
alter table private.adult_verification_sessions add column counts_toward_member_limit boolean not null default true;
alter table private.member_phone_verification_challenges add column counts_toward_member_limit boolean not null default true;
alter table private.member_email_change_challenges add column counts_toward_member_limit boolean not null default true;

-- 실제 신청 경로와 관리자 화면이 같은 시간·일 한도를 사용한다. 최신순 N번째 시도가 창 밖으로 나가면
-- 그 창에 한 자리가 생긴다. 두 창이 동시에 찼다면 더 늦게 풀리는 시각까지 기다려야 한다.
create function private.member_verification_window(p_user_id uuid, p_kind text, p_at timestamptz)
returns table(hour_limit integer, day_limit integer, hour_used integer, day_used integer,
              rate_until timestamptz, resend_until timestamptz, revision text)
language sql stable set search_path = '' as $$
  with rules(kind, per_hour, per_day, resend) as (values
    ('overseas_adult', null::integer, 3, false), ('domestic_adult', 10, 30, false),
    ('phone_code', 5, 10, true), ('email_change', 5, 10, true)
  ), attempts as (
    select id, created_at from private.overseas_adult_requests
      where p_kind = 'overseas_adult' and user_id = p_user_id and counts_toward_member_limit and created_at > p_at - interval '24 hours'
    union all select id, created_at from private.adult_verification_sessions
      where p_kind = 'domestic_adult' and user_id = p_user_id and counts_toward_member_limit and created_at > p_at - interval '24 hours'
    union all select id, created_at from private.member_phone_verification_challenges
      where p_kind = 'phone_code' and user_id = p_user_id and counts_toward_member_limit and created_at > p_at - interval '24 hours'
    union all select id, created_at from private.member_email_change_challenges
      where p_kind = 'email_change' and user_id = p_user_id and counts_toward_member_limit and created_at > p_at - interval '24 hours'
  ), usage as (
    select count(*) filter (where created_at > p_at - interval '1 hour')::integer as hourly, count(*)::integer as daily,
      array_agg(created_at order by created_at desc) as times, md5(string_agg(id::text, ',' order by id)) as revision
    from attempts
  ), deadlines as (
    select rules.*, usage.*, greatest(times[per_hour] + interval '1 hour', times[per_day] + interval '24 hours') as rate_end,
      case when resend then times[1] + interval '60 seconds' end as resend_end
    from rules cross join usage where kind = p_kind
  )
  select per_hour, per_day, hourly, daily, case when rate_end > p_at then rate_end end,
    case when resend_end > p_at then resend_end end, revision from deadlines;
$$;
revoke all on function private.member_verification_window(uuid,text,timestamptz) from public, anon, authenticated, service_role;

-- 이미 배포된 접수 함수에서 회원별 한도 판정만 교체한다. 호출 권한과 제출·확정·파기 계약을 보존한다.
create function pg_temp.replace_verification_predicate(fn regprocedure, before_text text, after_text text)
returns void language plpgsql as $$
declare definition text := pg_get_functiondef(fn);
begin
  if cardinality(string_to_array(definition, before_text)) <> 2 then raise exception 'unexpected verification function: %', fn; end if;
  execute replace(definition, before_text, after_text);
end $$;

select pg_temp.replace_verification_predicate('public.begin_overseas_adult_request()',
  $old$(select count(*) from private.overseas_adult_requests where user_id=actor and created_at>now()-interval '1 day')>=3$old$,
  $new$(select rate_until is not null from private.member_verification_window(actor, 'overseas_adult', clock_timestamp()))$new$);

select pg_temp.replace_verification_predicate('public.begin_adult_verification(uuid,text,text,text,text)',
  $old$(
    select pg_catalog.count(*)
    from private.adult_verification_sessions as session
    where session.user_id = p_user_id
      and session.created_at > v_now - interval '1 hour'
  ) >= 10 or (
    select pg_catalog.count(*)
    from private.adult_verification_sessions as session
    where session.user_id = p_user_id
      and session.created_at > v_now - interval '1 day'
  ) >= 30$old$,
  $new$(select rate_until is not null from private.member_verification_window(p_user_id, 'domestic_adult', clock_timestamp()))$new$);

select pg_temp.replace_verification_predicate('public.service_issue_member_phone_verification(uuid,uuid,text,text,text,text,integer)',
  $old$(c.user_id = p_user_id or c.phone_digest = p_phone_digest) and c.created_at > now_at - interval '60 seconds'$old$,
  $new$((c.user_id = p_user_id and c.counts_toward_member_limit) or c.phone_digest = p_phone_digest) and c.created_at > now_at - interval '60 seconds'$new$);
select pg_temp.replace_verification_predicate('public.service_issue_member_email_change(uuid,uuid,uuid,text,text,text,text,integer)',
  $old$c.user_id = p_user_id and c.created_at > now_at - interval '60 seconds'$old$,
  $new$c.user_id = p_user_id and c.counts_toward_member_limit and c.created_at > now_at - interval '60 seconds'$new$);

select pg_temp.replace_verification_predicate('public.service_issue_member_phone_verification(uuid,uuid,text,text,text,text,integer)',
  $old$private.member_phone_rate_limited('user', p_user_id::text, 5, 10)$old$,
  $new$(select ceil(extract(epoch from rate_until - now_at))::integer from private.member_verification_window(p_user_id, 'phone_code', now_at))$new$);
select pg_temp.replace_verification_predicate('public.service_issue_member_email_change(uuid,uuid,uuid,text,text,text,text,integer)',
  $old$private.member_email_change_rate_limited('user', p_user_id::text, 5, 10)$old$,
  $new$(select ceil(extract(epoch from rate_until - now_at))::integer from private.member_verification_window(p_user_id, 'email_change', now_at))$new$);

create function public.admin_member_verification_limits(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); checked_at timestamptz := clock_timestamp(); can_reset boolean;
begin
  if not private.has_operator_capability(actor, 'platform.manage', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  select p.suspended_at is null and private.has_operator_capability(actor, 'platform.manage', true)
    and not exists (select 1 from private.account_action_fences where subject_user_id = p.id)
    into can_reset from public.profiles p where p.id = p_user_id;
  if not found then return null; end if;

  return jsonb_build_object('checkedAt', checked_at, 'canReset', can_reset,
    'overseasState', coalesce(
      (select state from private.overseas_adult_requests where user_id = p_user_id and state <> 'closed'),
      case when private.overseas_valid_until(p_user_id) is not null or private.adult_verification_valid(p_user_id) then 'verified' end),
    'limits', (select jsonb_agg(jsonb_build_object('kind', kinds.kind,
      'hourLimit', w.hour_limit, 'dayLimit', w.day_limit, 'hourUsed', w.hour_used, 'dayUsed', w.day_used,
      'retryAt', greatest(w.rate_until, w.resend_until), 'revision', w.revision) order by kinds.position)
      from unnest(array['overseas_adult','domestic_adult','phone_code','email_change']) with ordinality kinds(kind, position)
      cross join lateral private.member_verification_window(p_user_id, kinds.kind, checked_at) w));
end $$;

create function public.admin_reset_member_verification_limit(p_user_id uuid, p_kind text, p_revision text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  checked_at timestamptz;
  used record;
  outcome text;
begin
  if not private.has_operator_capability(actor, 'platform.manage', true) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  -- 접수와 같은 회원 잠금. 관리자끼리 서로의 계정을 처리해도 같은 순서로 잠근다.
  perform private.lock_operator_subjects(array[actor, p_user_id]);
  perform private.require_operator_capability('platform.manage', true);
  if not exists (select 1 from public.profiles where id = p_user_id and suspended_at is null)
    or private.is_account_write_fenced(p_user_id) then
    raise exception 'member_unavailable' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('overseas_adult','domestic_adult','phone_code','email_change')
    or p_revision is null or p_revision !~ '^[0-9a-f]{32}$'
    or p_reason is null or char_length(btrim(p_reason)) not between 2 and 200 then
    raise invalid_parameter_value using message = 'invalid_verification_reset';
  end if;
  checked_at := clock_timestamp();
  select * into used from private.member_verification_window(p_user_id, p_kind, checked_at);
  if used.day_used = 0 then
    outcome := 'empty';
  elsif used.revision <> p_revision then
    outcome := 'changed';
  else
    case p_kind
      when 'overseas_adult' then
        update private.overseas_adult_requests set counts_toward_member_limit = false
          where user_id = p_user_id and counts_toward_member_limit and created_at > checked_at - interval '24 hours';
      when 'domestic_adult' then
        update private.adult_verification_sessions set counts_toward_member_limit = false
          where user_id = p_user_id and counts_toward_member_limit and created_at > checked_at - interval '24 hours';
      when 'phone_code' then
        update private.member_phone_verification_challenges set counts_toward_member_limit = false
          where user_id = p_user_id and counts_toward_member_limit and created_at > checked_at - interval '24 hours';
      when 'email_change' then
        update private.member_email_change_challenges set counts_toward_member_limit = false
          where user_id = p_user_id and counts_toward_member_limit and created_at > checked_at - interval '24 hours';
    end case;
    insert into public.audit_log(actor_id, action, target, diff) values
      (actor, 'admin.member.verification_limit_reset', p_user_id::text,
       jsonb_build_object('kind', p_kind, 'clearedAttempts', used.day_used, 'reason', btrim(p_reason)));
    outcome := 'reset';
  end if;
  return jsonb_build_object('outcome', outcome, 'snapshot', public.admin_member_verification_limits(p_user_id));
end $$;

revoke all on function public.admin_member_verification_limits(uuid), public.admin_reset_member_verification_limit(uuid,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_member_verification_limits(uuid), public.admin_reset_member_verification_limit(uuid,text,text,text)
  to authenticated;
select private.register_operator_rpc_contract('public.admin_member_verification_limits(uuid)', 'platform.manage', 'read', false);
select private.register_operator_rpc_contract('public.admin_reset_member_verification_limit(uuid,text,text,text)', 'platform.manage', 'write', true);

commit;
