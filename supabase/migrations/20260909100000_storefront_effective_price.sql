-- 스토어프론트 굿즈 RPC 네 개가 할인 전 판매가(goods.price)를 돌려주고 있었다. 주문 생성(create_order)·
-- 장바구니 견적은 good_effective_price 로 계산하므로 상품 화면 ₩42,000 · 결제 ₩37,800 이 갈렸다 —
-- 2026-09-09 브라우저 QA 에서 발견. 뷰 goods_storefront 는 이미 effective_price 를 갖고 있으므로
-- 네 함수의 가격 표현만 그것으로 바꾼다. 시그니처는 그대로(create or replace · 권한 유지) —
-- 라이브 정의를 베껴 가격 줄만 고친 것이다(옛 시그니처를 되살리지 않는다).

create or replace function public.storefront_goods_scope(p_view text default 'all'::text)
returns table(total bigint, price_ceil integer)
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_view text := coalesce(p_view, 'all');
begin
  if v_view not in ('all', 'new') then
    raise exception 'unsupported view: %', v_view using errcode = 'check_violation';
  end if;

  return query
  select pg_catalog.count(*)::bigint, coalesce(pg_catalog.max(good.effective_price), 0)::integer
  from public.goods_storefront as good
  where (v_view <> 'new' or good.badge = 'NEW');
end;
$function$;

create or replace function public.storefront_goods_page(
  p_view text default 'all'::text, p_ip_ids text[] default null::text[], p_types text[] default null::text[],
  p_price_min integer default null::integer, p_price_max integer default null::integer,
  p_sort text default 'recommended'::text, p_limit integer default 60, p_offset integer default 0
)
returns table(
  id text, ip_id text, name text, type text, price integer, compare_at_price integer,
  created_at timestamp with time zone, badge text, stock text, stock_qty integer, bg text, image_path text,
  allow_bank_transfer boolean, filtered_total bigint
)
language plpgsql
stable security definer
set search_path to ''
as $function$
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
      -- 가격 필터·정렬도 손님이 실제로 내는 값 기준이다.
      and (p_price_min is null or scope.effective_price >= p_price_min)
      and (p_price_max is null or scope.effective_price <= p_price_max)
  )
  select
    filtered.id,
    filtered.ip_id,
    filtered.name,
    filtered.type,
    filtered.effective_price,
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
    case when v_sort = 'price_asc' then filtered.effective_price end asc,
    case when v_sort = 'price_desc' then filtered.effective_price end desc,
    case when v_sort = 'newest' then filtered.created_at end desc nulls last,
    public.storefront_natural_prefix(filtered.id) asc,
    public.storefront_natural_number(filtered.id) asc nulls first,
    filtered.id asc
  limit v_limit offset v_offset;
end;
$function$;

create or replace function public.storefront_goods_by_ids(p_ids text[])
returns table(
  id text, ip_id text, name text, type text, price integer, compare_at_price integer,
  created_at timestamp with time zone, badge text, stock text, stock_qty integer, bg text, image_path text,
  allow_bank_transfer boolean
)
language plpgsql
stable security definer
set search_path to ''
as $function$
begin
  if p_ids is null or pg_catalog.cardinality(p_ids) = 0 then
    return;
  end if;
  if pg_catalog.cardinality(p_ids) > 500 then
    raise exception 'too many ids: %', pg_catalog.cardinality(p_ids) using errcode = 'check_violation';
  end if;

  return query
  select
    good.id, good.ip_id, good.name, good.type, good.effective_price, good.compare_at_price,
    good.created_at, good.badge, good.stock, good.stock_qty, good.bg, good.image_path,
    good.allow_bank_transfer
  from public.goods_storefront as good
  where good.id = any (p_ids);
end;
$function$;

create or replace function public.storefront_goods_search(p_query text, p_limit integer default 40, p_offset integer default 0)
returns table(
  id text, ip_id text, name text, type text, price integer, compare_at_price integer,
  created_at timestamp with time zone, badge text, stock text, stock_qty integer, bg text, image_path text,
  allow_bank_transfer boolean, filtered_total bigint
)
language plpgsql
stable security definer
set search_path to ''
as $function$
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
      good.id, good.ip_id, good.name, good.type, good.effective_price as price, good.compare_at_price,
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
$function$;
