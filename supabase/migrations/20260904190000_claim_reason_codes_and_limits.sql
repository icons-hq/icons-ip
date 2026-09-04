-- D-3 ⑨ — 클레임 사유 코드 마스터 · 환불 한도 (설계서 v2 §1-3)
--
-- 지금 사유는 `reason_type` 두 값(단순변심·하자)뿐이다. 그 둘은 **청약철회 기한과 반품
-- 배송비 부담 주체**를 가르는 법적 구분이라 그대로 두고, 그 위에 운영이 실제로 쓰는
-- 사유 코드를 얹는다 — 「배송 지연」과 「상품 파손」은 둘 다 판매자 과실이지만
-- CS 가 집계할 때는 다른 사유다.
--
-- 한도표는 「누가 승인 없이 얼마까지 환불할 수 있는가」를 적어 둔 표다. 이 숫자가 없으면
-- 승인 절차는 사람의 기억에 기대게 되고, 기억은 바쁜 날 먼저 무너진다.

create table if not exists public.claim_reason_codes (
  code text primary key,
  label text not null,
  -- 과실이 누구에게 있는가. 기존 `reason_type` 과 짝을 맞춘다(customer ⇔ 단순변심, seller ⇔ 하자).
  fault text not null check (fault in ('seller', 'customer')),
  cafe24_code text,
  applies_to text[] not null check (applies_to <@ array['cancel', 'return', 'exchange']),
  shipping_fee_payer text not null check (shipping_fee_payer in ('seller', 'customer')),
  -- 사유만으로 승인이 필요한 종류(기타). 금액과 무관하게 사람을 부른다.
  always_requires_approval boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0
);
alter table public.claim_reason_codes enable row level security;

drop policy if exists "staff reads claim reason codes" on public.claim_reason_codes;
create policy "staff reads claim reason codes" on public.claim_reason_codes
  for select to authenticated using (public.is_staff());
grant select on public.claim_reason_codes to authenticated;

insert into public.claim_reason_codes (code, label, fault, cafe24_code, applies_to, shipping_fee_payer, always_requires_approval, sort_order)
values
  ('change_of_mind', '단순 변심', 'customer', 'A', array['cancel', 'return', 'exchange'], 'customer', false, 10),
  ('delivery_delay', '배송 지연', 'seller', 'B', array['cancel', 'return'], 'seller', false, 20),
  ('wrong_delivery', '오배송', 'seller', 'C', array['return', 'exchange'], 'seller', false, 30),
  ('service_dissatisfied', '서비스 불만족', 'customer', 'D', array['cancel', 'return'], 'customer', false, 40),
  ('item_dissatisfied', '상품 불만족', 'customer', 'E', array['return', 'exchange'], 'customer', false, 50),
  ('info_mismatch', '상품 정보 상이', 'seller', 'F', array['return', 'exchange'], 'seller', false, 60),
  ('damaged', '파손·불량', 'seller', 'G', array['return', 'exchange'], 'seller', false, 70),
  ('other', '기타', 'customer', 'H', array['cancel', 'return', 'exchange'], 'customer', true, 80),
  ('out_of_stock', '품절·재고 부족', 'seller', null, array['cancel'], 'seller', false, 90),
  ('payment_error', '결제 오류', 'seller', null, array['cancel'], 'seller', false, 100)
on conflict (code) do update set
  label = excluded.label, fault = excluded.fault, cafe24_code = excluded.cafe24_code,
  applies_to = excluded.applies_to, shipping_fee_payer = excluded.shipping_fee_payer,
  always_requires_approval = excluded.always_requires_approval, sort_order = excluded.sort_order;

create table if not exists public.claim_refund_limits (
  reason_code text primary key references public.claim_reason_codes (code) on delete cascade,
  -- 이 금액까지는 담당자가 스스로 처리한다. 넘으면 승인자를 부른다.
  max_amount_no_approval bigint not null check (max_amount_no_approval >= 0),
  -- 주문 금액 대비 비율 상한. 금액이 작아도 「주문 전액」에 가까우면 한 번 더 본다.
  max_ratio numeric(4, 3) not null default 1 check (max_ratio > 0 and max_ratio <= 1),
  requires_photo boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.claim_refund_limits enable row level security;

drop policy if exists "staff reads claim refund limits" on public.claim_refund_limits;
create policy "staff reads claim refund limits" on public.claim_refund_limits
  for select to authenticated using (public.is_staff());
grant select on public.claim_refund_limits to authenticated;

-- 초기값은 **잠정**이다(설계서 §5 CS 판정 대기). 지금은 「판매자 과실은 넉넉히,
-- 고객 변심은 한 번 더 본다」는 상식선을 두고, CS 가 정하면 화면에서 바꾼다.
insert into public.claim_refund_limits (reason_code, max_amount_no_approval, max_ratio, requires_photo)
values
  ('change_of_mind', 100000, 1.000, false),
  ('delivery_delay', 300000, 1.000, false),
  ('wrong_delivery', 300000, 1.000, false),
  ('service_dissatisfied', 100000, 0.500, false),
  ('item_dissatisfied', 100000, 0.500, false),
  ('info_mismatch', 300000, 1.000, false),
  ('damaged', 300000, 1.000, true),
  ('other', 0, 1.000, false),
  ('out_of_stock', 1000000, 1.000, false),
  ('payment_error', 1000000, 1.000, false)
on conflict (reason_code) do nothing;

-- ---------------------------------------------------------------------------
-- 클레임 확장 — 수량 · 금액 · 한도 스냅샷 · 승인
-- ---------------------------------------------------------------------------
alter table public.order_cancellation_requests
  add column if not exists reason_code text references public.claim_reason_codes (code),
  add column if not exists qty integer check (qty is null or qty > 0),
  add column if not exists refund_amount bigint check (refund_amount is null or refund_amount >= 0),
  add column if not exists refund_shipping_fee bigint not null default 0 check (refund_shipping_fee >= 0),
  add column if not exists limit_snapshot jsonb,
  add column if not exists approval_requested_at timestamptz,
  add column if not exists approved_by uuid references auth.users (id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists inspection text check (inspection is null or inspection in ('restock', 'discard'));

-- 기존 행의 사유를 코드로 옮긴다. 두 값밖에 없었으므로 대응이 하나뿐이다.
update public.order_cancellation_requests
set reason_code = case when reason_type = 'defect' then 'damaged' else 'change_of_mind' end
where reason_code is null;

-- 승인자는 처리자와 달라야 한다. 표에서도 막아 둔다 — RPC 만 믿으면 새 경로가 생길 때 뚫린다.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'claim_approver_differs_from_decider' and conrelid = 'public.order_cancellation_requests'::regclass
  ) then
    alter table public.order_cancellation_requests
      add constraint claim_approver_differs_from_decider check (
        approved_by is null or decided_by is null or approved_by <> decided_by
      );
  end if;
end;
$$;

-- 단계에 `approval_pending` 을 더한다. 기존 9단은 그대로 둔다.
alter table public.order_cancellation_requests drop constraint if exists order_cancellation_requests_stage_check;
alter table public.order_cancellation_requests add constraint order_cancellation_requests_stage_check check (
  stage in (
    'requested', 'in_review', 'collecting', 'collected', 'on_hold',
    'approval_pending', 'processing', 'needs_review', 'completed', 'rejected'
  )
);

-- 단계와 status 의 짝은 기존 `..._stage_projection_check` 가 이미 본다 —
-- `approval_pending` 은 아직 처리 전이라 그 CASE 의 ELSE(=`status = 'requested'`)로 떨어진다.
-- 같은 규칙을 두 번 적으면 언젠가 한쪽만 고쳐진다.

-- ---------------------------------------------------------------------------
-- 재고 복원 기록 — 「돌아온 물건을 다시 팔 수 있게 했는가」의 원장
-- ---------------------------------------------------------------------------
create table if not exists public.stock_restorations (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.order_cancellation_requests (id) on delete cascade,
  order_item_id uuid references public.order_items (id) on delete set null,
  variant_id uuid references public.good_variants (id) on delete set null,
  location_id text references public.stock_locations (id),
  qty integer not null check (qty > 0),
  outcome text not null check (outcome in ('restock', 'discard')),
  actor_id uuid references auth.users (id) on delete set null,
  occurred_at timestamptz not null default now()
);
create index if not exists stock_restorations_claim_idx on public.stock_restorations (claim_id);
alter table public.stock_restorations enable row level security;

drop policy if exists "staff reads stock restorations" on public.stock_restorations;
create policy "staff reads stock restorations" on public.stock_restorations
  for select to authenticated using (public.is_staff());
grant select on public.stock_restorations to authenticated;
