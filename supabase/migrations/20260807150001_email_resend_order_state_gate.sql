-- ============================================================================
-- ICONS · 재발송 게이트에 주문 상태를 더한다 (#180 후속)
--
-- 20260807140001이 재발송 경로를 열면서 게이트가 email_deliveries.status 하나만 봤다.
-- 발송은 원래 웹훅 확정 직후에만 일어났으므로 "메일 본문이 지금도 사실인가"를 물을
-- 필요가 없었다. 재발송은 임의 시점이다 — 그 사이 주문이 청약철회로 canceled가 될 수 있다.
--
--   확인 메일이 Resend 429로 실패해 failed로 남는다
--   → 다음날 청약철회 승인, 환불 완료, orders.status='canceled'
--   → 운영자가 실패 목록에서 '다시 보내기'
--   → "결제가 확인됐고 배송 준비를 시작합니다"가 구매자에게 도착한다
--
-- 취소된 주문에 대한 거짓 고지다. 그래서 게이트가 대상 주문의 현재 상태를 함께 본다.
-- 앱의 발송 훅도 같은 판단을 한 번 더 한다(lib/email/transactional.server.ts) —
-- 이 함수를 우회하는 호출자(웹훅)가 있으므로 실제 안전장치는 그쪽이고, 여기는
-- 운영자에게 발송을 시도하기 전에 이유를 알려주고 감사 로그를 더럽히지 않는 역할이다.
-- ============================================================================

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
  v_order_id text;
  v_order_status text;
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

  -- dedupe_key는 '<template>:<order uuid>'다(lib/email/dedupe.ts).
  -- 현재 템플릿은 둘 다 주문 메일이다. 주문에 매이지 않는 템플릿이 생기면 이 함수를
  -- 함께 고쳐야 한다 — 그때까지는 형식을 벗어난 키를 fail-closed로 막는다.
  v_order_id := split_part(v_key, ':', 2);
  if v_order_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise check_violation using message = 'email_delivery_target_unresolved';
  end if;

  select target.status::text
  into v_order_status
  from public.orders as target
  where target.id = lower(v_order_id)::uuid;

  if not found then
    raise no_data_found using message = 'order_missing';
  end if;

  -- 본문이 지금도 사실인 상태에서만 통과시킨다.
  --   order_confirmation — "결제가 확인됐고 배송 준비를 시작합니다"
  --   order_shipped      — "주문한 굿즈가 배송지로 이동하고 있습니다"
  -- lib/email/transactional.server.ts의 ACCURATE_ORDER_STATUSES와 같은 집합이다.
  if v_template = 'order_confirmation' and v_order_status not in ('paid', 'shipping', 'done') then
    raise check_violation using message = 'email_no_longer_accurate';
  end if;
  if v_template = 'order_shipped' and v_order_status not in ('shipping', 'done') then
    raise check_violation using message = 'email_no_longer_accurate';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.email_delivery.resend_requested',
    'email_delivery:' || v_key,
    jsonb_build_object(
      'template', v_template,
      'status', v_status,
      'attemptCount', v_attempt_count,
      'orderStatus', v_order_status
    )
  );

  return v_template;
end;
$$;

-- create or replace는 기존 권한을 유지하지만, Supabase default privileges와의 관계를
-- 파일 하나만 읽고도 알 수 있게 봉인을 다시 명시한다.
revoke all on function public.admin_request_email_resend(text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_request_email_resend(text)
  to authenticated;
