-- 재고 부족 품목·수량 부분 취소(QNA-020, ADR-0032) — 스위치·원장·판정·운영자 RPC·결제사 확인 기록.
--
-- 원래 요청: 서원 회신 C7 "재고가 부족한 제품은 고객의견을 물어본 후 결정사항을 말씀 주시면 그대로 진행합니다",
-- E1 "품절의 경우 해당 고객정보를 전달드립니다".
-- 2026-11-11 사용자 결정(묶음 8): "차감·부분 취소 모두 (Recommended)" — 재고 부족 시 품목·수량 부분 취소 뒤 나머지 출고.
--
-- 오케스트레이터 판단(판단 위임 원칙 ① 원문 ② 업계 ③ 좁히지 않음 ④ 돈·재고는 안전한 쪽 + 스위치·감사):
--  * 스위치는 DB가 강제하고 기본 꺼짐이다. T12a 스위치 행(private.return_fee_deduction_settings)의 별도 칸
--    (partial_cancel_enabled)이다 — 결제사 부분 취소 기능의 켬 여부를 한 감사 행에 모으되, 게이트가 다르므로(반품배송비 금액·
--    서원 운임 계약은 필요 없고 서원 품절 통보 경로 E1이 필요) 따로 켠다. 꺼져 있으면 어떤 원장도 바뀌지 않고 판정은 'partial_cancel_disabled'.
--  * 운영자만 연다(고객 직접 신청 없음 — 원문 "결정사항을 말씀 주시면 그대로 진행"). 고객 결정 기록은 필수다.
--  * 발송 전 주문(결제완료·발주확인, 모든 배송 건 발송 전)만. 환불액 = 고른 품목·수량의 불변 배분액(복수구매 할인·쿠폰·적립금
--    배분 반영, 누적 비례 배분이라 같은 품목을 여러 번 나눠 취소해도 합이 배분액과 같다) + 남은 품목이 없어진 배송 건의 선결제
--    배송비. 남은 주문의 쿠폰 조건 재판정·회수는 하지 않는다. 그 품목에 배분된 적립금은 적립금으로 되돌린다(고객 불리 없음).
--  * 토스 카드: 시작(processing) → 서버가 결제사 부분 취소(취소마다 다른 멱등키, 잔액 기대값 검증) → 확인되면 그때 재고 복원·
--    배송 건 조정·카드팩 회수를 한 트랜잭션에서 적용(completed). 결제사가 부분 취소를 받지 않으면(isPartialCancelable=false 등)
--    돈이 움직이지 않았으므로 품목 부분 취소 자체를 진행하지 않는다(rejected — 전액 환불로 돌리지 않는다). 처리 중에는 그 주문의
--    출고지시·발송·다른 클레임을 막는다(결제사 취소와 출고가 엇갈리지 않게).
--  * 무통장: 결제사가 없으므로 시작 때 바로 적용하고 송금 대기(awaiting_transfer, 송금액 = 배분액)로 둔다. 운영자가 송금 증빙을
--    적으면 completed. 송금 대기·증빙 모델은 T03·ADR-0010과 같다(비종결 상태 → 불변 송금 증빙으로 종결).
--  * 부분 취소를 받지 않는 결제(나이스페이 계약 전·코페이·토스 가상계좌·정기배송 바인딩)와 선물 주문·버전 1 주문, 예약 판매·제작·
--    디지털·통합 이력 품목은 판정 단계에서 막고 이유를 보인다.
begin;

-- 1. 스위치(T12a 행의 별도 칸). 켤 때는 근거와 켠 시각이 필요하다. 행의 감사·리비전 트리거가 이 칸 변경도 남긴다.
alter table private.return_fee_deduction_settings
  add column partial_cancel_enabled boolean not null default false,
  add column partial_cancel_evidence text check (partial_cancel_evidence is null or (partial_cancel_evidence = btrim(partial_cancel_evidence)
    and char_length(partial_cancel_evidence) between 2 and 1000 and partial_cancel_evidence !~ '[[:cntrl:]]')),
  add column partial_cancel_enabled_at timestamptz,
  add constraint return_fee_deduction_settings_partial_cancel_shape
    check (not partial_cancel_enabled or (partial_cancel_evidence is not null and partial_cancel_enabled_at is not null));

create function private.order_partial_cancel_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.partial_cancel_enabled from private.return_fee_deduction_settings s where s.singleton), false);
$$;
revoke all on function private.order_partial_cancel_enabled() from public, anon, authenticated, service_role;

-- 2. 원장. 머리(한 번의 부분 취소) · 품목 줄 · 닫힌 배송 건 · 무통장 환불계좌.
create table private.order_partial_cancellations (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  provider public.payment_provider not null check (provider in ('toss', 'bank_transfer')),
  sequence integer not null check (sequence >= 1),
  reason_code text not null check (reason_code = 'out_of_stock'),
  customer_decision text not null check (customer_decision = btrim(customer_decision) and char_length(customer_decision) between 2 and 500
    and translate(customer_decision, E'\n\r\t', '') !~ '[[:cntrl:]]'),
  note text check (note is null or (note = btrim(note) and char_length(note) between 1 and 500 and translate(note, E'\n\r\t', '') !~ '[[:cntrl:]]')),
  warehouse_stop_confirmed boolean not null,
  payment_amount bigint not null check (payment_amount > 0),
  balance_before bigint not null check (balance_before > 0 and balance_before <= payment_amount),
  goods_refund_amount bigint not null check (goods_refund_amount >= 0),
  shipping_refund_amount bigint not null check (shipping_refund_amount >= 0),
  refund_amount bigint not null check (refund_amount > 0),
  store_credit_restore_amount bigint not null default 0 check (store_credit_restore_amount >= 0),
  state text not null check (state in ('processing', 'needs_review', 'rejected', 'completed', 'awaiting_transfer')),
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'),
  provider_transaction_key text check (provider_transaction_key is null or provider_transaction_key ~ '^[\x21-\x7e]{1,64}$'),
  provider_confirmed_at timestamptz,
  operation_id uuid not null unique,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  applied_at timestamptz,
  completed_at timestamptz,
  rejected_at timestamptz,
  transfer_operation_id uuid unique,
  transferred_by uuid references public.profiles(id) on delete restrict,
  transferred_at timestamptz,
  transfer_evidence text check (transfer_evidence is null or (transfer_evidence = btrim(transfer_evidence) and char_length(transfer_evidence) between 2 and 300)),
  transfer_note text check (transfer_note is null or (transfer_note = btrim(transfer_note) and char_length(transfer_note) between 2 and 300)),
  updated_at timestamptz not null default clock_timestamp(),
  unique (order_id, sequence),
  constraint order_partial_cancellations_amounts check (refund_amount = goods_refund_amount + shipping_refund_amount and refund_amount < balance_before),
  constraint order_partial_cancellations_applied check ((state in ('completed', 'awaiting_transfer')) = (applied_at is not null)),
  constraint order_partial_cancellations_completed check ((state = 'completed') = (completed_at is not null)),
  constraint order_partial_cancellations_rejected check ((state = 'rejected') = (rejected_at is not null)),
  constraint order_partial_cancellations_provider_state check (
    provider = 'toss' and state <> 'awaiting_transfer' and transfer_operation_id is null
      and (state <> 'completed' or (provider_confirmed_at is not null and provider_transaction_key is not null))
    -- 무통장은 시작 트랜잭션 안에서 processing으로 넣고 같은 트랜잭션에서 바로 적용해 송금 대기로 넘긴다(실패하면 함께 롤백).
    or provider = 'bank_transfer' and state in ('processing', 'awaiting_transfer', 'completed') and provider_confirmed_at is null and provider_transaction_key is null),
  constraint order_partial_cancellations_transfer check (
    (provider = 'bank_transfer' and state = 'completed') = (transfer_operation_id is not null and transferred_by is not null
      and transferred_at is not null and transfer_evidence is not null and transfer_note is not null))
);
-- 한 주문에 결제사 확인을 기다리는 부분 취소는 하나뿐이다(잔액 기대값이 서로 엇갈리지 않게).
create unique index order_partial_cancellations_in_flight on private.order_partial_cancellations(order_id) where state in ('processing', 'needs_review');
create index order_partial_cancellations_payment on private.order_partial_cancellations(payment_id);
create index order_partial_cancellations_transfer_queue on private.order_partial_cancellations(created_at, id) where state = 'awaiting_transfer';
alter table private.order_partial_cancellations enable row level security;
revoke all on table private.order_partial_cancellations from public, anon, authenticated, service_role;

create table private.order_partial_cancellation_items (
  partial_cancellation_id uuid not null references private.order_partial_cancellations(id) on delete restrict,
  order_id uuid not null,
  order_item_id uuid not null,
  shipment_id uuid not null references public.order_shipments(id) on delete restrict,
  qty integer not null check (qty > 0),
  canceled_qty_before integer not null check (canceled_qty_before >= 0),
  gross_amount bigint not null check (gross_amount >= 0),
  volume_discount bigint not null check (volume_discount >= 0),
  coupon_discount bigint not null check (coupon_discount >= 0),
  store_credit_discount bigint not null check (store_credit_discount >= 0),
  goods_refund_amount bigint not null check (goods_refund_amount >= 0),
  primary key (partial_cancellation_id, order_item_id),
  foreign key (order_id, order_item_id) references public.order_items(order_id, id) on delete restrict
);
create index order_partial_cancellation_items_item on private.order_partial_cancellation_items(order_item_id);
alter table private.order_partial_cancellation_items enable row level security;
revoke all on table private.order_partial_cancellation_items from public, anon, authenticated, service_role;

create table private.order_partial_cancellation_shipments (
  partial_cancellation_id uuid not null references private.order_partial_cancellations(id) on delete restrict,
  order_id uuid not null,
  shipment_id uuid not null unique,
  shipping_fee_refund bigint not null check (shipping_fee_refund >= 0),
  primary key (partial_cancellation_id, shipment_id),
  foreign key (order_id, shipment_id) references public.order_shipments(order_id, id) on delete restrict
);
alter table private.order_partial_cancellation_shipments enable row level security;
revoke all on table private.order_partial_cancellation_shipments from public, anon, authenticated, service_role;

-- 무통장 환불계좌(운영자가 고객 결정과 함께 받은 계좌). 원문은 송금 완료 30일 뒤 지운다(클레임 환불계좌와 같은 보관 기간).
create table private.order_partial_cancellation_refund_accounts (
  partial_cancellation_id uuid primary key references private.order_partial_cancellations(id) on delete restrict,
  bank_name text check (bank_name is null or (btrim(bank_name) = bank_name and char_length(bank_name) between 1 and 40)),
  account_number text check (account_number is null or account_number ~ '^[0-9-]{8,30}$'),
  account_holder text check (account_holder is null or (btrim(account_holder) = account_holder and char_length(account_holder) between 1 and 40)),
  masked_account text not null,
  masked_holder text not null,
  created_at timestamptz not null default clock_timestamp(),
  purge_after timestamptz,
  purged_at timestamptz,
  constraint order_partial_cancellation_refund_accounts_purged check (purged_at is null or (bank_name is null and account_number is null and account_holder is null))
);
alter table private.order_partial_cancellation_refund_accounts enable row level security;
revoke all on table private.order_partial_cancellation_refund_accounts from public, anon, authenticated, service_role;

-- 금액·품목·근거는 바뀌지 않고 상태는 정해진 방향으로만 간다. 행은 지우지 못한다.
create function private.guard_order_partial_cancellation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise check_violation using message = 'partial_cancellation_immutable'; end if;
  if (new.id, new.order_id, new.payment_id, new.provider, new.sequence, new.reason_code, new.customer_decision, new.note,
      new.warehouse_stop_confirmed, new.payment_amount, new.balance_before, new.goods_refund_amount, new.shipping_refund_amount,
      new.refund_amount, new.store_credit_restore_amount, new.operation_id, new.created_by, new.created_at)
    is distinct from
     (old.id, old.order_id, old.payment_id, old.provider, old.sequence, old.reason_code, old.customer_decision, old.note,
      old.warehouse_stop_confirmed, old.payment_amount, old.balance_before, old.goods_refund_amount, old.shipping_refund_amount,
      old.refund_amount, old.store_credit_restore_amount, old.operation_id, old.created_by, old.created_at)
    or (old.applied_at is not null and new.applied_at is distinct from old.applied_at)
    or not (old.state = new.state
      or old.state = 'processing' and new.state in ('needs_review', 'rejected', 'completed')
      or old.state = 'processing' and old.provider = 'bank_transfer' and new.state = 'awaiting_transfer'
      or old.state = 'needs_review' and new.state in ('processing', 'rejected', 'completed')
      or old.state = 'awaiting_transfer' and new.state = 'completed')
    or old.state in ('rejected', 'completed') and new is distinct from old
  then
    raise check_violation using message = 'partial_cancellation_immutable';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
revoke all on function private.guard_order_partial_cancellation() from public, anon, authenticated, service_role;
create trigger order_partial_cancellations_guard before update or delete on private.order_partial_cancellations
  for each row execute function private.guard_order_partial_cancellation();

create function private.guard_order_partial_cancellation_children() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise check_violation using message = 'partial_cancellation_immutable';
end $$;
revoke all on function private.guard_order_partial_cancellation_children() from public, anon, authenticated, service_role;
create trigger order_partial_cancellation_items_guard before update or delete on private.order_partial_cancellation_items
  for each row execute function private.guard_order_partial_cancellation_children();
create trigger order_partial_cancellation_shipments_guard before update or delete on private.order_partial_cancellation_shipments
  for each row execute function private.guard_order_partial_cancellation_children();

-- 3. 읽기 도우미. '적용됨' = 재고·배송 건·환불 의무에 반영됨(완료 또는 송금 대기). 부분 취소가 없으면 모두 0·false — 지금과 같다.
create function private.order_item_partially_canceled_qty(p_order_item_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(line.qty) from private.order_partial_cancellation_items line
    join private.order_partial_cancellations head on head.id = line.partial_cancellation_id
    where line.order_item_id = p_order_item_id and head.applied_at is not null), 0)::integer;
$$;
revoke all on function private.order_item_partially_canceled_qty(uuid) from public, anon, authenticated, service_role;

create function private.order_item_active_qty(p_order_item_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select (item.qty - private.order_item_partially_canceled_qty(item.id))::integer from public.order_items item where item.id = p_order_item_id;
$$;
revoke all on function private.order_item_active_qty(uuid) from public, anon, authenticated, service_role;

-- 적용된 부분 취소로 그 품목에서 빠진 금액(누적). 출고 파일·매출 보고가 남은 금액을 계산할 때 뺀다.
create function private.order_item_partial_cancel_totals(p_order_item_id uuid,
  out qty integer, out gross_amount bigint, out volume_discount bigint, out coupon_discount bigint,
  out store_credit_discount bigint, out paid_amount bigint)
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(line.qty), 0)::integer, coalesce(sum(line.gross_amount), 0)::bigint, coalesce(sum(line.volume_discount), 0)::bigint,
    coalesce(sum(line.coupon_discount), 0)::bigint, coalesce(sum(line.store_credit_discount), 0)::bigint,
    coalesce(sum(line.goods_refund_amount), 0)::bigint
  from private.order_partial_cancellation_items line
  join private.order_partial_cancellations head on head.id = line.partial_cancellation_id
  where line.order_item_id = p_order_item_id and head.applied_at is not null;
$$;
revoke all on function private.order_item_partial_cancel_totals(uuid) from public, anon, authenticated, service_role;

-- 결제 한 건에서 부분 취소로 이미 돌려줬거나(완료) 돌려줄 의무가 확정된(송금 대기) 금액. 뒤의 전액 취소·반품은 남은 잔액만 돌려준다.
create function private.payment_partial_refunded_amount(p_payment_id uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(head.refund_amount) from private.order_partial_cancellations head
    where head.payment_id = p_payment_id and head.applied_at is not null), 0)::bigint;
$$;
revoke all on function private.payment_partial_refunded_amount(uuid) from public, anon, authenticated, service_role;

create function private.order_partial_refunded_amount(p_order_id uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(head.refund_amount) from private.order_partial_cancellations head
    where head.order_id = p_order_id and head.applied_at is not null), 0)::bigint;
$$;
revoke all on function private.order_partial_refunded_amount(uuid) from public, anon, authenticated, service_role;

-- 굿즈 몫(배송비 제외)만. 적립 기준액(결제액 − 배송비)에서 뺀다.
create function private.order_partial_canceled_goods_amount(p_order_id uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(head.goods_refund_amount) from private.order_partial_cancellations head
    where head.order_id = p_order_id and head.applied_at is not null), 0)::bigint;
$$;
revoke all on function private.order_partial_canceled_goods_amount(uuid) from public, anon, authenticated, service_role;

create function private.shipment_closed_by_partial_cancel(p_shipment_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.order_partial_cancellation_shipments closed
    join private.order_partial_cancellations head on head.id = closed.partial_cancellation_id
    where closed.shipment_id = p_shipment_id and head.applied_at is not null);
$$;
revoke all on function private.shipment_closed_by_partial_cancel(uuid) from public, anon, authenticated, service_role;

-- 결제사 확인을 기다리는 부분 취소. 이 동안 그 주문의 출고지시·발송·다른 클레임을 막는다.
create function private.order_partial_cancel_in_flight(p_order_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.order_partial_cancellations head
    where head.order_id = p_order_id and head.state in ('processing', 'needs_review'));
$$;
revoke all on function private.order_partial_cancel_in_flight(uuid) from public, anon, authenticated, service_role;

-- 4. 판정. 주문 단위 막힘 이유(빈 배열이면 열 수 있다)와 품목 단위 막힘 이유.
create function private.order_partial_cancellation_payment(p_order_id uuid) returns public.payments
language sql stable security definer set search_path = '' as $$
  select p.* from public.payments p where p.purpose = 'order' and p.ref_id = p_order_id and p.status <> 'failed'
  order by p.created_at desc, p.id desc limit 1;
$$;
revoke all on function private.order_partial_cancellation_payment(uuid) from public, anon, authenticated, service_role;

create function private.order_partial_cancellation_blockers(p_order_id uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare purchase public.orders; pay public.payments; payment_count integer; blockers text[] := array[]::text[];
begin
  if not private.order_partial_cancel_enabled() then blockers := array_append(blockers, 'partial_cancel_disabled'); end if;
  select * into purchase from public.orders where id = p_order_id;
  if not found then return array_append(blockers, 'order_not_found'); end if;
  if purchase.status not in ('paid', 'confirmed') or purchase.shipped_at is not null or purchase.delivered_at is not null or purchase.done_at is not null then
    blockers := array_append(blockers, 'order_not_partial_cancelable');
  end if;
  if exists(select 1 from public.order_shipments s where s.order_id = p_order_id
      and (s.status not in ('ready', 'canceled') or s.shipped_at is not null or s.delivered_at is not null)) then
    blockers := array_append(blockers, 'shipment_already_dispatched');
  end if;
  if exists(select 1 from public.order_cancellation_requests r where r.order_id = p_order_id and r.status in ('requested', 'processing', 'needs_review'))
    or exists(select 1 from public.order_cancellation_claims c where c.order_id = p_order_id) then
    blockers := array_append(blockers, 'order_claim_in_progress');
  end if;
  if private.order_partial_cancel_in_flight(p_order_id) then blockers := array_append(blockers, 'partial_cancel_in_progress'); end if;
  if exists(select 1 from public.payment_attempts a where a.purpose = 'order' and a.ref_id = p_order_id
      and a.state in ('prepared', 'confirming', 'unknown', 'needs_review')) then
    blockers := array_append(blockers, 'payment_reconciliation_required');
  end if;
  if purchase.calculation_version is distinct from 2 then blockers := array_append(blockers, 'legacy_order'); end if;
  if exists(select 1 from private.gift_intents g where g.order_id = p_order_id) then blockers := array_append(blockers, 'gift_order'); end if;
  select count(*) into payment_count from public.payments p where p.purpose = 'order' and p.ref_id = p_order_id and p.status <> 'failed';
  pay := private.order_partial_cancellation_payment(p_order_id);
  if payment_count <> 1 or pay.id is null or pay.status <> 'paid' or pay.amount <= 0 or pay.amount <> purchase.total then
    blockers := array_append(blockers, 'payment_unavailable');
  elsif pay.provider not in ('toss', 'bank_transfer')
    or pay.provider = 'toss' and nullif(btrim(pay.payment_key), '') is null
    -- 정기배송(billing) 결제는 결제사 부분 취소 계약이 없다.
    or exists(select 1 from public.payment_attempts a join private.payment_provider_bindings b on b.attempt_id = a.id
      where a.purpose = 'order' and a.ref_id = p_order_id)
    -- 토스 가상계좌는 입금 전 부분 취소가 없고 환불계좌 경로가 다르다.
    or pay.provider = 'toss' and exists(select 1 from public.payment_attempts a
      join private.payment_provider_evidence e on e.payment_attempt_id = a.id
      where a.purpose = 'order' and a.ref_id = p_order_id and (e.payment_method = '가상계좌' or e.result_code = 'DONE_virtual_account')) then
    blockers := array_append(blockers, 'partial_cancel_unsupported');
  end if;
  return blockers;
end $$;
revoke all on function private.order_partial_cancellation_blockers(uuid) from public, anon, authenticated, service_role;

create function private.order_partial_cancellation_item_blocker(p_order_item_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare item public.order_items; physical record; target record; link public.order_shipment_items; active integer;
begin
  select * into item from public.order_items where id = p_order_item_id;
  if not found then return 'order_item_not_found'; end if;
  active := private.order_item_active_qty(item.id);
  if active <= 0 then return 'fully_canceled'; end if;
  if item.supply_source <> 'stock' then return 'preorder_item'; end if;
  if item.production_terms_snapshot is not null or exists(select 1 from private.order_production_jobs j where j.order_item_id = item.id) then
    return 'production_item';
  end if;
  if coalesce(item.fulfillment_terms_snapshot->>'mode', '') in ('digital', 'no_delivery') then return 'digital_item'; end if;
  if not exists(select 1 from private.order_price_allocations a where a.order_item_id = item.id and a.order_id = item.order_id) then
    return 'allocation_missing';
  end if;
  select * into link from public.order_shipment_items where order_item_id = item.id and order_id = item.order_id;
  if not found or link.qty <> active then return 'shipment_missing'; end if;
  if exists(select 1 from public.order_shipments s where s.id = link.shipment_id and (s.status <> 'ready' or s.delivery_method = 'digital')) then
    return 'shipment_missing';
  end if;
  -- 상품 통합(재고 승계)·교환 재출고 배정 이력이 있는 품목은 재고 복원 단위가 품목 전체라 수량 단위로 나누지 않는다.
  select * into physical from private.order_item_physical_unit(item.id);
  select * into target from private.resolve_goods_stock_successor(physical.good_id, physical.variant_id);
  if target.hop_count > 0 or physical.good_id <> item.good_id
    or exists(select 1 from private.group_claim_reshipment_allocations where order_item_id = item.id) then
    return 'stock_topology_changed';
  end if;
  return null;
end $$;
revoke all on function private.order_partial_cancellation_item_blocker(uuid) from public, anon, authenticated, service_role;

-- 누적 비례 배분: 품목 수량 Q 중 c개가 취소됐을 때까지 빠진 몫. c = Q면 정확히 전부다(나눠 취소해도 합이 맞다).
create function private.partial_cancel_prorate(p_amount bigint, p_canceled integer, p_qty integer) returns bigint
language sql immutable set search_path = '' as $$
  select case when p_canceled >= p_qty then p_amount
    else floor(p_amount::numeric * p_canceled::numeric / p_qty::numeric)::bigint end;
$$;
revoke all on function private.partial_cancel_prorate(bigint, integer, integer) from public, anon, authenticated, service_role;

-- 5. 계산(읽기 전용). 확인창 미리보기와 시작이 같은 함수를 쓴다. 입력·판정이 맞지 않으면 사유 코드로 거절한다.
create function private.order_partial_cancellation_plan(p_order_id uuid, p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  blockers text[]; purchase public.orders; pay public.payments; entry jsonb; item public.order_items; allocation private.order_price_allocations;
  link public.order_shipment_items; ship public.order_shipments; item_blocker text; qty integer; canceled_before integer; canceled_after integer;
  lines jsonb := '[]'::jsonb; closed jsonb := '[]'::jsonb; touched uuid[] := array[]::uuid[]; seen uuid[] := array[]::uuid[];
  goods bigint := 0; shipping bigint := 0; credit bigint := 0; balance bigint; line_paid bigint; line_volume bigint; line_coupon bigint;
  line_credit bigint; stop_required boolean := false; remaining integer; shipment_left integer; ship_id uuid;
begin
  blockers := private.order_partial_cancellation_blockers(p_order_id);
  if cardinality(blockers) > 0 then raise check_violation using message = blockers[1]; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise invalid_parameter_value using message = 'invalid_partial_cancel_items';
  end if;
  select * into purchase from public.orders where id = p_order_id;
  pay := private.order_partial_cancellation_payment(p_order_id);
  for entry in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(entry) <> 'object' or (select count(*) from jsonb_object_keys(entry)) <> 2 or not entry ?& array['orderItemId', 'qty']
      or jsonb_typeof(entry->'orderItemId') <> 'string' or coalesce(entry->>'orderItemId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(entry->'qty') <> 'number' or coalesce(entry->>'qty', '') !~ '^[1-9][0-9]{0,5}$' then
      raise invalid_parameter_value using message = 'invalid_partial_cancel_items';
    end if;
    if (entry->>'orderItemId')::uuid = any(seen) then raise invalid_parameter_value using message = 'invalid_partial_cancel_items'; end if;
    seen := seen || (entry->>'orderItemId')::uuid;
    select * into item from public.order_items where id = (entry->>'orderItemId')::uuid and order_id = p_order_id;
    if not found then raise check_violation using message = 'partial_cancel_item_not_found'; end if;
    item_blocker := private.order_partial_cancellation_item_blocker(item.id);
    if item_blocker is not null then raise check_violation using message = 'partial_cancel_item_' || item_blocker; end if;
    qty := (entry->>'qty')::integer;
    canceled_before := private.order_item_partially_canceled_qty(item.id);
    if qty > item.qty - canceled_before then raise check_violation using message = 'partial_cancel_qty_exceeds_remaining'; end if;
    canceled_after := canceled_before + qty;
    select * into allocation from private.order_price_allocations where order_item_id = item.id and order_id = p_order_id;
    select * into link from public.order_shipment_items where order_item_id = item.id and order_id = p_order_id;
    select * into ship from public.order_shipments where id = link.shipment_id;
    line_paid := private.partial_cancel_prorate(allocation.paid_goods_total, canceled_after, item.qty)
      - private.partial_cancel_prorate(allocation.paid_goods_total, canceled_before, item.qty);
    line_volume := private.partial_cancel_prorate(allocation.volume_discount, canceled_after, item.qty)
      - private.partial_cancel_prorate(allocation.volume_discount, canceled_before, item.qty);
    line_coupon := private.partial_cancel_prorate(allocation.coupon_discount, canceled_after, item.qty)
      - private.partial_cancel_prorate(allocation.coupon_discount, canceled_before, item.qty);
    line_credit := private.partial_cancel_prorate(allocation.store_credit_discount, canceled_after, item.qty)
      - private.partial_cancel_prorate(allocation.store_credit_discount, canceled_before, item.qty);
    goods := goods + line_paid;
    credit := credit + line_credit;
    if ship.exported_at is not null then stop_required := true; end if;
    if not ship.id = any(touched) then touched := touched || ship.id; end if;
    lines := lines || jsonb_build_object('orderItemId', item.id, 'shipmentId', ship.id, 'shipmentNumber', ship.shipment_number,
      'originName', ship.origin_name_snapshot, 'exported', ship.exported_at is not null,
      'goodName', item.good_name_snapshot, 'variantName', item.variant_name_snapshot, 'variantCode', item.variant_code_snapshot,
      'qty', qty, 'orderedQty', item.qty, 'canceledQtyBefore', canceled_before, 'remainingQtyAfter', item.qty - canceled_after,
      'grossAmount', qty::bigint * item.unit_price - line_volume, 'volumeDiscount', line_volume, 'couponDiscount', line_coupon,
      'storeCreditDiscount', line_credit, 'goodsRefundAmount', line_paid);
  end loop;
  -- 배송 건에 남는 품목이 없으면 그 배송 건을 닫고 선결제 배송비를 함께 돌려준다.
  foreach ship_id in array touched loop
    select coalesce(sum(l.qty), 0) - coalesce((select sum((x->>'qty')::integer) from jsonb_array_elements(lines) x
        where (x->>'shipmentId')::uuid = ship_id), 0)
      into shipment_left from public.order_shipment_items l where l.shipment_id = ship_id;
    if shipment_left = 0 then
      select * into ship from public.order_shipments where id = ship_id;
      shipping := shipping + ship.shipping_fee;
      closed := closed || jsonb_build_object('shipmentId', ship.id, 'shipmentNumber', ship.shipment_number, 'originName', ship.origin_name_snapshot,
        'shippingFeeRefund', ship.shipping_fee, 'shippingCollectFee', ship.shipping_collect_fee, 'exported', ship.exported_at is not null);
    end if;
  end loop;
  select coalesce(sum(l.qty), 0) - coalesce((select sum((x->>'qty')::integer) from jsonb_array_elements(lines) x), 0)
    into remaining from public.order_shipment_items l where l.order_id = p_order_id;
  if remaining <= 0 then raise check_violation using message = 'partial_cancel_leaves_nothing'; end if;
  balance := pay.amount - private.payment_partial_refunded_amount(pay.id);
  if goods + shipping <= 0 then raise check_violation using message = 'partial_cancel_refund_zero'; end if;
  if balance - (goods + shipping) <= 0 then raise check_violation using message = 'partial_cancel_remaining_balance_zero'; end if;
  return jsonb_build_object('orderId', p_order_id, 'orderNumber', purchase.order_number, 'paymentId', pay.id, 'provider', pay.provider,
    'paymentAmount', pay.amount, 'balanceBefore', balance, 'goodsRefundAmount', goods, 'shippingRefundAmount', shipping,
    'refundAmount', goods + shipping, 'balanceAfter', balance - goods - shipping, 'storeCreditRestoreAmount', credit,
    'warehouseStopRequired', stop_required, 'remainingQty', remaining, 'lines', lines, 'closedShipments', closed);
end $$;
revoke all on function private.order_partial_cancellation_plan(uuid, jsonb) from public, anon, authenticated, service_role;

-- 6. 수량 단위 재고 복원(재고 품목·통합 이력 없음만). 주문 전체 취소의 복원(restore_order_item_supply)은 다음 migration에서
--    이미 부분 취소로 복원한 수량을 빼고 남은 수량만 복원하도록 바뀐다.
create function private.restore_order_item_partial_supply(p_order_item_id uuid, p_qty integer, p_partial_cancellation_id uuid, p_reason text)
returns void language plpgsql set search_path = '' as $$
declare item public.order_items; physical record; target record;
begin
  select * into item from public.order_items where id = p_order_item_id;
  if not found then raise no_data_found using message = 'order_item_not_found'; end if;
  if p_qty is null or p_qty <= 0 then raise invalid_parameter_value using message = 'invalid_partial_cancel_items'; end if;
  perform 1 from public.orders where id = item.order_id for update;
  perform private.lock_goods_stock_successor_topology();
  select * into physical from private.order_item_physical_unit(item.id);
  select * into target from private.resolve_goods_stock_successor(physical.good_id, physical.variant_id);
  perform 1 from public.goods where id = any(array[item.good_id, physical.good_id, target.good_id]) order by id for update nowait;
  perform 1 from public.goods_variants where id = any(array[item.variant_id, physical.variant_id, target.variant_id]) order by id for update nowait;
  if item.supply_source <> 'stock' or target.hop_count > 0 or physical.good_id <> item.good_id
    or exists(select 1 from private.group_claim_reshipment_allocations where order_item_id = item.id) then
    raise check_violation using message = 'partial_cancel_item_stock_topology_changed';
  end if;
  perform private.apply_group_physical_stock_deltas(jsonb_build_array(jsonb_build_object('goodId', target.good_id, 'variantId', target.variant_id, 'delta', p_qty)));
  insert into public.audit_log(actor_id, action, target, diff) values(auth.uid(), 'order.option_stock_restored', 'order:' || item.order_id::text,
    jsonb_build_object('orderItemId', item.id, 'goodId', target.good_id, 'variantId', target.variant_id, 'delta', p_qty,
      'originalGoodId', item.good_id, 'originalVariantId', item.variant_id, 'physicalGoodId', physical.good_id, 'physicalVariantId', physical.variant_id,
      'generationKind', physical.generation_kind, 'generationId', physical.generation_id, 'operationPath', target.operation_path,
      'supplySource', item.supply_source, 'preorderPolicyId', item.preorder_policy_id, 'reason', p_reason,
      'partialCancellationId', p_partial_cancellation_id));
exception when lock_not_available then raise sqlstate 'PT409' using message = 'goods_group_retry';
end $$;
revoke all on function private.restore_order_item_partial_supply(uuid, integer, uuid, text) from public, anon, authenticated, service_role;

-- 7. 취소한 품목에 배분된 적립금 몫을 적립금으로 되돌린다. 주문 전체 취소의 되돌림(release_order_store_credits)과 같은 방식이고,
--    사용 배정(store_credit_allocations)의 금액을 그만큼 줄여 뒤의 전체 취소가 남은 몫만 되돌리게 한다.
create function private.restore_order_store_credit_portion(p_order_id uuid, p_user_id uuid, p_amount bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare allocation private.store_credit_allocations; lot private.store_credit_lots; root private.store_credit_lots;
  release_at timestamptz := clock_timestamp(); expires timestamptz; take bigint; debt_reduction bigint; restored bigint; left_amount bigint := p_amount;
begin
  if p_amount is null or p_amount <= 0 then return 0; end if;
  perform private.lock_store_credit_account(p_user_id);
  perform private.expire_store_credit_lots(p_user_id, release_at);
  for allocation in select * from private.store_credit_allocations where order_id = p_order_id and state = 'consumed' order by lot_id for update loop
    exit when left_amount <= 0;
    take := least(left_amount, allocation.amount);
    select * into lot from private.store_credit_lots where id = allocation.lot_id for update;
    if not found or lot.user_id <> p_user_id or allocation.user_id <> p_user_id then
      raise check_violation using message = 'store_credit_allocation_mismatch';
    end if;
    expires := case when allocation.original_expires_at > release_at then allocation.original_expires_at
      else release_at + make_interval(days => allocation.restore_grace_days) end;
    if lot.revoked_at is not null then
      select * into root from private.store_credit_lots where id = lot.root_lot_id for update;
      debt_reduction := least(take, root.debt_amount);
      update private.store_credit_lots set debt_amount = debt_amount - debt_reduction where id = root.id;
      update private.store_credit_lots set spent_amount = spent_amount - take, revoked_amount = revoked_amount + take where id = lot.id;
      insert into public.store_credit_ledger(user_id, kind, amount, reserved_delta, debt_delta, order_id, lot_id)
        values(p_user_id, 'restore', 0, 0, -debt_reduction, p_order_id, lot.id);
      restored := take - debt_reduction;
      if restored > 0 then perform private.issue_store_credit_lot(p_user_id, restored, expires, 'restoration', p_order_id, null, null, ''); end if;
    else
      update private.store_credit_lots set spent_amount = spent_amount - take, transferred_amount = transferred_amount + take where id = lot.id;
      perform private.issue_store_credit_lot(p_user_id, take, expires, 'restoration', p_order_id, null, null, '', lot.root_lot_id);
    end if;
    if take = allocation.amount then
      update private.store_credit_allocations set state = 'released', released_at = release_at where order_id = p_order_id and lot_id = lot.id;
    else
      update private.store_credit_allocations set amount = amount - take where order_id = p_order_id and lot_id = lot.id;
    end if;
    left_amount := left_amount - take;
  end loop;
  if left_amount > 0 then raise check_violation using message = 'store_credit_allocation_mismatch'; end if;
  perform private.expire_store_credit_lots(p_user_id, release_at);
  return p_amount;
end $$;
revoke all on function private.restore_order_store_credit_portion(uuid, uuid, bigint) from public, anon, authenticated, service_role;

create function private.partial_cancellation_items_label(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(format('%s%s %s개', item.good_name_snapshot,
      case when item.option_sale_mode_snapshot = 'random' or nullif(item.variant_name_snapshot, '') is null then ''
        else ' (' || item.variant_name_snapshot || ')' end, line.qty), ', ' order by item.good_name_snapshot, item.id)
  from private.order_partial_cancellation_items line join public.order_items item on item.id = line.order_item_id
  where line.partial_cancellation_id = p_id;
$$;
revoke all on function private.partial_cancellation_items_label(uuid) from public, anon, authenticated, service_role;

create function private.notify_order_partial_cancellation(p_id uuid, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare head private.order_partial_cancellations; purchase public.orders; label text; body text; title text;
begin
  select * into head from private.order_partial_cancellations where id = p_id;
  select * into purchase from public.orders where id = head.order_id;
  label := left(coalesce(private.partial_cancellation_items_label(p_id), '일부 굿즈'), 200);
  if p_event = 'applied' then
    title := '주문 일부가 취소됐어요';
    body := format('재고가 부족해 %s를 취소했습니다. %s', label,
      case when head.provider = 'bank_transfer'
        then format('환불 %s은 등록하신 환불계좌로 송금해 드립니다. 나머지 굿즈는 그대로 보내드립니다.', private.format_krw(head.refund_amount))
        else format('%s을 결제사에서 부분 취소했습니다(카드사 처리에 영업일 기준 3~4일). 나머지 굿즈는 그대로 보내드립니다.', private.format_krw(head.refund_amount)) end);
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
end $$;
revoke all on function private.notify_order_partial_cancellation(uuid, text) from public, anon, authenticated, service_role;

-- 8. 적용: 결제사 확인 뒤(토스) 또는 시작 때(무통장) 한 트랜잭션에서 재고·배송 건·적립금·카드팩을 바꾼다. 호출자가 주문을 잠근다.
create function private.apply_order_partial_cancellation(p_id uuid, p_actor uuid, p_next_state text) returns void
language plpgsql security definer set search_path = '' as $$
declare head private.order_partial_cancellations; purchase public.orders; line record; ship_id uuid; obligation private.shipping_collect_obligations;
  policy record; remaining numeric;
begin
  select * into head from private.order_partial_cancellations where id = p_id for update;
  if not found then raise no_data_found using message = 'partial_cancellation_not_found'; end if;
  if head.applied_at is not null then return; end if;
  if p_next_state not in ('completed', 'awaiting_transfer') then raise invalid_parameter_value using message = 'invalid_partial_cancel_state'; end if;
  select * into purchase from public.orders where id = head.order_id for update;
  perform s.id from public.order_shipments s where s.order_id = head.order_id order by s.id for update;
  if purchase.status not in ('paid', 'confirmed') or purchase.shipped_at is not null or purchase.delivered_at is not null
    or exists(select 1 from public.order_shipments s where s.order_id = head.order_id
      and (s.status not in ('ready', 'canceled') or s.shipped_at is not null or s.delivered_at is not null)) then
    raise check_violation using message = 'partial_cancel_state_changed';
  end if;
  for line in select l.*, link.qty as link_qty, link.shipment_id as link_shipment
    from private.order_partial_cancellation_items l
    left join public.order_shipment_items link on link.order_item_id = l.order_item_id and link.order_id = l.order_id
    where l.partial_cancellation_id = p_id order by l.order_item_id loop
    if line.link_qty is null or line.link_shipment <> line.shipment_id or line.link_qty < line.qty
      or private.order_item_partially_canceled_qty(line.order_item_id) <> line.canceled_qty_before then
      raise check_violation using message = 'partial_cancel_state_changed';
    end if;
  end loop;
  update private.order_partial_cancellations set state = p_next_state, applied_at = clock_timestamp(),
    completed_at = case when p_next_state = 'completed' then clock_timestamp() else completed_at end, last_error_code = null
  where id = p_id;
  for line in select * from private.order_partial_cancellation_items where partial_cancellation_id = p_id order by order_item_id loop
    delete from public.order_shipment_items where order_item_id = line.order_item_id and order_id = line.order_id and qty = line.qty;
    if not found then
      update public.order_shipment_items set qty = qty - line.qty where order_item_id = line.order_item_id and order_id = line.order_id;
    end if;
    perform private.restore_order_item_partial_supply(line.order_item_id, line.qty, p_id, '재고 부족 부분 취소');
  end loop;
  for ship_id in select shipment_id from private.order_partial_cancellation_shipments where partial_cancellation_id = p_id order by shipment_id loop
    if exists(select 1 from public.order_shipment_items where shipment_id = ship_id) then
      raise check_violation using message = 'partial_cancel_state_changed';
    end if;
    update public.order_shipments set status = 'canceled', updated_at = now() where id = ship_id and status = 'ready';
    select * into obligation from private.shipping_collect_obligations where shipment_id = ship_id for update;
    if found and obligation.state = 'planned' then
      update private.shipping_collect_obligations set state = 'void', revision = revision + 1, updated_at = clock_timestamp() where shipment_id = ship_id;
      insert into private.shipping_collect_events(operation_id, shipment_id, event, amount, evidence, previous_state, previous_revision)
      values (extensions.gen_random_uuid(), ship_id, 'void', 0,
        jsonb_build_object('orderId', head.order_id, 'reason', 'shipment_partially_canceled_before_dispatch', 'partialCancellationId', p_id),
        obligation.state, obligation.revision);
    end if;
  end loop;
  if head.store_credit_restore_amount > 0 then
    perform private.restore_order_store_credit_portion(head.order_id, purchase.user_id, head.store_credit_restore_amount);
  end if;
  -- 카드팩: 남은 수량의 대상 금액이 그 정책의 최소 금액에 못 미치면 열지 않은 카드팩을 회수한다(열어 본 것은 그대로).
  for policy in select distinct rp.id, rp.target_ip_id, rp.target_good_id, rp.min_amount
    from public.draw_tickets t join public.reward_policies rp on rp.id = t.reward_policy_id
    where t.source = 'order_paid' and t.source_id = head.order_id and t.consumed_at is null and t.revoked_at is null loop
    select coalesce(sum(private.order_item_active_qty(i.id)::numeric * i.unit_price), 0) into remaining
    from public.order_items i where i.order_id = head.order_id and i.good_ip_id_snapshot = policy.target_ip_id
      and (policy.target_good_id is null or i.good_id = policy.target_good_id);
    if remaining < policy.min_amount then
      perform t.id from public.draw_tickets t where t.source = 'order_paid' and t.source_id = head.order_id
        and t.reward_policy_id = policy.id and t.consumed_at is null and t.revoked_at is null order by t.id for update;
      update public.draw_tickets set revoked_at = now() where source = 'order_paid' and source_id = head.order_id
        and reward_policy_id = policy.id and consumed_at is null and revoked_at is null;
    end if;
  end loop;
  insert into public.audit_log(actor_id, action, target, diff)
  values (p_actor, 'admin.order.partial_cancellation_applied', 'order:' || head.order_id::text,
    jsonb_build_object('partialCancellationId', p_id, 'state', p_next_state, 'provider', head.provider, 'refundAmount', head.refund_amount,
      'goodsRefundAmount', head.goods_refund_amount, 'shippingRefundAmount', head.shipping_refund_amount,
      'storeCreditRestoreAmount', head.store_credit_restore_amount,
      'lines', (select jsonb_agg(jsonb_build_object('orderItemId', l.order_item_id, 'shipmentId', l.shipment_id, 'qty', l.qty,
        'goodsRefundAmount', l.goods_refund_amount) order by l.order_item_id) from private.order_partial_cancellation_items l where l.partial_cancellation_id = p_id),
      'closedShipments', coalesce((select jsonb_agg(c.shipment_id order by c.shipment_id) from private.order_partial_cancellation_shipments c
        where c.partial_cancellation_id = p_id), '[]'::jsonb)));
  perform private.notify_order_partial_cancellation(p_id, 'applied');
end $$;
revoke all on function private.apply_order_partial_cancellation(uuid, uuid, text) from public, anon, authenticated, service_role;

-- 9. 화면이 읽는 모양.
create function private.order_partial_cancellation_json(p_id uuid, p_staff boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', head.id, 'sequence', head.sequence, 'state', head.state, 'provider', head.provider,
    'refundAmount', head.refund_amount, 'goodsRefundAmount', head.goods_refund_amount, 'shippingRefundAmount', head.shipping_refund_amount,
    'storeCreditRestoreAmount', head.store_credit_restore_amount, 'createdAt', head.created_at, 'appliedAt', head.applied_at,
    'completedAt', head.completed_at, 'transferredAt', head.transferred_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('orderItemId', line.order_item_id, 'goodName', item.good_name_snapshot,
        'variantName', case when not p_staff and item.option_sale_mode_snapshot = 'random' then null else item.variant_name_snapshot end,
        'qty', line.qty, 'goodsRefundAmount', line.goods_refund_amount) order by item.good_name_snapshot, item.id)
      from private.order_partial_cancellation_items line join public.order_items item on item.id = line.order_item_id
      where line.partial_cancellation_id = head.id), '[]'::jsonb),
    'closedShipmentCount', (select count(*) from private.order_partial_cancellation_shipments c where c.partial_cancellation_id = head.id))
  || case when p_staff then jsonb_build_object('customerDecision', head.customer_decision, 'note', head.note,
      'warehouseStopConfirmed', head.warehouse_stop_confirmed, 'lastErrorCode', head.last_error_code, 'balanceBefore', head.balance_before,
      'paymentAmount', head.payment_amount, 'createdBy', (select nickname from public.profiles where id = head.created_by),
      'transferEvidence', head.transfer_evidence, 'transferNote', head.transfer_note,
      'closedShipments', coalesce((select jsonb_agg(jsonb_build_object('shipmentId', s.id, 'shipmentNumber', s.shipment_number,
          'originName', s.origin_name_snapshot, 'shippingFeeRefund', c.shipping_fee_refund) order by s.shipment_number)
        from private.order_partial_cancellation_shipments c join public.order_shipments s on s.id = c.shipment_id
        where c.partial_cancellation_id = head.id), '[]'::jsonb),
      'refundAccount', (select jsonb_build_object('maskedAccount', a.masked_account, 'maskedHolder', a.masked_holder, 'purged', a.purged_at is not null)
        from private.order_partial_cancellation_refund_accounts a where a.partial_cancellation_id = head.id))
    else '{}'::jsonb end
  from private.order_partial_cancellations head where head.id = p_id;
$$;
revoke all on function private.order_partial_cancellation_json(uuid, boolean) from public, anon, authenticated, service_role;

-- 10. 운영자 RPC.
-- 10-1. 주문 상세 패널. 스위치가 꺼져 있고 기록이 없으면 {enabled:false, history:[]} — 화면은 아무것도 그리지 않는다.
-- 운영자 능력 검사가 행 잠금을 쓰므로 PostgREST 읽기 전용 트랜잭션에 걸리지 않게 VOLATILE이다(cs_reply_read_transaction_mode).
create function public.admin_order_partial_cancellation_context(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare enabled boolean; blockers text[]; history jsonb; pay public.payments; items jsonb;
begin
  perform private.require_operator_capability('sales.manage', false);
  enabled := private.order_partial_cancel_enabled();
  select coalesce(jsonb_agg(private.order_partial_cancellation_json(head.id, true) order by head.sequence), '[]'::jsonb) into history
  from private.order_partial_cancellations head where head.order_id = p_order_id;
  if not enabled then
    return jsonb_build_object('enabled', false, 'blockers', jsonb_build_array('partial_cancel_disabled'), 'history', history);
  end if;
  if not exists(select 1 from public.orders where id = p_order_id) then raise no_data_found using message = 'order_not_found'; end if;
  blockers := private.order_partial_cancellation_blockers(p_order_id);
  pay := private.order_partial_cancellation_payment(p_order_id);
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId', item.id, 'goodName', item.good_name_snapshot, 'variantName', item.variant_name_snapshot,
      'variantCode', item.variant_code_snapshot, 'orderedQty', item.qty, 'canceledQty', private.order_item_partially_canceled_qty(item.id),
      'activeQty', private.order_item_active_qty(item.id), 'unitPrice', item.unit_price,
      'shipmentId', link.shipment_id, 'shipmentNumber', ship.shipment_number, 'originName', ship.origin_name_snapshot,
      'exported', ship.exported_at is not null, 'blocker', private.order_partial_cancellation_item_blocker(item.id))
    order by ship.shipment_number nulls last, item.good_name_snapshot, item.id), '[]'::jsonb) into items
  from public.order_items item
  left join public.order_shipment_items link on link.order_item_id = item.id and link.order_id = item.order_id
  left join public.order_shipments ship on ship.id = link.shipment_id
  where item.order_id = p_order_id;
  return jsonb_build_object('enabled', true, 'blockers', to_jsonb(blockers), 'provider', pay.provider, 'paymentAmount', pay.amount,
    'balance', case when pay.id is null then null else pay.amount - private.payment_partial_refunded_amount(pay.id) end,
    'items', items, 'history', history);
end $$;
revoke all on function public.admin_order_partial_cancellation_context(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_order_partial_cancellation_context(uuid) to authenticated;

-- 10-2. 확인창 미리보기(읽기 전용). 시작과 같은 계산이다.
create function public.admin_preview_order_partial_cancellation(p_order_id uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_operator_capability('sales.manage', false);
  return private.order_partial_cancellation_plan(p_order_id, p_items);
end $$;
revoke all on function public.admin_preview_order_partial_cancellation(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_preview_order_partial_cancellation(uuid, jsonb) to authenticated;

-- 10-3. 시작. 같은 operation_id 재전송은 같은 결과다. 토스는 processing(결제사 확인 대기), 무통장은 바로 적용 + 송금 대기.
create function public.admin_start_order_partial_cancellation(p_order_id uuid, p_items jsonb, p_customer_decision text, p_note text,
  p_warehouse_stop_confirmed boolean, p_expected_refund_amount bigint, p_operation_id uuid, p_refund_account jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); decision text := nullif(btrim(coalesce(p_customer_decision, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), ''); existing private.order_partial_cancellations; plan jsonb; v_id uuid;
  v_sequence integer; line jsonb; closed jsonb; v_state text;
begin
  perform private.require_actor_operator_capability(v_actor, 'sales.manage', false);
  if p_operation_id is null then raise invalid_parameter_value using message = 'invalid_partial_cancel_operation'; end if;
  if decision is null or char_length(decision) not between 2 and 500 or translate(decision, E'\n\r\t', '') ~ '[[:cntrl:]]' then
    raise check_violation using message = 'partial_cancel_customer_decision_required';
  end if;
  if v_note is not null and (char_length(v_note) > 500 or translate(v_note, E'\n\r\t', '') ~ '[[:cntrl:]]') then
    raise check_violation using message = 'invalid_partial_cancel_note';
  end if;
  -- 공통 잠금 순서: order → shipments → attempts → payments → 부분 취소 원장.
  perform 1 from public.orders where id = p_order_id for update;
  if not found then raise no_data_found using message = 'order_not_found'; end if;
  select * into existing from private.order_partial_cancellations where operation_id = p_operation_id;
  if found then
    if existing.order_id <> p_order_id or existing.created_by <> v_actor then
      raise unique_violation using message = 'partial_cancel_operation_conflict';
    end if;
    return jsonb_build_object('id', existing.id, 'state', existing.state, 'provider', existing.provider, 'refundAmount', existing.refund_amount, 'replayed', true);
  end if;
  perform s.id from public.order_shipments s where s.order_id = p_order_id order by s.id for update;
  perform a.id from public.payment_attempts a where a.purpose = 'order' and a.ref_id = p_order_id order by a.id for update;
  perform p.id from public.payments p where p.purpose = 'order' and p.ref_id = p_order_id order by p.id for update;
  plan := private.order_partial_cancellation_plan(p_order_id, p_items);
  if p_expected_refund_amount is distinct from (plan->>'refundAmount')::bigint then
    raise check_violation using message = 'partial_cancel_amount_changed';
  end if;
  if (plan->>'warehouseStopRequired')::boolean and p_warehouse_stop_confirmed is distinct from true then
    raise check_violation using message = 'warehouse_stop_confirmation_required';
  end if;
  if plan->>'provider' = 'bank_transfer' then
    if p_refund_account is null or jsonb_typeof(p_refund_account) <> 'object' or (select count(*) from jsonb_object_keys(p_refund_account)) <> 3
      or not p_refund_account ?& array['bankName', 'accountNumber', 'accountHolder']
      or coalesce(p_refund_account->>'bankName', '') !~ '^\S(.{0,38}\S)?$' or coalesce(p_refund_account->>'accountNumber', '') !~ '^[0-9-]{8,30}$'
      or coalesce(p_refund_account->>'accountHolder', '') !~ '^\S(.{0,38}\S)?$'
      or (p_refund_account->>'bankName') ~ '[[:cntrl:]]' or (p_refund_account->>'accountHolder') ~ '[[:cntrl:]]' then
      raise check_violation using message = 'partial_cancel_refund_account_required';
    end if;
  elsif p_refund_account is not null and p_refund_account <> 'null'::jsonb then
    raise check_violation using message = 'partial_cancel_refund_account_not_allowed';
  end if;
  select coalesce(max(sequence), 0) + 1 into v_sequence from private.order_partial_cancellations where order_id = p_order_id;
  v_state := case when plan->>'provider' = 'bank_transfer' then 'awaiting_transfer' else 'processing' end;
  insert into private.order_partial_cancellations(order_id, payment_id, provider, sequence, reason_code, customer_decision, note,
    warehouse_stop_confirmed, payment_amount, balance_before, goods_refund_amount, shipping_refund_amount, refund_amount,
    store_credit_restore_amount, state, operation_id, created_by)
  values (p_order_id, (plan->>'paymentId')::uuid, (plan->>'provider')::public.payment_provider, v_sequence, 'out_of_stock', decision, v_note,
    (plan->>'warehouseStopRequired')::boolean, (plan->>'paymentAmount')::bigint, (plan->>'balanceBefore')::bigint,
    (plan->>'goodsRefundAmount')::bigint, (plan->>'shippingRefundAmount')::bigint, (plan->>'refundAmount')::bigint,
    (plan->>'storeCreditRestoreAmount')::bigint, 'processing', p_operation_id, v_actor)
  returning id into v_id;
  for line in select value from jsonb_array_elements(plan->'lines') loop
    insert into private.order_partial_cancellation_items(partial_cancellation_id, order_id, order_item_id, shipment_id, qty, canceled_qty_before,
      gross_amount, volume_discount, coupon_discount, store_credit_discount, goods_refund_amount)
    values (v_id, p_order_id, (line->>'orderItemId')::uuid, (line->>'shipmentId')::uuid, (line->>'qty')::integer, (line->>'canceledQtyBefore')::integer,
      (line->>'grossAmount')::bigint, (line->>'volumeDiscount')::bigint, (line->>'couponDiscount')::bigint,
      (line->>'storeCreditDiscount')::bigint, (line->>'goodsRefundAmount')::bigint);
  end loop;
  for closed in select value from jsonb_array_elements(plan->'closedShipments') loop
    insert into private.order_partial_cancellation_shipments(partial_cancellation_id, order_id, shipment_id, shipping_fee_refund)
    values (v_id, p_order_id, (closed->>'shipmentId')::uuid, (closed->>'shippingFeeRefund')::bigint);
  end loop;
  insert into public.audit_log(actor_id, action, target, diff)
  values (v_actor, 'admin.order.partial_cancellation_started', 'order:' || p_order_id::text,
    jsonb_build_object('partialCancellationId', v_id, 'sequence', v_sequence, 'provider', plan->>'provider', 'reasonCode', 'out_of_stock',
      'customerDecision', decision, 'note', v_note, 'warehouseStopConfirmed', (plan->>'warehouseStopRequired')::boolean,
      'refundAmount', (plan->>'refundAmount')::bigint, 'goodsRefundAmount', (plan->>'goodsRefundAmount')::bigint,
      'shippingRefundAmount', (plan->>'shippingRefundAmount')::bigint, 'balanceBefore', (plan->>'balanceBefore')::bigint,
      'lines', plan->'lines', 'closedShipments', plan->'closedShipments'));
  if v_state = 'awaiting_transfer' then
    insert into private.order_partial_cancellation_refund_accounts(partial_cancellation_id, bank_name, account_number, account_holder, masked_account, masked_holder)
    values (v_id, p_refund_account->>'bankName', p_refund_account->>'accountNumber', p_refund_account->>'accountHolder',
      (p_refund_account->>'bankName') || ' ' || public.mask_refund_account_number(p_refund_account->>'accountNumber'),
      public.mask_refund_account_holder(p_refund_account->>'accountHolder'));
    perform private.apply_order_partial_cancellation(v_id, v_actor, 'awaiting_transfer');
  end if;
  return jsonb_build_object('id', v_id, 'state', v_state, 'provider', plan->>'provider', 'refundAmount', (plan->>'refundAmount')::bigint, 'replayed', false);
end $$;
revoke all on function public.admin_start_order_partial_cancellation(uuid, jsonb, text, text, boolean, bigint, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_start_order_partial_cancellation(uuid, jsonb, text, text, boolean, bigint, uuid, jsonb) to authenticated;

-- 10-4. 무통장 송금 완료(불변 송금 증빙). T03·ADR-0010과 같은 권한(송금 담당 = sales.manage + 레거시 관리자, 로그인 세션 확인).
create function public.admin_record_order_partial_cancellation_transfer(p_id uuid, p_evidence text, p_note text, p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_session uuid; head private.order_partial_cancellations;
  evidence text := nullif(btrim(coalesce(p_evidence, '')), ''); v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  begin v_session := (auth.jwt()->>'session_id')::uuid;
  exception when invalid_text_representation then raise insufficient_privilege using message = 'bank_refund_permission_required'; end;
  perform private.require_bank_transfer_refund_identity(v_actor, v_session);
  if p_operation_id is null or evidence is null or char_length(evidence) not between 2 and 300 or v_note is null or char_length(v_note) not between 2 and 300 then
    raise check_violation using message = 'partial_cancel_transfer_evidence_required';
  end if;
  select * into head from private.order_partial_cancellations where id = p_id;
  if not found then raise no_data_found using message = 'partial_cancellation_not_found'; end if;
  perform 1 from public.orders where id = head.order_id for update;
  select * into head from private.order_partial_cancellations where id = p_id for update;
  if head.provider <> 'bank_transfer' then raise check_violation using message = 'partial_cancel_not_bank_transfer'; end if;
  if head.state = 'completed' then
    if head.transfer_operation_id = p_operation_id then
      return jsonb_build_object('id', head.id, 'state', head.state, 'replayed', true);
    end if;
    raise check_violation using message = 'partial_cancel_transfer_already_recorded';
  end if;
  if head.state <> 'awaiting_transfer' then raise check_violation using message = 'partial_cancel_not_awaiting_transfer'; end if;
  update private.order_partial_cancellations set state = 'completed', completed_at = clock_timestamp(), transfer_operation_id = p_operation_id,
    transferred_by = v_actor, transferred_at = clock_timestamp(), transfer_evidence = evidence, transfer_note = v_note
  where id = p_id;
  update private.order_partial_cancellation_refund_accounts set purge_after = coalesce(purge_after, now() + interval '30 days')
  where partial_cancellation_id = p_id and purged_at is null;
  insert into public.audit_log(actor_id, action, target, diff)
  values (v_actor, 'admin.order.partial_cancellation_transferred', 'order:' || head.order_id::text,
    jsonb_build_object('partialCancellationId', p_id, 'refundAmount', head.refund_amount, 'evidence', evidence, 'note', v_note));
  perform private.notify_order_partial_cancellation(p_id, 'transferred');
  return jsonb_build_object('id', p_id, 'state', 'completed', 'replayed', false);
end $$;
revoke all on function public.admin_record_order_partial_cancellation_transfer(uuid, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_record_order_partial_cancellation_transfer(uuid, text, text, uuid) to authenticated;

-- 10-5. 송금할 계좌 원문 열람(감사 기록). 송금 대기 중에만 열린다.
create function public.admin_view_order_partial_cancellation_refund_account(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_session uuid; head private.order_partial_cancellations; account private.order_partial_cancellation_refund_accounts;
begin
  begin v_session := (auth.jwt()->>'session_id')::uuid;
  exception when invalid_text_representation then raise insufficient_privilege using message = 'bank_refund_permission_required'; end;
  perform private.require_bank_transfer_refund_identity(v_actor, v_session);
  select * into head from private.order_partial_cancellations where id = p_id;
  if not found then raise no_data_found using message = 'partial_cancellation_not_found'; end if;
  if head.state <> 'awaiting_transfer' then raise check_violation using message = 'partial_cancel_not_awaiting_transfer'; end if;
  select * into account from private.order_partial_cancellation_refund_accounts where partial_cancellation_id = p_id;
  if not found or account.purged_at is not null then raise no_data_found using message = 'partial_cancel_refund_account_missing'; end if;
  insert into public.audit_log(actor_id, action, target, diff)
  values (v_actor, 'admin.order.partial_cancellation_account_viewed', 'order:' || head.order_id::text,
    jsonb_build_object('partialCancellationId', p_id, 'maskedAccount', account.masked_account));
  return jsonb_build_object('bankName', account.bank_name, 'accountNumber', account.account_number, 'accountHolder', account.account_holder,
    'amount', head.refund_amount);
end $$;
revoke all on function public.admin_view_order_partial_cancellation_refund_account(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_view_order_partial_cancellation_refund_account(uuid) to authenticated;

-- 11. 서버 오케스트레이터(service_role) 경로 — 토스 부분 취소.
create function public.service_order_partial_cancellation(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', head.id, 'orderId', head.order_id, 'paymentId', head.payment_id, 'provider', head.provider,
    'state', head.state, 'paymentAmount', head.payment_amount, 'balanceBefore', head.balance_before, 'refundAmount', head.refund_amount,
    'paymentKey', pay.payment_key, 'paymentStatus', pay.status, 'paymentLiveAmount', pay.amount)
  from private.order_partial_cancellations head join public.payments pay on pay.id = head.payment_id
  where head.id = p_id;
$$;
revoke all on function public.service_order_partial_cancellation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_order_partial_cancellation(uuid) to service_role;

create function private.require_partial_cancellation_actor(p_actor_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_actor_id is null or not private.has_operator_capability(p_actor_id, 'sales.manage', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
end $$;
revoke all on function private.require_partial_cancellation_actor(uuid) from public, anon, authenticated, service_role;

-- 결제사 부분 취소를 조회로 확인한 결과를 적고 품목 취소를 적용한다. 같은 확인의 재전송은 같은 결과다.
create function public.service_complete_order_partial_cancellation(p_id uuid, p_refunded_amount bigint, p_provider_payment_key text,
  p_provider_transaction_key text, p_actor_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare head private.order_partial_cancellations; pay public.payments;
begin
  perform private.require_partial_cancellation_actor(p_actor_id);
  if p_refunded_amount is null or p_refunded_amount <= 0 or nullif(btrim(coalesce(p_provider_payment_key, '')), '') is null
    or p_provider_transaction_key is null or p_provider_transaction_key !~ '^[\x21-\x7e]{1,64}$' then
    raise invalid_parameter_value using message = 'partial_cancel_evidence_invalid';
  end if;
  select * into head from private.order_partial_cancellations where id = p_id;
  if not found then raise no_data_found using message = 'partial_cancellation_not_found'; end if;
  perform 1 from public.orders where id = head.order_id for update;
  perform s.id from public.order_shipments s where s.order_id = head.order_id order by s.id for update;
  select * into pay from public.payments where id = head.payment_id for update;
  select * into head from private.order_partial_cancellations where id = p_id for update;
  if head.provider <> 'toss' or pay.provider <> 'toss' or pay.payment_key is distinct from p_provider_payment_key or p_refunded_amount <> head.refund_amount then
    raise check_violation using message = 'partial_cancel_evidence_mismatch';
  end if;
  if head.state = 'completed' then
    if head.provider_transaction_key is distinct from p_provider_transaction_key then raise check_violation using message = 'partial_cancel_evidence_mismatch'; end if;
    return 'completed';
  end if;
  if head.state not in ('processing', 'needs_review') then raise check_violation using message = 'partial_cancel_not_processing'; end if;
  update private.order_partial_cancellations set provider_confirmed_at = clock_timestamp(), provider_transaction_key = p_provider_transaction_key
  where id = p_id;
  perform private.apply_order_partial_cancellation(p_id, p_actor_id, 'completed');
  insert into public.audit_log(actor_id, action, target, diff)
  values (p_actor_id, 'admin.order.partial_cancellation_completed', 'order:' || head.order_id::text,
    jsonb_build_object('partialCancellationId', p_id, 'paymentId', pay.id, 'refundedAmount', p_refunded_amount,
      'balanceAfter', head.balance_before - p_refunded_amount));
  return 'completed';
end $$;
revoke all on function public.service_complete_order_partial_cancellation(uuid, bigint, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_complete_order_partial_cancellation(uuid, bigint, text, text, uuid) to service_role;

-- 결제사가 이 결제의 부분 취소를 받지 않는다(돈이 움직이지 않음을 조회로 확인). 품목 부분 취소를 진행하지 않고 닫는다.
create function public.service_reject_order_partial_cancellation(p_id uuid, p_reason_code text, p_actor_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare head private.order_partial_cancellations;
begin
  perform private.require_partial_cancellation_actor(p_actor_id);
  if p_reason_code is distinct from 'provider_partial_cancel_unavailable' then raise invalid_parameter_value using message = 'invalid_partial_cancel_reason'; end if;
  select * into head from private.order_partial_cancellations where id = p_id;
  if not found then raise no_data_found using message = 'partial_cancellation_not_found'; end if;
  perform 1 from public.orders where id = head.order_id for update;
  select * into head from private.order_partial_cancellations where id = p_id for update;
  if head.state = 'rejected' then return 'rejected'; end if;
  if head.state not in ('processing', 'needs_review') then raise check_violation using message = 'partial_cancel_not_processing'; end if;
  update private.order_partial_cancellations set state = 'rejected', rejected_at = clock_timestamp(), last_error_code = p_reason_code where id = p_id;
  insert into public.audit_log(actor_id, action, target, diff)
  values (p_actor_id, 'admin.order.partial_cancellation_rejected', 'order:' || head.order_id::text,
    jsonb_build_object('partialCancellationId', p_id, 'reason', p_reason_code, 'refundAmount', head.refund_amount));
  return 'rejected';
end $$;
revoke all on function public.service_reject_order_partial_cancellation(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_reject_order_partial_cancellation(uuid, text, uuid) to service_role;

-- 결과가 모호하거나 대조가 맞지 않는다. 출고는 계속 막고 같은 경로로 다시 확인한다.
create function public.service_mark_order_partial_cancellation_needs_review(p_id uuid, p_code text, p_actor_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare head private.order_partial_cancellations;
begin
  perform private.require_partial_cancellation_actor(p_actor_id);
  if p_code is null or p_code !~ '^[a-z0-9_]{1,64}$' then raise invalid_parameter_value using message = 'invalid_partial_cancel_reason'; end if;
  select * into head from private.order_partial_cancellations where id = p_id;
  if not found then raise no_data_found using message = 'partial_cancellation_not_found'; end if;
  perform 1 from public.orders where id = head.order_id for update;
  select * into head from private.order_partial_cancellations where id = p_id for update;
  if head.state not in ('processing', 'needs_review') then return head.state; end if;
  update private.order_partial_cancellations set state = 'needs_review', last_error_code = p_code where id = p_id;
  insert into public.audit_log(actor_id, action, target, diff)
  values (p_actor_id, 'admin.order.partial_cancellation_needs_review', 'order:' || head.order_id::text,
    jsonb_build_object('partialCancellationId', p_id, 'code', p_code));
  return 'needs_review';
end $$;
revoke all on function public.service_mark_order_partial_cancellation_needs_review(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_mark_order_partial_cancellation_needs_review(uuid, text, uuid) to service_role;

-- 결제 한 건의 부분 취소 누계(전액 취소·반품 오케스트레이터가 남은 잔액을 계산할 때 읽는다). 없으면 빈 배열.
create function public.service_order_payment_partial_refunds(p_order_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('paymentId', s.payment_id, 'refundedAmount', s.amount) order by s.payment_id), '[]'::jsonb)
  from (select head.payment_id, sum(head.refund_amount)::bigint as amount from private.order_partial_cancellations head
    where head.order_id = p_order_id and head.applied_at is not null group by head.payment_id) s;
$$;
revoke all on function public.service_order_payment_partial_refunds(uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_order_payment_partial_refunds(uuid) to service_role;

-- 12. 구매자 주문 상세. 본인 주문의 적용된 부분 취소만(결제사 확인 전·진행하지 않은 건은 보이지 않는다).
create function public.get_my_order_partial_cancellations(p_order_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.order_partial_cancellation_json(head.id, false) order by head.sequence), '[]'::jsonb)
  from private.order_partial_cancellations head join public.orders o on o.id = head.order_id
  where head.order_id = p_order_id and head.applied_at is not null and auth.uid() is not null and o.user_id = auth.uid();
$$;
revoke all on function public.get_my_order_partial_cancellations(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_my_order_partial_cancellations(uuid) to authenticated;

select private.register_operator_rpc_contract('public.admin_order_partial_cancellation_context(uuid)'::regprocedure, 'sales.manage', 'read', false);
select private.register_operator_rpc_contract('public.admin_preview_order_partial_cancellation(uuid,jsonb)'::regprocedure, 'sales.manage', 'read', false);
select private.register_operator_rpc_contract('public.admin_start_order_partial_cancellation(uuid,jsonb,text,text,boolean,bigint,uuid,jsonb)'::regprocedure, 'sales.manage', 'write', false);
select private.register_operator_rpc_contract('public.admin_record_order_partial_cancellation_transfer(uuid,text,text,uuid)'::regprocedure, 'sales.manage', 'write', true);
select private.register_operator_rpc_contract('public.admin_view_order_partial_cancellation_refund_account(uuid)'::regprocedure, 'sales.manage', 'write', true);
select private.register_operator_rpc_contract('public.service_complete_order_partial_cancellation(uuid,bigint,text,text,uuid)'::regprocedure, 'sales.manage', 'service_finish', false);
select private.register_operator_rpc_contract('public.service_reject_order_partial_cancellation(uuid,text,uuid)'::regprocedure, 'sales.manage', 'service_finish', false);
select private.register_operator_rpc_contract('public.service_mark_order_partial_cancellation_needs_review(uuid,text,uuid)'::regprocedure, 'sales.manage', 'service_finish', false);

commit;
notify pgrst, 'reload schema';
