-- ============================================================================
-- 결제 유효 시간이 지난 결제 대기 주문은 고객 취소로 바로 닫는다
-- (2026-10-12 브라우저 QA QA-1 · R2-1)
--
-- 1. 만료된 결제 준비 시도(QA-1)
--    결제창을 연 뒤 결제 유효 시간(payment_attempts.expires_at)이 지난 결제 대기
--    주문을 구매자가 취소하면 request_order_claim은 그 prepared 시도를 미해결로 세어
--    요청을 requested로 남겼다. 실제로는 담당자 없이 결제 기한 + 5분 sweep
--    (expire_stale_checkouts)이 닫았고, 그동안 재고·쿠폰·적립금이 묶였다.
--
--    이제 이미 잡은 order → shipments → attempt 잠금 아래에서, 결제 원장이 없는
--    결제 대기 주문의 취소라면 만료된 prepared 시도를 sweep·
--    reconcile_expired_prepared_goods_cancellation과 같은 규칙으로 canceled로 닫고
--    결제 없는 즉시 종결(finalize_order_cancellation_with_provider_evidence →
--    'completed')로 보낸다. 감사 로그는 구매자 actor의
--    order.prepared_goods_cancellation_completed(outcome expired_no_capture)다.
--
--    근거: claim_goods_payment_attempt(최신 20260901120000:648)는 prepared 시도의
--    expires_at <= clock_timestamp()를 잠금 전·후 두 번 goods_payment_attempt_expired로
--    거절하고, 이미 canceled인 시도는 terminal로 돌려준다. 앱(goods-checkout.ts)은
--    claimed일 때만 gateway.confirm을 부른다. 토스는 인증을 마친 결제(IN_PROGRESS)도
--    승인 API를 부르지 않으면 매입하지 않고 유효 시간 뒤 EXPIRED로 닫는다(토스 코어 API
--    Payment.status, 웹훅 이벤트 PAYMENT_STATUS_CHANGED: "결제 인증이 유효한 10분 안에
--    결제 승인 API를 호출하지 않으면 EXPIRED"). 그래서 만료된 prepared 시도에는
--    잡힌 돈이 없다.
--
--    경합: claim과 이 함수는 모두 주문 행을 먼저 잠근다. claim이 먼저 잡으면 시도는
--    confirming이 되어 이 함수가 건드리지 않는다(종전처럼 requested). 이 함수가 먼저
--    닫으면 잠금을 기다린 claim은 시도를 다시 읽어 canceled(terminal)를 돌려주고
--    승인 API를 부르지 않는다.
--
-- 2. 결제 대기 주문의 취소 접수 알림(R2-1)
--    결제가 끝나기 전 접수된 취소 요청의 알림을 "담당자가 확인한 뒤"에서 시도 상태별로
--    실제로 닫히는 길(결제 기한 자동 취소·결제 승인 결과 확인)로 바꾼다. 반품·교환과
--    결제완료 주문의 하자 취소처럼 담당자가 검토하는 요청은 종전 문구를 쓴다.
--
-- 함수 본문은 최신 정의를 복사해 위 차이만 넣었다:
--   request_order_claim ← 20260909001505:63
-- ============================================================================

CREATE OR REPLACE FUNCTION public.request_order_claim(p_order_id uuid, p_user_id uuid, p_claim_type text, p_reason text, p_reason_type text, p_bank_name text DEFAULT NULL::text, p_account_number text DEFAULT NULL::text, p_account_holder text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid;
  v_status public.order_status;
  v_delivered_at timestamptz;
  v_claim_id uuid;
  v_has_unresolved_attempt boolean;
  v_masked_account text;
  v_masked_holder text;
  v_payment_count integer;
  v_expired_prepared_attempt_id uuid;
  v_attempt_state public.payment_attempt_state;
begin
  if p_claim_type is null or p_claim_type not in ('cancel', 'return', 'exchange') then
    raise check_violation using message = 'invalid claim type';
  end if;
  if p_reason_type is null or p_reason_type not in ('change_of_mind', 'defect') then
    raise check_violation using message = 'invalid cancellation reason type';
  end if;
  if p_reason is null
    or btrim(p_reason) <> p_reason
    or length(p_reason) not between 1 and 200
  then
    raise check_violation using message = 'invalid cancellation reason';
  end if;

  -- Common intake/dispatch lock order: order → shipments → payment attempts/payments.
  select orders.user_id, orders.status, orders.delivered_at
  into v_user_id, v_status, v_delivered_at
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found or p_user_id is null or v_user_id is distinct from p_user_id then
    return 'not_found';
  end if;

  perform s.id from public.order_shipments s where s.order_id=p_order_id order by s.id for update;

  perform attempt.id
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = p_order_id
  order by attempt.id
  for update;

  select exists (
    select 1
    from public.payment_attempts as attempt
    where attempt.purpose = 'order'
      and attempt.ref_id = p_order_id
      and attempt.state in (
        'prepared', 'confirming', 'unknown', 'needs_review', 'approved'
      )
  )
  into v_has_unresolved_attempt;

  if v_status = 'canceled' then
    return 'already_canceled';
  end if;

  -- 반품·교환은 물리적 회수를 전제한다. 배송이 끝나기 전에는 회수할 물건이
  -- Customer cancellation is available only before order confirmation.
  if p_claim_type in ('return', 'exchange') then
    if not private.order_all_items_delivered(p_order_id) then
      return 'not_claimable';
    end if;
  elsif not private.order_cancel_eligible(p_order_id) then
    return 'not_cancelable';
  end if;

  -- 교환도 청약철회 기한을 준용한다(변심 7일 · 하자 3개월). 판정의 진실원은
  -- 계속 order_withdrawal_deadline_passed 하나다.
  if public.order_withdrawal_deadline_passed(v_delivered_at, p_reason_type, now()) then
    return 'deadline_expired';
  end if;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = p_order_id
      and request.status in ('requested', 'processing', 'needs_review')
  ) then
    return 'already_requested';
  end if;

  -- status는 적지 않는다. 투영은 private.order_claim_status_for_stage 하나가 만든다.
  insert into public.order_cancellation_requests (
    order_id,
    requested_by,
    reason,
    reason_type,
    claim_type,
    stage
  )
  values (
    p_order_id,
    p_user_id,
    p_reason,
    p_reason_type,
    p_claim_type,
    'requested'
  )
  returning id into v_claim_id;

  /*
   * 환불계좌는 무통장 환불의 유일한 경로이고 카드 fallback의 안전망이다.
   * 세 칸이 모두 있을 때만 저장한다 — 반쪽 계좌는 송금에 쓸 수 없다.
   *
   * 교환에는 저장하지 않는다. 교환의 종결은 재출고이고 어떤 경로로도 돈이
   * 돌아가지 않으므로 계좌를 받을 목적 자체가 없다. 화면은 반품에만 폼을
   * 보이지만 API로는 실어 보낼 수 있으므로 접수 함수가 거른다. 취소·반품은
   * 결제사 취소가 막혔을 때 송금이 유일한 경로라 계속 받고, 보관 기간은
   * 종결 stage에서 seal_order_claim_refund_account가 잡는다.
   */
  if p_claim_type <> 'exchange'
    and p_bank_name is not null
    and p_account_number is not null
    and p_account_holder is not null
  then
    v_masked_account := public.mask_refund_account_number(p_account_number);
    v_masked_holder := public.mask_refund_account_holder(p_account_holder);

    insert into private.claim_refund_accounts (
      claim_id,
      bank_name,
      account_number,
      account_holder,
      masked_account,
      masked_holder
    )
    values (
      v_claim_id,
      btrim(p_bank_name),
      p_account_number,
      btrim(p_account_holder),
      btrim(p_bank_name) || ' ' || v_masked_account,
      v_masked_holder
    );
  end if;

  /*
   * 결제 유효 시간이 이미 지난 결제 준비(prepared) 시도는 미해결이 아니다
   * (2026-10-12 브라우저 QA QA-1).
   *
   * 위에서 잡은 order → shipments → attempt 잠금 아래에서만 판정한다. 만료된
   * prepared 시도는 claim_goods_payment_attempt가 잠금 전·후 두 번 모두
   * goods_payment_attempt_expired로 거절하므로, 늦게 도착한 결제 완료 리디렉트가
   * 있어도 서버는 승인 API를 부르지 않는다. 토스는 인증을 마친 결제(IN_PROGRESS)도
   * 승인 API를 부르지 않으면 매입하지 않고 EXPIRED로 닫는다(코어 API Payment.status,
   * 웹훅 이벤트 PAYMENT_STATUS_CHANGED). Korpay도 confirm 호출 전에는 승인하지 않는다.
   *
   * 그래서 결제 원장이 없는 결제 대기 주문의 취소라면 그 시도를 expire_stale_checkouts·
   * reconcile_expired_prepared_goods_cancellation과 같은 규칙(prepared → canceled,
   * claim 토큰 제거, 만료 재확인을 갱신 조건에 둔다)으로 닫고 아래 즉시 종결로
   * 보낸다. 지금까지는 만료 여부와 상관없이 prepared를 미해결로 세어 요청을
   * requested로 남겼고, 재고·쿠폰·적립금이 결제 기한 + 5분 sweep까지 묶였다.
   *
   * 유효 시간이 남은 prepared, confirming·unknown·needs_review·approved는 종전처럼
   * 미해결이다. 결제 원장이 하나라도 있으면(실패 행 포함) 시도를 건드리지 않는다 —
   * 즉시 종결 조건과 같아야 시도만 닫히고 요청이 남는 중간 상태가 생기지 않는다.
   * 굿즈 주문의 시도는 하나다(payment_attempts_one_goods_order_idx).
   */
  if p_claim_type = 'cancel'
    and v_status = 'pending'
    and v_has_unresolved_attempt
    and not exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = p_order_id
    )
  then
    update public.payment_attempts as attempt
    set
      state = 'canceled',
      claim_token = null,
      claim_expires_at = null
    where attempt.purpose = 'order'
      and attempt.ref_id = p_order_id
      and attempt.state = 'prepared'
      and attempt.expires_at is not null
      and attempt.expires_at <= pg_catalog.clock_timestamp()
    returning attempt.id into v_expired_prepared_attempt_id;

    if v_expired_prepared_attempt_id is not null then
      select exists (
        select 1
        from public.payment_attempts as attempt
        where attempt.purpose = 'order'
          and attempt.ref_id = p_order_id
          and attempt.state in (
            'prepared', 'confirming', 'unknown', 'needs_review', 'approved'
          )
      )
      into v_has_unresolved_attempt;
    end if;
  end if;

  -- 결제 이력이 없는 pending 주문은 예전처럼 즉시 종결한다.
  if p_claim_type = 'cancel'
    and v_status = 'pending'
    and not v_has_unresolved_attempt
    and not exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = p_order_id
    )
  then
    perform public.finalize_order_cancellation_with_provider_evidence(
      p_order_id,
      p_reason,
      array[]::text[]
    );

    update public.order_cancellation_requests
    set
      stage = 'completed',
      completed_at = now(),
      updated_at = now()
    where id = v_claim_id;

    -- 위에서 닫은 만료 시도는 reconcile_expired_prepared_goods_cancellation과 같은
    -- 결과 어휘로 남긴다. actor는 취소를 누른 구매자다.
    if v_expired_prepared_attempt_id is not null then
      insert into public.audit_log (actor_id, action, target, diff)
      values (
        p_user_id,
        'order.prepared_goods_cancellation_completed',
        'order:' || p_order_id::text,
        jsonb_build_object(
          'attemptId', v_expired_prepared_attempt_id,
          'requestId', v_claim_id,
          'outcome', 'expired_no_capture',
          'trigger', 'customer_cancel_request'
        )
      );
    end if;

    return 'completed';
  end if;

  /*
   * 자동 승인 — paid(발주확인 전) 변심 취소.
   *
   * 아직 발주확인도 하지 않은 주문의 변심 취소를 사람이 판단할 이유가 없다.
   * 스마트스토어와 같은 경계다. confirmed부터는 발송 준비가 시작됐으므로
   * 운영자 판단으로 남긴다.
   *
   * 승인의 실질(durable claim + 환불 intent)은 admin_decide_order_cancellation의
   * 승인 분기와 같다. decided_by는 null로 남긴다 — 사람이 누른 적이 없다.
   */
  if p_claim_type = 'cancel'
    and v_status = 'paid'
    and p_reason_type = 'change_of_mind'
  then
    insert into public.order_cancellation_claims (
      order_id,
      requested_by,
      previous_status
    )
    values (p_order_id, p_user_id, v_status)
    on conflict (order_id) do nothing;

    insert into public.refunds (
      payment_id,
      amount,
      reason,
      status,
      cancellation_request_id
    )
    select
      payment.id,
      payment.amount,
      p_reason,
      case when refund.status = 'done' then 'done' else 'requested' end,
      v_claim_id
    from public.payments as payment
    left join public.refunds as refund on refund.payment_id = payment.id
    where payment.purpose = 'order'
      and payment.ref_id = p_order_id
      and payment.status in ('pending', 'paid', 'canceled', 'refunded')
    on conflict (payment_id) do update
    set
      cancellation_request_id = excluded.cancellation_request_id,
      reason = coalesce(public.refunds.reason, excluded.reason),
      status = case
        when public.refunds.status = 'done' then 'done'
        else 'requested'
      end;

    select count(*)::integer
    into v_payment_count
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = p_order_id
      and payment.status in ('pending', 'paid', 'canceled', 'refunded');

    update public.order_cancellation_requests
    set
      stage = 'processing',
      decided_at = now(),
      provider_started_at = now(),
      updated_at = now()
    where id = v_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      p_user_id,
      'order.claim_auto_approved',
      'order:' || p_order_id::text,
      jsonb_build_object(
        'claimId', v_claim_id,
        'claimType', 'cancel',
        'from', 'requested',
        'to', 'processing',
        'previousOrderStatus', v_status::text,
        'reasonType', p_reason_type,
        'paymentCount', v_payment_count
      )
    );

    perform private.notify_order_claim(
      v_claim_id,
      'auto_approved',
      '취소 요청이 접수됐어요',
      '발송 전 주문이라 자동으로 승인됐습니다. 결제 취소 처리를 시작합니다.'
    );

    return 'auto_approved';
  end if;

  /*
   * 결제가 끝나기 전(결제 대기 주문)의 취소는 담당자가 아니라 결제 결과가 닫는다
   * (2026-10-12 브라우저 QA R2-1). 접수 알림이 "담당자가 확인한 뒤"라고 하면 주문
   * 상세(OrderCancellation)의 "결제 결과를 확인한 뒤 주문 취소를 마무리합니다"와
   * 어긋나고 일어나지 않을 일을 기다리게 한다. 시도 상태별로 실제로 닫히는 길만
   * 말한다:
   *   prepared   — 활성 요청이 있으면 claim이 거절하므로 결제가 더 진행되지 않고,
   *                결제 기한 sweep이 결제 없이 닫는다(알림 20261013110400).
   *   confirming — finalizer가 승인이면 자동 승인 후 토스 취소, 거절·이탈이면 결제
   *                없이 종결하고 알린다(20261013110100).
   *   그 밖      — 결과 불명·확인 필요는 결제 복구 확인이 닫는다.
   * 반품·교환과 결제완료 주문의 하자 취소처럼 담당자 검토가 실제로 필요한 요청은
   * 종전 문구를 쓴다.
   */
  if p_claim_type = 'cancel' and v_status = 'pending' then
    select attempt.state
    into v_attempt_state
    from public.payment_attempts as attempt
    where attempt.purpose = 'order'
      and attempt.ref_id = p_order_id
    order by attempt.id
    limit 1;

    perform private.notify_order_claim(
      v_claim_id,
      'requested',
      '취소 요청이 접수됐어요',
      case v_attempt_state
        when 'prepared' then
          '결제가 끝나지 않은 주문이라 결제 기한이 지나면 결제 없이 자동으로 취소되고 알림을 보내드려요.'
        when 'confirming' then
          '결제 승인 결과를 확인한 뒤 주문 취소를 마무리합니다. 승인됐다면 결제를 취소하고, 승인되지 않았다면 결제 없이 취소한 뒤 알림을 보내드려요.'
        else
          '결제 결과를 확인한 뒤 주문 취소를 마무리하고 진행 상황을 알려드립니다.'
      end
    );

    return 'requested';
  end if;

  perform private.notify_order_claim(
    v_claim_id,
    'requested',
    '클레임 요청이 접수됐어요',
    '요청을 접수했습니다. 담당자가 확인한 뒤 진행 상황을 알려드립니다.'
  );

  return 'requested';
end;
$function$;

revoke all on function public.request_order_claim(uuid,uuid,text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.request_order_claim(uuid,uuid,text,text,text,text,text,text) to service_role;

