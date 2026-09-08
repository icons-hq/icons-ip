-- 현업 요청 슬라이스 5(마무리) — 굿즈 조회에 바코드 축
--
-- 요청: 「굿즈 조회(상품번호·바코드·상품명)」. 슬라이스 1에서 `goods.barcode` 열은 넣었지만
-- **찾을 수는 없었다** — 열만 있고 검색 축이 없으면 적어 둔 값이 아무 일도 하지 않는다.
--
-- 목록과 탭 집계가 **같은 조건**을 봐야 한다. 한쪽만 고치면 「검색하면 나오는데 탭 수는 0」이
-- 되고, 그때 운영자는 목록을 믿지 않게 된다.
--
-- 함정 메모: 두 함수 모두 **지금 살아 있는 정의**를 베껴 와서 한 줄만 더한다.
-- `admin_search_goods` 는 판매 상태 마이그레이션(20260904130300)에서 인자가 11개로 늘었다 —
-- 옛 10인자 판을 그대로 `create or replace` 하면 **없어진 줄 알았던 오버로드가 되살아나고**,
-- 그 뒤로는 인자 없는 호출이 전부 "is not unique" 로 죽는다(여기서 한 번 밟았다).

-- 되살아났을 수 있는 옛 10인자 판을 내린다. 20260904130300 이 이미 내린 것과 같은 시그니처다.
drop function if exists public.admin_search_goods(text, text, text, text, text, text, text, text, integer, integer);

create or replace function public.admin_search_goods(
  p_tab text default 'all',
  p_field text default 'all',
  p_query text default null,
  p_ip_id text default null,
  p_type text default null,
  p_stock text default 'all',
  p_sort text default 'id',
  p_dir text default 'asc',
  p_limit integer default 20,
  p_offset integer default 0,
  p_sale_state text default 'all'
)
returns table (
  id text,
  archived_at timestamptz,
  ip_id text,
  ip_title text,
  name text,
  type text,
  price integer,
  compare_at_price integer,
  badge text,
  stock text,
  stock_qty integer,
  allow_bank_transfer boolean,
  bg text,
  image_path text,
  notice_maker text,
  notice_origin text,
  notice_material text,
  notice_size text,
  notice_made_on text,
  notice_as_manager text,
  notice_as_contact text,
  description text,
  gallery_paths text[],
  detail_image_path text,
  list_status text,
  sale_state text,
  hidden_at timestamptz,
  stopped_at timestamptz,
  sale_starts_at timestamptz,
  sale_ends_at timestamptz,
  sale_mode text,
  preorder_ships_at date,
  summary text,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_tab text := coalesce(p_tab, 'all');
  v_field text := coalesce(p_field, 'all');
  v_stock text := coalesce(p_stock, 'all');
  v_sale_state text := coalesce(p_sale_state, 'all');
  v_sort text := coalesce(p_sort, 'id');
  v_dir text := coalesce(p_dir, 'asc');
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_pattern text;
  v_ip text := nullif(btrim(coalesce(p_ip_id, '')), '');
  v_type text := nullif(btrim(coalesce(p_type, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 200);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  if v_tab not in ('all', 'selling', 'low', 'soldout', 'archived') then
    raise check_violation using message = 'invalid goods tab';
  end if;
  if v_field not in ('all', 'name', 'id', 'ip', 'barcode') then
    raise check_violation using message = 'invalid goods search field';
  end if;
  if v_stock not in ('all', 'ok', 'low', 'soldout', 'zero') then
    raise check_violation using message = 'invalid goods stock filter';
  end if;
  if v_sale_state not in ('all', 'archived', 'hidden', 'stopped', 'ended', 'scheduled', 'soldout', 'preorder', 'on_sale') then
    raise check_violation using message = 'invalid goods sale state';
  end if;
  if v_sort not in ('id', 'name', 'ip', 'price', 'stock_qty') then
    raise check_violation using message = 'invalid goods sort key';
  end if;
  if v_dir not in ('asc', 'desc') then
    raise check_violation using message = 'invalid sort direction';
  end if;
  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'goods search query too long';
  end if;
  v_pattern := case when v_query is null then null else private.catalog_search_pattern(v_query) end;

  return query
  select
    goods.id,
    goods.archived_at,
    goods.ip_id,
    ips.title as ip_title,
    goods.name,
    goods.type,
    goods.price,
    goods.compare_at_price,
    goods.badge,
    goods.stock,
    goods.stock_qty,
    goods.allow_bank_transfer,
    goods.bg,
    goods.image_path,
    goods.notice_maker,
    goods.notice_origin,
    goods.notice_material,
    goods.notice_size,
    goods.notice_made_on,
    goods.notice_as_manager,
    goods.notice_as_contact,
    goods.description,
    goods.gallery_paths,
    goods.detail_image_path,
    goods.list_status,
    public.good_sale_state(goods) as sale_state,
    goods.hidden_at,
    goods.stopped_at,
    goods.sale_starts_at,
    goods.sale_ends_at,
    goods.sale_mode,
    goods.preorder_ships_at,
    goods.summary,
    goods.updated_at,
    count(*) over()::bigint as total_count
  from public.goods as goods
  join public.ips as ips on ips.id = goods.ip_id
  where (v_tab = 'all' or goods.list_status = v_tab)
    and (v_sale_state = 'all' or public.good_sale_state(goods) = v_sale_state)
    and (v_ip is null or goods.ip_id = v_ip)
    and (v_type is null or goods.type = v_type)
    and (
      v_stock = 'all'
      or (v_stock = 'zero' and goods.stock_qty <= 0)
      or (v_stock <> 'zero' and goods.stock = v_stock)
    )
    and (
      v_pattern is null
      or (v_field in ('all', 'name') and goods.name ilike v_pattern escape '\')
      or (v_field in ('all', 'id') and goods.id ilike v_pattern escape '\')
      or (v_field in ('all', 'ip') and (ips.title ilike v_pattern escape '\' or goods.ip_id ilike v_pattern escape '\'))
      -- 바코드는 **전체 검색에도** 걸린다. 창고에서 스캐너로 찍은 값을 그대로 붙여 넣는데,
      -- 축을 따로 골라야만 찾히면 그 한 단계에서 손이 멈춘다.
      or (v_field in ('all', 'barcode') and goods.barcode ilike v_pattern escape '\')
    )
  order by
    case when v_dir = 'asc' then
      case v_sort when 'id' then goods.id when 'name' then goods.name when 'ip' then ips.title end
    end asc,
    case when v_dir = 'asc' then
      case v_sort when 'price' then goods.price when 'stock_qty' then goods.stock_qty end
    end asc,
    case when v_dir = 'desc' then
      case v_sort when 'id' then goods.id when 'name' then goods.name when 'ip' then ips.title end
    end desc,
    case when v_dir = 'desc' then
      case v_sort when 'price' then goods.price when 'stock_qty' then goods.stock_qty end
    end desc,
    -- 정렬 키가 같은 행은 id 순을 지킨다(앱 참조 구현의 안정 정렬과 동일).
    goods.id asc
  limit v_limit offset v_offset;
end;
$$;

create or replace function public.admin_goods_tab_counts(
  p_field text default 'all',
  p_query text default null,
  p_ip_id text default null,
  p_type text default null,
  p_stock text default 'all'
)
returns table (
  all_count bigint,
  selling_count bigint,
  low_count bigint,
  soldout_count bigint,
  archived_count bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_field text := coalesce(p_field, 'all');
  v_stock text := coalesce(p_stock, 'all');
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_pattern text;
  v_ip text := nullif(btrim(coalesce(p_ip_id, '')), '');
  v_type text := nullif(btrim(coalesce(p_type, '')), '');
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  if v_field not in ('all', 'name', 'id', 'ip', 'barcode') then
    raise check_violation using message = 'invalid goods search field';
  end if;
  if v_stock not in ('all', 'ok', 'low', 'soldout', 'zero') then
    raise check_violation using message = 'invalid goods stock filter';
  end if;
  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'goods search query too long';
  end if;
  v_pattern := case when v_query is null then null else private.catalog_search_pattern(v_query) end;

  return query
  select
    count(*)::bigint as all_count,
    count(*) filter (where goods.list_status = 'selling')::bigint as selling_count,
    count(*) filter (where goods.list_status = 'low')::bigint as low_count,
    count(*) filter (where goods.list_status = 'soldout')::bigint as soldout_count,
    count(*) filter (where goods.list_status = 'archived')::bigint as archived_count
  from public.goods as goods
  join public.ips as ips on ips.id = goods.ip_id
  where (v_ip is null or goods.ip_id = v_ip)
    and (v_type is null or goods.type = v_type)
    and (
      v_stock = 'all'
      or (v_stock = 'zero' and goods.stock_qty <= 0)
      or (v_stock <> 'zero' and goods.stock = v_stock)
    )
    and (
      v_pattern is null
      or (v_field in ('all', 'name') and goods.name ilike v_pattern escape '\')
      or (v_field in ('all', 'id') and goods.id ilike v_pattern escape '\')
      or (v_field in ('all', 'ip') and (ips.title ilike v_pattern escape '\' or goods.ip_id ilike v_pattern escape '\'))
      -- 바코드는 **전체 검색에도** 걸린다. 창고에서 스캐너로 찍은 값을 그대로 붙여 넣는데,
      -- 축을 따로 골라야만 찾히면 그 한 단계에서 손이 멈춘다.
      or (v_field in ('all', 'barcode') and goods.barcode ilike v_pattern escape '\')
    );
end;
$$;
