-- D-3 ⑪ — 승인 판정을 클레임 승인 경로에 건다 (설계서 v2 §1-3)
--
-- 기존 승인 버튼은 그대로 두되, 환불 처리로 넘어가기 직전에 한도를 본다.
-- 넘으면 `approval_pending` 에서 멈추고 승인자를 기다린다 — 그 뒤는 같은 코드를 지난다.

CREATE OR REPLACE FUNCTION public.admin_decide_order_claim(p_claim_id uuid, p_decision text, p_note text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_order_id uuid;
  v_order_status public.order_status;
  v_delivered_at timestamptz;
  v_claim record;
  v_next_stage text;
  v_assessment jsonb;
  v_payment_count integer;
  /*
   * 보류를 벗긴 실질 단계.
   *
   * on_hold는 절차의 단계가 아니라 그 위에 덮인 표시다. 보류 중인 클레임을
   * 판정할 때 stage만 보면 processing에서 건 보류가 "아직 착수 전"으로 보인다.
   * lib/orders/claims.ts의 orderClaimEffectiveStage와 같은 정의다.
   */
  v_effective_stage text;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_decision not in ('review', 'approve', 'reject', 'hold', 'resume') then
    raise check_violation using message = 'invalid claim decision';
  end if;

  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_claim_id;

  if v_order_id is null then
    raise no_data_found using message = 'claim_not_found';
  end if;

  -- 잠금 순서: 주문 → 클레임. admin_decide_order_cancellation과 같다.
  select orders.status, orders.delivered_at
  into v_order_status, v_delivered_at
  from public.orders
  where orders.id = v_order_id
  for update;

  select request.*
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id
  for update;

  if v_claim.stage in ('completed', 'rejected') then
    raise exception using message = 'claim_not_decidable';
  end if;

  v_effective_stage := case
    when v_claim.stage = 'on_hold' then coalesce(v_claim.held_from, 'requested')
    else v_claim.stage
  end;

  if p_decision = 'reject' then
    if p_note is null
      or btrim(p_note) <> p_note
      or length(p_note) not between 10 and 200
    then
      raise check_violation using message = 'invalid rejection reason';
    end if;

    /*
     * 거절은 처리에 착수하기 전에만 가능하다.
     *
     * processing·needs_review는 이미 durable claim과 refunds(status='requested')를
     * 열어 둔 상태다. 그 상태에서 요청만 rejected로 닫으면 주문은 "취소 진행 중"인
     * 채로 남고 complete_order_cancellation_request가 cancellation_request_not_processing
     * 으로 막아 돈이 갇힌다. needs_review는 Korpay 수동 복구 seam까지 함께 닫혀
     * 복구 경로가 하나도 남지 않는다. 그 단계에서 되돌릴 일이 있으면 거절이 아니라
     * 보류·정합화로 처리한다.
     */
    if v_effective_stage not in ('requested', 'in_review', 'collecting', 'collected') then
      raise exception using message = 'claim_not_rejectable';
    end if;

    update public.order_cancellation_requests
    set
      stage = 'rejected',
      decided_by = v_actor,
      decision_note = p_note,
      decided_at = now(),
      updated_at = now()
    where id = p_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_rejected',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'from', v_claim.stage,
        'to', 'rejected',
        'reason', p_note
      )
    );

    perform private.notify_order_claim(
      p_claim_id,
      'rejected',
      '클레임 요청이 거절됐어요',
      '요청이 거절됐습니다. 사유: ' || p_note
    );
    return 'rejected';
  end if;

  if p_decision = 'hold' then
    if p_note is null
      or btrim(p_note) <> p_note
      or length(p_note) not between 10 and 200
    then
      raise check_violation using message = 'invalid hold reason';
    end if;
    if v_claim.stage = 'on_hold' then
      return 'on_hold';
    end if;

    update public.order_cancellation_requests
    set
      stage = 'on_hold',
      held_from = v_claim.stage,
      hold_reason = p_note,
      held_at = now(),
      updated_at = now()
    where id = p_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_held',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'from', v_claim.stage,
        'to', 'on_hold',
        'reason', p_note
      )
    );

    perform private.notify_order_claim(
      p_claim_id,
      'held',
      '클레임 처리가 보류됐어요',
      '처리가 보류됐습니다. 사유: ' || p_note
    );
    return 'on_hold';
  end if;

  if p_decision = 'resume' then
    if v_claim.stage <> 'on_hold' then
      raise exception using message = 'claim_not_held';
    end if;

    v_next_stage := coalesce(v_claim.held_from, 'requested');

    -- status를 여기서 계산하지 않는다. held_from이 needs_review면 이 자리에서
    -- 'requested'를 적어 투영 CHECK에 막혔고, 보류가 영원히 풀리지 않았다(F3).
    update public.order_cancellation_requests
    set
      stage = v_next_stage,
      held_from = null,
      hold_reason = null,
      held_at = null,
      updated_at = now()
    where id = p_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_resumed',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'from', 'on_hold',
        'to', v_next_stage
      )
    );

    perform private.notify_order_claim(
      p_claim_id,
      'resumed',
      '클레임 처리가 재개됐어요',
      '보류가 해제되어 처리가 다시 시작됐습니다.'
    );
    return v_next_stage;
  end if;

  if p_decision = 'review' then
    if v_claim.stage <> 'requested' then
      raise exception using message = 'claim_not_decidable';
    end if;

    update public.order_cancellation_requests
    set
      stage = 'in_review',
      decided_by = v_actor,
      updated_at = now()
    where id = p_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_in_review',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'from', 'requested',
        'to', 'in_review'
      )
    );
    return 'in_review';
  end if;

  -- 승인.
  if v_claim.stage not in ('requested', 'in_review') then
    raise exception using message = 'claim_not_decidable';
  end if;

  if v_order_status not in (
    'pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done'
  ) then
    raise exception using message = 'order_not_cancelable';
  end if;

  -- 돈이 걸린 판정은 승인 단계에서 다시 본다(#189). 기준 시각은 접수 시각이다.
  if public.order_withdrawal_deadline_passed(
    v_delivered_at,
    v_claim.reason_type,
    v_claim.requested_at
  ) then
    raise check_violation using message = 'withdrawal_deadline_expired';
  end if;

  -- 취소는 회수할 물건이 없으므로 곧장 환불 처리로 간다. 반품·교환은 수거부터다.
  if v_claim.claim_type = 'cancel' then
    v_next_stage := 'processing';
  else
    v_next_stage := 'collecting';
  end if;

  -- D-3: 한도를 넘거나 「기타」 사유면 처리 전에 승인자를 부른다.
  -- 금액은 계산이고 승인은 권한이다 — 담당자가 전액 환불을 혼자 끝내지 않게 나눈다.
  if v_next_stage = 'processing' then
    v_assessment := private.claim_refund_assessment(p_claim_id);
    if (v_assessment ->> 'requires_approval')::boolean then
      update public.order_cancellation_requests
      set stage = 'approval_pending',
          decided_by = v_actor,
          decided_at = now(),
          approval_requested_at = now(),
          limit_snapshot = v_assessment,
          updated_at = now()
      where id = p_claim_id;

      insert into public.audit_log (actor_id, action, target, diff)
      values (
        v_actor,
        'admin.order.claim_approval_requested',
        'order:' || v_order_id::text,
        jsonb_build_object('claimId', p_claim_id, 'assessment', v_assessment)
      );
      return 'approval_pending';
    end if;

    v_payment_count := private.start_claim_refund(p_claim_id);
  end if;

  update public.order_cancellation_requests
  set
    stage = v_next_stage,
    decided_by = v_actor,
    decision_note = null,
    decided_at = now(),
    provider_started_at = case when v_next_stage = 'processing' then now() else provider_started_at end,
    limit_snapshot = coalesce(v_assessment, limit_snapshot),
    collecting_at = case when v_next_stage = 'collecting' then now() else collecting_at end,
    updated_at = now()
  where id = p_claim_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.claim_approved',
    'order:' || v_order_id::text,
    jsonb_build_object(
      'claimId', p_claim_id,
      'claimType', v_claim.claim_type,
      'from', v_claim.stage,
      'to', v_next_stage,
      'previousOrderStatus', v_order_status::text,
      'reasonType', v_claim.reason_type,
      'paymentCount', coalesce(v_payment_count, 0)
    )
  );

  perform private.notify_order_claim(
    p_claim_id,
    'approved',
    '클레임 요청이 승인됐어요',
    case
      when v_next_stage = 'collecting'
        then '요청이 승인됐습니다. 안내받은 방법으로 굿즈를 반송해주세요.'
      else '요청이 승인됐습니다. 결제 취소 처리를 시작합니다.'
    end
  );

  return v_next_stage;
end;
$function$

;
