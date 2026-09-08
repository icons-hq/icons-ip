-- 규모 후속 — 카드 축 공개 페이징 · 바인더 집계 · 굿즈 검색
--
-- 남은 전량 소비처: 바인더(카드 전량 + 보유 대조) · 카드팩(카드 전량에서 라인업만 찾음) ·
-- 검색(굿즈 전량을 메모리에서 훑음). 셋 다 `getCatalogSnapshot()` 을 통해 네 축을 한꺼번에
-- 읽었고, 어느 축이든 1,000행에 닿으면 절단 감지가 던져 화면이 멈춘다.
--
-- **집계는 서버가 한다.** 바인더의 「보유 n / 전체 m · 달성률」은 전량을 봐야 나오는 수다 —
-- 목록을 페이지로 자르면서 이 수를 화면에서 세면 첫 페이지만 센 숫자가 된다. 그래서 목록과
-- 집계를 **다른 문**으로 나눈다: 목록은 페이지, 집계는 전량 count.
--
-- `coalesce`/`least`/`greatest` 는 SQL 문법이라 `pg_catalog.` 을 붙일 수 없다.
-- `cards.rarity` 는 enum(`public.rarity`)이다 — text 변수와 바로 비교하면 "operator does not
-- exist: rarity = text" 로 죽는다. 반환·비교 모두 `::text` 로 맞춘다.

-- ---------------------------------------------------------------------------
-- ① 카드 한 페이지 — 도감 순서(IP 자연 순서 → 카드 자연 순서)
-- ---------------------------------------------------------------------------
create index if not exists cards_storefront_order_idx
  on public.cards (ip_id, public.storefront_natural_prefix(id), public.storefront_natural_number(id), id)
  where archived_at is null;

create or replace function public.storefront_cards_page(
  p_ip_ids text[] default null,
  p_rarity text default null,
  p_limit integer default 120,
  p_offset integer default 0
)
returns table (
  id text,
  ip_id text,
  name text,
  no text,
  rarity text,
  bg text,
  image_path text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 120), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_rarity text := nullif(btrim(coalesce(p_rarity, '')), '');
begin
  return query
  select
    card.id, card.ip_id, card.name, card.no, card.rarity::text, card.bg, card.image_path,
    pg_catalog.count(*) over () as total_count
  from public.cards as card
  where card.archived_at is null
    and (p_ip_ids is null or card.ip_id = any(p_ip_ids))
    -- rarity 는 enum 이다. text 로 비교해야 모르는 값이 오류가 아니라 「없음」이 된다.
    and (v_rarity is null or card.rarity::text = v_rarity)
  order by
    card.ip_id,
    public.storefront_natural_prefix(card.id),
    public.storefront_natural_number(card.id),
    card.id
  limit v_limit offset v_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- ② id 로 카드 — 카드팩 라인업·보유 카드처럼 「이 카드들」만 필요할 때
-- ---------------------------------------------------------------------------
-- 보관된 카드도 돌려준다. 바인더의 보유 행(user_cards)은 보관 뒤에도 남아 있어야 하고
-- (`getBinderCatalogOverlay` 와 같은 규율), 라인업이 가리키는 카드가 보관됐다고 팩 화면이
-- 빈칸을 그리면 안 된다. 공개 도감 목록(①)만 보관을 뺀다.
create or replace function public.storefront_cards_by_ids(p_ids text[])
returns table (
  id text,
  ip_id text,
  name text,
  no text,
  rarity text,
  bg text,
  image_path text,
  archived_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select card.id, card.ip_id, card.name, card.no, card.rarity::text, card.bg, card.image_path, card.archived_at
  from public.cards as card
  where card.id = any(coalesce(p_ids, '{}'::text[]))
  order by card.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- ③ 바인더 집계 — 보는 사람 기준
-- ---------------------------------------------------------------------------
-- 로그인 전에는 보유 열이 전부 0·null 이다(공개 도감). 보유는 auth.uid() 로 센다 —
-- 남의 보유를 인자로 묻는 문은 두지 않는다.
create or replace function public.storefront_binder_overview()
returns table (
  total_cards bigint,
  owned_cards bigint,
  total_ips bigint,
  owned_ips bigint,
  holo_cards bigint,
  holo_owned bigint,
  ssr_cards bigint,
  signed_in boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  return query
  with catalog as (
    select card.id, card.ip_id, card.rarity::text as rarity
    from public.cards as card
    where card.archived_at is null
  ),
  owned as (
    select held.card_id
    from public.user_cards as held
    where v_user is not null and held.user_id = v_user and held.qty > 0
  )
  select
    (select pg_catalog.count(*) from catalog),
    (select pg_catalog.count(*) from catalog as c join owned as o on o.card_id = c.id),
    (select pg_catalog.count(distinct c.ip_id) from catalog as c),
    (select pg_catalog.count(distinct c.ip_id) from catalog as c join owned as o on o.card_id = c.id),
    (select pg_catalog.count(*) from catalog as c where c.rarity = 'HOLO'),
    (select pg_catalog.count(*) from catalog as c join owned as o on o.card_id = c.id where c.rarity = 'HOLO'),
    (select pg_catalog.count(*) from catalog as c where c.rarity = 'SSR'),
    v_user is not null;
end;
$$;

-- IP 별 「보유/전체」 — 카드 상세가 「3/12」 를 적는 데 쓴다. 전량을 화면에 들고 있지 않아도 된다.
create or replace function public.storefront_binder_ip_progress(p_ip_ids text[] default null)
returns table (
  ip_id text,
  total_cards bigint,
  owned_cards bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  return query
  select
    card.ip_id,
    pg_catalog.count(*) as total_cards,
    pg_catalog.count(held.card_id) as owned_cards
  from public.cards as card
  left join public.user_cards as held
    on held.card_id = card.id and v_user is not null and held.user_id = v_user and held.qty > 0
  where card.archived_at is null
    and (p_ip_ids is null or card.ip_id = any(p_ip_ids))
  group by card.ip_id
  order by card.ip_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- ④ 굿즈 검색 한 페이지 — 결과 페이지용(통합검색은 그룹당 6건만 준다)
-- ---------------------------------------------------------------------------
-- 순위는 `lib/search-goods.ts` 가 메모리에서 하던 것과 같다: 이름 일치 → IP 이름 일치 →
-- 유형·배지 일치. 같은 순위 안에서는 카탈로그 자연 순서다. 화면이 바뀌지 않게 **같은 순서**를
-- 서버가 낸다.
create or replace function public.storefront_goods_search(
  p_query text,
  p_limit integer default 40,
  p_offset integer default 0
)
returns table (
  id text,
  ip_id text,
  name text,
  type text,
  price integer,
  compare_at_price integer,
  created_at timestamptz,
  badge text,
  stock text,
  stock_qty integer,
  bg text,
  image_path text,
  allow_bank_transfer boolean,
  filtered_total bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_pattern text;
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if v_query is null then
    return;
  end if;
  v_pattern := private.catalog_search_pattern(v_query);

  return query
  with ranked as (
    select
      good.id, good.ip_id, good.name, good.type, good.price, good.compare_at_price,
      good.created_at, good.badge, good.stock, good.stock_qty, good.bg, good.image_path,
      good.allow_bank_transfer,
      case
        when good.name ilike v_pattern escape '\' then 0
        when ip.title ilike v_pattern escape '\' then 1
        else 2
      end as bucket
    from public.goods_storefront as good
    left join public.ips as ip on ip.id = good.ip_id
    where good.name ilike v_pattern escape '\'
       or ip.title ilike v_pattern escape '\'
       or good.type ilike v_pattern escape '\'
       or good.badge ilike v_pattern escape '\'
  )
  select
    ranked.id, ranked.ip_id, ranked.name, ranked.type, ranked.price, ranked.compare_at_price,
    ranked.created_at, ranked.badge, ranked.stock, ranked.stock_qty, ranked.bg, ranked.image_path,
    ranked.allow_bank_transfer,
    pg_catalog.count(*) over () as filtered_total
  from ranked
  order by
    ranked.bucket,
    public.storefront_natural_prefix(ranked.id),
    public.storefront_natural_number(ranked.id),
    ranked.id
  limit v_limit offset v_offset;
end;
$$;

-- 공개 표면 — anon 도 도감·검색을 본다. service_role 은 다른 public 표와 같은 규율로 제외.
revoke all on function public.storefront_cards_page(text[], text, integer, integer) from public, service_role;
revoke all on function public.storefront_cards_by_ids(text[]) from public, service_role;
revoke all on function public.storefront_binder_overview() from public, service_role;
revoke all on function public.storefront_binder_ip_progress(text[]) from public, service_role;
revoke all on function public.storefront_goods_search(text, integer, integer) from public, service_role;
grant execute on function public.storefront_cards_page(text[], text, integer, integer) to anon, authenticated;
grant execute on function public.storefront_cards_by_ids(text[]) to anon, authenticated;
grant execute on function public.storefront_binder_overview() to anon, authenticated;
grant execute on function public.storefront_binder_ip_progress(text[]) to anon, authenticated;
grant execute on function public.storefront_goods_search(text, integer, integer) to anon, authenticated;

analyze public.cards;
