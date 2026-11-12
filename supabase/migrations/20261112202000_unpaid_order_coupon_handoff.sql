-- ============================================================================
-- 결제 대기 주문이 잡은 쿠폰을 새 주문에서 고른다 (QA 라운드 1 고객 S-D2-08, ADR-0030 '보류와 이전 미결제 닫기' 확장)
--
-- 결정 '새 주문은 출처 무관 이전 미결제 점유 닫기(ADR-0026 확장)': 새 주문(place_direct_order·place_order_with_cart_selection·
-- place_order_with_cart_snapshot)은 접수 트랜잭션 맨 앞에서 같은 계정의 결제 대기 카드 주문을 닫고(supersede) 그 주문이 잡은
-- 쿠폰·첫구매 예약을 돌려받은 뒤 쿠폰을 확인·소비한다. 그런데 견적과 장바구니 쿠폰 선택은 그 쿠폰을 '이미 사용한 쿠폰'
-- (coupon_already_used)·'진행 중인 첫구매'(coupon_first_purchase_reserved·pending)로 막았고, 화면은 사용 처리된 쿠폰을 목록에서
-- 뺐다. 고객은 그 쿠폰을 고를 수 없었고, 첫구매 쿠폰으로 15,000원이어야 할 주문이 18,000원으로 접수됐다.
--
-- 1. private.unpaid_order_replaceable(order, user): 다음 새 주문이 닫을 결제 대기 주문인지 — 이 계정의 카드 결제 대기 주문,
--    보류 awaiting_payment(출처 무관), 결제 승인 확인·결과 불명·결제 진행·처리 중 취소가 없다(close_unpaid_cart_order가
--    closed로 끝나는 조건, service_list_unpaid_checkout_orders의 releasable과 같다).
-- 2. 쿠폰 평가 evaluate_coupon_target_lines_at에 p_replace_unpaid(6번째 인자)를 더한다. 켜면 1의 주문이 잡은 쿠폰 사용·첫구매
--    예약·결제 대기를 이미 닫힌 것으로 본다. 기존 5인자 함수는 false로 부르는 감싸개가 된다 — 주문 생성(evaluate_order_user_coupon)과
--    거래 런타임은 지금처럼 엄격하다. 본문은 현재 정의를 앵커 치환으로 옮겨 다른 변경을 보존한다.
-- 3. 켜는 곳은 견적·선택뿐이다: 장바구니·선택 주문 쿠폰 견적(quote_selected_coupon), 바로구매 주문서 쿠폰 견적(quote_user_coupon),
--    장바구니 쿠폰 선택(evaluate_user_coupon — apply_cart_coupon·apply_cart_coupon_code만 부른다). 선택은 아무 주문도 닫지 않는다
--    (장바구니를 열거나 쿠폰을 고르기만 해서는 다른 탭의 결제창을 끊지 않는다).
--    닫기와 쿠폰 소비는 주문 생성 한 트랜잭션 안에서 계정 advisory로 직렬화되어 원자적이다. 그 주문을 닫지 못하면(결제 승인 확인
--    중) 새 주문은 checkout_payment_in_progress로, 떼어 낸(결과 불명) 주문이 쿠폰을 계속 잡고 있으면 coupon_already_used로
--    거절된다 — 같은 쿠폰이 두 주문에 '사용'되지 않는다(user_coupons.used_order_id 한 칸, coupon_redemptions 적용 행 유일).
-- 4. public.get_my_unpaid_order_coupons(): 본인 쿠폰 가운데 결제 대기(카드)·입금 대기(무통장) 주문이 잡은 쿠폰, 그 주문, 다음 새
--    주문이 그 주문을 닫고 쿠폰을 쓸 수 있는지(replaceable). 장바구니·주문서 쿠폰 칸('진행 중인 주문에서 사용 중')과 쿠폰함
--    ('결제 대기 주문에 사용 중')이 읽는다.
-- ============================================================================

-- ── 1. 다음 새 주문이 닫을 결제 대기 주문 ─────────────────────────────────────────────
create function private.unpaid_order_replaceable(p_order_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_order_id is not null and p_user_id is not null
    and exists (
      select 1
      from private.cart_order_holds as hold
      join public.orders as o on o.id = hold.order_id
      where hold.order_id = p_order_id and hold.user_id = p_user_id and hold.state = 'awaiting_payment'
        and o.user_id = p_user_id and o.status = 'pending' and o.payment_method = 'card')
    and not private.checkout_draft_order_payment_unresolved(p_order_id), false);
$$;
revoke all on function private.unpaid_order_replaceable(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.unpaid_order_replaceable(uuid, uuid) to postgres;

-- ── 2. 쿠폰 평가: 다음 새 주문이 닫을 결제 대기 주문의 점유를 닫힌 것으로 볼지 ─────────────────
do $$
declare
  v_definition text;
  v_anchor record;
begin
  v_definition := pg_catalog.pg_get_functiondef('private.evaluate_coupon_target_lines_at(uuid,uuid,jsonb,uuid,timestamptz)'::regprocedure);
  for v_anchor in
    select * from (values
      (1, 'p_at timestamp with time zone, OUT o_reason text',
          'p_at timestamp with time zone, p_replace_unpaid boolean, OUT o_reason text'),
      (2, E' if held.status=\'used\' then o_reason:=\'coupon_already_used\'; return; end if;',
          E' -- 다음 새 주문이 닫을 결제 대기 주문이 잡은 쿠폰은 그 주문이 닫힌 것으로 본다(견적·선택만, QA1 S-D2-08).\n'
          || E' if held.status=\'used\' and not (p_replace_unpaid is true and private.unpaid_order_replaceable(held.used_order_id,p_user_id)) then o_reason:=\'coupon_already_used\'; return; end if;'),
      (3, E'where user_id=p_user_id and state=\'reserved\' and order_id is distinct from p_order_id)',
          E'where user_id=p_user_id and state=\'reserved\' and order_id is distinct from p_order_id and not (p_replace_unpaid is true and private.unpaid_order_replaceable(order_id,p_user_id)))'),
      (4, E'where user_id=p_user_id and status=\'pending\' and id is distinct from p_order_id)',
          E'where user_id=p_user_id and status=\'pending\' and id is distinct from p_order_id and not (p_replace_unpaid is true and private.unpaid_order_replaceable(id,p_user_id)))')
    ) as anchors(position, anchor, replacement)
    order by position
  loop
    if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor.anchor, ''))) / pg_catalog.length(v_anchor.anchor) <> 1 then
      raise exception 'coupon_replace_unpaid_anchor_changed: %', v_anchor.position;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_anchor.anchor, v_anchor.replacement);
  end loop;
  -- 새 인자 목록이라 새 함수가 생긴다(기존 5인자 함수는 아래에서 감싸개로 바꾼다).
  execute v_definition;
end;
$$;
revoke all on function private.evaluate_coupon_target_lines_at(uuid, uuid, jsonb, uuid, timestamptz, boolean) from public, anon, authenticated, service_role;
grant execute on function private.evaluate_coupon_target_lines_at(uuid, uuid, jsonb, uuid, timestamptz, boolean) to postgres;

-- 기존 호출(주문 생성·거래 런타임)은 지금처럼 엄격하다. 본문은 위 6인자 함수 하나다.
create or replace function private.evaluate_coupon_target_lines_at(
  p_user_coupon_id uuid, p_user_id uuid, p_lines jsonb, p_order_id uuid, p_at timestamp with time zone,
  out o_reason text, out o_discount bigint, out o_coupon_code text, out o_eligible_subtotal bigint, out o_terms_snapshot jsonb
) returns record
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.evaluate_coupon_target_lines_at(p_user_coupon_id, p_user_id, p_lines, p_order_id, p_at, false);
$$;
revoke all on function private.evaluate_coupon_target_lines_at(uuid, uuid, jsonb, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.evaluate_coupon_target_lines_at(uuid, uuid, jsonb, uuid, timestamptz) to postgres;

-- ── 3. 견적·선택은 다음 새 주문이 닫을 결제 대기 주문의 쿠폰을 받아들인다 ───────────────────
do $$
declare
  v_definition text;
  v_target record;
begin
  for v_target in
    select * from (values
      ('private.quote_selected_coupon(jsonb,bigint,bigint)',
        ' select * into evaluated from private.evaluate_coupon_target_lines(selected,actor,lines,null);',
        ' select * into evaluated from private.evaluate_coupon_target_lines_at(selected,actor,lines,null,statement_timestamp(),true);'),
      ('private.quote_user_coupon(uuid,jsonb,bigint,bigint)',
        '  select * into evaluated from private.evaluate_coupon_target_lines(p_user_coupon_id, actor, lines, null);',
        '  select * into evaluated from private.evaluate_coupon_target_lines_at(p_user_coupon_id, actor, lines, null, statement_timestamp(), true);'),
      ('private.evaluate_user_coupon(uuid,uuid,bigint)',
        ' select * into evaluated from private.evaluate_coupon_target_lines(p_user_coupon_id,p_user_id,lines,null);',
        ' select * into evaluated from private.evaluate_coupon_target_lines_at(p_user_coupon_id,p_user_id,lines,null,statement_timestamp(),true);')
    ) as targets(signature, anchor, replacement)
  loop
    v_definition := pg_catalog.pg_get_functiondef(v_target.signature::regprocedure);
    if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_target.anchor, ''))) / pg_catalog.length(v_target.anchor) <> 1 then
      raise exception 'coupon_replace_unpaid_quote_anchor_changed: %', v_target.signature;
    end if;
    execute pg_catalog.replace(v_definition, v_target.anchor, v_target.replacement);
  end loop;
end;
$$;
revoke all on function private.quote_selected_coupon(jsonb, bigint, bigint) from public, anon, authenticated, service_role;
grant execute on function private.quote_selected_coupon(jsonb, bigint, bigint) to postgres;
revoke all on function private.quote_user_coupon(uuid, jsonb, bigint, bigint) from public, anon, authenticated, service_role;
grant execute on function private.quote_user_coupon(uuid, jsonb, bigint, bigint) to postgres;
revoke all on function private.evaluate_user_coupon(uuid, uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function private.evaluate_user_coupon(uuid, uuid, bigint) to postgres;
comment on function private.evaluate_user_coupon(uuid, uuid, bigint) is
  '장바구니 쿠폰 선택 판정(apply_cart_coupon·apply_cart_coupon_code). 다음 새 주문이 닫을 결제 대기 주문이 잡은 쿠폰도 받는다 — 주문 생성의 쿠폰 확인·소비는 evaluate_order_user_coupon(엄격)이 한다.';

-- ── 4. 결제 대기·입금 대기 주문이 잡은 본인 쿠폰 ─────────────────────────────────────
create function public.get_my_unpaid_order_coupons()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'userCouponId', held.id, 'orderId', o.id, 'orderNumber', o.order_number, 'paymentMethod', o.payment_method,
      'replaceable', private.unpaid_order_replaceable(o.id, held.user_id))
    order by o.created_at desc, held.id), '[]'::jsonb)
  from public.user_coupons as held
  join public.orders as o on o.id = held.used_order_id
  where held.user_id = (select auth.uid()) and held.status = 'used'
    and o.user_id = held.user_id and o.status = 'pending';
$$;
revoke all on function public.get_my_unpaid_order_coupons() from public, anon, authenticated, service_role;
grant execute on function public.get_my_unpaid_order_coupons() to authenticated;

-- 운영 계약 지문: 감싸개로 바꾼 5인자 평가와 본문을 가진 6인자 평가를 함께 등록한다(operator_capability_coverage drift).
select private.register_operator_internal_contract('private.evaluate_coupon_target_lines_at(uuid,uuid,jsonb,uuid,timestamptz)'::regprocedure);
select private.register_operator_internal_contract('private.evaluate_coupon_target_lines_at(uuid,uuid,jsonb,uuid,timestamptz,boolean)'::regprocedure);

notify pgrst, 'reload schema';
