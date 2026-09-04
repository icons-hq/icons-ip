-- D-3 ⑭ — 현금영수증 · 세금계산서 (설계서 v2 §1-3)
--
-- 전자상거래 소매업은 현금영수증 **의무발행업종**이다. 건당 10만 원 이상 현금성 거래는
-- 5일 안에 발급해야 하고, 안 하면 미발급 가산세가 붙는다. 상대의 인적사항을 모르면
-- 국세청 지정번호(010-000-1234)로 자진발급한다.
--
-- 그래서 이 표의 목적은 「발급했다」가 아니라 **「발급해야 하는데 아직 안 한 건이 무엇인가」**다.
-- 발급된 것만 적는 원장은 빠뜨린 건을 절대 보여주지 못한다.
--
-- 식별번호(전화·사업자번호·현금영수증카드)는 개인정보다. 원장에는 마스킹만 두고
-- 원문은 service_role 만 닿는 `private` 표에 따로 둔다.

create type public.cash_receipt_kind as enum ('income_deduction', 'expense_proof', 'self_issued');
create type public.cash_receipt_status as enum ('queued', 'requested', 'issued', 'failed', 'canceled');

create table if not exists public.cash_receipts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  kind public.cash_receipt_kind not null,
  status public.cash_receipt_status not null default 'queued',
  amount bigint not null check (amount >= 0),
  -- 화면과 엑셀이 보는 값. 원문은 private 에 있다.
  identity_masked text,
  receipt_key text,
  receipt_number text,
  receipt_url text,
  -- 같은 주문에 같은 요청이 두 번 나가지 않게 하는 열쇠. 토스에도 그대로 보낸다.
  idempotency_key text not null,
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  issued_at timestamptz,
  canceled_at timestamptz,
  error_code text,
  error_message text,
  updated_at timestamptz not null default now()
);
create unique index if not exists cash_receipts_idempotency_key on public.cash_receipts (idempotency_key);
-- 한 주문에 살아 있는 영수증은 하나다. 취소된 것은 다시 발급할 수 있다.
create unique index if not exists cash_receipts_active_per_order
  on public.cash_receipts (order_id) where status in ('queued', 'requested', 'issued');
create index if not exists cash_receipts_status_idx on public.cash_receipts (status, requested_at);
alter table public.cash_receipts enable row level security;

drop policy if exists "staff reads cash receipts" on public.cash_receipts;
create policy "staff reads cash receipts" on public.cash_receipts
  for select to authenticated using (public.is_staff());
drop policy if exists "buyer reads own cash receipts" on public.cash_receipts;
create policy "buyer reads own cash receipts" on public.cash_receipts
  for select to authenticated using (
    exists (select 1 from public.orders as ord where ord.id = cash_receipts.order_id and ord.user_id = (select auth.uid()))
  );
grant select on public.cash_receipts to authenticated;

create table if not exists private.cash_receipt_identities (
  receipt_id uuid primary key references public.cash_receipts (id) on delete cascade,
  identity_number text not null,
  created_at timestamptz not null default now()
);
alter table private.cash_receipt_identities enable row level security;
revoke all on table private.cash_receipt_identities from public, anon, authenticated;
grant select, insert, delete on table private.cash_receipt_identities to service_role;

-- ---------------------------------------------------------------------------
-- 세금계산서 — 1차는 신청 접수·발행 기록까지. 발행 자체는 스마트빌에서 사람이 한다.
-- ---------------------------------------------------------------------------
create table if not exists public.tax_invoice_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'approved', 'issued', 'rejected')),
  business_number text not null check (business_number ~ '^[0-9]{10}$'),
  business_name text not null check (char_length(btrim(business_name)) between 1 and 100),
  representative_name text check (char_length(representative_name) <= 50),
  email text check (char_length(email) <= 200),
  -- 스마트빌이 발행하고 우리는 그 승인번호를 받아 적는다.
  approval_number text,
  issued_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  note text check (char_length(note) <= 300),
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tax_invoice_requests_active_per_order
  on public.tax_invoice_requests (order_id) where status in ('requested', 'approved', 'issued');
create unique index if not exists tax_invoice_requests_approval_number
  on public.tax_invoice_requests (approval_number) where approval_number is not null;
alter table public.tax_invoice_requests enable row level security;

drop policy if exists "staff reads tax invoice requests" on public.tax_invoice_requests;
create policy "staff reads tax invoice requests" on public.tax_invoice_requests
  for select to authenticated using (public.is_staff());
drop policy if exists "buyer reads own tax invoice requests" on public.tax_invoice_requests;
create policy "buyer reads own tax invoice requests" on public.tax_invoice_requests
  for select to authenticated using (
    exists (select 1 from public.orders as ord where ord.id = tax_invoice_requests.order_id and ord.user_id = (select auth.uid()))
  );
grant select on public.tax_invoice_requests to authenticated;

-- ---------------------------------------------------------------------------
-- 의무발행 대상 — 「아직 증빙이 없는 현금성 거래」
-- ---------------------------------------------------------------------------
create or replace view public.cash_receipt_pending_view as
select
  ord.id as order_id,
  ord.order_no,
  ord.total,
  ord.created_at,
  ord.user_id,
  -- 10만 원 이상은 의무발행 구간이다. 그 아래는 요청이 있을 때만 발급한다.
  (ord.total >= 100000) as mandatory,
  -- 입금 확정일 + 5일. 이 날짜를 넘기면 가산세 구간이다.
  (coalesce(ord.confirmed_at, ord.created_at) + interval '5 days') as due_at
from public.orders as ord
where ord.payment_method = 'bank_transfer'
  and ord.status in ('paid', 'confirmed', 'shipping', 'delivered', 'done')
  and not exists (
    select 1 from public.cash_receipts as receipt
    where receipt.order_id = ord.id and receipt.status in ('queued', 'requested', 'issued')
  )
  -- 세금계산서를 신청한 건은 현금영수증을 발급하지 않는다. 같은 거래에 증빙은 하나다.
  and not exists (
    select 1 from public.tax_invoice_requests as invoice
    where invoice.order_id = ord.id and invoice.status in ('requested', 'approved', 'issued')
  );

alter view public.cash_receipt_pending_view set (security_invoker = on);
grant select on public.cash_receipt_pending_view to authenticated;
