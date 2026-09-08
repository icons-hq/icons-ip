-- 규모 후속 — 어드민 카드 목록 페이징 (설계서 v2 §마이그레이션 ③ 「다른 8화면의 getAdminCatalogRecords 는 후속」)
--
-- 카드 화면은 `getAdminCatalogRecords({ include: ['cards', 'ips', 'cardPools'] })` 로 카드·IP 전량을
-- limit 없이 읽었다. PostgREST 는 1,000행에서 **말없이** 잘라내므로 카드가 그만큼 쌓이면 목록에
-- 없는 카드가 생긴다 — 굿즈·IP 목록을 옮긴 것과 같은 결함, 같은 처방이다.
--
-- IP 검색 RPC 와 **같은 계약**이다: staff 만, 탭(전체/운영 중/보관)·검색·IP·풀·등급 필터,
-- 정렬 화이트리스트, 한 페이지 + 윈도 count. 목록과 탭 집계는 같은 where 를 본다 —
-- 한쪽만 고치면 「검색하면 나오는데 탭 수는 0」이 된다.
--
-- 함정 메모: `cards.rarity` 는 enum 이라 text 와 바로 비교하면 죽는다 — `::text` 로 맞춘다.
-- `coalesce`/`least`/`greatest` 는 SQL 문법이라 `pg_catalog.` 을 붙일 수 없다.

create or replace function public.admin_search_cards(
  p_tab text default 'all',
  p_query text default null,
  p_ip_id text default null,
  p_pool_id uuid default null,
  p_rarity text default null,
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
  pool_id uuid,
  pool_name text,
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
set search_path = public, extensions, pg_temp
as $$
declare
  v_tab text := coalesce(p_tab, 'all');
  v_sort text := coalesce(p_sort, 'id');
  v_dir text := coalesce(p_dir, 'asc');
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_pattern text;
  v_ip text := nullif(btrim(coalesce(p_ip_id, '')), '');
  v_rarity text := nullif(btrim(coalesce(p_rarity, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 200);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  if v_tab not in ('all', 'active', 'archived') then
    raise check_violation using message = 'invalid card tab';
  end if;
  if v_sort not in ('id', 'name', 'no', 'rarity') then
    raise check_violation using message = 'invalid card sort key';
  end if;
  if v_dir not in ('asc', 'desc') then
    raise check_violation using message = 'invalid sort direction';
  end if;
  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'card search query too long';
  end if;
  v_pattern := case when v_query is null then null else private.catalog_search_pattern(v_query) end;

  return query
  select
    cards.id,
    cards.archived_at,
    cards.ip_id,
    coalesce(ips.title, cards.ip_id) as ip_title,
    cards.pool_id,
    pools.name as pool_name,
    cards.name,
    cards.no,
    cards.rarity::text,
    cards.bg,
    cards.image_path,
    count(*) over()::bigint as total_count
  from public.cards as cards
  left join public.ips as ips on ips.id = cards.ip_id
  left join public.card_pools as pools on pools.id = cards.pool_id
  where (
      v_tab = 'all'
      or (v_tab = 'active' and cards.archived_at is null)
      or (v_tab = 'archived' and cards.archived_at is not null)
    )
    and (v_ip is null or cards.ip_id = v_ip)
    and (p_pool_id is null or cards.pool_id = p_pool_id)
    and (v_rarity is null or cards.rarity::text = v_rarity)
    and (
      v_pattern is null
      or cards.name ilike v_pattern escape '\'
      or cards.id ilike v_pattern escape '\'
      or coalesce(cards.no, '') ilike v_pattern escape '\'
    )
  order by
    case when v_dir = 'asc' then
      case v_sort when 'id' then cards.id when 'name' then cards.name when 'no' then cards.no when 'rarity' then cards.rarity::text end
    end asc,
    case when v_dir = 'desc' then
      case v_sort when 'id' then cards.id when 'name' then cards.name when 'no' then cards.no when 'rarity' then cards.rarity::text end
    end desc,
    cards.id asc
  limit v_limit offset v_offset;
end;
$$;

create or replace function public.admin_cards_tab_counts(
  p_query text default null,
  p_ip_id text default null,
  p_pool_id uuid default null,
  p_rarity text default null
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
  v_ip text := nullif(btrim(coalesce(p_ip_id, '')), '');
  v_rarity text := nullif(btrim(coalesce(p_rarity, '')), '');
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'card search query too long';
  end if;
  v_pattern := case when v_query is null then null else private.catalog_search_pattern(v_query) end;

  return query
  select
    count(*)::bigint as all_count,
    count(*) filter (where cards.archived_at is null)::bigint as active_count,
    count(*) filter (where cards.archived_at is not null)::bigint as archived_count
  from public.cards as cards
  where (v_ip is null or cards.ip_id = v_ip)
    and (p_pool_id is null or cards.pool_id = p_pool_id)
    and (v_rarity is null or cards.rarity::text = v_rarity)
    and (
      v_pattern is null
      or cards.name ilike v_pattern escape '\'
      or cards.id ilike v_pattern escape '\'
      or coalesce(cards.no, '') ilike v_pattern escape '\'
    );
end;
$$;

revoke all on function public.admin_search_cards(text, text, text, uuid, text, text, text, integer, integer) from public, anon, service_role;
revoke all on function public.admin_cards_tab_counts(text, text, uuid, text) from public, anon, service_role;
grant execute on function public.admin_search_cards(text, text, text, uuid, text, text, text, integer, integer) to authenticated;
grant execute on function public.admin_cards_tab_counts(text, text, uuid, text) to authenticated;

create index if not exists cards_admin_list_idx on public.cards (archived_at, ip_id, pool_id, id);
analyze public.cards;
