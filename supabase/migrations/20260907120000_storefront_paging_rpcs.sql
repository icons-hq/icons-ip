-- 규모 ⑤ — 스토어프론트 공개 페이징 RPC
--
-- 고치는 결함: 스토어프론트가 카탈로그 전량을 limit 없는 select 로 읽는다. PostgREST 는
-- `max_rows`(로컬·클라우드 기본 1,000)에서 **조용히** 자르므로, 굿즈가 1,000개를 넘는
-- 순간부터 1,001번째 상품은 느린 게 아니라 **없는 것이 된다**. 오류도 경고도 없다.
--
-- 그래서 소비처를 셋으로 나눈다: ① IP 목록 ② 컬렉션 굿즈 페이지(+집계) ③ id 배열 조회.
-- 셋 다 상한이 있고, 상한을 넘으면 다음 페이지로 이어진다.
--
-- `coalesce`·`least`·`greatest` 는 **함수가 아니라 SQL 문법**이라 `pg_catalog.` 로 한정할 수 없다
-- (한정하면 "function pg_catalog.coalesce(integer, integer) does not exist"). `search_path = ''`
-- 밑에서도 그대로 쓴다 — 파서가 푸는 이름이라 검색 경로를 타지 않는다.
--
-- 읽는 곳은 `public.goods_storefront` 뷰다(보관·숨김 제외 = D-9 판매 상태 규율).
-- 지금까지 스토어프론트는 `goods` 를 직접 읽어 **숨긴 상품도 목록에 나왔다**.

-- ---------------------------------------------------------------------------
-- 정렬 키
--
-- 「추천순」은 카탈로그의 자연 순서다 — 앱은 `Intl.Collator(numeric)` 로 g2 < g10 을 만든다.
-- SQL 에서 같은 결과를 내려고 **접두어 + 끝자리 숫자**로 쪼개 정렬한다(이 카탈로그의 id 모양).
-- 끝자리 숫자가 없는 id 는 접두어만으로 비교된다. 패리티는 테스트가 잠근다.
create or replace function public.storefront_natural_prefix(p_id text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.regexp_replace(p_id, '[0-9]+$', '')
$$;

create or replace function public.storefront_natural_number(p_id text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when pg_catalog.regexp_match(p_id, '([0-9]+)$') is null then null
    -- 20자리를 넘는 꼬리 숫자는 bigint 를 넘긴다 — 그때는 숫자 키를 포기하고 id 로만 비교한다.
    when pg_catalog.length((pg_catalog.regexp_match(p_id, '([0-9]+)$'))[1]) > 18 then null
    else ((pg_catalog.regexp_match(p_id, '([0-9]+)$'))[1])::bigint
  end
$$;

comment on function public.storefront_natural_number(text) is
  '자연 정렬용 꼬리 숫자. 앱의 Intl.Collator(numeric) 와 같은 순서를 내기 위한 것.';

-- 목록 정렬을 인덱스가 받게 한다. 추천순은 자연 키, NEW 는 badge 부분 인덱스.
create index if not exists goods_natural_order_idx
  on public.goods (public.storefront_natural_prefix(id), public.storefront_natural_number(id), id)
  where archived_at is null and hidden_at is null;

create index if not exists goods_storefront_price_idx
  on public.goods (price, id)
  where archived_at is null and hidden_at is null;

create index if not exists goods_storefront_created_idx
  on public.goods (created_at desc, id)
  where archived_at is null and hidden_at is null;

create index if not exists goods_storefront_new_idx
  on public.goods (id)
  where archived_at is null and hidden_at is null and badge = 'NEW';

create index if not exists ips_storefront_order_idx
  on public.ips (fans_count desc, id)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- ② 컬렉션 굿즈 한 페이지
--
-- `filtered_total` 은 필터를 적용한 전체 건수다(윈도 count). 화면의 「더 보기」가 이 수를
-- 보고 다음 페이지가 있는지 정한다 — 페이지에 담긴 수로 판단하면 마지막 페이지에서
-- 「더 보기」가 남는다.
create or replace function public.storefront_goods_page(
  p_view text default 'all',
  p_ip_ids text[] default null,
  p_types text[] default null,
  p_price_min integer default null,
  p_price_max integer default null,
  p_sort text default 'recommended',
  p_limit integer default 60,
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
  v_limit integer := least(greatest(coalesce(p_limit, 60), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_sort text := coalesce(p_sort, 'recommended');
  v_view text := coalesce(p_view, 'all');
begin
  if v_sort not in ('recommended', 'newest', 'price_asc', 'price_desc') then
    raise exception 'unsupported sort: %', v_sort using errcode = 'check_violation';
  end if;
  if v_view not in ('all', 'new') then
    raise exception 'unsupported view: %', v_view using errcode = 'check_violation';
  end if;

  return query
  with scope as (
    select good.*
    from public.goods_storefront as good
    where (v_view <> 'new' or good.badge = 'NEW')
  ),
  filtered as (
    select scope.*
    from scope
    where (p_ip_ids is null or pg_catalog.cardinality(p_ip_ids) = 0 or scope.ip_id = any (p_ip_ids))
      and (p_types is null or pg_catalog.cardinality(p_types) = 0 or scope.type = any (p_types))
      and (p_price_min is null or scope.price >= p_price_min)
      and (p_price_max is null or scope.price <= p_price_max)
  )
  select
    filtered.id,
    filtered.ip_id,
    filtered.name,
    filtered.type,
    filtered.price,
    filtered.compare_at_price,
    filtered.created_at,
    filtered.badge,
    filtered.stock,
    filtered.stock_qty,
    filtered.bg,
    filtered.image_path,
    filtered.allow_bank_transfer,
    pg_catalog.count(*) over () as filtered_total
  from filtered
  order by
    -- 가격·최신순은 지정한 키가 먼저, 동점은 언제나 자연 순서로 되돌아간다(앱의 안정 정렬).
    case when v_sort = 'price_asc' then filtered.price end asc,
    case when v_sort = 'price_desc' then filtered.price end desc,
    case when v_sort = 'newest' then filtered.created_at end desc nulls last,
    public.storefront_natural_prefix(filtered.id) asc,
    public.storefront_natural_number(filtered.id) asc nulls first,
    filtered.id asc
  limit v_limit offset v_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- 컬렉션 집계 — facet 개수와 가격 상한
--
-- **필터를 적용하기 전 스코프**에서 뽑는다. 필터를 걸 때마다 체크박스가 사라지거나
-- 슬라이더 최댓값이 줄면 되돌릴 방법이 없어진다(화면 규칙과 같은 이유).
create or replace function public.storefront_goods_facets(
  p_view text default 'all',
  p_limit integer default 50
)
returns table (kind text, value text, count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_view text := coalesce(p_view, 'all');
begin
  if v_view not in ('all', 'new') then
    raise exception 'unsupported view: %', v_view using errcode = 'check_violation';
  end if;

  return query
  with scope as (
    select good.ip_id, good.type
    from public.goods_storefront as good
    where (v_view <> 'new' or good.badge = 'NEW')
  ),
  ip_facets as (
    -- IP 가 1만 개면 체크박스도 1만 개일 수 없다 — 많이 걸린 순으로 상한까지만 준다.
    select 'ip'::text as kind, scope.ip_id as value, pg_catalog.count(*) as count
    from scope
    group by scope.ip_id
    order by pg_catalog.count(*) desc, scope.ip_id asc
    limit v_limit
  ),
  type_facets as (
    select 'type'::text as kind, scope.type as value, pg_catalog.count(*) as count
    from scope
    group by scope.type
  )
  select ip_facets.kind, ip_facets.value, ip_facets.count from ip_facets
  union all
  select type_facets.kind, type_facets.value, type_facets.count from type_facets;
end;
$$;

create or replace function public.storefront_goods_scope(p_view text default 'all')
returns table (total bigint, price_ceil integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_view text := coalesce(p_view, 'all');
begin
  if v_view not in ('all', 'new') then
    raise exception 'unsupported view: %', v_view using errcode = 'check_violation';
  end if;

  return query
  select pg_catalog.count(*)::bigint, coalesce(pg_catalog.max(good.price), 0)::integer
  from public.goods_storefront as good
  where (v_view <> 'new' or good.badge = 'NEW');
end;
$$;

-- ---------------------------------------------------------------------------
-- ③ id 배열 조회 — 장바구니·위시리스트·결제·BEST 큐레이션
--
-- 순서는 부르는 쪽이 정한다(큐레이션 순서·담은 순서). 여기서는 찾아만 준다.
create or replace function public.storefront_goods_by_ids(p_ids text[])
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
  allow_bank_transfer boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_ids is null or pg_catalog.cardinality(p_ids) = 0 then
    return;
  end if;
  if pg_catalog.cardinality(p_ids) > 500 then
    raise exception 'too many ids: %', pg_catalog.cardinality(p_ids) using errcode = 'check_violation';
  end if;

  return query
  select
    good.id, good.ip_id, good.name, good.type, good.price, good.compare_at_price,
    good.created_at, good.badge, good.stock, good.stock_qty, good.bg, good.image_path,
    good.allow_bank_transfer
  from public.goods_storefront as good
  where good.id = any (p_ids);
end;
$$;

-- ---------------------------------------------------------------------------
-- ① IP 목록 한 페이지 — 팬 많은 순
create or replace function public.storefront_ips_page(
  p_limit integer default 60,
  p_offset integer default 0
)
returns table (
  id text,
  title text,
  sub text,
  vertical_key text,
  tagline text,
  synopsis text,
  glyph text,
  bg text,
  image_path text,
  featured boolean,
  fans_count integer,
  goods_count integer,
  cards_count integer,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 60), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return query
  select
    ip.id, ip.title, ip.sub, ip.vertical_key, ip.tagline, ip.synopsis, ip.glyph,
    ip.bg, ip.image_path, ip.featured, ip.fans_count, ip.goods_count, ip.cards_count,
    pg_catalog.count(*) over () as total_count
  from public.ips as ip
  where ip.archived_at is null
  order by ip.fans_count desc, ip.id asc
  limit v_limit offset v_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- ACL — 공개 표면이다. 로그인하지 않은 방문자도 상점을 본다.
-- security definer 인 이유는 권한 상승이 아니라 **계획 안정성**이다(뷰가 security_invoker 라
-- 어차피 같은 행만 보인다). service_role 은 다른 public 표와 같은 규율로 제외한다.
revoke all on function public.storefront_goods_page(text, text[], text[], integer, integer, text, integer, integer) from public, service_role;
revoke all on function public.storefront_goods_facets(text, integer) from public, service_role;
revoke all on function public.storefront_goods_scope(text) from public, service_role;
revoke all on function public.storefront_goods_by_ids(text[]) from public, service_role;
revoke all on function public.storefront_ips_page(integer, integer) from public, service_role;

grant execute on function public.storefront_goods_page(text, text[], text[], integer, integer, text, integer, integer) to anon, authenticated;
grant execute on function public.storefront_goods_facets(text, integer) to anon, authenticated;
grant execute on function public.storefront_goods_scope(text) to anon, authenticated;
grant execute on function public.storefront_goods_by_ids(text[]) to anon, authenticated;
grant execute on function public.storefront_ips_page(integer, integer) to anon, authenticated;

analyze public.goods;
analyze public.ips;
