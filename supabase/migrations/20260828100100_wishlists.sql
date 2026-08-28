-- S4 commerce core (#326) migration ③: 위시리스트.
--
-- 로그인 사용자가 굿즈를 찜해 모아 두는 목록(CONTEXT.md "위시리스트") — 결제 전
-- 담기인 장바구니(cart_items)와 별개 도메인이다. 구조는 cart_items 를 따른다:
-- user×good 을 PK 로 유니크하게 잡고, RLS 본인 격리 + 직접 insert/delete 로
-- 토글한다(수량 개념이 없어 update 는 필요 없다). 멱등성은 PK 와
-- insert ... on conflict do nothing / delete 조합이 보장한다.

create table public.wishlists (
  user_id uuid not null references public.profiles (id) on delete cascade,
  good_id text not null references public.goods (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, good_id)
);

-- PK 가 user_id 선두라 good_id 쪽 FK cascade·집계는 별도 인덱스가 받는다.
create index wishlists_good_idx on public.wishlists (good_id);

alter table public.wishlists enable row level security;

create policy wishlists_self on public.wishlists
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.wishlists from public, anon, authenticated, service_role;
grant select, insert, delete on table public.wishlists to authenticated;
