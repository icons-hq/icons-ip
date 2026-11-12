-- ============================================================================
-- 거래 런타임도 장바구니 선택 주문·바로구매 계약을 따른다 (ADR-0030, 10/14 회의 백로그 D2①)
--
-- 운영은 거래 런타임이 꺼져 있지만(private.goods_transaction_runtime.enabled=false) 두 주문 경로의 계약이 갈라지지 않게
-- legacy(20261112100100·100200)와 같은 규칙으로 맞춘다.
--
-- 1. 선택 주문: 장바구니 원본을 그대로 쓰고 "선택 = 장바구니 전체" 단언을 "고른 줄 ⊆ 지금 장바구니(줄마다 수량·직접입력값
--    정확히 일치)"로 바꾼다. 견적(quote·quote_combined)·주문(place)·복구(resume → place) 네 어댑터가 같은 단언을 쓴다.
--    카드 보류 줄 = 고른 줄이라 고르지 않은 줄은 결제 뒤에도 남는다. 무통장은 지금처럼 고른 줄만 접수 때 뺀다.
-- 2. 바로구매: 새 원본 kind 'direct'(id = 계정, 잠금 키 goods-transaction-source:direct:<계정>). 선택 = 바로구매 초안 줄.
--    장바구니를 읽지도 바꾸지도 않고, 쿠폰은 견적에서 고른 쿠폰이다. 새 주문은 출처와 무관하게 이전 미결제 점유를 닫는다.
--    카드는 장바구니 효과 없는 보류(direct_transaction)를 남기고, 무통장은 같은 쿠폰의 장바구니 선택만 접수 때 해제한다.
--    랜덤 판매 굿즈는 거래 런타임이 받지 않는 지금 계약(ADR-0027) 그대로다.
-- ============================================================================

-- ── 선택 주문: 고른 줄 ⊆ 지금 장바구니 ─────────────────────────────────────────────
create or replace function private.assert_cart_goods_transaction_selection(p_actor uuid, p_selection jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare matched integer;
begin
  -- 선택은 normalize_goods_transaction_selection을 거쳐 같은 줄(qty 제외)이 두 번 오지 않는다.
  select count(*) into matched
  from jsonb_array_elements(p_selection) as selected
  where exists (
    select 1 from public.cart_items as cart
    where cart.user_id = p_actor and cart.good_id = selected ->> 'goodId' and cart.variant_id = (selected ->> 'variantId')::uuid
      and cart.qty = (selected ->> 'qty')::integer and cart.input_revision = (selected ->> 'inputRevision')::integer
      and cart.input_values = selected -> 'inputValues');
  if matched <> jsonb_array_length(p_selection) then
    raise sqlstate 'PT409' using message = 'cart_snapshot_changed';
  end if;
end;
$$;
revoke all on function private.assert_cart_goods_transaction_selection(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.assert_cart_goods_transaction_selection(uuid, jsonb) to postgres;

-- 카드 보류 줄은 고른 줄이다(장바구니 전체가 아니다). 나머지 본문은 20261027120000 정의 그대로다.
do $$
declare
  v_definition text;
  v_anchor text := E' perform private.record_cart_order_hold(result,p_user_id,''cart_transaction'');';
begin
  v_definition := pg_catalog.pg_get_functiondef('public.place_cart_goods_transaction(uuid,jsonb,jsonb,uuid,uuid,public.order_payment_method)'::regprocedure);
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))) / pg_catalog.length(v_anchor) <> 1 then
    raise exception 'transaction_selection_hold_anchor_changed';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_anchor,
    E' -- 보류 줄 = 고른 줄(ADR-0030). 고른 줄은 위에서 지금 장바구니와 정확히 같다고 단언했다.\n'
    || E' perform private.record_checkout_order_hold(result,p_user_id,''cart_transaction'',(select jsonb_agg(jsonb_build_object(''goodId'',cart.good_id,''variantId'',cart.variant_id,\n'
    || E'   ''inputKey'',cart.input_key,''inputRevision'',cart.input_revision,''inputValues'',cart.input_values,''qty'',cart.qty) order by cart.good_id,cart.variant_id,cart.input_key)\n'
    || E'   from public.cart_items cart where cart.user_id=p_user_id and exists(select 1 from jsonb_array_elements(selection) selected\n'
    || E'    where selected->>''goodId''=cart.good_id and (selected->>''variantId'')::uuid=cart.variant_id\n'
    || E'     and (selected->>''inputRevision'')::integer=cart.input_revision and selected->''inputValues''=cart.input_values)));');
  execute v_definition;
end;
$$;
revoke all on function public.place_cart_goods_transaction(uuid,jsonb,jsonb,uuid,uuid,public.order_payment_method) from public, anon, authenticated, service_role;
grant execute on function public.place_cart_goods_transaction(uuid,jsonb,jsonb,uuid,uuid,public.order_payment_method) to service_role;

-- ── 바로구매: 새 원본 kind 'direct' ─────────────────────────────────────────────────
alter table private.order_goods_transactions drop constraint order_goods_transactions_source_kind_check;
alter table private.order_goods_transactions add constraint order_goods_transactions_source_kind_check
  check (source_kind in ('cart', 'gift', 'subscription', 'direct'));

do $$
declare
  v_definition text;
  v_anchor record;
begin
  v_definition := pg_catalog.pg_get_functiondef('private.lock_goods_transaction_source(uuid,jsonb)'::regprocedure);
  for v_anchor in
    select * from (values
      (1, E'not in (''cart'',''gift'',''subscription'')', E'not in (''cart'',''gift'',''subscription'',''direct'')'),
      (2, E'if p_source->>''kind''=''cart'' and source_id<>p_actor', E'if p_source->>''kind'' in (''cart'',''direct'') and source_id<>p_actor')
    ) as anchors(position, anchor, replacement)
    order by position
  loop
    if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor.anchor, ''))) / pg_catalog.length(v_anchor.anchor) <> 1 then
      raise exception 'transaction_direct_source_anchor_changed: %', v_anchor.position;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_anchor.anchor, v_anchor.replacement);
  end loop;
  execute v_definition;
end;
$$;
revoke all on function private.lock_goods_transaction_source(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.lock_goods_transaction_source(uuid, jsonb) to postgres;

-- 바로구매 초안 → 거래 런타임 선택(초안 줄 그대로). 만료·다른 계정·장바구니 선택 초안은 PT409 checkout_draft_expired,
-- 이 초안으로 만든 주문이 이미 무통장 접수·결제 완료면 PT409 checkout_draft_used, 그 주문의 결제가 아직 확정되지 않았으면
-- PT409 checkout_payment_in_progress(legacy 바로구매와 같은 규칙). 주문(p_lock)은 그 이전 주문 행을 먼저 잠근다.
create function private.direct_goods_transaction_selection(p_actor uuid, p_draft_id uuid, p_lock boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_draft private.checkout_drafts%rowtype;
begin
  v_draft := private.checkout_draft_for_order(p_actor, p_draft_id, 'direct', p_lock);
  return private.normalize_goods_transaction_selection((
    select jsonb_agg(jsonb_build_object('goodId', line ->> 'goodId', 'variantId', line ->> 'variantId', 'qty', (line ->> 'qty')::integer,
      'inputRevision', (line ->> 'inputRevision')::integer, 'inputValues', line -> 'inputValues'))
    from jsonb_array_elements(v_draft.lines) as line));
end;
$$;
revoke all on function private.direct_goods_transaction_selection(uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function private.direct_goods_transaction_selection(uuid, uuid, boolean) to postgres;

create function private.goods_direct_transaction_source(p_actor uuid, p_selection jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('kind', 'direct', 'id', p_actor, 'revision', encode(extensions.digest(convert_to(p_selection::text, 'UTF8'), 'sha256'), 'hex'));
$$;
revoke all on function private.goods_direct_transaction_source(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.goods_direct_transaction_source(uuid, jsonb) to postgres;

-- 견적: 바로구매 초안 줄 + 견적에서 고른 쿠폰. 장바구니 쿠폰 선택과 비교하지 않는다.
create function public.quote_direct_goods_transaction(
  p_user_id uuid, p_draft_id uuid, p_address jsonb, p_delivery_choices jsonb, p_user_coupon_id uuid, p_store_credit_amount bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare selection jsonb; source jsonb;
begin
  if p_user_id is null or p_draft_id is null then raise invalid_parameter_value using message = 'invalid_transaction_actor'; end if;
  selection := private.direct_goods_transaction_selection(p_user_id, p_draft_id, false);
  source := private.goods_direct_transaction_source(p_user_id, selection);
  return private.quote_goods_transaction(p_user_id, source, selection, p_address, p_delivery_choices, p_user_coupon_id, p_store_credit_amount);
end;
$$;
revoke all on function public.quote_direct_goods_transaction(uuid, uuid, jsonb, jsonb, uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function public.quote_direct_goods_transaction(uuid, uuid, jsonb, jsonb, uuid, bigint) to service_role;

create function public.quote_direct_goods_transaction_combined(
  p_user_id uuid, p_draft_id uuid, p_address jsonb, p_delivery_choices jsonb, p_user_coupon_ids uuid[], p_store_credit_amount bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare selection jsonb; source jsonb;
begin
  if p_user_id is null or p_draft_id is null then raise invalid_parameter_value using message = 'invalid_transaction_actor'; end if;
  selection := private.direct_goods_transaction_selection(p_user_id, p_draft_id, false);
  source := private.goods_direct_transaction_source(p_user_id, selection);
  perform private.lock_goods_transaction_source(p_user_id, source);
  return private.quote_goods_transaction_combined(p_user_id, source, selection, p_address, p_delivery_choices, p_user_coupon_ids, p_store_credit_amount);
end;
$$;
revoke all on function public.quote_direct_goods_transaction_combined(uuid, uuid, jsonb, jsonb, uuid[], bigint) from public, anon, authenticated, service_role;
grant execute on function public.quote_direct_goods_transaction_combined(uuid, uuid, jsonb, jsonb, uuid[], bigint) to service_role;

-- 주문: 계정 advisory → (같은 키면 원래 영수증) → 이전 미결제 점유 닫기(출처 무관) → 원본 잠금 → 코어.
create function public.place_direct_goods_transaction(
  p_user_id uuid, p_draft_id uuid, p_address jsonb, p_quote_id uuid, p_checkout_key uuid, p_payment_method public.order_payment_method
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare existing private.order_goods_transactions; selection jsonb; source jsonb; base_good text; draft_lines jsonb; result uuid;
begin
  if p_user_id is null or p_draft_id is null then raise invalid_parameter_value using message = 'invalid_transaction_actor'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  -- 같은 checkout key의 재요청은 초안(만료됐을 수 있다)을 다시 보지 않고 원래 영수증을 돌려준다.
  select * into existing from private.order_goods_transactions where actor_id = p_user_id and checkout_key = p_checkout_key;
  if found then
    if existing.source_kind <> 'direct' then raise sqlstate 'PT409' using message = 'checkout_key_conflict'; end if;
    perform private.lock_goods_transaction_actor(p_user_id);
    return (private.replay_goods_transaction_receipt(p_user_id,
      jsonb_build_object('kind', existing.source_kind, 'id', existing.source_id, 'revision', existing.source_revision),
      p_quote_id, p_checkout_key, p_payment_method) ->> 'orderId')::uuid;
  end if;
  selection := private.direct_goods_transaction_selection(p_user_id, p_draft_id, true);
  source := private.goods_direct_transaction_source(p_user_id, selection);
  select draft.base_good_id, draft.lines into base_good, draft_lines from private.checkout_drafts as draft where draft.id = p_draft_id;
  -- 이전 미결제 주문(장바구니·바로구매 모두)의 재고·쿠폰·적립금·첫구매 예약·구매 한도를 먼저 돌려준다(ADR-0026·0030).
  perform private.supersede_unpaid_checkout_orders(p_user_id, true, null, 'new_direct_order');
  perform private.lock_goods_transaction_source(p_user_id, source);
  result := private.place_goods_transaction(p_user_id, source, selection, p_address, p_quote_id, p_checkout_key, p_payment_method);
  -- 같은 초안의 재제출을 막는 연결(무통장 접수·결제 완료 뒤에는 checkout_draft_used).
  update private.checkout_drafts set order_id = result where id = p_draft_id;
  if p_payment_method = 'bank_transfer' then
    -- 무통장은 접수 = 주문 완료다. 장바구니 줄은 건드리지 않고, 이 주문이 쓴 쿠폰의 장바구니 선택만 해제한다.
    delete from public.cart_coupon_selections as selection_row
    where selection_row.user_id = p_user_id
      and selection_row.user_coupon_id in (select redemption.user_coupon_id from public.coupon_redemptions as redemption
        where redemption.order_id = result and redemption.status = 'applied');
  else
    -- 카드는 장바구니 효과 없는 보류를 남긴다(다음 주문이 이 미결제 점유를 닫는 색인, 결제 확정 때 쿠폰 선택만 정리).
    perform private.record_direct_order_hold(result, p_user_id, 'direct_transaction', draft_lines, base_good);
  end if;
  return result;
end;
$$;
revoke all on function public.place_direct_goods_transaction(uuid, uuid, jsonb, uuid, uuid, public.order_payment_method) from public, anon, authenticated, service_role;
grant execute on function public.place_direct_goods_transaction(uuid, uuid, jsonb, uuid, uuid, public.order_payment_method) to service_role;

-- 복구: 같은 키로 만든 주문이 있으면 그 영수증, 없으면(그리고 새 결제가 허용되면) 견적의 배송지로 다시 주문한다.
create function public.resume_direct_goods_transaction(
  p_user_id uuid, p_draft_id uuid, p_quote_id uuid, p_checkout_key uuid, p_payment_method public.order_payment_method, p_allow_new boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare existing private.order_goods_transactions; quoted private.goods_transaction_quotes;
begin
  if p_user_id is null then raise invalid_parameter_value using message = 'invalid_transaction_actor'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  if p_quote_id is null or p_checkout_key is null or p_payment_method is null or p_allow_new is null then
    raise invalid_parameter_value using message = 'invalid_transaction_resume'; end if;
  select * into existing from private.order_goods_transactions where actor_id = p_user_id and checkout_key = p_checkout_key;
  if found then
    perform private.lock_goods_transaction_actor(p_user_id);
    if existing.source_kind <> 'direct' then raise sqlstate 'PT409' using message = 'checkout_key_conflict'; end if;
    return (private.replay_goods_transaction_receipt(p_user_id,
      jsonb_build_object('kind', existing.source_kind, 'id', existing.source_id, 'revision', existing.source_revision),
      p_quote_id, p_checkout_key, p_payment_method) ->> 'orderId')::uuid;
  end if;
  if not p_allow_new then raise check_violation using message = 'transaction_new_payment_disabled'; end if;
  select * into quoted from private.goods_transaction_quotes where id = p_quote_id and actor_id = p_user_id;
  if not found or quoted.source ->> 'kind' <> 'direct' or quoted.source ->> 'id' <> p_user_id::text then
    raise sqlstate 'PT409' using message = 'transaction_quote_expired'; end if;
  return public.place_direct_goods_transaction(p_user_id, p_draft_id, quoted.address, p_quote_id, p_checkout_key, p_payment_method);
end;
$$;
revoke all on function public.resume_direct_goods_transaction(uuid, uuid, uuid, uuid, public.order_payment_method, boolean) from public, anon, authenticated, service_role;
grant execute on function public.resume_direct_goods_transaction(uuid, uuid, uuid, uuid, public.order_payment_method, boolean) to service_role;

-- 운영 계약 지문: 재정의한 런타임 함수는 같은 migration 끝에서 다시 등록한다(operator_capability_coverage drift).
select private.register_operator_internal_contract('private.assert_cart_goods_transaction_selection(uuid,jsonb)'::regprocedure);
select private.register_operator_internal_contract('public.place_cart_goods_transaction(uuid,jsonb,jsonb,uuid,uuid,public.order_payment_method)'::regprocedure);
select private.register_operator_internal_contract('private.lock_goods_transaction_source(uuid,jsonb)'::regprocedure);
select private.register_operator_internal_contract('public.quote_direct_goods_transaction(uuid,uuid,jsonb,jsonb,uuid,bigint)'::regprocedure);
select private.register_operator_internal_contract('public.quote_direct_goods_transaction_combined(uuid,uuid,jsonb,jsonb,uuid[],bigint)'::regprocedure);
select private.register_operator_internal_contract('public.place_direct_goods_transaction(uuid,uuid,jsonb,uuid,uuid,public.order_payment_method)'::regprocedure);
select private.register_operator_internal_contract('public.resume_direct_goods_transaction(uuid,uuid,uuid,uuid,public.order_payment_method,boolean)'::regprocedure);

notify pgrst, 'reload schema';
