-- 규모 슬라이스 ② — 어드민 카탈로그 검색 RPC 5종 (통합 어드민 설계서 v2 §1-4, 리서치 보고서 D §7-2)
--
-- 사본 굿즈·IP 목록의 URL 계약(tab·field·query·ip·type·stock·sort·dir·page·size)을 인자 그대로
-- 받아 서버가 자른다. 총 건수는 정확 count(`count(*) over()`), 탭 건수는 `count(*) filter` 1회 스캔.
-- 검색은 ILIKE 부분 일치(pg_trgm GIN 재사용) — 특수문자 `% _ \` 는 리터럴로, 입력은 NFC 로 정규화.
-- 정렬은 정적 SQL 의 case 로만 고른다(동적 SQL 없음 = 인젝션 표면 없음).
--
-- 모두 stable · security definer · authenticated 에게만 execute(기존 admin_* 관례).
-- 롤백: drop function … (5종) + drop function private.catalog_search_pattern.

create or replace function private.catalog_search_pattern(p_query text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select '%'
    || replace(replace(replace(normalize(btrim(p_query), NFC), '\', '\\'), '%', '\%'), '_', '\_')
    || '%';
$$;

revoke all on function private.catalog_search_pattern(text) from public;

-- ---------------------------------------------------------------------------
-- 굿즈
-- ---------------------------------------------------------------------------

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
  p_offset integer default 0
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
  if v_field not in ('all', 'name', 'id', 'ip') then
    raise check_violation using message = 'invalid goods search field';
  end if;
  if v_stock not in ('all', 'ok', 'low', 'soldout', 'zero') then
    raise check_violation using message = 'invalid goods stock filter';
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
    goods.updated_at,
    count(*) over()::bigint as total_count
  from public.goods as goods
  join public.ips as ips on ips.id = goods.ip_id
  where (v_tab = 'all' or goods.list_status = v_tab)
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
  if v_field not in ('all', 'name', 'id', 'ip') then
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
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- IP
-- ---------------------------------------------------------------------------

create or replace function public.admin_search_ips(
  p_tab text default 'all',
  p_query text default null,
  p_vertical text default null,
  p_sort text default 'id',
  p_dir text default 'asc',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id text,
  archived_at timestamptz,
  title text,
  sub text,
  vertical_key text,
  vertical_label text,
  tagline text,
  synopsis text,
  glyph text,
  bg text,
  image_path text,
  featured boolean,
  fans_count integer,
  goods_count bigint,
  active_goods_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_tab text := coalesce(p_tab, 'all');
  v_sort text := coalesce(p_sort, 'id');
  v_dir text := coalesce(p_dir, 'asc');
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_pattern text;
  v_vertical text := nullif(btrim(coalesce(p_vertical, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 200);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  if v_tab not in ('all', 'active', 'archived') then
    raise check_violation using message = 'invalid ip tab';
  end if;
  if v_sort not in ('id', 'title', 'goods', 'fans') then
    raise check_violation using message = 'invalid ip sort key';
  end if;
  if v_dir not in ('asc', 'desc') then
    raise check_violation using message = 'invalid sort direction';
  end if;
  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'ip search query too long';
  end if;
  v_pattern := case when v_query is null then null else private.catalog_search_pattern(v_query) end;

  return query
  select
    ips.id,
    ips.archived_at,
    ips.title,
    ips.sub,
    ips.vertical_key,
    coalesce(verticals.label, ips.vertical_key) as vertical_label,
    ips.tagline,
    ips.synopsis,
    ips.glyph,
    ips.bg,
    ips.image_path,
    ips.featured,
    ips.fans_count,
    counted.goods_count,
    counted.active_goods_count,
    count(*) over()::bigint as total_count
  from public.ips as ips
  left join public.verticals as verticals on verticals.key = ips.vertical_key
  cross join lateral (
    select
      count(*)::bigint as goods_count,
      count(*) filter (where goods.archived_at is null)::bigint as active_goods_count
    from public.goods as goods
    where goods.ip_id = ips.id
  ) as counted
  where (
      v_tab = 'all'
      or (v_tab = 'active' and ips.archived_at is null)
      or (v_tab = 'archived' and ips.archived_at is not null)
    )
    and (v_vertical is null or ips.vertical_key = v_vertical)
    and (
      v_pattern is null
      or ips.title ilike v_pattern escape '\'
      or ips.id ilike v_pattern escape '\'
    )
  order by
    case when v_dir = 'asc' then
      case v_sort when 'id' then ips.id when 'title' then ips.title end
    end asc,
    case when v_dir = 'asc' then
      case v_sort when 'goods' then counted.active_goods_count when 'fans' then ips.fans_count::bigint end
    end asc,
    case when v_dir = 'desc' then
      case v_sort when 'id' then ips.id when 'title' then ips.title end
    end desc,
    case when v_dir = 'desc' then
      case v_sort when 'goods' then counted.active_goods_count when 'fans' then ips.fans_count::bigint end
    end desc,
    ips.id asc
  limit v_limit offset v_offset;
end;
$$;

create or replace function public.admin_ips_tab_counts(
  p_query text default null,
  p_vertical text default null
)
returns table (
  all_count bigint,
  active_count bigint,
  archived_count bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_pattern text;
  v_vertical text := nullif(btrim(coalesce(p_vertical, '')), '');
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'ip search query too long';
  end if;
  v_pattern := case when v_query is null then null else private.catalog_search_pattern(v_query) end;

  return query
  select
    count(*)::bigint as all_count,
    count(*) filter (where ips.archived_at is null)::bigint as active_count,
    count(*) filter (where ips.archived_at is not null)::bigint as archived_count
  from public.ips as ips
  where (v_vertical is null or ips.vertical_key = v_vertical)
    and (
      v_pattern is null
      or ips.title ilike v_pattern escape '\'
      or ips.id ilike v_pattern escape '\'
    );
end;
$$;

-- 검색형 IP 선택기. 보관 IP 는 기본 제외하되 이미 선택된 IP 는 보관이어도 항상 첫 행으로 돌려준다
-- (그 IP 를 참조하는 굿즈를 편집할 때 선택지가 사라지면 저장이 막힌다).
-- rank: 0 = 선택된 IP · 1 = 제목/코드 접두 일치 · 2 = 부분 일치 · 3 = 검색어 없음(팬 많은 순).
create or replace function public.admin_pick_ips(
  p_query text default null,
  p_selected_id text default null,
  p_limit integer default 50
)
returns table (
  id text,
  title text,
  vertical_key text,
  archived_at timestamptz,
  fans_count integer,
  rank integer
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_pattern text;
  v_prefix text;
  v_selected text := nullif(btrim(coalesce(p_selected_id, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'ip search query too long';
  end if;
  v_pattern := case when v_query is null then null else private.catalog_search_pattern(v_query) end;
  v_prefix := case when v_query is null then null else right(v_pattern, -1) end;

  return query
  select picked.id, picked.title, picked.vertical_key, picked.archived_at, picked.fans_count, picked.rank
  from (
    select
      ips.id,
      ips.title,
      ips.vertical_key,
      ips.archived_at,
      ips.fans_count,
      case
        when ips.id = v_selected then 0
        when v_pattern is null then 3
        when ips.title ilike v_prefix escape '\' or ips.id ilike v_prefix escape '\' then 1
        else 2
      end as rank
    from public.ips as ips
    where ips.id = v_selected
      or (
        ips.archived_at is null
        and (
          v_pattern is null
          or ips.title ilike v_pattern escape '\'
          or ips.id ilike v_pattern escape '\'
        )
      )
  ) as picked
  order by picked.rank asc, picked.fans_count desc, picked.id asc
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- ACL — 기존 어드민 관례: authenticated 만 execute, anon·service_role 거부(RPC 안에서 is_staff 재검사)
-- ---------------------------------------------------------------------------

revoke all on function public.admin_search_goods(text, text, text, text, text, text, text, text, integer, integer) from public, anon, service_role;
grant execute on function public.admin_search_goods(text, text, text, text, text, text, text, text, integer, integer) to authenticated;

revoke all on function public.admin_goods_tab_counts(text, text, text, text, text) from public, anon, service_role;
grant execute on function public.admin_goods_tab_counts(text, text, text, text, text) to authenticated;

revoke all on function public.admin_search_ips(text, text, text, text, text, integer, integer) from public, anon, service_role;
grant execute on function public.admin_search_ips(text, text, text, text, text, integer, integer) to authenticated;

revoke all on function public.admin_ips_tab_counts(text, text) from public, anon, service_role;
grant execute on function public.admin_ips_tab_counts(text, text) to authenticated;

revoke all on function public.admin_pick_ips(text, text, integer) from public, anon, service_role;
grant execute on function public.admin_pick_ips(text, text, integer) to authenticated;
