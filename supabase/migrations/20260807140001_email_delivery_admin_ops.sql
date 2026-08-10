-- ============================================================================
-- ICONS · 트랜잭션 이메일 발송 이력의 운영 경로 (#180 범위 5)
--
-- 20260807130001이 email_deliveries를 만들면서 테이블을 모든 롤에서 revoke했다.
-- 멱등은 그것으로 지켜졌지만 운영 경로가 함께 사라졌다 — 발송이 실패해도 목록을
-- 볼 방법도, 다시 보낼 방법도 없다. 구매자는 전자상거래법상 계약내용 서면(L4)을
-- 영구히 못 받는다.
--
-- 그래서 테이블 권한은 닫아 둔 채, staff만 통과하는 security definer 경로 두 개를 연다.
--   1) admin_search_email_deliveries — 실패 목록 조회
--   2) admin_request_email_resend    — 재발송 게이트 + 감사 기록
--
-- 재발송은 여기서 메일을 보내지 않는다. 실제 발송은 앱의 service_role 경로가
-- claim_email_delivery를 다시 잡아 수행한다. 이 함수는 "누가 무엇을 다시 보내려
-- 했는가"를 남기고 이미 sent인 건을 거절하는 역할만 한다 — 멱등의 진실원은
-- 여전히 claim_email_delivery 하나다.
-- ============================================================================

-- 실패·대기 건 조회. 읽기는 staff 게이트로 막고 감사 로그는 남기지 않는다.
-- 운영 화면이 열릴 때마다 audit_log가 불어나면 정작 추적해야 할 쓰기 기록이 묻힌다.
create or replace function public.admin_search_email_deliveries(
  p_status text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  dedupe_key text,
  template text,
  recipient text,
  subject text,
  status text,
  attempt_count integer,
  last_error text,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_status is not null and p_status not in ('pending', 'sent', 'failed') then
    raise check_violation using message = 'invalid email delivery status filter';
  end if;

  return query
  select
    delivery.dedupe_key,
    delivery.template,
    delivery.recipient,
    delivery.subject,
    delivery.status,
    delivery.attempt_count,
    delivery.last_error,
    delivery.claimed_at,
    delivery.completed_at,
    delivery.created_at,
    count(*) over()::bigint as total_count
  from public.email_deliveries as delivery
  where (p_status is null or delivery.status = p_status)
  order by delivery.claimed_at desc, delivery.dedupe_key desc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.admin_search_email_deliveries(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_search_email_deliveries(text, integer, integer)
  to authenticated;

-- 재발송 게이트. 통과한 호출자만 발송 훅을 다시 부른다.
-- 반환값은 템플릿 이름 — 호출자가 어떤 메일을 다시 만들지 고르는 데 쓴다.
create or replace function public.admin_request_email_resend(p_dedupe_key text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_key text := nullif(btrim(coalesce(p_dedupe_key, ''), E' \t\n\r\f\v'), '');
  v_template text;
  v_status text;
  v_attempt_count integer;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if v_key is null then
    raise check_violation using message = 'invalid_dedupe_key';
  end if;

  select delivery.template, delivery.status, delivery.attempt_count
  into v_template, v_status, v_attempt_count
  from public.email_deliveries as delivery
  where delivery.dedupe_key = v_key
  for update;

  if not found then
    raise no_data_found using message = 'email_delivery_not_found';
  end if;

  -- 이미 도착한 메일을 다시 보내지 않는다. claim_email_delivery도 같은 판단을 하지만,
  -- 운영자에게는 발송 훅을 부르기 전에 이유를 알려주는 편이 낫다.
  if v_status = 'sent' then
    raise check_violation using message = 'email_already_sent';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.email_delivery.resend_requested',
    'email_delivery:' || v_key,
    jsonb_build_object(
      'template', v_template,
      'status', v_status,
      'attemptCount', v_attempt_count
    )
  );

  return v_template;
end;
$$;

revoke all on function public.admin_request_email_resend(text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_request_email_resend(text)
  to authenticated;
