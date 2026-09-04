-- D-6 ① — 매출 시각과 통계 인덱스 (설계서 v2 §1-5)
--
-- 통계의 첫 질문은 「이 매출이 언제 잡히는가」다. 지금은 그 시각이 어디에도 없어서
-- 화면마다 `created_at`(주문한 때)과 `confirmed_at`(발주확인한 때) 중 아무거나 쓴다 —
-- 두 값은 무통장 입금에서 며칠씩 벌어진다.
--
-- **매출 시각 = 결제가 확정된 때**로 못 박는다: 카드는 주문 생성(승인이 그 안에 끝난다),
-- 무통장은 입금 확인 시각. 요일·시간대 분석은 **고객이 주문한 때**(`created_at`)를 쓴다 —
-- 그건 매출이 아니라 행동을 보는 축이라 기준이 다르다.

alter table public.orders add column if not exists paid_at timestamptz;

-- 백필: 카드는 주문 시각, 무통장은 입금 확인 기록의 시각(없으면 발주확인 시각).
update public.orders as ord
set paid_at = case
  when ord.payment_method = 'bank_transfer' then coalesce(
    (select confirmation.confirmed_at
     from public.bank_transfer_confirmations as confirmation
     where confirmation.order_id = ord.id
     order by confirmation.confirmed_at
     limit 1),
    ord.confirmed_at,
    ord.created_at
  )
  else ord.created_at
end
where ord.paid_at is null
  and ord.status in ('paid', 'confirmed', 'shipping', 'delivered', 'done');

create or replace function private.stamp_order_paid_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 결제가 확정되는 순간을 한 번만 찍는다. 그 뒤 상태가 어떻게 바뀌어도 매출 시각은 안 움직인다 —
  -- 움직이면 지난달 마감 숫자가 이번 달에 달라진다.
  if new.status in ('paid', 'confirmed', 'shipping', 'delivered', 'done') and new.paid_at is null then
    new.paid_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

drop trigger if exists orders_stamp_paid_at on public.orders;
create trigger orders_stamp_paid_at before update of status on public.orders
  for each row execute function private.stamp_order_paid_at();

-- ---------------------------------------------------------------------------
-- 인덱스 — KST 일자 표현식에는 인덱스를 못 건다(안정 함수). 원본 timestamptz 에 걸고
-- 조회는 KST 경계를 timestamptz 로 환산한 범위 조건으로 한다.
-- ---------------------------------------------------------------------------
create index if not exists orders_paid_at_idx on public.orders (paid_at)
  where status in ('paid', 'confirmed', 'shipping', 'delivered', 'done');
create index if not exists orders_created_at_status_idx on public.orders (created_at, status);
create index if not exists refunds_completed_at_idx on public.refunds (completed_at)
  where completed_at is not null;
create index if not exists claims_requested_at_idx on public.order_cancellation_requests (requested_at);
create index if not exists order_items_good_order_idx on public.order_items (good_id, order_id);

-- ---------------------------------------------------------------------------
-- 지역 조회표 — 우편번호 앞 두 자리로 시/도를 읽는다.
--
-- 주소에 시/도를 저장하는 것이 정답이지만(v2), 지금 주소는 문자열 한 덩어리라
-- 파싱하면 「서울특별시」와 「서울시」가 다른 지역이 된다. 우편번호는 이미 구조가 있다.
-- ---------------------------------------------------------------------------
create table if not exists public.postal_regions (
  prefix text primary key check (prefix ~ '^[0-9]{2}$'),
  sido text not null,
  -- 도서산간 추가비 판정과 같은 표를 쓴다(D-2). 두 표로 나뉘면 「배송비는 붙는데
  -- 통계에는 도서산간이 아닌」 주소가 생긴다.
  remote_area boolean not null default false
);
alter table public.postal_regions enable row level security;
drop policy if exists "everyone reads postal regions" on public.postal_regions;
create policy "everyone reads postal regions" on public.postal_regions
  for select to anon, authenticated using (true);
grant select on public.postal_regions to anon, authenticated;

insert into public.postal_regions (prefix, sido, remote_area) values
  ('01', '서울', false), ('02', '서울', false), ('03', '서울', false), ('04', '서울', false),
  ('05', '서울', false), ('06', '서울', false), ('07', '서울', false), ('08', '서울', false),
  ('09', '서울', false),
  ('10', '경기', false), ('11', '경기', false), ('12', '경기', false), ('13', '경기', false),
  ('14', '경기', false), ('15', '경기', false), ('16', '경기', false), ('17', '경기', false),
  ('18', '경기', false), ('19', '경기', false), ('20', '경기', false),
  ('21', '인천', false), ('22', '인천', false), ('23', '인천', true),
  ('24', '강원', false), ('25', '강원', false), ('26', '강원', false),
  ('27', '충북', false), ('28', '충북', false), ('29', '충북', false),
  ('30', '세종', false), ('31', '충남', false), ('32', '충남', false), ('33', '충남', false),
  ('34', '대전', false), ('35', '대전', false),
  ('36', '경북', false), ('37', '경북', false), ('38', '경북', false), ('39', '경북', false),
  ('40', '경북', false), ('41', '대구', false), ('42', '대구', false), ('43', '대구', false),
  ('44', '울산', false), ('45', '울산', false),
  ('46', '부산', false), ('47', '부산', false), ('48', '부산', false), ('49', '부산', false),
  ('50', '경남', false), ('51', '경남', false), ('52', '경남', false), ('53', '경남', true),
  ('54', '전북', false), ('55', '전북', false), ('56', '전북', false),
  ('57', '전남', false), ('58', '전남', true), ('59', '전남', true),
  ('61', '광주', false), ('62', '광주', false),
  ('63', '제주', true)
on conflict (prefix) do update set sido = excluded.sido, remote_area = excluded.remote_area;

comment on table public.postal_regions is
  '우편번호 앞 두 자리 → 시/도·도서산간. 통계 지역 축과 배송비 판정이 같은 표를 본다.';
