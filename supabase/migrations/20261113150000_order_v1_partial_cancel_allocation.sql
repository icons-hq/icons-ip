-- 재고 부족 부분 취소(QNA-020, ADR-0032 보완 2026-11-13) — 버전 1 주문의 파생 배분 원장.
--
-- 원래 요청: 서원 회신 C7 "재고가 부족한 제품은 고객의견을 물어본 후 결정사항을 말씀 주시면 그대로 진행합니다".
-- 운영 실측(11/13, 읽기 전용): 최근 30일 주문 164건이 모두 calculation_version = 1 이다. T12b는 불변 배분 원장
-- (private.order_price_allocations, 버전 2만)이 없는 주문을 'legacy_order'로 막아, 스위치를 켜도 실제 주문에 쓸 수 없었다.
--
-- 오케스트레이터 결정(11/13): 버전 1 주문의 첫 부분 취소 때 결정적 파생 배분을 계산해 불변 원장으로 얼리고, 이후 부분 취소·전액
-- 취소 잔액은 그 원장을 쓴다. 배분을 확정할 수 없는 주문은 이유와 함께 막는다. 거래 런타임은 켜지 않는다.
--
-- 배분 규칙은 새로 만들지 않고 운영 화면이 이미 버전 1 주문에 쓰는 공통 규칙(10/14 회의 A5, lib/admin/item-allocation.ts
-- allocateLegacyOrderDiscounts — 주문 상세·상품주문 조회·출고지시 표준 양식·거래확정 엑셀)을 DB로 옮긴다:
--  * 품목 금액 = 판매 단가 × 수량(버전 1에는 복수구매 할인이 없다 — 있으면 막는다).
--  * 쿠폰(주문 단위 할인) = 주문 당시 쿠폰 기록(대상 범위·대상 품목 합계)으로 대상 품목을 가리고, 대상 품목 금액 비례로 나눈다.
--    다시 판정한 대상 품목 합계가 기록과 다르면 추정하지 않고 막는다.
--  * 적립금 = 쿠폰 뒤 품목 금액 비례로 나눈다.
--  * 나누기는 버전 2 주문 생성과 같은 함수(private.allocate_transaction_amount)다: 각 몫을 내림(floor)하고, 남은 끝수는 나머지가
--    큰 품목부터(같으면 품목 UUID 순) 1원씩 준다 — 화면·엑셀의 allocateSettledAmount와 같은 결과다.
--  * 배송 건 선결제 배송비 = 그 배송 건의 주문 배송비 스냅숏(shipping_fee_snapshot.totalFee). 배송 건 금액과 스냅숏, 배송 건 합과
--    주문 배송비가 맞아야 한다(버전 1에는 배송비 쿠폰이 없다 — 있으면 막는다).
--  * 핵심 검사: Σ품목 결제 몫 + Σ배송 건 선결제 배송비 = 결제액(1원 단위). 다르면 partial_cancel_v1_allocation_mismatch.
-- 원장은 첫 부분 취소 시작 때(주문 행 잠금 아래) 한 번만 만들고 바꾸지 않는다(기본 키 order_id, 갱신·삭제 트리거 거절). 미리보기는
-- 같은 함수로 계산만 한다. 원장이 생긴 뒤에는 다시 계산하지 않는다(그 사이 카테고리·통합 같은 가변 입력이 바뀌어도 배분이 같다).
begin;

-- 1. 원장. 머리(주문 한 건) · 품목 줄 · 배송 건.
create table private.order_v1_price_allocation_heads (
  order_id uuid primary key references public.orders(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  source_calculation_version integer not null check (source_calculation_version = 1),
  rule_version text not null check (rule_version = 'v1-a5-largest-remainder-1'),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  input_snapshot jsonb not null check (jsonb_typeof(input_snapshot) = 'object'),
  payment_amount bigint not null check (payment_amount > 0),
  goods_total bigint not null check (goods_total >= 0),
  volume_discount_total bigint not null check (volume_discount_total = 0),
  coupon_discount_total bigint not null check (coupon_discount_total >= 0),
  store_credit_total bigint not null check (store_credit_total >= 0),
  paid_goods_total bigint not null check (paid_goods_total >= 0),
  shipping_total bigint not null check (shipping_total >= 0),
  frozen_by uuid not null references public.profiles(id) on delete restrict,
  frozen_operation_id uuid not null,
  frozen_at timestamptz not null default clock_timestamp(),
  constraint order_v1_price_allocation_heads_sums check (
    paid_goods_total = goods_total - volume_discount_total - coupon_discount_total - store_credit_total
    and paid_goods_total + shipping_total = payment_amount)
);
alter table private.order_v1_price_allocation_heads enable row level security;
revoke all on table private.order_v1_price_allocation_heads from public, anon, authenticated, service_role;

-- 품목 줄은 버전 2 원장(private.order_price_allocations)과 같은 칸·같은 식이다(보고·출고가 한 모양으로 읽는다).
create table private.order_v1_price_allocations (
  order_item_id uuid primary key references public.order_items(id) on delete restrict,
  order_id uuid not null references private.order_v1_price_allocation_heads(order_id) on delete restrict,
  calculation_version integer not null check (calculation_version = 1),
  subtotal bigint not null check (subtotal >= 0),
  volume_discount bigint not null check (volume_discount >= 0),
  net_subtotal bigint not null check (net_subtotal >= 0),
  coupon_discount bigint not null check (coupon_discount >= 0),
  store_credit_discount bigint not null check (store_credit_discount >= 0),
  paid_goods_total bigint not null check (paid_goods_total >= 0),
  check (net_subtotal = subtotal - volume_discount and paid_goods_total = net_subtotal - coupon_discount - store_credit_discount),
  foreign key (order_id, order_item_id) references public.order_items(order_id, id) on delete restrict
);
create index order_v1_price_allocations_order on private.order_v1_price_allocations(order_id);
alter table private.order_v1_price_allocations enable row level security;
revoke all on table private.order_v1_price_allocations from public, anon, authenticated, service_role;

create table private.order_v1_shipment_allocations (
  shipment_id uuid primary key,
  order_id uuid not null references private.order_v1_price_allocation_heads(order_id) on delete restrict,
  prepaid_shipping_fee bigint not null check (prepaid_shipping_fee >= 0),
  foreign key (order_id, shipment_id) references public.order_shipments(order_id, id) on delete restrict
);
create index order_v1_shipment_allocations_order on private.order_v1_shipment_allocations(order_id);
alter table private.order_v1_shipment_allocations enable row level security;
revoke all on table private.order_v1_shipment_allocations from public, anon, authenticated, service_role;

create function private.guard_order_v1_price_allocation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise check_violation using message = 'v1_allocation_immutable';
end $$;
revoke all on function private.guard_order_v1_price_allocation() from public, anon, authenticated, service_role;
create trigger order_v1_price_allocation_heads_guard before update or delete on private.order_v1_price_allocation_heads
  for each row execute function private.guard_order_v1_price_allocation();
create trigger order_v1_price_allocations_guard before update or delete on private.order_v1_price_allocations
  for each row execute function private.guard_order_v1_price_allocation();
create trigger order_v1_shipment_allocations_guard before update or delete on private.order_v1_shipment_allocations
  for each row execute function private.guard_order_v1_price_allocation();

-- 불변 배분 원장 읽기(보고·출고·화면): 버전 2 원장과 얼린 버전 1 원장을 한 모양으로. 원장이 없는 버전 1 주문은 지금처럼 비어 있다.
create view private.order_price_allocation_ledger as
  select a.order_item_id, a.order_id, a.calculation_version, a.subtotal, a.volume_discount, a.net_subtotal, a.coupon_discount,
    a.store_credit_discount, a.paid_goods_total
  from private.order_price_allocations a
  union all
  select v.order_item_id, v.order_id, v.calculation_version, v.subtotal, v.volume_discount, v.net_subtotal, v.coupon_discount,
    v.store_credit_discount, v.paid_goods_total
  from private.order_v1_price_allocations v;
revoke all on table private.order_price_allocation_ledger from public, anon, authenticated, service_role;

-- 2. 나누기(화면·엑셀의 allocateSettledAmount와 같은 조건): 0원이면 모두 0, 가중치 합이 금액보다 작으면 나눌 수 없음(null).
create function private.order_v1_allocate(p_amount bigint, p_weights jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
begin
  if p_amount = 0 then
    return (select jsonb_object_agg(w->>'id', 0) from jsonb_array_elements(p_weights) w);
  end if;
  if (select coalesce(sum((w->>'weight')::numeric), 0) from jsonb_array_elements(p_weights) w) < p_amount then return null; end if;
  return private.allocate_transaction_amount(p_amount, p_weights);
end $$;
revoke all on function private.order_v1_allocate(bigint, jsonb) from public, anon, authenticated, service_role;

-- 3. 계산(읽기 전용). 같은 입력이면 언제나 같은 결과다. ok가 거짓이면 issue가 이유다.
--  issue: payment_unavailable(결제 한 건·결제액 = 주문 총액 아님 — 기존 막힘이 같이 잡는다) · items_missing · unsupported_discount
--   (복수구매 할인·배송비 쿠폰 — 버전 1에 없는 항목) · coupon_unrecorded(쿠폰 기록·대상 범위·대상 판정 없음)
--   · coupon_amount_mismatch · coupon_target_mismatch · credit_mismatch · shipping_snapshot_mismatch · amount_mismatch(핵심 합계 검사).
create function private.order_v1_allocation_derive(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  rule constant text := 'v1-a5-largest-remainder-1';
  purchase public.orders; pay public.payments; payment_count integer; redemption public.coupon_redemptions; terms jsonb;
  item_rows jsonb; ship_rows jsonb; coupon_alloc jsonb; credit_alloc jsonb; entry jsonb; result_items jsonb := '[]'::jsonb;
  eligible_total bigint := 0; goods_total bigint := 0; shipping_total bigint := 0; paid_total bigint := 0;
  line_coupon bigint; line_credit bigint; line_paid bigint; input jsonb;
begin
  select * into purchase from public.orders where id = p_order_id;
  if not found then return jsonb_build_object('ok', false, 'issue', 'order_not_found', 'ruleVersion', rule); end if;
  if purchase.calculation_version is distinct from 1 then return jsonb_build_object('ok', false, 'issue', 'not_v1', 'ruleVersion', rule); end if;
  select count(*) into payment_count from public.payments p where p.purpose = 'order' and p.ref_id = p_order_id and p.status <> 'failed';
  pay := private.order_partial_cancellation_payment(p_order_id);
  if payment_count <> 1 or pay.id is null or pay.amount <= 0 or pay.amount <> purchase.total then
    return jsonb_build_object('ok', false, 'issue', 'payment_unavailable', 'ruleVersion', rule);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'goodId', i.good_id, 'ipId', i.good_ip_id_snapshot, 'qty', i.qty,
      'unitPrice', i.unit_price, 'subtotal', i.qty::bigint * i.unit_price::bigint, 'volumeDiscount', i.volume_discount_total) order by i.id), '[]'::jsonb)
    into item_rows from public.order_items i where i.order_id = p_order_id;
  if jsonb_array_length(item_rows) = 0 then return jsonb_build_object('ok', false, 'issue', 'items_missing', 'ruleVersion', rule); end if;
  if purchase.volume_discount_total <> 0 or purchase.shipping_coupon_discount_total <> 0
    or exists(select 1 from jsonb_array_elements(item_rows) x where (x->>'volumeDiscount')::bigint <> 0)
    or exists(select 1 from public.coupon_redemptions r where r.order_id = p_order_id and r.status = 'applied' and r.benefit_kind <> 'goods') then
    return jsonb_build_object('ok', false, 'issue', 'unsupported_discount', 'ruleVersion', rule);
  end if;
  select coalesce(sum((x->>'subtotal')::bigint), 0) into goods_total from jsonb_array_elements(item_rows) x;

  -- 쿠폰: 화면·엑셀(admin_order_item_allocation_inputs)과 같은 기록(적용된 상품 쿠폰 중 첫 번째)과 같은 대상 판정.
  if purchase.discount_total > 0 then
    select * into redemption from public.coupon_redemptions r
      where r.order_id = p_order_id and r.status = 'applied' and r.benefit_kind = 'goods' order by r.application_index limit 1;
    terms := redemption.terms_snapshot;
    if redemption.id is null or terms is null or jsonb_typeof(terms) <> 'object' or redemption.eligible_subtotal is null
      or coalesce(terms->>'goodsScope', '') not in ('all', 'selected_goods', 'selected_categories', 'selected_ips')
      or coalesce(jsonb_typeof(terms->'targetGoodIds'), 'null') not in ('null', 'array')
      or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(terms->'targetGoodIds') = 'array' then terms->'targetGoodIds' else '[]'::jsonb end) t
        where jsonb_typeof(t) <> 'string')
      or terms ? 'targetCategoryIds' and (jsonb_typeof(terms->'targetCategoryIds') <> 'array'
        or exists(select 1 from jsonb_array_elements(terms->'targetCategoryIds') t where jsonb_typeof(t) <> 'string'))
      or terms ? 'targetIpIds' and (jsonb_typeof(terms->'targetIpIds') <> 'array'
        or exists(select 1 from jsonb_array_elements(terms->'targetIpIds') t where jsonb_typeof(t) <> 'string')) then
      return jsonb_build_object('ok', false, 'issue', 'coupon_unrecorded', 'ruleVersion', rule);
    end if;
    if redemption.discount_amount <> purchase.discount_total then
      return jsonb_build_object('ok', false, 'issue', 'coupon_amount_mismatch', 'ruleVersion', rule);
    end if;
    select jsonb_agg(x || jsonb_build_object('couponEligible', private.coupon_line_eligible_now(terms, x->>'goodId', x->>'ipId')) order by x->>'id')
      into item_rows from jsonb_array_elements(item_rows) x;
    if exists(select 1 from jsonb_array_elements(item_rows) x where jsonb_typeof(x->'couponEligible') <> 'boolean') then
      return jsonb_build_object('ok', false, 'issue', 'coupon_unrecorded', 'ruleVersion', rule);
    end if;
    select coalesce(sum((x->>'subtotal')::bigint) filter (where (x->>'couponEligible')::boolean), 0) into eligible_total
      from jsonb_array_elements(item_rows) x;
    if eligible_total <> redemption.eligible_subtotal then
      return jsonb_build_object('ok', false, 'issue', 'coupon_target_mismatch', 'ruleVersion', rule);
    end if;
    coupon_alloc := private.order_v1_allocate(purchase.discount_total, (select jsonb_agg(jsonb_build_object('id', x->>'id',
      'weight', case when (x->>'couponEligible')::boolean then (x->>'subtotal')::bigint else 0 end)) from jsonb_array_elements(item_rows) x));
    if coupon_alloc is null then return jsonb_build_object('ok', false, 'issue', 'coupon_target_mismatch', 'ruleVersion', rule); end if;
  else
    coupon_alloc := (select jsonb_object_agg(x->>'id', 0) from jsonb_array_elements(item_rows) x);
  end if;

  -- 적립금: 쿠폰 뒤 품목 금액 비례.
  credit_alloc := private.order_v1_allocate(purchase.store_credit_total, (select jsonb_agg(jsonb_build_object('id', x->>'id',
    'weight', (x->>'subtotal')::bigint - (coupon_alloc->>(x->>'id'))::bigint)) from jsonb_array_elements(item_rows) x));
  if credit_alloc is null then return jsonb_build_object('ok', false, 'issue', 'credit_mismatch', 'ruleVersion', rule); end if;

  for entry in select value from jsonb_array_elements(item_rows) loop
    line_coupon := (coupon_alloc->>(entry->>'id'))::bigint;
    line_credit := (credit_alloc->>(entry->>'id'))::bigint;
    line_paid := (entry->>'subtotal')::bigint - (entry->>'volumeDiscount')::bigint - line_coupon - line_credit;
    if line_paid < 0 then return jsonb_build_object('ok', false, 'issue', 'amount_mismatch', 'ruleVersion', rule); end if;
    paid_total := paid_total + line_paid;
    result_items := result_items || jsonb_build_object('orderItemId', entry->>'id', 'subtotal', (entry->>'subtotal')::bigint,
      'volumeDiscount', (entry->>'volumeDiscount')::bigint, 'netSubtotal', (entry->>'subtotal')::bigint - (entry->>'volumeDiscount')::bigint,
      'couponDiscount', line_coupon, 'storeCreditDiscount', line_credit, 'paidGoodsTotal', line_paid);
  end loop;

  -- 배송 건 선결제 배송비: 주문 배송비 스냅숏 그대로.
  select coalesce(jsonb_agg(jsonb_build_object('shipmentId', s.id, 'shippingFee', s.shipping_fee,
      'snapshotTotalFee', s.shipping_fee_snapshot->'totalFee') order by s.id), '[]'::jsonb)
    into ship_rows from public.order_shipments s where s.order_id = p_order_id;
  if jsonb_array_length(ship_rows) = 0 or exists(select 1 from jsonb_array_elements(ship_rows) x
      where case when coalesce(jsonb_typeof(x->'snapshotTotalFee'), 'missing') <> 'number' or (x->>'snapshotTotalFee') !~ '^[0-9]{1,15}$' then true
        else (x->>'snapshotTotalFee')::bigint <> (x->>'shippingFee')::bigint end) then
    return jsonb_build_object('ok', false, 'issue', 'shipping_snapshot_mismatch', 'ruleVersion', rule);
  end if;
  select coalesce(sum((x->>'shippingFee')::bigint), 0) into shipping_total from jsonb_array_elements(ship_rows) x;
  if shipping_total <> purchase.shipping_fee then
    return jsonb_build_object('ok', false, 'issue', 'shipping_snapshot_mismatch', 'ruleVersion', rule);
  end if;

  -- 핵심 검사: 품목 결제 몫 합 + 배송 건 배송비 합 = 결제액(1원 단위).
  if paid_total + shipping_total <> pay.amount then
    return jsonb_build_object('ok', false, 'issue', 'amount_mismatch', 'ruleVersion', rule);
  end if;

  input := jsonb_build_object('ruleVersion', rule,
    'order', jsonb_build_object('id', purchase.id, 'calculationVersion', purchase.calculation_version, 'total', purchase.total,
      'shippingFee', purchase.shipping_fee, 'discountTotal', purchase.discount_total, 'storeCreditTotal', purchase.store_credit_total,
      'volumeDiscountTotal', purchase.volume_discount_total, 'shippingCouponDiscountTotal', purchase.shipping_coupon_discount_total),
    'payment', jsonb_build_object('id', pay.id, 'amount', pay.amount),
    'coupon', case when redemption.id is null then null else jsonb_build_object('redemptionId', redemption.id, 'code', redemption.coupon_code,
      'discountAmount', redemption.discount_amount, 'eligibleSubtotal', redemption.eligible_subtotal, 'terms', terms) end,
    'items', item_rows, 'shipments', ship_rows);
  return jsonb_build_object('ok', true, 'issue', null, 'ruleVersion', rule,
    'inputHash', encode(extensions.digest(convert_to(input::text, 'UTF8'), 'sha256'), 'hex'), 'input', input,
    'paymentId', pay.id, 'paymentAmount', pay.amount, 'goodsTotal', goods_total, 'volumeDiscountTotal', 0,
    'couponDiscountTotal', purchase.discount_total, 'storeCreditTotal', purchase.store_credit_total, 'paidGoodsTotal', paid_total,
    'shippingTotal', shipping_total, 'items', result_items,
    'shipments', (select jsonb_agg(jsonb_build_object('shipmentId', x->'shipmentId', 'prepaidShippingFee', (x->>'shippingFee')::bigint)
      order by x->>'shipmentId') from jsonb_array_elements(ship_rows) x));
end $$;
revoke all on function private.order_v1_allocation_derive(uuid) from public, anon, authenticated, service_role;

-- 이유 코드 → 막힘 코드. 결제 문제는 기존 막힘(payment_unavailable)이 잡으므로 더하지 않는다.
create function private.order_v1_allocation_blocker(p_issue text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_issue is null or p_issue in ('payment_unavailable', 'not_v1', 'order_not_found') then null
    when p_issue in ('coupon_amount_mismatch', 'coupon_target_mismatch', 'credit_mismatch', 'shipping_snapshot_mismatch', 'amount_mismatch')
      then 'partial_cancel_v1_allocation_mismatch'
    else 'partial_cancel_v1_allocation_unavailable' end;
$$;
revoke all on function private.order_v1_allocation_blocker(text) from public, anon, authenticated, service_role;

-- 화면 문맥: 버전 1 주문의 원장 상태(얼렸는지·막힌 이유). 버전 1이 아니면 null.
create function private.order_v1_allocation_state(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare derived jsonb;
begin
  if (select calculation_version from public.orders where id = p_order_id) is distinct from 1 then return null; end if;
  if exists(select 1 from private.order_v1_price_allocation_heads where order_id = p_order_id) then
    return jsonb_build_object('frozen', true, 'issue', null);
  end if;
  derived := private.order_v1_allocation_derive(p_order_id);
  return jsonb_build_object('frozen', false, 'issue', derived->>'issue');
end $$;
revoke all on function private.order_v1_allocation_state(uuid) from public, anon, authenticated, service_role;

create function private.order_v1_allocation_blockers(p_order_id uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_remove(array[private.order_v1_allocation_blocker(private.order_v1_allocation_state(p_order_id)->>'issue')], null), array[]::text[]);
$$;
revoke all on function private.order_v1_allocation_blockers(uuid) from public, anon, authenticated, service_role;

-- 4. 얼리기. 첫 부분 취소 시작이 주문 행을 잠근 뒤 부른다. 이미 있으면 그대로 둔다(다시 계산하지 않는다).
create function private.freeze_order_v1_allocation(p_order_id uuid, p_actor uuid, p_operation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare derived jsonb; blocker text; line jsonb;
begin
  perform 1 from public.orders where id = p_order_id and calculation_version = 1 for update;
  if not found then return; end if;
  if exists(select 1 from private.order_v1_price_allocation_heads where order_id = p_order_id) then return; end if;
  derived := private.order_v1_allocation_derive(p_order_id);
  if not coalesce((derived->>'ok')::boolean, false) then
    blocker := coalesce(private.order_v1_allocation_blocker(derived->>'issue'), 'payment_unavailable');
    raise check_violation using message = blocker;
  end if;
  insert into private.order_v1_price_allocation_heads(order_id, payment_id, source_calculation_version, rule_version, input_hash, input_snapshot,
    payment_amount, goods_total, volume_discount_total, coupon_discount_total, store_credit_total, paid_goods_total, shipping_total,
    frozen_by, frozen_operation_id)
  values (p_order_id, (derived->>'paymentId')::uuid, 1, derived->>'ruleVersion', derived->>'inputHash', derived->'input',
    (derived->>'paymentAmount')::bigint, (derived->>'goodsTotal')::bigint, (derived->>'volumeDiscountTotal')::bigint,
    (derived->>'couponDiscountTotal')::bigint, (derived->>'storeCreditTotal')::bigint, (derived->>'paidGoodsTotal')::bigint,
    (derived->>'shippingTotal')::bigint, p_actor, p_operation_id);
  for line in select value from jsonb_array_elements(derived->'items') loop
    insert into private.order_v1_price_allocations(order_item_id, order_id, calculation_version, subtotal, volume_discount, net_subtotal,
      coupon_discount, store_credit_discount, paid_goods_total)
    values ((line->>'orderItemId')::uuid, p_order_id, 1, (line->>'subtotal')::bigint, (line->>'volumeDiscount')::bigint,
      (line->>'netSubtotal')::bigint, (line->>'couponDiscount')::bigint, (line->>'storeCreditDiscount')::bigint, (line->>'paidGoodsTotal')::bigint);
  end loop;
  for line in select value from jsonb_array_elements(derived->'shipments') loop
    insert into private.order_v1_shipment_allocations(shipment_id, order_id, prepaid_shipping_fee)
    values ((line->>'shipmentId')::uuid, p_order_id, (line->>'prepaidShippingFee')::bigint);
  end loop;
  -- 줄 합계가 머리와 같아야 한다(머리 제약이 결제액 = 품목 결제 몫 + 배송비를 지킨다).
  if (select count(*) from private.order_v1_price_allocations where order_id = p_order_id)
      <> (select count(*) from public.order_items where order_id = p_order_id)
    or (select count(*) from private.order_v1_shipment_allocations where order_id = p_order_id)
      <> (select count(*) from public.order_shipments where order_id = p_order_id)
    or (select (sum(subtotal), sum(coupon_discount), sum(store_credit_discount), sum(paid_goods_total))
        from private.order_v1_price_allocations where order_id = p_order_id)
      is distinct from (select (goods_total::numeric, coupon_discount_total::numeric, store_credit_total::numeric, paid_goods_total::numeric)
        from private.order_v1_price_allocation_heads where order_id = p_order_id)
    or (select sum(prepaid_shipping_fee) from private.order_v1_shipment_allocations where order_id = p_order_id)
      is distinct from (select shipping_total::numeric from private.order_v1_price_allocation_heads where order_id = p_order_id) then
    raise check_violation using message = 'partial_cancel_v1_allocation_mismatch';
  end if;
  insert into public.audit_log(actor_id, action, target, diff)
  values (p_actor, 'admin.order.v1_allocation_frozen', 'order:' || p_order_id::text,
    jsonb_build_object('ruleVersion', derived->>'ruleVersion', 'inputHash', derived->>'inputHash', 'operationId', p_operation_id,
      'paymentId', derived->>'paymentId', 'paymentAmount', (derived->>'paymentAmount')::bigint, 'paidGoodsTotal', (derived->>'paidGoodsTotal')::bigint,
      'shippingTotal', (derived->>'shippingTotal')::bigint, 'couponDiscountTotal', (derived->>'couponDiscountTotal')::bigint,
      'storeCreditTotal', (derived->>'storeCreditTotal')::bigint, 'items', derived->'items', 'shipments', derived->'shipments'));
end $$;
revoke all on function private.freeze_order_v1_allocation(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- 5. 원장 읽기 seam(판정·금액). 품목: 불변 원장(버전 2 원장 또는 얼린 버전 1 원장), 아직 얼리지 않은 버전 1 주문은 같은 계산.
--    배송 건: 버전 1은 원장(또는 같은 계산)의 선결제 배송비, 그 밖은 배송 건 배송비(지금과 같다).
create function private.order_item_price_allocation(p_order_item_id uuid) returns private.order_price_allocations
language plpgsql stable security definer set search_path = '' as $$
declare result private.order_price_allocations; item public.order_items; derived jsonb; entry jsonb;
begin
  select l.order_item_id, l.order_id, l.calculation_version, l.subtotal, l.volume_discount, l.net_subtotal, l.coupon_discount,
    l.store_credit_discount, l.paid_goods_total
    into result from private.order_price_allocation_ledger l where l.order_item_id = p_order_item_id;
  if found then return result; end if;
  select * into item from public.order_items where id = p_order_item_id;
  if not found or (select calculation_version from public.orders where id = item.order_id) is distinct from 1
    or exists(select 1 from private.order_v1_price_allocation_heads where order_id = item.order_id) then
    return null;
  end if;
  derived := private.order_v1_allocation_derive(item.order_id);
  if not coalesce((derived->>'ok')::boolean, false) then return null; end if;
  select value into entry from jsonb_array_elements(derived->'items') where value->>'orderItemId' = p_order_item_id::text;
  if entry is null then return null; end if;
  result := row(p_order_item_id, item.order_id, 1, (entry->>'subtotal')::bigint, (entry->>'volumeDiscount')::bigint,
    (entry->>'netSubtotal')::bigint, (entry->>'couponDiscount')::bigint, (entry->>'storeCreditDiscount')::bigint,
    (entry->>'paidGoodsTotal')::bigint)::private.order_price_allocations;
  return result;
end $$;
revoke all on function private.order_item_price_allocation(uuid) from public, anon, authenticated, service_role;

create function private.order_shipment_prepaid_fee(p_shipment_id uuid) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare ship public.order_shipments; fee bigint; derived jsonb;
begin
  select * into ship from public.order_shipments where id = p_shipment_id;
  if not found then raise no_data_found using message = 'shipment_not_found'; end if;
  if (select calculation_version from public.orders where id = ship.order_id) is distinct from 1 then return ship.shipping_fee; end if;
  if exists(select 1 from private.order_v1_price_allocation_heads where order_id = ship.order_id) then
    select prepaid_shipping_fee into fee from private.order_v1_shipment_allocations where shipment_id = p_shipment_id;
  else
    derived := private.order_v1_allocation_derive(ship.order_id);
    if coalesce((derived->>'ok')::boolean, false) then
      select (value->>'prepaidShippingFee')::bigint into fee from jsonb_array_elements(derived->'shipments') where value->>'shipmentId' = p_shipment_id::text;
    end if;
  end if;
  if fee is null then raise check_violation using message = 'partial_cancel_v1_allocation_unavailable'; end if;
  return fee;
end $$;
revoke all on function private.order_shipment_prepaid_fee(uuid) from public, anon, authenticated, service_role;

-- 6. T12b 판정·계산·시작을 seam에 잇는다(런타임 정의에 대한 앵커 치환 — 앵커는 정확히 1회).
create function private.t12c_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 't12c patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 주문 막힘: 버전 1 주문은 '배분 원장 없음'으로 막지 않고, 배분을 확정할 수 없을 때만 그 이유로 막는다.
select private.t12c_patch_function('private.order_partial_cancellation_blockers(uuid)'::regprocedure, array[
$a$  if purchase.calculation_version is distinct from 2 then blockers := array_append(blockers, 'legacy_order'); end if;$a$,
$a$  -- 버전 1 주문은 첫 부분 취소 때 얼리는 파생 배분 원장을 쓴다(ADR-0032 보완). 배분을 확정할 수 없으면 그 이유로 막는다.
  if purchase.calculation_version = 1 then blockers := blockers || private.order_v1_allocation_blockers(p_order_id);
  elsif purchase.calculation_version is distinct from 2 then blockers := array_append(blockers, 'legacy_order'); end if;$a$
]);

-- 품목 막힘: 배분 원장 확인은 seam으로(버전 2 원장 · 얼린 버전 1 원장 · 같은 계산).
select private.t12c_patch_function('private.order_partial_cancellation_item_blocker(uuid)'::regprocedure, array[
$a$  if not exists(select 1 from private.order_price_allocations a where a.order_item_id = item.id and a.order_id = item.order_id) then$a$,
$a$  if (private.order_item_price_allocation(item.id)).order_item_id is distinct from item.id then$a$
]);

-- 계산: 품목 배분액과 닫히는 배송 건의 선결제 배송비를 seam에서 읽는다(버전 2는 지금과 같은 값).
select private.t12c_patch_function('private.order_partial_cancellation_plan(uuid,jsonb)'::regprocedure, array[
$a$    select * into allocation from private.order_price_allocations where order_item_id = item.id and order_id = p_order_id;$a$,
$a$    allocation := private.order_item_price_allocation(item.id);$a$,
$a$      shipping := shipping + ship.shipping_fee;$a$,
$a$      shipping := shipping + private.order_shipment_prepaid_fee(ship.id);$a$,
$a$        'shippingFeeRefund', ship.shipping_fee, 'shippingCollectFee',$a$,
$a$        'shippingFeeRefund', private.order_shipment_prepaid_fee(ship.id), 'shippingCollectFee',$a$
]);

-- 시작: 판정이 열려 있으면 계산 전에 버전 1 주문의 배분을 얼린다(주문 행 잠금 아래, 한 번만). 막혀 있으면 아래 계산이 그 이유로 거절한다.
select private.t12c_patch_function('public.admin_start_order_partial_cancellation(uuid,jsonb,text,text,boolean,bigint,uuid,jsonb)'::regprocedure, array[
$a$  plan := private.order_partial_cancellation_plan(p_order_id, p_items);$a$,
$a$  if cardinality(private.order_partial_cancellation_blockers(p_order_id)) = 0 then
    perform private.freeze_order_v1_allocation(p_order_id, v_actor, p_operation_id);
  end if;
  plan := private.order_partial_cancellation_plan(p_order_id, p_items);$a$
]);

-- 문맥(처리 권한): 주문 계산 버전과 버전 1 원장 상태를 싣는다 — 화면이 '첫 부분 취소 때 금액 배분을 확정' 안내와 막힌 이유를 보인다.
select private.t12c_patch_function('public.admin_order_partial_cancellation_context(uuid)'::regprocedure, array[
$a$    'gift', exists(select 1 from private.gift_intents g where g.order_id = p_order_id),$a$,
$a$    'gift', exists(select 1 from private.gift_intents g where g.order_id = p_order_id),
    'calculationVersion', (select o.calculation_version from public.orders o where o.id = p_order_id),
    'v1Allocation', private.order_v1_allocation_state(p_order_id),$a$
]);

do $$declare fn regprocedure; contract record; begin
  foreach fn in array array[
    'private.order_partial_cancellation_blockers(uuid)'::regprocedure,
    'private.order_partial_cancellation_item_blocker(uuid)'::regprocedure,
    'private.order_partial_cancellation_plan(uuid,jsonb)'::regprocedure,
    'public.admin_start_order_partial_cancellation(uuid,jsonb,text,text,boolean,bigint,uuid,jsonb)'::regprocedure,
    'public.admin_order_partial_cancellation_context(uuid)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

drop function private.t12c_patch_function(regprocedure, text[]);

commit;
notify pgrst, 'reload schema';
