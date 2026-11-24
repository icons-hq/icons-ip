-- 2026-11-24 고객 화면 표기 전환('굿즈' → '상품', PR #722·#732)의 DB 쪽 나머지: DB가 만드는 앱 알림 문구와
-- 적립금 내역 사유에 남은 '굿즈'를 '상품'으로 바꾼다. 바뀌는 것은 고객에게 보이는 문자열뿐이고 분기·잠금·키·링크는 그대로다.
--
-- 1) 아래 14개 함수는 이 migration 직전의 정의(pg_get_functiondef)와 같고, 문자열 안의 '굿즈'만 바꿨다(함수 안 주석은 그대로).
--    조사는 받침에 맞춰 고쳤다(굿즈가→상품이, 굿즈를→상품을, 굿즈는→상품은).
--    부분 취소·부분 반품 알림의 품목 이름 대체값 '일부 굿즈'는 '상품 일부'로 바꿨다 — 뒤에 붙는 '를'·'의'가 그대로 맞는다.
-- 2) 이미 쌓인 알림도 같은 문장으로 고친다. 알림 종류와 정해진 문장(또는 문장 끝)이 정확히 같은 행만 바꾸고,
--    상품 이름 같은 나머지 글자는 건드리지 않는다. 적립금 원장(store_credit_ledger.reason)과 리뷰 이벤트 회수 기록은
--    돈·감사 기록이라 지난 행을 고치지 않는다 — 리뷰 이벤트 혜택 회수 사유는 이 migration 뒤에 남는 행부터 '상품'이다.
-- 3) 운영자 계약으로 등록된 함수 5개는 끝에서 지문을 다시 적는다(분류 값은 기존 행 그대로).
-- CREATE OR REPLACE는 소유자·권한·트리거 연결을 그대로 둔다.

-- private.notify_order_status_change: 문구 2곳
CREATE OR REPLACE FUNCTION private.notify_order_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'paid' then
    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      link_path,
      source_type,
      source_id,
      dedupe_key
    )
    values (
      new.user_id,
      'order_paid',
      '결제가 확인됐어요',
      '주문 결제가 완료됐습니다.',
      '/orders/' || new.id::text,
      'order',
      new.id::text,
      'order:paid:' || new.id::text
    )
    on conflict (user_id, dedupe_key) do nothing;
  elsif new.status = 'shipping' then
    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      link_path,
      source_type,
      source_id,
      dedupe_key
    )
    values (
      new.user_id,
      'order_shipping',
      '배송이 시작됐어요',
      '주문한 상품의 배송이 시작됐습니다.',
      '/orders/' || new.id::text,
      'order',
      new.id::text,
      'order:shipping:' || new.id::text
    )
    on conflict (user_id, dedupe_key) do nothing;
  elsif new.status = 'delivered' then
    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      link_path,
      source_type,
      source_id,
      dedupe_key
    )
    values (
      new.user_id,
      'order_delivered',
      '배송이 완료됐어요',
      '주문한 상품이 배송 완료됐습니다. 문제가 있으면 주문 상세에서 알려주세요.',
      '/orders/' || new.id::text,
      'order',
      new.id::text,
      'order:delivered:' || new.id::text
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  return new;
end;
$function$;

-- private.decide_order_claim: 문구 1곳
CREATE OR REPLACE FUNCTION private.decide_order_claim(p_claim_id uuid, p_decision text, p_note text)
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
  perform private.require_operator_capability('sales.manage',false);

  if v_actor is null or not public.has_operator_capability('sales.manage',false) then
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

  perform s.id from public.order_shipments s where s.order_id=v_order_id order by s.id for update;

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

    /*
     * 한 출고지라도 교환품을 재출고했으면 거부할 수 없다(TKT-166·ADR-0041).
     * 나간 소포의 재고 차감과 배송 기록이 남으므로, 남은 출고지를 재출고해 종결하거나 보류한다.
     */
    if v_claim.reshipped_at is not null
      or exists (select 1 from public.order_claim_reshipments as reshipment where reshipment.claim_id = p_claim_id)
    then
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

  if v_claim.claim_type='cancel' and not private.order_cancel_eligible(v_order_id) then raise exception using message='order_not_cancelable'; end if;
  if v_claim.claim_type in ('return','exchange') and not private.order_return_intake_eligible(v_order_id) then raise exception using message='order_not_claimable'; end if;
  perform private.prepare_claim_collections(p_claim_id);

  -- Money/deadline approval continues to use the original request time.
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

  if v_next_stage = 'processing' then
    insert into public.order_cancellation_claims (
      order_id,
      requested_by,
      previous_status
    )
    values (v_order_id, v_claim.requested_by, v_order_status)
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
      payment.amount - private.payment_partial_refunded_amount(payment.id),
      v_claim.reason,
      case when refund.status = 'done' then 'done' else 'requested' end,
      p_claim_id
    from public.payments as payment
    left join public.refunds as refund on refund.payment_id = payment.id
    where payment.purpose = 'order'
      and payment.ref_id = v_order_id
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
      and payment.ref_id = v_order_id
      and payment.status in ('pending', 'paid', 'canceled', 'refunded');
  end if;

  update public.order_cancellation_requests
  set
    stage = v_next_stage,
    decided_by = v_actor,
    decision_note = null,
    decided_at = now(),
    provider_started_at = case when v_next_stage = 'processing' then now() else provider_started_at end,
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
        then '요청이 승인됐습니다. 안내받은 방법으로 상품을 반송해주세요.'
      else '요청이 승인됐습니다. 결제 취소 처리를 시작합니다.'
    end
  );

  return v_next_stage;
end;
$function$;

-- private.notify_good_insert: 문구 2곳
CREATE OR REPLACE FUNCTION private.notify_good_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.published_at is null or new.archived_at is not null or new.sale_restriction<>'none'
    or not (new.allow_card_payment or new.allow_bank_transfer)
    or not exists(select 1 from public.ips where id=new.ip_id and published_at is not null and archived_at is null) then return new; end if;
  if tg_op='UPDATE' and old.published_at is not null then return new; end if;
  if (select auth.uid()) is null or not (select public.is_staff()) then
    return new;
  end if;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    link_path,
    source_type,
    source_id,
    dedupe_key
  )
  select
    follow.user_id,
    'drop_published',
    '새 상품이 공개됐어요',
    left(new.name || ' 상품이 공개됐습니다.', 500),
    '/shop',
    'good',
    new.id,
    'good:' || pg_catalog.encode(
      extensions.digest(new.id, 'sha256'),
      'hex'
    )
  from public.ip_follows as follow
  where follow.ip_id = new.ip_id
    and follow.notify_drops
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$function$;

-- private.notify_order_partial_cancellation: 문구 2곳
CREATE OR REPLACE FUNCTION private.notify_order_partial_cancellation(p_id uuid, p_event text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare head private.order_partial_cancellations; purchase public.orders; label text; body text; title text;
begin
  select * into head from private.order_partial_cancellations where id = p_id;
  if head.reason_code = 'return' then perform private.notify_order_partial_return(p_id, p_event); return; end if;
  select * into purchase from public.orders where id = head.order_id;
  label := left(coalesce(private.partial_cancellation_items_label(p_id), '상품 일부'), 200);
  if p_event = 'applied' then
    title := '주문 일부가 취소됐어요';
    body := format('재고가 부족해 %s를 취소했습니다. %s%s나머지 상품은 그대로 보내드립니다.', label,
      case when head.refund_amount = 0 then '돌려드릴 결제 금액은 없습니다. '
        when head.provider = 'bank_transfer'
        then format('환불 %s은 등록하신 환불계좌로 송금해 드립니다. ', private.format_krw(head.refund_amount))
        else format('%s을 결제사에서 부분 취소했습니다(카드사 처리에 영업일 기준 3~4일). ', private.format_krw(head.refund_amount)) end,
      case when head.store_credit_restore_amount > 0
        then format('사용하신 적립금 %s은 적립금으로 되돌려 드렸습니다. ', private.format_krw(head.store_credit_restore_amount)) else '' end);
  elsif p_event = 'transferred' then
    title := '부분 취소 환불을 송금했어요';
    body := format('취소한 %s의 환불 %s을 환불계좌로 송금했습니다.', label, private.format_krw(head.refund_amount));
  else
    return;
  end if;
  insert into public.notifications(user_id, type, title, body, link_path, source_type, source_id, dedupe_key)
  values (purchase.user_id, 'claim_updated', title, left(body, 500), '/orders/' || purchase.id::text, 'order_partial_cancellation', head.id::text,
    'partial-cancel:' || p_event || ':' || head.id::text)
  on conflict (user_id, dedupe_key) do nothing;
end $function$;

-- private.notify_order_partial_return: 문구 2곳
CREATE OR REPLACE FUNCTION private.notify_order_partial_return(p_id uuid, p_event text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare head private.order_partial_cancellations; purchase public.orders; label text; body text; title text; deduction text;
begin
  select * into head from private.order_partial_cancellations where id = p_id;
  select * into purchase from public.orders where id = head.order_id;
  label := left(coalesce(private.partial_cancellation_items_label(p_id), '상품 일부'), 200);
  deduction := case when head.return_fee_deduction > 0 then format('반품배송비 %s을 뺀 ', private.format_krw(head.return_fee_deduction)) else '' end;
  if p_event = 'applied' then
    title := case when head.state = 'completed' then '반품 환불이 완료됐어요' else '반품 환불 송금을 접수했어요' end;
    body := format('반품하신 %s의 확인을 마쳤습니다. %s%s나머지 상품은 그대로 유지됩니다.', label,
      case when head.refund_amount = 0 then '돌려드릴 결제 금액은 없습니다. '
        when head.provider = 'bank_transfer' and purchase.payment_method <> 'bank_transfer'
        then format('결제사가 이 결제의 부분 취소를 받지 않아 %s환불 %s은 알려 주신 계좌로 송금해 드립니다. ', deduction,
          private.format_krw(head.refund_amount))
        when head.provider = 'bank_transfer'
        then format('%s환불 %s은 등록하신 환불계좌로 송금해 드립니다. ', deduction, private.format_krw(head.refund_amount))
        else format('%s%s을 결제사에서 부분 취소했습니다(카드사 처리에 영업일 기준 3~4일). ', deduction, private.format_krw(head.refund_amount)) end,
      case when head.store_credit_restore_amount > 0
        then format('사용하신 적립금 %s은 적립금으로 되돌려 드렸습니다. ', private.format_krw(head.store_credit_restore_amount)) else '' end);
  elsif p_event = 'transferred' then
    title := '반품 환불을 송금했어요';
    body := format('반품하신 %s의 환불 %s을 환불계좌로 송금했습니다.', label, private.format_krw(head.refund_amount));
  else
    return;
  end if;
  insert into public.notifications(user_id, type, title, body, link_path, source_type, source_id, dedupe_key)
  values (purchase.user_id, 'claim_updated', title, left(body, 500), '/orders/' || purchase.id::text, 'order_partial_cancellation', head.id::text,
    'partial-return:' || p_event || ':' || head.id::text)
  on conflict (user_id, dedupe_key) do nothing;
end $function$;

-- private.review_event_purchase_revocation: 문구 1곳
CREATE OR REPLACE FUNCTION private.review_event_purchase_revocation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if tg_table_name='orders' then
  if new.status='canceled' then perform private.reverse_review_event_order_awards(new.id,'원주문 취소');end if;
 elsif tg_table_name='payments' then
  if new.purpose='order' and new.status='refunded' then
   -- Wait for an in-flight publisher before scanning its newly committed awards.
   -- Publishing locks original orders before credit accounts, as refund finalizers do.
   perform 1 from public.orders where id=new.ref_id for update;
   perform private.reverse_review_event_order_awards(new.ref_id,'원결제 환불');
  end if;
 elsif new.claim_type in ('cancel','return') and (new.status='completed' or new.stage='completed') and not private.claim_is_partial_return(new.id) then
  perform 1 from public.orders where id=new.order_id for update;
  perform private.reverse_review_event_order_awards(new.order_id,'원주문 취소·반품 완료');
 elsif new.claim_type='return' and (new.status='completed' or new.stage='completed') and private.claim_is_partial_return(new.id) then
  perform 1 from public.orders where id=new.order_id for update;
  perform private.reverse_review_event_returned_awards(new.order_id,'리뷰한 상품 부분 반품 완료');
 end if;
 return new;
end $function$;

-- public.admin_answer_product_question: 문구 1곳
CREATE OR REPLACE FUNCTION public.admin_answer_product_question(target_question_id uuid, target_answer_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
  normalized_answer text := btrim(coalesce(target_answer_body, ''), E' \t\n\r\f\v');
  v_user_id uuid;
  v_good_id text;
  v_good_name text;
  v_previous text;
begin
  perform private.require_operator_capability('cs.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('cs.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if char_length(normalized_answer) not between 1 and 2000 then
    raise exception 'invalid_question_answer' using errcode = '22023';
  end if;

  select question.user_id, question.good_id, question.answer_body
    into v_user_id, v_good_id, v_previous
  from public.product_questions as question
  where question.id = target_question_id
  for update;

  if not found then
    raise exception 'question_not_found' using errcode = 'P0002';
  end if;

  update public.product_questions
  set answer_body = normalized_answer,
      answered_at = now(),
      answered_by = actor_id
  where id = target_question_id;

  select good.name into v_good_name
  from public.goods as good
  where good.id = v_good_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'product_question.answer',
    'product_questions:' || target_question_id::text,
    jsonb_build_object(
      'goodId', v_good_id,
      'isEdit', v_previous is not null,
      'answerLength', char_length(normalized_answer)
    )
  );

  -- body CHECK 상한은 500자다. 굿즈 이름이 길어 알림 insert가 실패하면 답변
  -- 저장까지 함께 되돌아간다 — 이름을 잘라서라도 답변은 남긴다.
  insert into public.notifications (
    user_id, type, title, body, link_path, source_type, source_id, dedupe_key
  )
  values (
    v_user_id,
    'product_question_answered',
    -- 용어 규율(CONTEXT.md): 공개 상품 Q&A를 1:1 '문의'와 섞어 부르지 않는다.
    '상품 Q&A에 답변이 등록됐어요',
    left(coalesce(v_good_name, '상품'), 100) || ' 질문에 엑스스퀘어 운영자가 답변을 남겼습니다.',
    '/my/questions',
    'product_question',
    target_question_id::text,
    'product_question_answered:' || target_question_id::text
  )
  on conflict (user_id, dedupe_key) do update set
    title = excluded.title,
    body = excluded.body,
    read_at = null,
    created_at = now();
end;
$function$;

-- public.admin_reply_to_review: 문구 1곳
CREATE OR REPLACE FUNCTION public.admin_reply_to_review(target_review_id uuid, target_reply text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_reply text := btrim(coalesce(target_reply, ''));
  v_user_id uuid;
  v_good_id text;
  v_good_name text;
  v_previous text;
  v_link text;
begin
  perform private.require_operator_capability('cs.manage',false);

  if v_actor is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if char_length(v_reply) not between 2 and 1000 then
    raise invalid_parameter_value using message = 'invalid_review_reply';
  end if;

  select review.user_id, review.good_id, review.admin_reply
    into v_user_id, v_good_id, v_previous
  from public.reviews as review
  where review.id = target_review_id
  for update;

  if not found then
    raise no_data_found using message = 'review_not_found';
  end if;

  select good.name into v_good_name
  from public.goods as good
  where good.id = v_good_id;

  update public.reviews
  set
    admin_reply = v_reply,
    admin_reply_at = now(),
    admin_reply_by = v_actor
  where id = target_review_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.review.reply',
    'review:' || target_review_id::text,
    jsonb_build_object(
      'goodId', v_good_id,
      'isEdit', v_previous is not null,
      'replyLength', char_length(v_reply)
    )
  );

  -- 굿즈 id는 카탈로그 슬러그지만 링크로 쓰기 전에 형태를 확인한다. link_path
  -- CHECK가 제어문자·역슬래시를 막긴 해도, 이상한 id 하나 때문에 답글 저장
  -- 전체가 실패하는 것보다 안전한 목적지로 접는 편이 낫다.
  v_link := case
    when v_good_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' then '/shop/' || v_good_id
    else '/my/reviews'
  end;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    link_path,
    source_type,
    source_id,
    dedupe_key
  )
  values (
    v_user_id,
    'review_replied',
    '리뷰에 답글이 달렸어요',
    /* body CHECK 상한은 500자다. 굿즈 이름이 길어 알림 insert가 실패하면 답글
       저장까지 함께 되돌아간다 — 이름을 잘라서라도 답글은 남긴다. */
    left(coalesce(v_good_name, '상품'), 100) || ' 리뷰에 엑스스퀘어 운영자가 답글을 남겼습니다.',
    v_link,
    'review',
    target_review_id::text,
    'review_replied:' || target_review_id::text
  )
  on conflict (user_id, dedupe_key) do nothing;
end;
$function$;

-- private.change_purchase_confirmation: 문구 1곳
CREATE OR REPLACE FUNCTION private.change_purchase_confirmation(p_order_id uuid, p_kind text, p_note text, p_revision bigint, p_operation_id uuid, p_actor uuid, p_session uuid, p_admin boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.orders;c private.order_purchase_confirmations;e private.purchase_confirmation_events;request jsonb;at_value timestamptz;active boolean;
begin
 perform private.purchase_confirmation_identity(p_actor,p_session,p_admin);
 if p_operation_id is null or p_revision is null or p_revision<0 or p_kind is null
  or (p_admin and p_kind not in ('request','hold','resume')) or (not p_admin and p_kind not in ('confirm','extend'))
  or p_note is null or char_length(p_note)>500 or p_kind='hold' and char_length(btrim(p_note))<1 then raise invalid_parameter_value;end if;
 select * into o from public.orders where id=p_order_id for update;
 if not found or not p_admin and o.user_id is distinct from p_actor then raise insufficient_privilege;end if;
 request:=jsonb_build_object('kind',p_kind,'note',p_note,'revision',p_revision,'admin',p_admin);
 select * into e from private.purchase_confirmation_events where id=p_operation_id;
 if found then
  if e.order_id<>p_order_id or e.actor_id is distinct from p_actor or e.session_id is distinct from p_session or e.request is distinct from request then raise sqlstate 'PT409' using message='purchase_confirmation_operation_conflict';end if;
  return private.purchase_confirmation_document(p_order_id);end if;
 insert into private.order_purchase_confirmations(order_id,policy_snapshot) values(p_order_id,'{"revision":0,"autoEnabled":false,"autoAfterDays":null,"buyerExtensionDays":null}') on conflict(order_id) do nothing;
 select * into c from private.order_purchase_confirmations where order_id=p_order_id for update;
 if c.revision<>p_revision then raise sqlstate 'PT409' using message='purchase_confirmation_changed';end if;
 if not private.purchase_confirmation_eligible(p_order_id) then raise check_violation using message='purchase_confirmation_unavailable';end if;
 at_value:=clock_timestamp();
 if p_kind='confirm' then
  if c.held then raise check_violation using message='purchase_confirmation_held';end if;
  update private.order_purchase_confirmations set confirmed_at=at_value,confirmed_by=p_actor,confirmation_kind='buyer' where order_id=p_order_id;
  update public.orders set status='done',done_at=at_value where id=p_order_id;
 elsif p_kind='extend' then
  select auto_enabled into active from private.purchase_confirmation_policy where singleton;
  if c.held or not active or c.extension_used or c.auto_due_at is null or (c.policy_snapshot->>'buyerExtensionDays')::integer is null then raise check_violation using message='purchase_confirmation_extension_unavailable';end if;
  update private.order_purchase_confirmations set extension_used=true,auto_due_at=greatest(at_value,c.auto_due_at)+make_interval(days=>(c.policy_snapshot->>'buyerExtensionDays')::integer) where order_id=p_order_id;
 elsif p_kind='hold' then
  if c.held then raise check_violation using message='purchase_confirmation_held';end if;
  update private.order_purchase_confirmations set held=true,hold_reason=btrim(p_note) where order_id=p_order_id;
 elsif p_kind='resume' then
  if not c.held then raise check_violation using message='purchase_confirmation_not_held';end if;
  update private.order_purchase_confirmations set held=false,hold_reason=null where order_id=p_order_id;
 elsif p_kind='request' then
  if c.held or c.requested_at is not null then raise check_violation using message='purchase_confirmation_already_requested';end if;
  insert into public.notifications(user_id,type,title,body,link_path,source_type,source_id,dedupe_key)
   values(o.user_id,'purchase_confirmation','구매확정을 확인해주세요','받으신 상품을 확인하셨다면 주문 상세에서 구매확정을 진행할 수 있습니다. 반품·교환 신청 자격은 별도로 유지됩니다.',
    '/orders/'||o.id,'purchase_confirmation',o.id::text,'purchase-confirmation:'||o.id) on conflict(user_id,dedupe_key) do nothing;
  update private.order_purchase_confirmations set requested_at=at_value where order_id=p_order_id;
 end if;
 update private.order_purchase_confirmations set revision=revision+1 where order_id=p_order_id;
 insert into private.purchase_confirmation_events(id,order_id,actor_id,session_id,kind,note,request,created_at) values(p_operation_id,p_order_id,p_actor,p_session,p_kind,btrim(p_note),request,at_value);
 insert into public.audit_log(actor_id,action,target,diff) values(p_actor,'order.purchase_confirmation.'||p_kind,'order:'||p_order_id,jsonb_build_object('operationId',p_operation_id,'revision',c.revision+1));
 return private.purchase_confirmation_document(p_order_id);
end $function$;

-- private.wake_restock_alerts: 문구 1곳
CREATE OR REPLACE FUNCTION private.wake_restock_alerts(target_good goods, target_variant_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  woken integer := 0;
  -- 랜덤 판매 굿즈(D5②)는 고객이 옵션을 고르지 않는다 — 옵션 신청도 굿즈 단위 문구·링크로 알린다.
  random_good boolean := exists(select 1 from public.goods as good where good.id = target_good.id and good.option_sale_mode = 'random');
  -- 재신청→재품절→재입고 사이클마다 새 알림이어야 하므로 시각을 키에 넣는다(기존 규율).
  -- now() 는 트랜잭션 시작에 고정되므로 문장 시각(clock_timestamp) 밀리초로 사이클을 구분한다.
  stamp text := ((extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint)::text;
begin
  if target_good.id is null then
    return 0;
  end if;

  -- 신청이 없는 굿즈가 절대다수다. 아래 예외 블록(서브트랜잭션)에 들어가기 전에 거른다.
  if not exists (
    select 1 from public.restock_alerts as alert
    where alert.good_id = target_good.id and alert.status = 'pending'
  ) then
    return 0;
  end if;

  begin
    with flipped as (
      update public.restock_alerts as alert
      set status = 'notified', notified_at = now()
      where alert.good_id = target_good.id
        and alert.status = 'pending'
        and case
          -- ② 옵션이 살 수 있게 됐다: 그 옵션 신청과 "모든 옵션" 신청이 충족된다.
          when target_variant_id is not null then
            alert.variant_id is null or alert.variant_id = target_variant_id
          -- ① 굿즈가 판매 가능해졌다: "모든 옵션" 신청은 재고로 살 수 있는 옵션이 하나라도 있을 때,
          --    옵션 신청은 그 옵션을 지금 재고로 살 수 있을 때만 충족된다. goods.stock_qty 는 보관 옵션과
          --    예약판매 옵션의 실물 입고분까지 더한 캐시라(ADR-0015) 그것만으로는 살 수 있는 옵션이 있다는
          --    뜻이 아니다.
          when alert.variant_id is null then exists (
            select 1 from public.goods_variants as variant
            where variant.good_id = target_good.id
              and variant.archived_at is null
              and variant.preorder_policy_id is null
              and variant.stock_qty > 0
          )
          else exists (
            select 1 from public.goods_variants as variant
            where variant.id = alert.variant_id
              and variant.good_id = target_good.id
              and variant.archived_at is null
              and variant.preorder_policy_id is null
              and variant.stock_qty > 0
          )
        end
      returning alert.user_id, alert.variant_id
    ), fanned as (
      insert into public.notifications (
        user_id,
        type,
        title,
        body,
        link_path,
        source_type,
        source_id,
        dedupe_key
      )
      select
        flipped.user_id,
        'restock_available',
        '재입고 알림',
        left(
          case
            when flipped.variant_id is null or variant.name is null or random_good
              then target_good.name || ' 상품이 다시 판매를 시작했어요.'
            else target_good.name || ' · ' || variant.name || ' 옵션이 다시 판매를 시작했어요.'
          end,
          500
        ),
        -- 옵션 신청은 그 옵션을 고른 상세로 연다(?variant=, PD-14).
        '/shop/' || target_good.id
          || case when flipped.variant_id is null or random_good then '' else '?variant=' || flipped.variant_id::text end,
        'good',
        target_good.id,
        -- 옵션 신청은 키에 옵션을 담는다. 같은 사용자의 "모든 옵션" 신청과 옵션 신청이 한 문장에서
        -- 함께 깨어나도 서로의 알림을 지우지 않는다. 옵션 키는 굿즈 id 길이와 무관하게 128자 안이다.
        case
          when flipped.variant_id is null then 'restock:' || target_good.id || ':' || stamp
          else 'restock:' || flipped.variant_id::text || ':' || stamp
        end
      from flipped
      left join public.goods_variants as variant on variant.id = flipped.variant_id
      on conflict (user_id, dedupe_key) do nothing
      returning 1
    )
    select count(*) into woken from flipped;
  exception when others then
    -- 재고 쓰기를 되돌리지 않는다. 이 블록의 신청 전이·알림만 되돌아가 신청은 pending 으로 남는다.
    raise warning 'restock_alert_wake_failed good=% variant=% sqlstate=%',
      target_good.id, target_variant_id, sqlstate;
    return 0;
  end;

  return woken;
end;
$function$;

-- private.complete_order_claim_collection: 문구 6곳
CREATE OR REPLACE FUNCTION private.complete_order_claim_collection(p_claim_id uuid, p_cause text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare claim public.order_cancellation_requests;completion_event text;
begin
 select * into claim from public.order_cancellation_requests where id=p_claim_id;
 if not found or claim.collected_at is not null or claim.collection_policy is distinct from 'origin' or not claim.collection_required
  or not(claim.stage in('collecting','collected','processing','needs_review')
   or claim.stage='on_hold' and claim.held_from in('collecting','collected','processing','needs_review'))
  or not exists(select 1 from public.order_claim_collections x where x.claim_id=p_claim_id and x.collected_at is not null)
   -- 배송 분실(택배사 확인, 2026-11-19)로 회수를 생략한 배송 건은 입고 없이도 회수가 끝난 것이다.
   and not private.claim_has_effective_carrier_loss(p_claim_id)
  or not private.claim_collections_complete(p_claim_id) then return false;end if;
 -- 회수 완료일은 지금 확인된 출고지 행에서 다시 센다. 되돌림 뒤 다시 완료되는 경우에도 이전 완료일이 남지 않는다.
 update public.order_cancellation_requests set collected_at=clock_timestamp(),
   collection_received_on=private.claim_collection_received_on(p_claim_id),
   stage=case when stage='collecting' then 'collected' else stage end,
   held_from=case when stage='on_hold' and held_from='collecting' then 'collected' else held_from end,
   updated_at=clock_timestamp()
 where id=p_claim_id returning * into claim;
 -- 출고지 입고 확인은 그 감사 기록이 완료를 담는다. 결정·정정으로 끝난 완료는 따로 남긴다(되돌림 감사와 대칭).
 if p_cause is not null then
  -- 같은 거래의 결정·정정 감사(created_at=now())보다 뒤에 보이도록 실제 시각을 적는다(타임라인은 created_at·id 순).
  insert into public.audit_log(actor_id,action,target,diff,created_at) values((select auth.uid()),'admin.order.claim_collection_completed','order:'||claim.order_id::text,
   jsonb_build_object('claimId',p_claim_id,'claimType',claim.claim_type,'reasonType',claim.reason_type,'stage',claim.stage,'heldFrom',claim.held_from,
    'receivedOn',claim.collection_received_on,'cause',p_cause),clock_timestamp());
 end if;
 -- 알림 중복 방지 키는 회차를 담는다(첫 회차는 예전 키 그대로). 되돌림 뒤 다시 끝난 때의 안내가 앞 회차의 안내에 막히지 않는다.
 select case when count(*)=0 then 'collected' else 'collected:'||(count(*)+1) end into completion_event
 from public.audit_log a where a.target='order:'||claim.order_id::text and a.action='admin.order.claim_collection_reopened'
  and a.diff->>'claimId'=p_claim_id::text;
 -- 효력 있는 회수 생략 결정의 배송 건이 아직 돌아오지 않았으면 "반송한 굿즈가 모두 입고"라고 알리지 않는다. 진실원은 결정
 -- 표다(재출고 전에 결정만 한 배송 건 포함).
 if claim.claim_type='return' and private.claim_has_effective_carrier_loss(p_claim_id) then
  -- 배송 분실 반품은 "다시 보내드려요"가 아니라 회수 없이 환불을 준비한다고 알린다.
  perform private.notify_order_claim(p_claim_id,completion_event,'반품 확인이 끝났어요',
   case when exists(select 1 from public.order_claim_collections x where x.claim_id=p_claim_id and x.collected_at is not null)
    then '반송한 상품의 입고와 배송 중 분실 확인이 모두 끝나 환불을 준비합니다. 분실된 상품은 반송하지 않아도 됩니다.'
    else '배송 중 분실이 확인되어 상품 회수 없이 환불을 준비합니다.' end);
 elsif exists(select 1 from public.order_claim_collections x
   where x.claim_id=p_claim_id and x.collected_at is null and private.claim_collection_waived(x.claim_id,x.shipment_id)) then
  perform private.notify_order_claim(p_claim_id,completion_event,'반송이 필요한 상품이 모두 입고됐어요',
   '반송이 필요한 상품의 입고가 모두 확인되어 후속 처리를 준비합니다. 일부 상품은 회수 없이 다시 보내드려요.');
 else
  perform private.notify_order_claim(p_claim_id,completion_event,'반송한 상품이 모두 입고됐어요','반송한 상품의 입고가 모두 확인되어 후속 처리를 준비합니다.');
 end if;
 return true;
end $function$;

-- public.admin_record_order_claim_collection: 문구 1곳
CREATE OR REPLACE FUNCTION public.admin_record_order_claim_collection(p_claim_id uuid, p_stage text, p_received_on date, p_evidence text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_claim record;
  v_order_day date;
  v_today date := (clock_timestamp() at time zone 'Asia/Seoul')::date;
  v_received date;
begin
  perform private.require_operator_capability('sales.manage',false);

  if v_actor is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_stage not in ('collecting', 'collected') then
    raise check_violation using message = 'invalid collection stage';
  end if;
  -- 레거시 회수에는 근거 열이 없어 감사 기록에만 남긴다. 출고지별 회수 확인 근거와 같은 규칙이다.
  if p_evidence is not null and (p_evidence <> btrim(p_evidence) or char_length(p_evidence) not between 1 and 500
    or translate(p_evidence, E'\n\r\t', '') ~ '[[:cntrl:]]') then
    raise check_violation using message = 'invalid_collection_evidence';
  end if;

  select (o.created_at at time zone 'Asia/Seoul')::date into v_order_day
  from public.orders o join public.order_cancellation_requests c on c.order_id=o.id where c.id=p_claim_id for update of o;
  perform s.id from public.order_shipments s join public.order_cancellation_requests c on c.order_id=s.order_id where c.id=p_claim_id order by s.id for update of s;

  select request.*
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id
  for update;

  if not found then
    raise no_data_found using message = 'claim_not_found';
  end if;

  if v_claim.collection_policy='origin' and p_stage='collected' then raise check_violation using message='origin_collection_required'; end if;

  if v_claim.claim_type = 'cancel' then
    raise exception using message = 'claim_type_has_no_collection';
  end if;

  -- 수거 시작은 승인이 이미 만든다. 같은 값으로 다시 부르면 멱등하게 통과하고,
  -- 그 밖의 단계에서 부르면 거절한다 — 뒤로 감는 전이를 만들지 않는다.
  if p_stage = 'collecting' then
    if v_claim.stage = 'collecting' then
      return 'collecting';
    end if;
    raise exception using message = 'claim_not_collectable';
  end if;

  if v_claim.stage = 'collected' then
    return 'collected';
  end if;
  if v_claim.stage <> 'collecting' then
    raise exception using message = 'claim_not_collectable';
  end if;

  -- 실제 입고일(KST 날짜). 비우면 오늘이다. 미래와 주문일보다 이른 날은 받지 않는다.
  v_received := coalesce(p_received_on, v_today);
  if v_received > v_today or v_received < v_order_day then
    raise check_violation using message = 'invalid_collection_received_on';
  end if;

  update public.order_cancellation_requests
  set
    stage = p_stage,
    collected_at = case when p_stage = 'collected' then now() else collected_at end,
    collection_received_on = v_received,
    updated_at = now()
  where id = p_claim_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.claim_collected',
    'order:' || v_claim.order_id::text,
    jsonb_build_object(
      'claimId', p_claim_id,
      'claimType', v_claim.claim_type,
      'from', v_claim.stage,
      'to', p_stage,
      'receivedOn', v_received,
      'evidence', p_evidence
    )
  );

  perform private.notify_order_claim(
    p_claim_id,
    'collected',
    '반송한 상품이 입고됐어요',
    case
      when v_claim.claim_type = 'exchange'
        then '입고가 확인됐습니다. 교환 상품 재출고를 준비합니다.'
      else '입고가 확인됐습니다. 영업일 기준 3일 이내에 환급 절차를 진행합니다.'
    end
  );

  return p_stage;
end;
$function$;

-- public.service_record_return_pickup_results: 문구 1곳
CREATE OR REPLACE FUNCTION public.service_record_return_pickup_results(p_results jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare settings private.return_pickup_settings; result jsonb; pickup private.claim_return_pickups; tracking text; external text; code text;
  bundle public.order_claim_collection_bundles; label text; recorded integer := 0; requested integer := 0; failed integer := 0; canceled integer := 0;
  cancel_failed integer := 0; stale integer := 0; invalid integer := 0; deferred integer := 0; late text; system_actor constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results) > 100 then
    raise invalid_parameter_value using message = 'invalid_return_pickup_results'; end if;
  select * into settings from private.return_pickup_settings where singleton;
  for result in select value from jsonb_array_elements(p_results) loop
    if jsonb_typeof(result) is distinct from 'object' or coalesce(result->>'pickupId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(result->>'leaseToken', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(result->>'kind', '') not in ('request','cancel') then invalid := invalid + 1; continue; end if;
    select * into pickup from private.claim_return_pickups where id = (result->>'pickupId')::uuid for update;
    if not found or pickup.lease_token is distinct from (result->>'leaseToken')::uuid
      or (result->>'kind' = 'request') <> (pickup.state in ('pending','failed')) then stale := stale + 1; continue; end if;
    -- 회차 시간 예산이 끝나 보내지 못한 일: 한 번도 보내지 않았으니 임대를 풀고 이번 회차가 센 시도를 되돌린다(다음 회차가 다시 잡는다).
    if result->>'outcome' = 'deferred' then
      update private.claim_return_pickups set lease_token = null, lease_until = null, updated_at = clock_timestamp(),
        attempts = case when result->>'kind' = 'request' then greatest(attempts - 1, retry_base) else attempts end,
        cancel_attempts = case when result->>'kind' = 'cancel' then greatest(cancel_attempts - 1, cancel_retry_base) else cancel_attempts end
      where id = pickup.id;
      deferred := deferred + 1;
      continue;
    end if;
    code := nullif(result->>'errorCode', '');
    if code is not null and code !~ '^[a-z0-9_]{1,64}$' then code := 'upstream_error'; end if;
    if result->>'kind' = 'request' then
      tracking := upper(regexp_replace(coalesce(result->>'trackingNumber', ''), '[^A-Za-z0-9]', '', 'g'));
      external := nullif(result->>'externalId', '');
      if result->>'outcome' = 'requested' and tracking ~ '^[A-Z0-9]{8,30}$' and (external is null or external ~ '^[\x21-\x7e]{1,100}$') then
        update private.claim_return_pickups set state = 'requested', tracking_number = tracking, external_id = external, requested_at = clock_timestamp(),
          last_error_code = null, next_attempt_at = null, lease_token = null, lease_until = null, updated_at = clock_timestamp()
        where id = pickup.id;
        insert into private.claim_return_pickup_attempts(pickup_id, kind, outcome) values (pickup.id, 'request', 'requested');
        select * into bundle from public.order_claim_collection_bundles where id = pickup.bundle_id;
        -- 요청이 나가는 사이 철회·거절됐거나 회수가 필요 없어졌으면 접수됐다고 알리지 않고 바로 취소로 돌린다('collected'는 정상 종료라 다음 회차가 닫는다).
        late := private.claim_return_pickup_block(bundle);
        if late is not null and late <> 'collected' then
          update private.claim_return_pickups set state = 'cancel_pending', cancel_reason = late, next_attempt_at = clock_timestamp(),
            cancel_retry_base = cancel_attempts, updated_at = clock_timestamp() where id = pickup.id;
        end if;
        label := coalesce(nullif(bundle.return_name_snapshot, ''), '출고지 반품 주소');
        insert into private.claim_collection_events(id, claim_id, shipment_id, actor_id, session_id, request, result)
        values (gen_random_uuid(), pickup.claim_id, pickup.shipment_id, system_actor, system_actor,
          jsonb_build_object('claimId', pickup.claim_id, 'shipmentId', pickup.shipment_id, 'bundleId', pickup.bundle_id, 'source', 'return_pickup',
            'values', jsonb_build_object('method', 'seller_arranged', 'carrier', pickup.carrier, 'trackingNumber', tracking,
              'evidence', case when late is not null and late <> 'collected' then '자동 회수 접수 후 즉시 취소 · ' else '자동 회수 접수 · ' end || label)),
          jsonb_build_object('pickupId', pickup.id, 'state', 'requested'));
        insert into public.audit_log(actor_id, action, target, diff) values (null, 'system.order.claim_return_pickup_requested', 'order:' || pickup.order_id,
          jsonb_build_object('claimId', pickup.claim_id, 'shipmentId', pickup.shipment_id, 'bundleId', pickup.bundle_id, 'pickupId', pickup.id,
            'provider', pickup.provider, 'carrier', pickup.carrier, 'trackingNumber', tracking, 'attempts', pickup.attempts,
            'canceledAtOnce', case when late is not null and late <> 'collected' then late else null end));
        if late is null then
          perform private.notify_order_claim(pickup.claim_id, 'return_pickup_requested', '방문 회수가 접수됐어요',
            '택배 기사가 방문해 상품을 회수합니다. 주문 상세의 회수 정보에서 회수 송장을 확인해주세요.');
        end if;
        requested := requested + 1;
      else
        update private.claim_return_pickups set state = 'failed',
          last_error_code = case when result->>'outcome' = 'requested' then 'invalid_tracking' else coalesce(code, 'upstream_error') end,
          next_attempt_at = private.claim_return_pickup_next_attempt(pickup.attempts - pickup.retry_base, settings),
          lease_token = null, lease_until = null, updated_at = clock_timestamp()
        where id = pickup.id;
        insert into private.claim_return_pickup_attempts(pickup_id, kind, outcome, error_code)
        values (pickup.id, 'request', 'error', case when result->>'outcome' = 'requested' then 'invalid_tracking' else coalesce(code, 'upstream_error') end);
        failed := failed + 1;
      end if;
    else
      if result->>'outcome' in ('canceled','not_found') then
        update private.claim_return_pickups set state = 'canceled', canceled_at = clock_timestamp(), last_error_code = null, next_attempt_at = null,
          lease_token = null, lease_until = null, updated_at = clock_timestamp() where id = pickup.id;
        insert into private.claim_return_pickup_attempts(pickup_id, kind, outcome) values (pickup.id, 'cancel', result->>'outcome');
        if pickup.tracking_number is not null then
          insert into private.claim_collection_events(id, claim_id, shipment_id, actor_id, session_id, request, result)
          values (gen_random_uuid(), pickup.claim_id, pickup.shipment_id, system_actor, system_actor,
            jsonb_build_object('claimId', pickup.claim_id, 'shipmentId', pickup.shipment_id, 'bundleId', pickup.bundle_id, 'source', 'return_pickup',
              'values', jsonb_build_object('method', 'seller_arranged', 'carrier', pickup.carrier, 'trackingNumber', pickup.tracking_number,
                'evidence', '자동 회수 취소 · ' || case pickup.cancel_reason when 'withdrawn' then '요청 철회' when 'rejected' then '요청 거절'
                  when 'completed' then '요청 종결' when 'waived' then '회수 생략' when 'customer_sent' then '고객 직접 발송' when 'manual' then '수거 방법 별도 기록' else '회수 불필요' end)),
            jsonb_build_object('pickupId', pickup.id, 'state', 'canceled'));
        end if;
        insert into public.audit_log(actor_id, action, target, diff) values (null, 'system.order.claim_return_pickup_canceled', 'order:' || pickup.order_id,
          jsonb_build_object('claimId', pickup.claim_id, 'bundleId', pickup.bundle_id, 'pickupId', pickup.id, 'provider', pickup.provider,
            'carrier', pickup.carrier, 'trackingNumber', pickup.tracking_number, 'reason', pickup.cancel_reason, 'outcome', result->>'outcome'));
        canceled := canceled + 1;
      else
        update private.claim_return_pickups set state = 'cancel_failed', last_error_code = coalesce(code, 'upstream_error'),
          next_attempt_at = private.claim_return_pickup_next_attempt(pickup.cancel_attempts - pickup.cancel_retry_base, settings),
          lease_token = null, lease_until = null, updated_at = clock_timestamp() where id = pickup.id;
        insert into private.claim_return_pickup_attempts(pickup_id, kind, outcome, error_code) values (pickup.id, 'cancel', 'error', coalesce(code, 'upstream_error'));
        cancel_failed := cancel_failed + 1;
      end if;
    end if;
    recorded := recorded + 1;
  end loop;
  return jsonb_build_object('recorded', recorded, 'requested', requested, 'failed', failed, 'canceled', canceled, 'cancelFailed', cancel_failed,
    'stale', stale, 'invalid', invalid, 'deferred', deferred);
end $function$;

-- private.record_partial_return_refund: 문구 1곳
CREATE OR REPLACE FUNCTION private.record_partial_return_refund(p_claim_id uuid, p_method text, p_stage text, p_note text, p_actor uuid, p_transfer jsonb DEFAULT NULL::jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare claim public.order_cancellation_requests; plan jsonb; head private.order_partial_cancellations; v_id uuid; v_sequence integer;
  v_state text; zero boolean; line jsonb; emptied jsonb; account private.claim_refund_accounts; fee jsonb; expected_method text;
  settlement text;
begin
  select * into claim from public.order_cancellation_requests where id = p_claim_id for update;
  perform a.id from public.payment_attempts a where a.purpose = 'order' and a.ref_id = claim.order_id order by a.id for update;
  perform p.id from public.payments p where p.purpose = 'order' and p.ref_id = claim.order_id order by p.id for update;
  if p_stage = 'completed' then
    select * into head from private.order_partial_cancellations where claim_id = p_claim_id and state <> 'rejected';
    if claim.stage <> 'completed' or head.id is null or head.state <> 'completed' then
      raise exception using message = 'claim_refund_finalization_required';
    end if;
    if p_method <> (case when head.provider = 'bank_transfer' then 'bank_transfer' else 'pg_cancel' end) then
      raise check_violation using message = 'partial_return_refund_method_mismatch';
    end if;
    insert into public.audit_log(actor_id, action, target, diff)
    values (p_actor, 'admin.order.claim_refund_completed', 'order:' || claim.order_id::text,
      jsonb_build_object('claimId', p_claim_id, 'claimType', claim.claim_type, 'method', p_method, 'partialReturn', true,
        'partialCancellationId', head.id, 'refundAmount', head.refund_amount, 'returnFeeDeduction', head.return_fee_deduction,
        'settlementNote', p_note));
    return 'completed';
  end if;
  -- 이미 접수한 원장이 살아 있으면 같은 결과다(다시 누름).
  select * into head from private.order_partial_cancellations where claim_id = p_claim_id and state <> 'rejected';
  if found then
    if p_transfer is not null then raise check_violation using message = 'partial_return_transfer_unavailable'; end if;
    return 'filed';
  end if;
  -- 입고완료, 또는 결제사가 부분 취소를 받지 않아 닫힌 원장 뒤의 다시 접수만.
  if not (claim.stage = 'collected' or claim.stage = 'needs_review'
      and exists(select 1 from private.order_partial_cancellations h where h.claim_id = p_claim_id and h.state = 'rejected')) then
    raise exception using message = 'claim_not_refundable';
  end if;
  -- 계좌 송금 전환은 결제사가 부분 취소를 받지 않아 닫힌 원장 뒤에만(돈이 움직이지 않았다고 결제사 조회로 확인한 상태).
  if p_transfer is not null and not (claim.stage = 'needs_review' and claim.last_error_code = 'partial_return_provider_refused') then
    raise check_violation using message = 'partial_return_transfer_unavailable';
  end if;
  -- 버전 1 주문은 첫 부분 환불 때 배분을 얼린다(ADR-0032 보완 — 얼린 뒤에는 다시 계산하지 않는다).
  perform private.freeze_order_v1_allocation(claim.order_id, p_actor, extensions.gen_random_uuid());
  plan := private.order_partial_return_plan(p_claim_id);
  if p_transfer is not null and plan->>'provider' <> 'toss' then raise check_violation using message = 'partial_return_transfer_unavailable'; end if;
  settlement := case when p_transfer is not null then 'bank_transfer' else plan->>'provider' end;
  expected_method := case when settlement = 'bank_transfer' then 'bank_transfer' else 'pg_cancel' end;
  if p_method <> expected_method then raise check_violation using message = 'partial_return_refund_method_mismatch'; end if;
  zero := (plan->>'refundAmount')::bigint = 0;
  -- 0원이면 결제사를 부르지 않고 다시 접수로 바로 끝난다 — 송금으로 바꿀 돈이 없다.
  if p_transfer is not null and zero then raise check_violation using message = 'partial_return_transfer_unavailable'; end if;
  if plan->>'provider' = 'bank_transfer' then
    -- 무통장 송금 담당(ADR-0010·T03과 같은 판정).
    perform private.require_operator_capability('sales.manage', true);
    if not zero then
      select * into account from private.claim_refund_accounts where claim_id = p_claim_id;
      if not found or account.purged_at is not null or account.account_number is null then
        raise exception using message = 'claim_refund_account_missing';
      end if;
    end if;
  end if;
  fee := plan->'returnFee';
  select coalesce(max(sequence), 0) + 1 into v_sequence from private.order_partial_cancellations where order_id = claim.order_id;
  v_state := case when zero then 'completed' when settlement = 'bank_transfer' then 'awaiting_transfer' else 'processing' end;
  insert into private.order_partial_cancellations(order_id, payment_id, provider, sequence, reason_code, customer_decision, note,
    warehouse_stop_confirmed, payment_amount, balance_before, goods_refund_amount, shipping_refund_amount, refund_amount,
    store_credit_restore_amount, state, operation_id, created_by, filed_at, filed_by, claim_id,
    return_fee_deduction, return_fee_basis, return_fee_one_way_amount, return_fee_settings_revision)
  values (claim.order_id, (plan->>'paymentId')::uuid, settlement::public.payment_provider, v_sequence, 'return',
    left(format('반품 클레임 #%s · %s', claim.reference, claim.reason), 500), coalesce(p_transfer->>'reason', p_note), false,
    (plan->>'paymentAmount')::bigint, (plan->>'balanceBefore')::bigint, (plan->>'goodsRefundAmount')::bigint,
    (plan->>'shippingRefundAmount')::bigint, (plan->>'refundAmount')::bigint, (plan->>'storeCreditRestoreAmount')::bigint,
    'processing', coalesce((p_transfer->>'operationId')::uuid, extensions.gen_random_uuid()), p_actor,
    case when v_state = 'awaiting_transfer' then clock_timestamp() end, case when v_state = 'awaiting_transfer' then p_actor end, p_claim_id,
    (plan->>'returnFeeDeduction')::bigint,
    case when (plan->>'returnFeeDeduction')::bigint > 0 then fee->>'basis' end,
    case when (plan->>'returnFeeDeduction')::bigint > 0 then (fee->>'oneWayAmount')::integer end,
    case when (plan->>'returnFeeDeduction')::bigint > 0 then (fee->>'settingsRevision')::integer end)
  returning id into v_id;
  for line in select value from jsonb_array_elements(plan->'lines') loop
    insert into private.order_partial_cancellation_items(partial_cancellation_id, order_id, order_item_id, shipment_id, qty, canceled_qty_before,
      gross_amount, volume_discount, coupon_discount, store_credit_discount, goods_refund_amount)
    values (v_id, claim.order_id, (line->>'orderItemId')::uuid, (line->>'shipmentId')::uuid, (line->>'qty')::integer, (line->>'canceledQtyBefore')::integer,
      (line->>'grossAmount')::bigint, (line->>'volumeDiscount')::bigint, (line->>'couponDiscount')::bigint,
      (line->>'storeCreditDiscount')::bigint, (line->>'goodsRefundAmount')::bigint);
  end loop;
  for emptied in select value from jsonb_array_elements(plan->'emptiedShipments') loop
    insert into private.order_partial_return_shipments(partial_cancellation_id, order_id, shipment_id, shipping_fee_refund)
    values (v_id, claim.order_id, (emptied->>'shipmentId')::uuid, (emptied->>'shippingFeeRefund')::bigint);
  end loop;
  if v_state = 'awaiting_transfer' and p_transfer is not null then
    -- 계좌 송금 전환: 결제 담당이 고객에게 받은 계좌(마스킹 보관, 원문 열람은 감사 기록 — ADR-0032 결정 7과 같은 원장).
    insert into private.order_partial_cancellation_refund_accounts(partial_cancellation_id, bank_name, account_number, account_holder, masked_account, masked_holder)
    values (v_id, p_transfer#>>'{account,bankName}', p_transfer#>>'{account,accountNumber}', p_transfer#>>'{account,accountHolder}',
      (p_transfer#>>'{account,bankName}') || ' ' || public.mask_refund_account_number(p_transfer#>>'{account,accountNumber}'),
      public.mask_refund_account_holder(p_transfer#>>'{account,accountHolder}'));
  elsif v_state = 'awaiting_transfer' then
    -- 고객이 반품 신청 때 낸 환불계좌를 부분 환불 원장 계좌로 옮긴다(송금 대기 목록·엑셀·송금 완료가 이 원장을 읽는다).
    insert into private.order_partial_cancellation_refund_accounts(partial_cancellation_id, bank_name, account_number, account_holder, masked_account, masked_holder)
    values (v_id, account.bank_name, account.account_number, account.account_holder, account.masked_account, account.masked_holder);
  end if;
  update public.order_cancellation_requests set stage = 'processing', provider_started_at = coalesce(provider_started_at, now()),
    last_error_code = null, updated_at = now() where id = p_claim_id;
  insert into public.audit_log(actor_id, action, target, diff)
  values (p_actor, 'admin.order.claim_refund_filed', 'order:' || claim.order_id::text,
    jsonb_build_object('claimId', p_claim_id, 'claimType', claim.claim_type, 'method', p_method, 'from', claim.stage, 'to', 'processing',
      'partialReturn', true, 'partialCancellationId', v_id, 'provider', settlement, 'transferConversion', p_transfer is not null,
      'balanceBefore', (plan->>'balanceBefore')::bigint,
      'goodsRefundAmount', (plan->>'goodsRefundAmount')::bigint, 'shippingRefundAmount', (plan->>'shippingRefundAmount')::bigint,
      'returnFee', fee, 'refundAmount', (plan->>'refundAmount')::bigint, 'lines', plan->'lines', 'emptiedShipments', plan->'emptiedShipments'));
  if v_state in ('awaiting_transfer', 'completed') then
    perform private.apply_order_partial_cancellation(v_id, p_actor, v_state);
  else
    perform private.notify_order_claim(p_claim_id, 'refund_filed', '환불 접수가 완료됐어요',
      format('반품하신 상품의 환불 %s%s을 결제사 부분 취소로 진행합니다. 결제사 취소가 확인되면 다시 알려드립니다.',
        private.format_krw((plan->>'refundAmount')::bigint),
        case when (plan->>'returnFeeDeduction')::bigint > 0
          then format('(반품배송비 %s 차감)', private.format_krw((plan->>'returnFeeDeduction')::bigint)) else '' end));
  end if;
  return 'filed';
end $function$;

-- 2) 이미 쌓인 알림 문구
update public.notifications set body = left(body, char_length(body) - char_length(' 굿즈가 공개됐습니다.')) || ' 상품이 공개됐습니다.'
where type = 'drop_published' and body like '% 굿즈가 공개됐습니다.';
update public.notifications set title = '새 상품이 공개됐어요' where type = 'drop_published' and title = '새 굿즈가 공개됐어요';

update public.notifications set body = left(body, char_length(body) - char_length(' 굿즈가 다시 판매를 시작했어요.')) || ' 상품이 다시 판매를 시작했어요.'
where type = 'restock_available' and body like '% 굿즈가 다시 판매를 시작했어요.';

update public.notifications set body = case body
  when '주문한 굿즈의 배송이 시작됐습니다.' then '주문한 상품의 배송이 시작됐습니다.'
  when '주문한 굿즈가 배송 완료됐습니다. 문제가 있으면 주문 상세에서 알려주세요.' then '주문한 상품이 배송 완료됐습니다. 문제가 있으면 주문 상세에서 알려주세요.'
  else body end
where type in ('order_shipping', 'order_delivered')
  and body in ('주문한 굿즈의 배송이 시작됐습니다.', '주문한 굿즈가 배송 완료됐습니다. 문제가 있으면 주문 상세에서 알려주세요.');

update public.notifications
set body = '받으신 상품을 확인하셨다면 주문 상세에서 구매확정을 진행할 수 있습니다. 반품·교환 신청 자격은 별도로 유지됩니다.'
where type = 'purchase_confirmation'
  and body = '받으신 굿즈를 확인하셨다면 주문 상세에서 구매확정을 진행할 수 있습니다. 반품·교환 신청 자격은 별도로 유지됩니다.';

update public.notifications set title = case title
  when '반송이 필요한 굿즈가 모두 입고됐어요' then '반송이 필요한 상품이 모두 입고됐어요'
  when '반송한 굿즈가 모두 입고됐어요' then '반송한 상품이 모두 입고됐어요'
  when '반송한 굿즈가 입고됐어요' then '반송한 상품이 입고됐어요'
  else title end
where type = 'claim_updated' and title in ('반송이 필요한 굿즈가 모두 입고됐어요', '반송한 굿즈가 모두 입고됐어요', '반송한 굿즈가 입고됐어요');

update public.notifications set body = case body
  when '요청이 승인됐습니다. 안내받은 방법으로 굿즈를 반송해주세요.' then '요청이 승인됐습니다. 안내받은 방법으로 상품을 반송해주세요.'
  when '반송한 굿즈의 입고와 배송 중 분실 확인이 모두 끝나 환불을 준비합니다. 분실된 굿즈는 반송하지 않아도 됩니다.'
    then '반송한 상품의 입고와 배송 중 분실 확인이 모두 끝나 환불을 준비합니다. 분실된 상품은 반송하지 않아도 됩니다.'
  when '배송 중 분실이 확인되어 굿즈 회수 없이 환불을 준비합니다.' then '배송 중 분실이 확인되어 상품 회수 없이 환불을 준비합니다.'
  when '반송이 필요한 굿즈의 입고가 모두 확인되어 후속 처리를 준비합니다. 일부 상품은 회수 없이 다시 보내드려요.'
    then '반송이 필요한 상품의 입고가 모두 확인되어 후속 처리를 준비합니다. 일부 상품은 회수 없이 다시 보내드려요.'
  when '반송한 굿즈의 입고가 모두 확인되어 후속 처리를 준비합니다.' then '반송한 상품의 입고가 모두 확인되어 후속 처리를 준비합니다.'
  when '택배 기사가 방문해 굿즈를 회수합니다. 주문 상세의 회수 정보에서 회수 송장을 확인해주세요.'
    then '택배 기사가 방문해 상품을 회수합니다. 주문 상세의 회수 정보에서 회수 송장을 확인해주세요.'
  else body end
where type = 'claim_updated' and body in (
  '요청이 승인됐습니다. 안내받은 방법으로 굿즈를 반송해주세요.',
  '반송한 굿즈의 입고와 배송 중 분실 확인이 모두 끝나 환불을 준비합니다. 분실된 굿즈는 반송하지 않아도 됩니다.',
  '배송 중 분실이 확인되어 굿즈 회수 없이 환불을 준비합니다.',
  '반송이 필요한 굿즈의 입고가 모두 확인되어 후속 처리를 준비합니다. 일부 상품은 회수 없이 다시 보내드려요.',
  '반송한 굿즈의 입고가 모두 확인되어 후속 처리를 준비합니다.',
  '택배 기사가 방문해 굿즈를 회수합니다. 주문 상세의 회수 정보에서 회수 송장을 확인해주세요.');

-- 부분 취소·부분 반품·반품 환불 접수: 문장 안 고정 구절만 바꾼다(품목 이름·금액은 그대로).
update public.notifications
set body = replace(replace(replace(replace(replace(body,
    '나머지 굿즈는 그대로 보내드립니다.', '나머지 상품은 그대로 보내드립니다.'),
    '나머지 굿즈는 그대로 유지됩니다.', '나머지 상품은 그대로 유지됩니다.'),
    '재고가 부족해 일부 굿즈를 취소했습니다.', '재고가 부족해 상품 일부를 취소했습니다.'),
    '반품하신 일부 굿즈의 ', '반품하신 상품 일부의 '),
    '취소한 일부 굿즈의 환불 ', '취소한 상품 일부의 환불 ')
where type = 'claim_updated' and source_type = 'order_partial_cancellation'
  and (body like '%나머지 굿즈는 그대로 보내드립니다.%' or body like '%나머지 굿즈는 그대로 유지됩니다.%'
    or body like '재고가 부족해 일부 굿즈를 취소했습니다.%' or body like '반품하신 일부 굿즈의 %' or body like '취소한 일부 굿즈의 환불 %');

update public.notifications set body = '반품하신 상품의 환불 ' || substr(body, char_length('반품하신 굿즈의 환불 ') + 1)
where type = 'claim_updated' and body like '반품하신 굿즈의 환불 %을 결제사 부분 취소로 진행합니다.%';

-- 상품 Q&A 답변·리뷰 답글: 상품 이름을 못 찾았을 때의 대체값(서비스 이름 통일 20261125175000 전의 'ICONS 운영자' 행 포함)
update public.notifications set body = '상품' || substr(body, char_length('굿즈') + 1)
where type in ('product_question_answered', 'review_replied')
  and body in ('굿즈 질문에 엑스스퀘어 운영자가 답변을 남겼습니다.', '굿즈 리뷰에 엑스스퀘어 운영자가 답글을 남겼습니다.',
    '굿즈 질문에 ICONS 운영자가 답변을 남겼습니다.', '굿즈 리뷰에 ICONS 운영자가 답글을 남겼습니다.');

-- 3) 운영자 계약 지문
select private.register_operator_rpc_contract('public.admin_answer_product_question(uuid,text)'::regprocedure,'cs.manage','retired',false);
select private.register_operator_rpc_contract('public.admin_reply_to_review(uuid,text)'::regprocedure,'cs.manage','retired',false);
select private.register_operator_rpc_contract('public.admin_record_order_claim_collection(uuid,text,date,text)'::regprocedure,'sales.manage','write',false);
select private.register_operator_internal_contract('private.decide_order_claim(uuid,text,text)'::regprocedure);
select private.register_operator_internal_contract('private.review_event_purchase_revocation()'::regprocedure);
