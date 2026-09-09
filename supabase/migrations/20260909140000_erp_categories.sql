-- 카탈로그 분류 = ERP(K-System) 품목대중소분류 (PM 2026-09-09 「상품 분류는 ERP 기준으로」)
--
-- 분류 트리의 1~3단은 ERP 제상품 분류(대 8 · 중 52 · 소 290, 2026-08-04 품목대중소분류정의)를 그대로 쓴다.
-- 이름·위치·순서는 ERP 가 원본이라 어드민에서 바꾸지 않고(잠금 트리거) 동기화 함수로만 바뀐다.
-- 자체 분류는 ERP 잎(소분류) 아래 4단째로만 만든다 — 그래야 어떤 굿즈든 대표 분류의 조상 셋이 항상
-- ERP 대/중/소분류가 되고, ERP 품목 등록 엑셀의 분류 열 셋이 이름 짐작이 아니라 확정값이 된다.
-- 기획전(collection)은 ERP 와 무관한 우리 진열 묶음이라 그대로 자유다.
-- ERP 분류에 없는 굿즈 유형(아크릴 스탠드·포토카드·세트 구성)은 가장 가까운 ERP 소분류 아래 자체 분류로 두고,
-- ERP 쪽에 소분류를 추가해 달라고 요청한다(그때 동기화하면 옮겨 달면 된다).
--
-- 진열 설정(표시·정렬·품절 뒤로·하위 포함·SEO·이미지)은 ERP 노드라도 우리 몫이라 열려 있다 — 잠기는 것은 정체(id·부모·이름·순서)다.
--
-- 롤백: 트리거·함수 drop → `delete from public.categories where source = 'erp'`(소속 행이 있으면 먼저 옮긴다) → 열 drop.

-- ---------------------------------------------------------------------------
-- 1. 열 — 출처 · ERP 자연키(이름 경로) · 동기화 시각 · ERP 에서 사라진 시각
-- ---------------------------------------------------------------------------
alter table public.categories
  add column source text not null default 'store' check (source in ('store', 'erp')),
  add column erp_key text check (erp_key is null or char_length(erp_key) between 1 and 200),
  add column erp_synced_at timestamptz,
  add column erp_removed_at timestamptz,
  add constraint categories_erp_key_matches_source check ((source = 'erp') = (erp_key is not null)),
  add constraint categories_collection_is_store check (kind = 'catalog' or source = 'store');
create unique index categories_erp_key_key on public.categories (erp_key) where erp_key is not null;

comment on column public.categories.source is 'erp = K-System 품목대중소분류에서 동기화한 노드(정체 잠금) · store = 어드민이 만든 노드(ERP 잎 아래 4단째 또는 기획전).';
comment on column public.categories.erp_key is 'ERP 자연키 = 이름 경로(「문구 > 노트 > 스프링노트」). ERP 에 분류 코드가 없어서 이름 경로로 맞춘다.';
comment on column public.categories.erp_removed_at is '마지막 동기화 목록에 없던 ERP 노드. 지우지 않고 숨긴다 — 굿즈가 매달려 있을 수 있다.';

-- ---------------------------------------------------------------------------
-- 2. ERP 잎 판정 — 자체 분류를 매달 수 있는 자리
-- ---------------------------------------------------------------------------
create or replace function private.is_erp_leaf_category(p_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.categories as parent
    where parent.id = p_id
      and parent.source = 'erp'
      and parent.archived_at is null
      and not exists (
        select 1 from public.categories as child
        where child.parent_id = parent.id and child.source = 'erp'
      )
  );
$$;
revoke all on function private.is_erp_leaf_category(text) from public;

-- ---------------------------------------------------------------------------
-- 3. 잠금 트리거 — ERP 노드의 정체는 동기화(세션 플래그)만 바꾼다
-- ---------------------------------------------------------------------------
create or replace function private.guard_erp_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('icons.erp_category_sync', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.source = 'erp' then
      raise exception 'category_erp_locked' using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.source = 'erp' then
      raise exception 'category_erp_locked' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.source = 'erp' or new.source = 'erp' then
    if new.id is distinct from old.id
      or new.kind is distinct from old.kind
      or new.parent_id is distinct from old.parent_id
      or new.name is distinct from old.name
      or new.position is distinct from old.position
      or new.source is distinct from old.source
      or new.erp_key is distinct from old.erp_key
      or new.erp_synced_at is distinct from old.erp_synced_at
      or new.erp_removed_at is distinct from old.erp_removed_at
      or new.archived_at is distinct from old.archived_at
    then
      raise exception 'category_erp_locked' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger categories_guard_erp before insert or update or delete on public.categories
  for each row execute function private.guard_erp_category();

-- ---------------------------------------------------------------------------
-- 4. 동기화 — ERP 분류 목록(JSON)을 받아 이름 경로로 맞춘다
--    행 = {id, key, parentKey, name, level(1~3), position}. 없어진 노드는 erp_removed_at + 숨김.
-- ---------------------------------------------------------------------------
create or replace function private.sync_erp_categories(p_rows jsonb)
returns table (inserted integer, updated integer, removed integer)
language plpgsql
set search_path = ''
as $$
declare
  v_inserted integer := 0;
  v_updated integer := 0;
  v_removed integer := 0;
  v_level integer;
  v_row record;
  v_parent_id text;
  v_existing record;
  v_id text;
  v_suffix integer;
begin
  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' or pg_catalog.jsonb_array_length(p_rows) = 0 then
    raise exception 'erp_categories_payload_invalid' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('icons.erp_category_sync', 'on', true);

  for v_level in 1..3 loop
    for v_row in
      select
        item->>'id' as id,
        item->>'key' as key,
        item->>'parentKey' as parent_key,
        item->>'name' as name,
        (item->>'position')::integer as position
      from pg_catalog.jsonb_array_elements(p_rows) as item
      where (item->>'level')::integer = v_level
      order by (item->>'position')::integer, item->>'id'
    loop
      if v_row.id is null or v_row.key is null or v_row.name is null or v_row.position is null
        or (v_level = 1) <> (v_row.parent_key is null)
      then
        raise exception 'erp_categories_payload_invalid' using errcode = '22023';
      end if;

      v_parent_id := null;
      if v_row.parent_key is not null then
        select category.id into v_parent_id
        from public.categories as category
        where category.erp_key = v_row.parent_key;
        if v_parent_id is null then
          raise exception 'erp_categories_parent_missing' using errcode = 'P0002';
        end if;
      end if;

      select category.id, category.parent_id, category.name, category.position into v_existing
      from public.categories as category
      where category.erp_key = v_row.key;

      if not found then
        -- id 는 목록이 제안한 값. 이미 다른 노드가 쓰고 있으면 꼬리를 붙인다(자연키는 erp_key 라 id 는 안정만 하면 된다).
        v_id := v_row.id;
        v_suffix := 1;
        while exists (select 1 from public.categories as taken where taken.id = v_id) loop
          v_suffix := v_suffix + 1;
          v_id := v_row.id || '-' || v_suffix::text;
        end loop;
        insert into public.categories (id, kind, parent_id, name, path, depth, position, source, erp_key, erp_synced_at)
        values (v_id, 'catalog', v_parent_id, v_row.name, '', 1, v_row.position, 'erp', v_row.key, pg_catalog.now());
        v_inserted := v_inserted + 1;
      else
        if v_existing.parent_id is distinct from v_parent_id
          or v_existing.name is distinct from v_row.name
          or v_existing.position is distinct from v_row.position
        then
          v_updated := v_updated + 1;
        end if;
        update public.categories
        set parent_id = v_parent_id,
            name = v_row.name,
            position = v_row.position,
            erp_synced_at = pg_catalog.now(),
            erp_removed_at = null
        where erp_key = v_row.key;
      end if;
    end loop;
  end loop;

  update public.categories
  set erp_removed_at = pg_catalog.now(), status = 'hidden'
  where source = 'erp'
    and erp_removed_at is null
    and erp_key not in (select item->>'key' from pg_catalog.jsonb_array_elements(p_rows) as item where item->>'key' is not null);
  get diagnostics v_removed = row_count;

  perform pg_catalog.set_config('icons.erp_category_sync', 'off', true);
  return query select v_inserted, v_updated, v_removed;
end;
$$;
revoke all on function private.sync_erp_categories(jsonb) from public;

create or replace function public.admin_sync_erp_categories(p_rows jsonb)
returns table (inserted integer, updated integer, removed integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_result record;
begin
  select sync.inserted, sync.updated, sync.removed into v_result
  from private.sync_erp_categories(p_rows) as sync;

  perform private.record_admin_action(
    null, v_actor, 'catalog.category.erp_sync', 'category:erp',
    jsonb_build_object('rows', jsonb_array_length(p_rows), 'inserted', v_result.inserted,
                       'updated', v_result.updated, 'removed', v_result.removed)
  );
  return query select v_result.inserted, v_result.updated, v_result.removed;
end;
$$;
revoke all on function public.admin_sync_erp_categories(jsonb) from public, anon, service_role;
grant execute on function public.admin_sync_erp_categories(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. 유형(goods.type) 파생 — 대표 분류의 ERP 조상에서. 매핑이 없으면 손으로 고른 값을 둔다.
--    (아크릴 스탠드·세트 구성은 ERP 에 없어 수동. 유형은 스토어 필터 축이라 아직 남긴다.)
-- ---------------------------------------------------------------------------
create or replace function private.good_type_for_category(p_category_id text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when chain.names[3] = '인형' then '인형'
    when chain.names[3] = '피규어' then '피규어'
    when chain.names[2] = '키링' then '키링'
    when chain.names[2] = '파우치' then '파우치'
    when chain.names[2] = '쿠션' or chain.names[3] = '쿠션' then '쿠션'
    when chain.names[1] = '문구' then '문구'
    else null
  end
  from (
    select array(
      select ancestor.name
      from pg_catalog.unnest(pg_catalog.string_to_array(pg_catalog.btrim(category.path, '/'), '/')) with ordinality as part(id, ord)
      join public.categories as ancestor on ancestor.id = part.id
      where ancestor.source = 'erp'
      order by part.ord
    ) as names
    from public.categories as category
    where category.id = p_category_id
  ) as chain;
$$;
revoke all on function private.good_type_for_category(text) from public;

-- ---------------------------------------------------------------------------
-- 6. RPC 개정 — 만들기(자체 분류는 ERP 잎 아래만) · 옮기기 · 보관 · 소속(유형 파생) · 목록(출처 열)
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_category(
  target_id text,
  target_name text,
  target_parent_id text default null,
  target_kind text default 'catalog',
  target_description text default null,
  target_status text default 'active',
  target_is_internal boolean default false,
  target_display_mode text default 'manual',
  target_auto_sort_key text default 'newest',
  target_soldout_last boolean default true,
  target_include_descendants boolean default true,
  target_hero_image_path text default null,
  target_seo_title text default null,
  target_seo_description text default null,
  target_previous_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_previous text := nullif(btrim(coalesce(target_previous_id, '')), '');
  v_parent text := nullif(btrim(coalesce(target_parent_id, '')), '');
  v_name text := nullif(btrim(coalesce(target_name, '')), '');
  v_next_position integer;
begin
  if v_previous is not null and v_previous is distinct from target_id then
    raise exception 'catalog_id_immutable' using errcode = '22023';
  end if;
  if v_name is null or char_length(v_name) > 60 then
    raise exception 'category_name_invalid' using errcode = '22023';
  end if;
  if target_kind not in ('catalog', 'collection') then
    raise exception 'category_kind_invalid' using errcode = '22023';
  end if;
  if target_kind = 'collection' and v_parent is not null then
    raise exception 'category_collection_flat' using errcode = '23514';
  end if;
  if v_parent is not null and not exists (select 1 from public.categories as parent where parent.id = v_parent) then
    raise exception 'category_parent_missing' using errcode = 'P0002';
  end if;
  -- 새 카탈로그 분류는 ERP 잎(소분류) 아래에만 — 1~3단은 ERP 가 원본이다.
  if v_previous is null and target_kind = 'catalog' and (v_parent is null or not private.is_erp_leaf_category(v_parent)) then
    raise exception 'category_catalog_under_erp_leaf' using errcode = '23514';
  end if;

  select coalesce(max(sibling.position), -1) + 1 into v_next_position
  from public.categories as sibling
  where sibling.parent_id is not distinct from v_parent;

  insert into public.categories (
    id, kind, parent_id, name, description, path, depth, position, status, is_internal,
    display_mode, auto_sort_key, soldout_last, include_descendants, hero_image_path, seo_title, seo_description
  )
  values (
    target_id, target_kind, v_parent, v_name, nullif(btrim(coalesce(target_description, '')), ''),
    '', 1, v_next_position, target_status, target_is_internal,
    target_display_mode, target_auto_sort_key, target_soldout_last, target_include_descendants,
    nullif(btrim(coalesce(target_hero_image_path, '')), ''),
    nullif(btrim(coalesce(target_seo_title, '')), ''),
    nullif(btrim(coalesce(target_seo_description, '')), '')
  )
  on conflict (id) do update set
    -- ERP 노드의 이름은 ERP 가 원본 — 폼이 다른 이름을 보내도 바꾸지 않는다(진열 설정만 받는다).
    name = case when categories.source = 'erp' then categories.name else excluded.name end,
    description = excluded.description,
    status = excluded.status,
    is_internal = excluded.is_internal,
    display_mode = excluded.display_mode,
    auto_sort_key = excluded.auto_sort_key,
    soldout_last = excluded.soldout_last,
    include_descendants = excluded.include_descendants,
    hero_image_path = excluded.hero_image_path,
    seo_title = excluded.seo_title,
    seo_description = excluded.seo_description
  where v_previous is not null;

  if not found then
    raise exception 'catalog_id_taken' using errcode = '23505';
  end if;

  perform private.record_admin_action(
    null, v_actor, 'catalog.category.upsert', 'category:' || target_id,
    jsonb_build_object('name', v_name, 'parent_id', v_parent, 'kind', target_kind,
                       'mode', case when v_previous is null then 'create' else 'update' end)
  );
end;
$$;

create or replace function public.admin_move_category(
  target_id text,
  target_new_parent_id text default null,
  target_position integer default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_parent text := nullif(btrim(coalesce(target_new_parent_id, '')), '');
  v_current record;
  v_position integer;
begin
  select category.id, category.parent_id, category.path, category.kind, category.source into v_current
  from public.categories as category
  where category.id = target_id
  for update;
  if not found then
    raise exception 'category_missing' using errcode = 'P0002';
  end if;
  if v_current.source = 'erp' then
    raise exception 'category_erp_locked' using errcode = '23514';
  end if;
  if v_current.kind = 'collection' and v_parent is not null then
    raise exception 'category_collection_flat' using errcode = '23514';
  end if;
  if v_parent is not null then
    if not exists (select 1 from public.categories as parent where parent.id = v_parent) then
      raise exception 'category_parent_missing' using errcode = 'P0002';
    end if;
    if exists (
      select 1 from public.categories as parent
      where parent.id = v_parent and parent.path like v_current.path || '%'
    ) then
      raise exception 'category_cycle' using errcode = '23514';
    end if;
  end if;
  -- 자체 카탈로그 분류는 ERP 잎 사이에서만 옮긴다.
  if v_current.kind = 'catalog' and (v_parent is null or not private.is_erp_leaf_category(v_parent)) then
    raise exception 'category_catalog_under_erp_leaf' using errcode = '23514';
  end if;

  v_position := coalesce(target_position, (
    select coalesce(max(sibling.position), -1) + 1
    from public.categories as sibling
    where sibling.parent_id is not distinct from v_parent and sibling.id <> target_id
  ));

  update public.categories
  set parent_id = v_parent, position = greatest(v_position, 0)
  where id = target_id;

  perform private.record_admin_action(
    null, v_actor, 'catalog.category.move', 'category:' || target_id,
    jsonb_build_object('from_parent', v_current.parent_id, 'to_parent', v_parent, 'position', greatest(v_position, 0))
  );
end;
$$;

create or replace function public.admin_archive_category(target_id text, target_archived boolean default true)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
begin
  if exists (select 1 from public.categories as category where category.id = target_id and category.source = 'erp') then
    raise exception 'category_erp_locked' using errcode = '23514';
  end if;
  if target_archived then
    if exists (
      select 1 from public.categories as child
      where child.parent_id = target_id and child.archived_at is null
    ) then
      raise exception 'category_not_empty' using errcode = '23514';
    end if;
    if exists (select 1 from public.good_categories as membership where membership.category_id = target_id) then
      raise exception 'category_not_empty' using errcode = '23514';
    end if;
  end if;

  update public.categories
  set archived_at = case when target_archived then coalesce(archived_at, now()) else null end
  where id = target_id;
  if not found then
    raise exception 'category_missing' using errcode = 'P0002';
  end if;

  perform private.record_admin_action(
    null, v_actor, 'catalog.category.archive', 'category:' || target_id,
    jsonb_build_object('archived', target_archived)
  );
end;
$$;

create or replace function public.admin_set_good_categories(
  target_good_id text,
  target_primary_category_id text,
  target_category_ids text[] default '{}'::text[],
  target_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_primary text := nullif(btrim(coalesce(target_primary_category_id, '')), '');
  v_ids text[] := coalesce(target_category_ids, '{}'::text[]);
  v_previous jsonb;
  v_type text;
begin
  if not exists (select 1 from public.goods as good where good.id = target_good_id) then
    raise exception 'good_not_found' using errcode = 'P0002';
  end if;
  if v_primary is not null and not (v_primary = any(v_ids)) then
    v_ids := v_ids || v_primary;
  end if;
  if exists (
    select 1 from unnest(v_ids) as given(id)
    where not exists (select 1 from public.categories as category where category.id = given.id)
  ) then
    raise exception 'category_missing' using errcode = 'P0002';
  end if;
  if cardinality(v_ids) > 0 and v_primary is null then
    raise exception 'category_primary_required' using errcode = '23514';
  end if;

  select jsonb_agg(membership.category_id order by membership.category_id) into v_previous
  from public.good_categories as membership
  where membership.good_id = target_good_id;

  if not private.record_admin_action(
    target_request_id, v_actor, 'catalog.good.categories', 'goods:' || target_good_id,
    jsonb_build_object('from', coalesce(v_previous, '[]'::jsonb), 'to', to_jsonb(v_ids), 'primary', v_primary)
  ) then
    return;
  end if;

  delete from public.good_categories as membership
  where membership.good_id = target_good_id
    and not (membership.category_id = any(v_ids));

  insert into public.good_categories (good_id, category_id, is_primary, position)
  select
    target_good_id,
    given.id,
    given.id = v_primary,
    coalesce((
      select max(existing.position) + 1
      from public.good_categories as existing
      where existing.category_id = given.id
    ), 0)
  from unnest(v_ids) as given(id)
  on conflict (good_id, category_id) do update set is_primary = excluded.is_primary;

  -- 대표 분류가 ERP 키링/파우치/쿠션/인형/피규어/문구 아래면 유형을 맞춘다 — 두 번 고르지 않게.
  if v_primary is not null then
    v_type := private.good_type_for_category(v_primary);
    if v_type is not null then
      update public.goods set type = v_type
      where id = target_good_id and type is distinct from v_type;
    end if;
  end if;
end;
$$;

drop function public.admin_list_categories(boolean);
create function public.admin_list_categories(p_include_archived boolean default false)
returns table (
  id text,
  kind text,
  parent_id text,
  name text,
  description text,
  path text,
  depth smallint,
  sort_position integer,
  status text,
  is_internal boolean,
  display_mode text,
  auto_sort_key text,
  soldout_last boolean,
  include_descendants boolean,
  hero_image_path text,
  seo_title text,
  seo_description text,
  archived_at timestamptz,
  goods_count bigint,
  descendant_goods_count bigint,
  source text,
  erp_key text,
  erp_synced_at timestamptz,
  erp_removed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  return query
  select
    category.id, category.kind, category.parent_id, category.name, category.description,
    category.path, category.depth, category.position as sort_position, category.status, category.is_internal,
    category.display_mode, category.auto_sort_key, category.soldout_last, category.include_descendants,
    category.hero_image_path, category.seo_title, category.seo_description, category.archived_at,
    (select count(*) from public.good_categories as membership where membership.category_id = category.id),
    (select count(distinct membership.good_id)
     from public.categories as descendant
     join public.good_categories as membership on membership.category_id = descendant.id
     where descendant.path like category.path || '%'),
    category.source, category.erp_key, category.erp_synced_at, category.erp_removed_at
  from public.categories as category
  where p_include_archived or category.archived_at is null
  order by category.path;
end;
$$;
revoke all on function public.admin_list_categories(boolean) from public, anon, service_role;
grant execute on function public.admin_list_categories(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. 시드 — ERP 제상품 분류 350 노드 (scripts/erp/erp-categories.json · 생성 scripts/erp/erp-categories-from-xlsx.py)
-- ---------------------------------------------------------------------------
select private.sync_erp_categories($erp$[{"id":"erp-01","key":"가공품","parentKey":null,"name":"가공품","level":1,"position":0},{"id":"erp-01-01","key":"가공품 > 가공품","parentKey":"가공품","name":"가공품","level":2,"position":0},{"id":"erp-01-01-01","key":"가공품 > 가공품 > 가공품","parentKey":"가공품 > 가공품","name":"가공품","level":3,"position":0},{"id":"erp-02","key":"문구","parentKey":null,"name":"문구","level":1,"position":1},{"id":"erp-02-02","key":"문구 > 노트","parentKey":"문구","name":"노트","level":2,"position":1},{"id":"erp-02-02-01","key":"문구 > 노트 > 스프링노트","parentKey":"문구 > 노트","name":"스프링노트","level":3,"position":0},{"id":"erp-02-02-02","key":"문구 > 노트 > 중철/무선철노트","parentKey":"문구 > 노트","name":"중철/무선철노트","level":3,"position":1},{"id":"erp-02-02-03","key":"문구 > 노트 > 연습장/하프노트","parentKey":"문구 > 노트","name":"연습장/하프노트","level":3,"position":2},{"id":"erp-02-02-04","key":"문구 > 노트 > 신학기노트","parentKey":"문구 > 노트","name":"신학기노트","level":3,"position":3},{"id":"erp-02-02-05","key":"문구 > 노트 > 초등노트","parentKey":"문구 > 노트","name":"초등노트","level":3,"position":4},{"id":"erp-02-02-06","key":"문구 > 노트 > 스케치/드로잉북","parentKey":"문구 > 노트","name":"스케치/드로잉북","level":3,"position":5},{"id":"erp-02-02-07","key":"문구 > 노트 > 기타노트","parentKey":"문구 > 노트","name":"기타노트","level":3,"position":6},{"id":"erp-02-03","key":"문구 > 메모/수첩","parentKey":"문구","name":"메모/수첩","level":2,"position":2},{"id":"erp-02-03-01","key":"문구 > 메모/수첩 > 메모지","parentKey":"문구 > 메모/수첩","name":"메모지","level":3,"position":0},{"id":"erp-02-03-02","key":"문구 > 메모/수첩 > 점착메모지","parentKey":"문구 > 메모/수첩","name":"점착메모지","level":3,"position":1},{"id":"erp-02-03-03","key":"문구 > 메모/수첩 > 단어장","parentKey":"문구 > 메모/수첩","name":"단어장","level":3,"position":2},{"id":"erp-02-03-04","key":"문구 > 메모/수첩 > 수첩","parentKey":"문구 > 메모/수첩","name":"수첩","level":3,"position":3},{"id":"erp-02-04","key":"문구 > 문구소품","parentKey":"문구","name":"문구소품","level":2,"position":3},{"id":"erp-02-04-01","key":"문구 > 문구소품 > 계산기","parentKey":"문구 > 문구소품","name":"계산기","level":3,"position":0},{"id":"erp-02-04-02","key":"문구 > 문구소품 > 수정용품","parentKey":"문구 > 문구소품","name":"수정용품","level":3,"position":1},{"id":"erp-02-04-03","key":"문구 > 문구소품 > 자/줄자","parentKey":"문구 > 문구소품","name":"자/줄자","level":3,"position":2},{"id":"erp-02-04-04","key":"문구 > 문구소품 > 칼/가위","parentKey":"문구 > 문구소품","name":"칼/가위","level":3,"position":3},{"id":"erp-02-04-05","key":"문구 > 문구소품 > 클립/집게/마그넷","parentKey":"문구 > 문구소품","name":"클립/집게/마그넷","level":3,"position":4},{"id":"erp-02-04-06","key":"문구 > 문구소품 > 풀/테이프","parentKey":"문구 > 문구소품","name":"풀/테이프","level":3,"position":5},{"id":"erp-02-04-07","key":"문구 > 문구소품 > 기타문구소품","parentKey":"문구 > 문구소품","name":"기타문구소품","level":3,"position":6},{"id":"erp-02-05","key":"문구 > 데스크정리/보관","parentKey":"문구","name":"데스크정리/보관","level":2,"position":4},{"id":"erp-02-05-01","key":"문구 > 데스크정리/보관 > 정리함/꽂이","parentKey":"문구 > 데스크정리/보관","name":"정리함/꽂이","level":3,"position":0},{"id":"erp-02-05-02","key":"문구 > 데스크정리/보관 > 트레이/케이스","parentKey":"문구 > 데스크정리/보관","name":"트레이/케이스","level":3,"position":1},{"id":"erp-02-05-03","key":"문구 > 데스크정리/보관 > 매트/패드/보드","parentKey":"문구 > 데스크정리/보관","name":"매트/패드/보드","level":3,"position":2},{"id":"erp-02-05-04","key":"문구 > 데스크정리/보관 > 독서용품","parentKey":"문구 > 데스크정리/보관","name":"독서용품","level":3,"position":3},{"id":"erp-02-05-05","key":"문구 > 데스크정리/보관 > 청소/정리용품","parentKey":"문구 > 데스크정리/보관","name":"청소/정리용품","level":3,"position":4},{"id":"erp-02-06","key":"문구 > 파일/바인더","parentKey":"문구","name":"파일/바인더","level":2,"position":5},{"id":"erp-02-06-01","key":"문구 > 파일/바인더 > 종이/PP파일","parentKey":"문구 > 파일/바인더","name":"종이/PP파일","level":3,"position":0},{"id":"erp-02-06-02","key":"문구 > 파일/바인더 > 바인더","parentKey":"문구 > 파일/바인더","name":"바인더","level":3,"position":1},{"id":"erp-02-06-03","key":"문구 > 파일/바인더 > 지퍼/손잡이형파일","parentKey":"문구 > 파일/바인더","name":"지퍼/손잡이형파일","level":3,"position":2},{"id":"erp-02-06-04","key":"문구 > 파일/바인더 > 클리어파일","parentKey":"문구 > 파일/바인더","name":"클리어파일","level":3,"position":3},{"id":"erp-02-06-05","key":"문구 > 파일/바인더 > 클립보드","parentKey":"문구 > 파일/바인더","name":"클립보드","level":3,"position":4},{"id":"erp-02-06-06","key":"문구 > 파일/바인더 > 기타파일/바인더","parentKey":"문구 > 파일/바인더","name":"기타파일/바인더","level":3,"position":5},{"id":"erp-02-06-07","key":"문구 > 파일/바인더 > 앨범","parentKey":"문구 > 파일/바인더","name":"앨범","level":3,"position":6},{"id":"erp-02-07","key":"문구 > 스티커","parentKey":"문구","name":"스티커","level":2,"position":6},{"id":"erp-02-07-01","key":"문구 > 스티커 > 베이직스티커","parentKey":"문구 > 스티커","name":"베이직스티커","level":3,"position":0},{"id":"erp-02-07-02","key":"문구 > 스티커 > 포인트스티커(빅)","parentKey":"문구 > 스티커","name":"포인트스티커(빅)","level":3,"position":1},{"id":"erp-02-07-03","key":"문구 > 스티커 > 패턴/그래픽스티커","parentKey":"문구 > 스티커","name":"패턴/그래픽스티커","level":3,"position":2},{"id":"erp-02-07-04","key":"문구 > 스티커 > 라벨/인덱스스티커","parentKey":"문구 > 스티커","name":"라벨/인덱스스티커","level":3,"position":3},{"id":"erp-02-07-05","key":"문구 > 스티커 > 기능성스티커","parentKey":"문구 > 스티커","name":"기능성스티커","level":3,"position":4},{"id":"erp-02-07-06","key":"문구 > 스티커 > 표시/데코스티커","parentKey":"문구 > 스티커","name":"표시/데코스티커","level":3,"position":5},{"id":"erp-02-07-07","key":"문구 > 스티커 > 네일/타투스티커","parentKey":"문구 > 스티커","name":"네일/타투스티커","level":3,"position":6},{"id":"erp-02-07-08","key":"문구 > 스티커 > 스티커세트","parentKey":"문구 > 스티커","name":"스티커세트","level":3,"position":7},{"id":"erp-02-07-09","key":"문구 > 스티커 > 기타스티커","parentKey":"문구 > 스티커","name":"기타스티커","level":3,"position":8},{"id":"erp-02-07-10","key":"문구 > 스티커 > 마스킹/데코테이프","parentKey":"문구 > 스티커","name":"마스킹/데코테이프","level":3,"position":9},{"id":"erp-02-08","key":"문구 > 포장/데코소품","parentKey":"문구","name":"포장/데코소품","level":2,"position":7},{"id":"erp-02-08-01","key":"문구 > 포장/데코소품 > 데코/파티소품","parentKey":"문구 > 포장/데코소품","name":"데코/파티소품","level":3,"position":0},{"id":"erp-02-08-02","key":"문구 > 포장/데코소품 > 포장소품","parentKey":"문구 > 포장/데코소품","name":"포장소품","level":3,"position":1},{"id":"erp-02-09","key":"문구 > 필기구","parentKey":"문구","name":"필기구","level":2,"position":8},{"id":"erp-02-09-01","key":"문구 > 필기구 > 마커/매직","parentKey":"문구 > 필기구","name":"마커/매직","level":3,"position":0},{"id":"erp-02-09-02","key":"문구 > 필기구 > 멀티펜","parentKey":"문구 > 필기구","name":"멀티펜","level":3,"position":1},{"id":"erp-02-09-03","key":"문구 > 필기구 > 볼펜/젤펜","parentKey":"문구 > 필기구","name":"볼펜/젤펜","level":3,"position":2},{"id":"erp-02-09-04","key":"문구 > 필기구 > 샤프/샤프심","parentKey":"문구 > 필기구","name":"샤프/샤프심","level":3,"position":3},{"id":"erp-02-09-05","key":"문구 > 필기구 > 연필/연필캡","parentKey":"문구 > 필기구","name":"연필/연필캡","level":3,"position":4},{"id":"erp-02-09-06","key":"문구 > 필기구 > 사인펜/색연필","parentKey":"문구 > 필기구","name":"사인펜/색연필","level":3,"position":5},{"id":"erp-02-09-07","key":"문구 > 필기구 > 형광펜","parentKey":"문구 > 필기구","name":"형광펜","level":3,"position":6},{"id":"erp-02-09-08","key":"문구 > 필기구 > 연필깎이","parentKey":"문구 > 필기구","name":"연필깎이","level":3,"position":7},{"id":"erp-02-09-09","key":"문구 > 필기구 > 기타필기구","parentKey":"문구 > 필기구","name":"기타필기구","level":3,"position":8},{"id":"erp-02-10","key":"문구 > 필통","parentKey":"문구","name":"필통","level":2,"position":9},{"id":"erp-02-10-01","key":"문구 > 필통 > PVC필통","parentKey":"문구 > 필통","name":"PVC필통","level":3,"position":0},{"id":"erp-02-10-02","key":"문구 > 필통 > 사출/틴필통","parentKey":"문구 > 필통","name":"사출/틴필통","level":3,"position":1},{"id":"erp-02-10-03","key":"문구 > 필통 > 실리콘필통","parentKey":"문구 > 필통","name":"실리콘필통","level":3,"position":2},{"id":"erp-02-10-04","key":"문구 > 필통 > 인형필통","parentKey":"문구 > 필통","name":"인형필통","level":3,"position":3},{"id":"erp-02-10-05","key":"문구 > 필통 > 패브릭필통","parentKey":"문구 > 필통","name":"패브릭필통","level":3,"position":4},{"id":"erp-02-10-06","key":"문구 > 필통 > 기타필통","parentKey":"문구 > 필통","name":"기타필통","level":3,"position":5},{"id":"erp-02-11","key":"문구 > 카드/편지지","parentKey":"문구","name":"카드/편지지","level":2,"position":10},{"id":"erp-02-11-01","key":"문구 > 카드/편지지 > 봉투","parentKey":"문구 > 카드/편지지","name":"봉투","level":3,"position":0},{"id":"erp-02-11-02","key":"문구 > 카드/편지지 > 카드","parentKey":"문구 > 카드/편지지","name":"카드","level":3,"position":1},{"id":"erp-02-11-03","key":"문구 > 카드/편지지 > 패드편지지","parentKey":"문구 > 카드/편지지","name":"패드편지지","level":3,"position":2},{"id":"erp-02-11-04","key":"문구 > 카드/편지지 > 편지지","parentKey":"문구 > 카드/편지지","name":"편지지","level":3,"position":3},{"id":"erp-02-11-05","key":"문구 > 카드/편지지 > 기타카드/편지지","parentKey":"문구 > 카드/편지지","name":"기타카드/편지지","level":3,"position":4},{"id":"erp-02-12","key":"문구 > 캘린더/플래너","parentKey":"문구","name":"캘린더/플래너","level":2,"position":11},{"id":"erp-02-12-01","key":"문구 > 캘린더/플래너 > 다이어리","parentKey":"문구 > 캘린더/플래너","name":"다이어리","level":3,"position":0},{"id":"erp-02-12-02","key":"문구 > 캘린더/플래너 > 위클리/먼슬리플래너","parentKey":"문구 > 캘린더/플래너","name":"위클리/먼슬리플래너","level":3,"position":1},{"id":"erp-02-12-03","key":"문구 > 캘린더/플래너 > 캘린더","parentKey":"문구 > 캘린더/플래너","name":"캘린더","level":3,"position":2},{"id":"erp-02-12-04","key":"문구 > 캘린더/플래너 > 스터디/캐쉬플래너","parentKey":"문구 > 캘린더/플래너","name":"스터디/캐쉬플래너","level":3,"position":3},{"id":"erp-02-13","key":"문구 > 기타문구","parentKey":"문구","name":"기타문구","level":2,"position":12},{"id":"erp-02-13-01","key":"문구 > 기타문구 > 미술용품","parentKey":"문구 > 기타문구","name":"미술용품","level":3,"position":0},{"id":"erp-02-13-02","key":"문구 > 기타문구 > 색종이/종이접기","parentKey":"문구 > 기타문구","name":"색종이/종이접기","level":3,"position":1},{"id":"erp-02-13-03","key":"문구 > 기타문구 > 아트/컬러링","parentKey":"문구 > 기타문구","name":"아트/컬러링","level":3,"position":2},{"id":"erp-02-13-04","key":"문구 > 기타문구 > 체육용품","parentKey":"문구 > 기타문구","name":"체육용품","level":3,"position":3},{"id":"erp-02-13-05","key":"문구 > 기타문구 > 개인소품","parentKey":"문구 > 기타문구","name":"개인소품","level":3,"position":4},{"id":"erp-02-13-06","key":"문구 > 기타문구 > 완구잡화","parentKey":"문구 > 기타문구","name":"완구잡화","level":3,"position":5},{"id":"erp-02-13-07","key":"문구 > 기타문구 > 문구세트","parentKey":"문구 > 기타문구","name":"문구세트","level":3,"position":6},{"id":"erp-02-13-08","key":"문구 > 기타문구 > 기타문구","parentKey":"문구 > 기타문구","name":"기타문구","level":3,"position":7},{"id":"erp-02-45","key":"문구 > 팬시","parentKey":"문구","name":"팬시","level":2,"position":44},{"id":"erp-02-45-01","key":"문구 > 팬시 > 포토북","parentKey":"문구 > 팬시","name":"포토북","level":3,"position":0},{"id":"erp-02-45-02","key":"문구 > 팬시 > 응원도구","parentKey":"문구 > 팬시","name":"응원도구","level":3,"position":1},{"id":"erp-02-45-03","key":"문구 > 팬시 > 기타 도자재","parentKey":"문구 > 팬시","name":"기타 도자재","level":3,"position":2},{"id":"erp-02-45-04","key":"문구 > 팬시 > 기타 팬시용품","parentKey":"문구 > 팬시","name":"기타 팬시용품","level":3,"position":3},{"id":"erp-03","key":"리빙","parentKey":null,"name":"리빙","level":1,"position":2},{"id":"erp-03-14","key":"리빙 > 홈데코","parentKey":"리빙","name":"홈데코","level":2,"position":13},{"id":"erp-03-14-01","key":"리빙 > 홈데코 > 시트지/벽지","parentKey":"리빙 > 홈데코","name":"시트지/벽지","level":3,"position":0},{"id":"erp-03-14-02","key":"리빙 > 홈데코 > 가구소품","parentKey":"리빙 > 홈데코","name":"가구소품","level":3,"position":1},{"id":"erp-03-14-03","key":"리빙 > 홈데코 > 거울","parentKey":"리빙 > 홈데코","name":"거울","level":3,"position":2},{"id":"erp-03-14-04","key":"리빙 > 홈데코 > 조명","parentKey":"리빙 > 홈데코","name":"조명","level":3,"position":3},{"id":"erp-03-14-05","key":"리빙 > 홈데코 > 액자","parentKey":"리빙 > 홈데코","name":"액자","level":3,"position":4},{"id":"erp-03-14-06","key":"리빙 > 홈데코 > 시계","parentKey":"리빙 > 홈데코","name":"시계","level":3,"position":5},{"id":"erp-03-14-07","key":"리빙 > 홈데코 > 바구니/박스","parentKey":"리빙 > 홈데코","name":"바구니/박스","level":3,"position":6},{"id":"erp-03-14-08","key":"리빙 > 홈데코 > 방향제/디퓨저","parentKey":"리빙 > 홈데코","name":"방향제/디퓨저","level":3,"position":7},{"id":"erp-03-14-09","key":"리빙 > 홈데코 > 장식소품","parentKey":"리빙 > 홈데코","name":"장식소품","level":3,"position":8},{"id":"erp-03-14-10","key":"리빙 > 홈데코 > 기타홈데코소품","parentKey":"리빙 > 홈데코","name":"기타홈데코소품","level":3,"position":9},{"id":"erp-03-15","key":"리빙 > 쿠션","parentKey":"리빙","name":"쿠션","level":2,"position":14},{"id":"erp-03-15-01","key":"리빙 > 쿠션 > 사각쿠션","parentKey":"리빙 > 쿠션","name":"사각쿠션","level":3,"position":0},{"id":"erp-03-15-02","key":"리빙 > 쿠션 > 원형쿠션","parentKey":"리빙 > 쿠션","name":"원형쿠션","level":3,"position":1},{"id":"erp-03-15-03","key":"리빙 > 쿠션 > 형태쿠션","parentKey":"리빙 > 쿠션","name":"형태쿠션","level":3,"position":2},{"id":"erp-03-15-04","key":"리빙 > 쿠션 > 목쿠션","parentKey":"리빙 > 쿠션","name":"목쿠션","level":3,"position":3},{"id":"erp-03-15-05","key":"리빙 > 쿠션 > 등쿠션","parentKey":"리빙 > 쿠션","name":"등쿠션","level":3,"position":4},{"id":"erp-03-15-06","key":"리빙 > 쿠션 > 워머","parentKey":"리빙 > 쿠션","name":"워머","level":3,"position":5},{"id":"erp-03-15-07","key":"리빙 > 쿠션 > 바디필로우","parentKey":"리빙 > 쿠션","name":"바디필로우","level":3,"position":6},{"id":"erp-03-15-08","key":"리빙 > 쿠션 > 기타쿠션","parentKey":"리빙 > 쿠션","name":"기타쿠션","level":3,"position":7},{"id":"erp-03-16","key":"리빙 > 방석","parentKey":"리빙","name":"방석","level":2,"position":15},{"id":"erp-03-16-01","key":"리빙 > 방석 > 사각방석","parentKey":"리빙 > 방석","name":"사각방석","level":3,"position":0},{"id":"erp-03-16-02","key":"리빙 > 방석 > 원형방석","parentKey":"리빙 > 방석","name":"원형방석","level":3,"position":1},{"id":"erp-03-16-03","key":"리빙 > 방석 > 형태방석","parentKey":"리빙 > 방석","name":"형태방석","level":3,"position":2},{"id":"erp-03-16-04","key":"리빙 > 방석 > 전기방석","parentKey":"리빙 > 방석","name":"전기방석","level":3,"position":3},{"id":"erp-03-16-05","key":"리빙 > 방석 > 대형방석","parentKey":"리빙 > 방석","name":"대형방석","level":3,"position":4},{"id":"erp-03-16-06","key":"리빙 > 방석 > 기타방석","parentKey":"리빙 > 방석","name":"기타방석","level":3,"position":5},{"id":"erp-03-17","key":"리빙 > 홈패브릭","parentKey":"리빙","name":"홈패브릭","level":2,"position":16},{"id":"erp-03-17-01","key":"리빙 > 홈패브릭 > 수면안대","parentKey":"리빙 > 홈패브릭","name":"수면안대","level":3,"position":0},{"id":"erp-03-17-02","key":"리빙 > 홈패브릭 > 담요/이불","parentKey":"리빙 > 홈패브릭","name":"담요/이불","level":3,"position":1},{"id":"erp-03-17-03","key":"리빙 > 홈패브릭 > 커튼/커버","parentKey":"리빙 > 홈패브릭","name":"커튼/커버","level":3,"position":2},{"id":"erp-03-17-04","key":"리빙 > 홈패브릭 > 실내화","parentKey":"리빙 > 홈패브릭","name":"실내화","level":3,"position":3},{"id":"erp-03-17-05","key":"리빙 > 홈패브릭 > 러그/매트","parentKey":"리빙 > 홈패브릭","name":"러그/매트","level":3,"position":4},{"id":"erp-03-17-06","key":"리빙 > 홈패브릭 > 기타홈패브릭","parentKey":"리빙 > 홈패브릭","name":"기타홈패브릭","level":3,"position":5},{"id":"erp-03-18","key":"리빙 > 욕실","parentKey":"리빙","name":"욕실","level":2,"position":17},{"id":"erp-03-18-01","key":"리빙 > 욕실 > 세면/샤워소품","parentKey":"리빙 > 욕실","name":"세면/샤워소품","level":3,"position":0},{"id":"erp-03-18-02","key":"리빙 > 욕실 > 세안밴드","parentKey":"리빙 > 욕실","name":"세안밴드","level":3,"position":1},{"id":"erp-03-18-03","key":"리빙 > 욕실 > 구강소품","parentKey":"리빙 > 욕실","name":"구강소품","level":3,"position":2},{"id":"erp-03-18-04","key":"리빙 > 욕실 > 면도소품","parentKey":"리빙 > 욕실","name":"면도소품","level":3,"position":3},{"id":"erp-03-18-05","key":"리빙 > 욕실 > 목욕가운","parentKey":"리빙 > 욕실","name":"목욕가운","level":3,"position":4},{"id":"erp-03-18-06","key":"리빙 > 욕실 > 타월","parentKey":"리빙 > 욕실","name":"타월","level":3,"position":5},{"id":"erp-03-18-07","key":"리빙 > 욕실 > 욕실화","parentKey":"리빙 > 욕실","name":"욕실화","level":3,"position":6},{"id":"erp-03-18-08","key":"리빙 > 욕실 > 욕실수납/정리","parentKey":"리빙 > 욕실","name":"욕실수납/정리","level":3,"position":7},{"id":"erp-03-18-09","key":"리빙 > 욕실 > 기타욕실용품","parentKey":"리빙 > 욕실","name":"기타욕실용품","level":3,"position":8},{"id":"erp-03-19","key":"리빙 > 주방","parentKey":"리빙","name":"주방","level":2,"position":18},{"id":"erp-03-19-01","key":"리빙 > 주방 > 조리도구","parentKey":"리빙 > 주방","name":"조리도구","level":3,"position":0},{"id":"erp-03-19-02","key":"리빙 > 주방 > 보조조리도구","parentKey":"리빙 > 주방","name":"보조조리도구","level":3,"position":1},{"id":"erp-03-19-03","key":"리빙 > 주방 > 커팅도구","parentKey":"리빙 > 주방","name":"커팅도구","level":3,"position":2},{"id":"erp-03-19-04","key":"리빙 > 주방 > 식기","parentKey":"리빙 > 주방","name":"식기","level":3,"position":3},{"id":"erp-03-19-05","key":"리빙 > 주방 > 커트러리","parentKey":"리빙 > 주방","name":"커트러리","level":3,"position":4},{"id":"erp-03-19-06","key":"리빙 > 주방 > 쟁반/밥상","parentKey":"리빙 > 주방","name":"쟁반/밥상","level":3,"position":5},{"id":"erp-03-19-07","key":"리빙 > 주방 > 밀폐/보관용기","parentKey":"리빙 > 주방","name":"밀폐/보관용기","level":3,"position":6},{"id":"erp-03-19-08","key":"리빙 > 주방 > 보온/보냉용기","parentKey":"리빙 > 주방","name":"보온/보냉용기","level":3,"position":7},{"id":"erp-03-19-09","key":"리빙 > 주방 > 피크닉/도시락","parentKey":"리빙 > 주방","name":"피크닉/도시락","level":3,"position":8},{"id":"erp-03-19-10","key":"리빙 > 주방 > 주방수납/정리","parentKey":"리빙 > 주방","name":"주방수납/정리","level":3,"position":9},{"id":"erp-03-19-11","key":"리빙 > 주방 > 주방패브릭","parentKey":"리빙 > 주방","name":"주방패브릭","level":3,"position":10},{"id":"erp-03-19-12","key":"리빙 > 주방 > 와인소품","parentKey":"리빙 > 주방","name":"와인소품","level":3,"position":11},{"id":"erp-03-19-13","key":"리빙 > 주방 > 기타주방소품","parentKey":"리빙 > 주방","name":"기타주방소품","level":3,"position":12},{"id":"erp-03-20","key":"리빙 > 텀블러/보틀","parentKey":"리빙","name":"텀블러/보틀","level":2,"position":19},{"id":"erp-03-20-01","key":"리빙 > 텀블러/보틀 > 아이스텀블러","parentKey":"리빙 > 텀블러/보틀","name":"아이스텀블러","level":3,"position":0},{"id":"erp-03-20-02","key":"리빙 > 텀블러/보틀 > 스텐텀블러","parentKey":"리빙 > 텀블러/보틀","name":"스텐텀블러","level":3,"position":1},{"id":"erp-03-20-03","key":"리빙 > 텀블러/보틀 > 유리텀블러","parentKey":"리빙 > 텀블러/보틀","name":"유리텀블러","level":3,"position":2},{"id":"erp-03-20-04","key":"리빙 > 텀블러/보틀 > 플라스틱텀블러","parentKey":"리빙 > 텀블러/보틀","name":"플라스틱텀블러","level":3,"position":3},{"id":"erp-03-20-05","key":"리빙 > 텀블러/보틀 > 기타텀블러","parentKey":"리빙 > 텀블러/보틀","name":"기타텀블러","level":3,"position":4},{"id":"erp-03-20-06","key":"리빙 > 텀블러/보틀 > 아이스보틀","parentKey":"리빙 > 텀블러/보틀","name":"아이스보틀","level":3,"position":5},{"id":"erp-03-20-07","key":"리빙 > 텀블러/보틀 > 유리보틀","parentKey":"리빙 > 텀블러/보틀","name":"유리보틀","level":3,"position":6},{"id":"erp-03-20-08","key":"리빙 > 텀블러/보틀 > 스텐보틀","parentKey":"리빙 > 텀블러/보틀","name":"스텐보틀","level":3,"position":7},{"id":"erp-03-20-09","key":"리빙 > 텀블러/보틀 > 기타보틀","parentKey":"리빙 > 텀블러/보틀","name":"기타보틀","level":3,"position":8},{"id":"erp-03-21","key":"리빙 > 컵/잔","parentKey":"리빙","name":"컵/잔","level":2,"position":20},{"id":"erp-03-21-01","key":"리빙 > 컵/잔 > 머그컵","parentKey":"리빙 > 컵/잔","name":"머그컵","level":3,"position":0},{"id":"erp-03-21-02","key":"리빙 > 컵/잔 > 유리컵","parentKey":"리빙 > 컵/잔","name":"유리컵","level":3,"position":1},{"id":"erp-03-21-03","key":"리빙 > 컵/잔 > 술잔","parentKey":"리빙 > 컵/잔","name":"술잔","level":3,"position":2},{"id":"erp-03-22","key":"리빙 > 생활용품","parentKey":"리빙","name":"생활용품","level":2,"position":21},{"id":"erp-03-22-01","key":"리빙 > 생활용품 > 공구","parentKey":"리빙 > 생활용품","name":"공구","level":3,"position":0},{"id":"erp-03-22-02","key":"리빙 > 생활용품 > 수납/정리","parentKey":"리빙 > 생활용품","name":"수납/정리","level":3,"position":1},{"id":"erp-03-22-03","key":"리빙 > 생활용품 > 마스크/마스크 악세서리/황사용품","parentKey":"리빙 > 생활용품","name":"마스크/마스크 악세서리/황사용품","level":3,"position":2},{"id":"erp-03-22-04","key":"리빙 > 생활용품 > 멀티케이스/지퍼백","parentKey":"리빙 > 생활용품","name":"멀티케이스/지퍼백","level":3,"position":3},{"id":"erp-03-22-05","key":"리빙 > 생활용품 > 세탁용품","parentKey":"리빙 > 생활용품","name":"세탁용품","level":3,"position":4},{"id":"erp-03-22-06","key":"리빙 > 생활용품 > 청소용품","parentKey":"리빙 > 생활용품","name":"청소용품","level":3,"position":5},{"id":"erp-03-22-07","key":"리빙 > 생활용품 > 기타생활용품","parentKey":"리빙 > 생활용품","name":"기타생활용품","level":3,"position":6},{"id":"erp-03-22-08","key":"리빙 > 생활용품 > 데스크용품","parentKey":"리빙 > 생활용품","name":"데스크용품","level":3,"position":7},{"id":"erp-03-22-09","key":"리빙 > 생활용품 > 마스크/황사용품","parentKey":"리빙 > 생활용품","name":"마스크/황사용품","level":3,"position":8},{"id":"erp-03-22-10","key":"리빙 > 생활용품 > 제습백","parentKey":"리빙 > 생활용품","name":"제습백","level":3,"position":9},{"id":"erp-03-22-11","key":"리빙 > 생활용품 > 안전용품","parentKey":"리빙 > 생활용품","name":"안전용품","level":3,"position":10},{"id":"erp-03-23","key":"리빙 > 차량용품","parentKey":"리빙","name":"차량용품","level":2,"position":22},{"id":"erp-03-23-01","key":"리빙 > 차량용품 > 도어용품","parentKey":"리빙 > 차량용품","name":"도어용품","level":3,"position":0},{"id":"erp-03-23-02","key":"리빙 > 차량용품 > 주차번호판","parentKey":"리빙 > 차량용품","name":"주차번호판","level":3,"position":1},{"id":"erp-03-23-03","key":"리빙 > 차량용품 > 차량스티커","parentKey":"리빙 > 차량용품","name":"차량스티커","level":3,"position":2},{"id":"erp-03-23-04","key":"리빙 > 차량용품 > 시트커버","parentKey":"리빙 > 차량용품","name":"시트커버","level":3,"position":3},{"id":"erp-03-23-05","key":"리빙 > 차량용품 > 쿠션","parentKey":"리빙 > 차량용품","name":"쿠션","level":3,"position":4},{"id":"erp-03-23-06","key":"리빙 > 차량용품 > 기타차량소품","parentKey":"리빙 > 차량용품","name":"기타차량소품","level":3,"position":5},{"id":"erp-03-24","key":"리빙 > 캠핑용품","parentKey":"리빙","name":"캠핑용품","level":2,"position":23},{"id":"erp-03-24-01","key":"리빙 > 캠핑용품 > 텐트/그늘막","parentKey":"리빙 > 캠핑용품","name":"텐트/그늘막","level":3,"position":0},{"id":"erp-03-24-02","key":"리빙 > 캠핑용품 > 침낭","parentKey":"리빙 > 캠핑용품","name":"침낭","level":3,"position":1},{"id":"erp-03-24-03","key":"리빙 > 캠핑용품 > 캠핑랜턴/조명","parentKey":"리빙 > 캠핑용품","name":"캠핑랜턴/조명","level":3,"position":2},{"id":"erp-03-24-04","key":"리빙 > 캠핑용품 > 캠핑매트","parentKey":"리빙 > 캠핑용품","name":"캠핑매트","level":3,"position":3},{"id":"erp-03-24-05","key":"리빙 > 캠핑용품 > 캠핑의자/테이블","parentKey":"리빙 > 캠핑용품","name":"캠핑의자/테이블","level":3,"position":4},{"id":"erp-03-25","key":"리빙 > 헬스용품","parentKey":"리빙","name":"헬스용품","level":2,"position":24},{"id":"erp-03-25-01","key":"리빙 > 헬스용품 > 매트/장갑","parentKey":"리빙 > 헬스용품","name":"매트/장갑","level":3,"position":0},{"id":"erp-03-25-02","key":"리빙 > 헬스용품 > 운동도구","parentKey":"리빙 > 헬스용품","name":"운동도구","level":3,"position":1},{"id":"erp-03-26","key":"리빙 > 반려용품","parentKey":"리빙","name":"반려용품","level":2,"position":25},{"id":"erp-03-26-01","key":"리빙 > 반려용품 > 식품","parentKey":"리빙 > 반려용품","name":"식품","level":3,"position":0},{"id":"erp-03-26-02","key":"리빙 > 반려용품 > 완구/식기","parentKey":"리빙 > 반려용품","name":"완구/식기","level":3,"position":1},{"id":"erp-03-26-03","key":"리빙 > 반려용품 > 위생/미용","parentKey":"리빙 > 반려용품","name":"위생/미용","level":3,"position":2},{"id":"erp-03-26-04","key":"리빙 > 반려용품 > 하우스/이동장","parentKey":"리빙 > 반려용품","name":"하우스/이동장","level":3,"position":3},{"id":"erp-03-26-05","key":"리빙 > 반려용품 > 의류/악세서리","parentKey":"리빙 > 반려용품","name":"의류/악세서리","level":3,"position":4},{"id":"erp-03-26-06","key":"리빙 > 반려용품 > 기타반려용품","parentKey":"리빙 > 반려용품","name":"기타반려용품","level":3,"position":5},{"id":"erp-03-27","key":"리빙 > 시즌용품","parentKey":"리빙","name":"시즌용품","level":2,"position":26},{"id":"erp-03-27-01","key":"리빙 > 시즌용품 > 선풍기","parentKey":"리빙 > 시즌용품","name":"선풍기","level":3,"position":0},{"id":"erp-03-27-02","key":"리빙 > 시즌용품 > 감사","parentKey":"리빙 > 시즌용품","name":"감사","level":3,"position":1},{"id":"erp-03-27-03","key":"리빙 > 시즌용품 > 비치블랭킷","parentKey":"리빙 > 시즌용품","name":"비치블랭킷","level":3,"position":2},{"id":"erp-03-27-04","key":"리빙 > 시즌용품 > 비치백/파우치","parentKey":"리빙 > 시즌용품","name":"비치백/파우치","level":3,"position":3},{"id":"erp-03-27-05","key":"리빙 > 시즌용품 > 부채","parentKey":"리빙 > 시즌용품","name":"부채","level":3,"position":4},{"id":"erp-03-27-06","key":"리빙 > 시즌용품 > 비치웨어","parentKey":"리빙 > 시즌용품","name":"비치웨어","level":3,"position":5},{"id":"erp-03-27-07","key":"리빙 > 시즌용품 > 비치악세서리","parentKey":"리빙 > 시즌용품","name":"비치악세서리","level":3,"position":6},{"id":"erp-03-27-08","key":"리빙 > 시즌용품 > 할로윈","parentKey":"리빙 > 시즌용품","name":"할로윈","level":3,"position":7},{"id":"erp-03-27-09","key":"리빙 > 시즌용품 > 눈집게","parentKey":"리빙 > 시즌용품","name":"눈집게","level":3,"position":8},{"id":"erp-03-27-10","key":"리빙 > 시즌용품 > 크리스마스","parentKey":"리빙 > 시즌용품","name":"크리스마스","level":3,"position":9},{"id":"erp-03-27-11","key":"리빙 > 시즌용품 > 핫팩","parentKey":"리빙 > 시즌용품","name":"핫팩","level":3,"position":10},{"id":"erp-03-28","key":"리빙 > 뷰티소품","parentKey":"리빙","name":"뷰티소품","level":2,"position":27},{"id":"erp-03-28-01","key":"리빙 > 뷰티소품 > 퍼프/스펀지","parentKey":"리빙 > 뷰티소품","name":"퍼프/스펀지","level":3,"position":0},{"id":"erp-03-28-02","key":"리빙 > 뷰티소품 > 헤어브러시","parentKey":"리빙 > 뷰티소품","name":"헤어브러시","level":3,"position":1},{"id":"erp-03-28-03","key":"리빙 > 뷰티소품 > 헤어악세서리","parentKey":"리빙 > 뷰티소품","name":"헤어악세서리","level":3,"position":2},{"id":"erp-03-28-04","key":"리빙 > 뷰티소품 > 손거울","parentKey":"리빙 > 뷰티소품","name":"손거울","level":3,"position":3},{"id":"erp-03-28-05","key":"리빙 > 뷰티소품 > 네일케어","parentKey":"리빙 > 뷰티소품","name":"네일케어","level":3,"position":4},{"id":"erp-03-28-06","key":"리빙 > 뷰티소품 > 면봉/기름종이","parentKey":"리빙 > 뷰티소품","name":"면봉/기름종이","level":3,"position":5},{"id":"erp-03-28-07","key":"리빙 > 뷰티소품 > 공용기","parentKey":"리빙 > 뷰티소품","name":"공용기","level":3,"position":6},{"id":"erp-03-28-08","key":"리빙 > 뷰티소품 > 스타일링기","parentKey":"리빙 > 뷰티소품","name":"스타일링기","level":3,"position":7},{"id":"erp-03-28-09","key":"리빙 > 뷰티소품 > 기타뷰티소품","parentKey":"리빙 > 뷰티소품","name":"기타뷰티소품","level":3,"position":8},{"id":"erp-03-28-10","key":"리빙 > 뷰티소품 > 기름종이","parentKey":"리빙 > 뷰티소품","name":"기름종이","level":3,"position":9},{"id":"erp-03-29","key":"리빙 > 뷰티용품","parentKey":"리빙","name":"뷰티용품","level":2,"position":28},{"id":"erp-03-29-01","key":"리빙 > 뷰티용품 > 마스크팩","parentKey":"리빙 > 뷰티용품","name":"마스크팩","level":3,"position":0},{"id":"erp-03-46","key":"리빙 > 건강식품","parentKey":"리빙","name":"건강식품","level":2,"position":45},{"id":"erp-03-46-01","key":"리빙 > 건강식품 > 건강식품","parentKey":"리빙 > 건강식품","name":"건강식품","level":3,"position":0},{"id":"erp-03-51","key":"리빙 > 토이","parentKey":"리빙","name":"토이","level":2,"position":50},{"id":"erp-03-51-01","key":"리빙 > 토이 > 인형","parentKey":"리빙 > 토이","name":"인형","level":3,"position":0},{"id":"erp-03-51-02","key":"리빙 > 토이 > 피규어","parentKey":"리빙 > 토이","name":"피규어","level":3,"position":1},{"id":"erp-03-51-03","key":"리빙 > 토이 > 기타토이","parentKey":"리빙 > 토이","name":"기타토이","level":3,"position":2},{"id":"erp-04","key":"전장","parentKey":null,"name":"전장","level":1,"position":3},{"id":"erp-04-30","key":"전장 > PC주변기기","parentKey":"전장","name":"PC주변기기","level":2,"position":29},{"id":"erp-04-30-01","key":"전장 > PC주변기기 > 키보드","parentKey":"전장 > PC주변기기","name":"키보드","level":3,"position":0},{"id":"erp-04-30-02","key":"전장 > PC주변기기 > 마우스","parentKey":"전장 > PC주변기기","name":"마우스","level":3,"position":1},{"id":"erp-04-30-03","key":"전장 > PC주변기기 > 키보드/마우스세트","parentKey":"전장 > PC주변기기","name":"키보드/마우스세트","level":3,"position":2},{"id":"erp-04-30-04","key":"전장 > PC주변기기 > 마우스패드","parentKey":"전장 > PC주변기기","name":"마우스패드","level":3,"position":3},{"id":"erp-04-30-05","key":"전장 > PC주변기기 > 메모리","parentKey":"전장 > PC주변기기","name":"메모리","level":3,"position":4},{"id":"erp-04-31","key":"전장 > 모바일주변기기","parentKey":"전장","name":"모바일주변기기","level":2,"position":30},{"id":"erp-04-31-01","key":"전장 > 모바일주변기기 > 핸드폰케이스","parentKey":"전장 > 모바일주변기기","name":"핸드폰케이스","level":3,"position":0},{"id":"erp-04-31-02","key":"전장 > 모바일주변기기 > 케이블","parentKey":"전장 > 모바일주변기기","name":"케이블","level":3,"position":1},{"id":"erp-04-31-03","key":"전장 > 모바일주변기기 > 충전기","parentKey":"전장 > 모바일주변기기","name":"충전기","level":3,"position":2},{"id":"erp-04-31-04","key":"전장 > 모바일주변기기 > 차량용충전기","parentKey":"전장 > 모바일주변기기","name":"차량용충전기","level":3,"position":3},{"id":"erp-04-31-05","key":"전장 > 모바일주변기기 > 무선충전기","parentKey":"전장 > 모바일주변기기","name":"무선충전기","level":3,"position":4},{"id":"erp-04-31-06","key":"전장 > 모바일주변기기 > 보조배터리","parentKey":"전장 > 모바일주변기기","name":"보조배터리","level":3,"position":5},{"id":"erp-04-31-07","key":"전장 > 모바일주변기기 > 기타ACC","parentKey":"전장 > 모바일주변기기","name":"기타ACC","level":3,"position":6},{"id":"erp-04-32","key":"전장 > 음향기기","parentKey":"전장","name":"음향기기","level":2,"position":31},{"id":"erp-04-32-01","key":"전장 > 음향기기 > 이어폰","parentKey":"전장 > 음향기기","name":"이어폰","level":3,"position":0},{"id":"erp-04-32-02","key":"전장 > 음향기기 > 블루투스이어폰","parentKey":"전장 > 음향기기","name":"블루투스이어폰","level":3,"position":1},{"id":"erp-04-32-03","key":"전장 > 음향기기 > 헤드폰","parentKey":"전장 > 음향기기","name":"헤드폰","level":3,"position":2},{"id":"erp-04-32-04","key":"전장 > 음향기기 > 이어폰ACC","parentKey":"전장 > 음향기기","name":"이어폰ACC","level":3,"position":3},{"id":"erp-04-32-05","key":"전장 > 음향기기 > 스피커","parentKey":"전장 > 음향기기","name":"스피커","level":3,"position":4},{"id":"erp-04-33","key":"전장 > 가전","parentKey":"전장","name":"가전","level":2,"position":32},{"id":"erp-04-33-01","key":"전장 > 가전 > 미용가전","parentKey":"전장 > 가전","name":"미용가전","level":3,"position":0},{"id":"erp-04-33-02","key":"전장 > 가전 > 주방가전","parentKey":"전장 > 가전","name":"주방가전","level":3,"position":1},{"id":"erp-04-33-03","key":"전장 > 가전 > 계절가전","parentKey":"전장 > 가전","name":"계절가전","level":3,"position":2},{"id":"erp-04-33-04","key":"전장 > 가전 > 조명가전","parentKey":"전장 > 가전","name":"조명가전","level":3,"position":3},{"id":"erp-04-33-05","key":"전장 > 가전 > 생활가전","parentKey":"전장 > 가전","name":"생활가전","level":3,"position":4},{"id":"erp-05","key":"패션","parentKey":null,"name":"패션","level":1,"position":4},{"id":"erp-05-34","key":"패션 > 가방","parentKey":"패션","name":"가방","level":2,"position":33},{"id":"erp-05-34-01","key":"패션 > 가방 > 백팩","parentKey":"패션 > 가방","name":"백팩","level":3,"position":0},{"id":"erp-05-34-02","key":"패션 > 가방 > 크로스/메신저백","parentKey":"패션 > 가방","name":"크로스/메신저백","level":3,"position":1},{"id":"erp-05-34-03","key":"패션 > 가방 > 에코백","parentKey":"패션 > 가방","name":"에코백","level":3,"position":2},{"id":"erp-05-34-04","key":"패션 > 가방 > 미니백","parentKey":"패션 > 가방","name":"미니백","level":3,"position":3},{"id":"erp-05-34-05","key":"패션 > 가방 > 숄더/토트백","parentKey":"패션 > 가방","name":"숄더/토트백","level":3,"position":4},{"id":"erp-05-34-06","key":"패션 > 가방 > 피크닉백","parentKey":"패션 > 가방","name":"피크닉백","level":3,"position":5},{"id":"erp-05-34-07","key":"패션 > 가방 > 보조가방/장바구니","parentKey":"패션 > 가방","name":"보조가방/장바구니","level":3,"position":6},{"id":"erp-05-34-08","key":"패션 > 가방 > 기타가방/가방소품","parentKey":"패션 > 가방","name":"기타가방/가방소품","level":3,"position":7},{"id":"erp-05-35","key":"패션 > 파우치","parentKey":"패션","name":"파우치","level":2,"position":34},{"id":"erp-05-35-01","key":"패션 > 파우치 > 납작파우치","parentKey":"패션 > 파우치","name":"납작파우치","level":3,"position":0},{"id":"erp-05-35-02","key":"패션 > 파우치 > 사각파우치","parentKey":"패션 > 파우치","name":"사각파우치","level":3,"position":1},{"id":"erp-05-35-03","key":"패션 > 파우치 > 형태파우치","parentKey":"패션 > 파우치","name":"형태파우치","level":3,"position":2},{"id":"erp-05-35-04","key":"패션 > 파우치 > 하드파우치","parentKey":"패션 > 파우치","name":"하드파우치","level":3,"position":3},{"id":"erp-05-35-05","key":"패션 > 파우치 > 실리콘파우치","parentKey":"패션 > 파우치","name":"실리콘파우치","level":3,"position":4},{"id":"erp-05-35-06","key":"패션 > 파우치 > 노트북/태블릿파우치","parentKey":"패션 > 파우치","name":"노트북/태블릿파우치","level":3,"position":5},{"id":"erp-05-35-07","key":"패션 > 파우치 > 뷰티파우치","parentKey":"패션 > 파우치","name":"뷰티파우치","level":3,"position":6},{"id":"erp-05-35-08","key":"패션 > 파우치 > 여행/피크닉파우치","parentKey":"패션 > 파우치","name":"여행/피크닉파우치","level":3,"position":7},{"id":"erp-05-35-09","key":"패션 > 파우치 > 스트링파우치","parentKey":"패션 > 파우치","name":"스트링파우치","level":3,"position":8},{"id":"erp-05-35-10","key":"패션 > 파우치 > 기타파우치","parentKey":"패션 > 파우치","name":"기타파우치","level":3,"position":9},{"id":"erp-05-36","key":"패션 > 지갑","parentKey":"패션","name":"지갑","level":2,"position":35},{"id":"erp-05-36-01","key":"패션 > 지갑 > 카드지갑","parentKey":"패션 > 지갑","name":"카드지갑","level":3,"position":0},{"id":"erp-05-36-02","key":"패션 > 지갑 > 동전지갑","parentKey":"패션 > 지갑","name":"동전지갑","level":3,"position":1},{"id":"erp-05-36-03","key":"패션 > 지갑 > 반지갑/장지갑","parentKey":"패션 > 지갑","name":"반지갑/장지갑","level":3,"position":2},{"id":"erp-05-36-04","key":"패션 > 지갑 > 여권지갑","parentKey":"패션 > 지갑","name":"여권지갑","level":3,"position":3},{"id":"erp-05-36-05","key":"패션 > 지갑 > 기타지갑","parentKey":"패션 > 지갑","name":"기타지갑","level":3,"position":4},{"id":"erp-05-37","key":"패션 > 키링","parentKey":"패션","name":"키링","level":2,"position":36},{"id":"erp-05-37-01","key":"패션 > 키링 > 실리콘키링","parentKey":"패션 > 키링","name":"실리콘키링","level":3,"position":0},{"id":"erp-05-37-02","key":"패션 > 키링 > 아크릴키링","parentKey":"패션 > 키링","name":"아크릴키링","level":3,"position":1},{"id":"erp-05-37-03","key":"패션 > 키링 > 메탈키링","parentKey":"패션 > 키링","name":"메탈키링","level":3,"position":2},{"id":"erp-05-37-04","key":"패션 > 키링 > 봉제키링","parentKey":"패션 > 키링","name":"봉제키링","level":3,"position":3},{"id":"erp-05-37-05","key":"패션 > 키링 > 기타키링","parentKey":"패션 > 키링","name":"기타키링","level":3,"position":4},{"id":"erp-05-38","key":"패션 > 우산/우비","parentKey":"패션","name":"우산/우비","level":2,"position":37},{"id":"erp-05-38-01","key":"패션 > 우산/우비 > 3단우산","parentKey":"패션 > 우산/우비","name":"3단우산","level":3,"position":0},{"id":"erp-05-38-02","key":"패션 > 우산/우비 > 5단우산","parentKey":"패션 > 우산/우비","name":"5단우산","level":3,"position":1},{"id":"erp-05-38-03","key":"패션 > 우산/우비 > 장우산","parentKey":"패션 > 우산/우비","name":"장우산","level":3,"position":2},{"id":"erp-05-38-04","key":"패션 > 우산/우비 > 투명우산","parentKey":"패션 > 우산/우비","name":"투명우산","level":3,"position":3},{"id":"erp-05-38-05","key":"패션 > 우산/우비 > 양우산","parentKey":"패션 > 우산/우비","name":"양우산","level":3,"position":4},{"id":"erp-05-38-06","key":"패션 > 우산/우비 > 우비","parentKey":"패션 > 우산/우비","name":"우비","level":3,"position":5},{"id":"erp-05-39","key":"패션 > 양말","parentKey":"패션","name":"양말","level":2,"position":38},{"id":"erp-05-39-01","key":"패션 > 양말 > 발목/단목양말","parentKey":"패션 > 양말","name":"발목/단목양말","level":3,"position":0},{"id":"erp-05-39-02","key":"패션 > 양말 > 중목/장목양말","parentKey":"패션 > 양말","name":"중목/장목양말","level":3,"position":1},{"id":"erp-05-39-03","key":"패션 > 양말 > 페이크삭스","parentKey":"패션 > 양말","name":"페이크삭스","level":3,"position":2},{"id":"erp-05-39-04","key":"패션 > 양말 > 기타양말","parentKey":"패션 > 양말","name":"기타양말","level":3,"position":3},{"id":"erp-05-40","key":"패션 > 수면의류","parentKey":"패션","name":"수면의류","level":2,"position":39},{"id":"erp-05-40-01","key":"패션 > 수면의류 > 수면바지","parentKey":"패션 > 수면의류","name":"수면바지","level":3,"position":0},{"id":"erp-05-40-02","key":"패션 > 수면의류 > 수면원피스","parentKey":"패션 > 수면의류","name":"수면원피스","level":3,"position":1},{"id":"erp-05-40-03","key":"패션 > 수면의류 > 수면양말","parentKey":"패션 > 수면의류","name":"수면양말","level":3,"position":2},{"id":"erp-05-40-04","key":"패션 > 수면의류 > 수면조끼","parentKey":"패션 > 수면의류","name":"수면조끼","level":3,"position":3},{"id":"erp-05-41","key":"패션 > 기타잡화","parentKey":"패션","name":"기타잡화","level":2,"position":40},{"id":"erp-05-41-01","key":"패션 > 기타잡화 > 뱃지","parentKey":"패션 > 기타잡화","name":"뱃지","level":3,"position":0},{"id":"erp-05-41-02","key":"패션 > 기타잡화 > 모자","parentKey":"패션 > 기타잡화","name":"모자","level":3,"position":1},{"id":"erp-05-41-03","key":"패션 > 기타잡화 > 잠옷","parentKey":"패션 > 기타잡화","name":"잠옷","level":3,"position":2},{"id":"erp-05-41-04","key":"패션 > 기타잡화 > 속옷","parentKey":"패션 > 기타잡화","name":"속옷","level":3,"position":3},{"id":"erp-05-41-05","key":"패션 > 기타잡화 > 이지웨어","parentKey":"패션 > 기타잡화","name":"이지웨어","level":3,"position":4},{"id":"erp-05-41-06","key":"패션 > 기타잡화 > 손수건/머플러","parentKey":"패션 > 기타잡화","name":"손수건/머플러","level":3,"position":5},{"id":"erp-05-41-07","key":"패션 > 기타잡화 > 슬리퍼","parentKey":"패션 > 기타잡화","name":"슬리퍼","level":3,"position":6},{"id":"erp-05-41-08","key":"패션 > 기타잡화 > 손목시계","parentKey":"패션 > 기타잡화","name":"손목시계","level":3,"position":7},{"id":"erp-05-41-09","key":"패션 > 기타잡화 > 여행소품","parentKey":"패션 > 기타잡화","name":"여행소품","level":3,"position":8},{"id":"erp-05-41-10","key":"패션 > 기타잡화 > 슈즈악세서리","parentKey":"패션 > 기타잡화","name":"슈즈악세서리","level":3,"position":9},{"id":"erp-05-41-11","key":"패션 > 기타잡화 > 기타잡화","parentKey":"패션 > 기타잡화","name":"기타잡화","level":3,"position":10},{"id":"erp-05-41-12","key":"패션 > 기타잡화 > 헤어밴드","parentKey":"패션 > 기타잡화","name":"헤어밴드","level":3,"position":11},{"id":"erp-05-41-13","key":"패션 > 기타잡화 > 여성장갑","parentKey":"패션 > 기타잡화","name":"여성장갑","level":3,"position":12},{"id":"erp-05-41-14","key":"패션 > 기타잡화 > 귀마개","parentKey":"패션 > 기타잡화","name":"귀마개","level":3,"position":13},{"id":"erp-06","key":"스포츠/레저","parentKey":null,"name":"스포츠/레저","level":1,"position":5},{"id":"erp-06-43","key":"스포츠/레저 > 수영/수상스포츠","parentKey":"스포츠/레저","name":"수영/수상스포츠","level":2,"position":42},{"id":"erp-06-43-01","key":"스포츠/레저 > 수영/수상스포츠 > 물놀이용품","parentKey":"스포츠/레저 > 수영/수상스포츠","name":"물놀이용품","level":3,"position":0},{"id":"erp-06-43-02","key":"스포츠/레저 > 수영/수상스포츠 > 수영용품","parentKey":"스포츠/레저 > 수영/수상스포츠","name":"수영용품","level":3,"position":1},{"id":"erp-06-44","key":"스포츠/레저 > 구기스포츠","parentKey":"스포츠/레저","name":"구기스포츠","level":2,"position":43},{"id":"erp-06-44-01","key":"스포츠/레저 > 구기스포츠 > 야구","parentKey":"스포츠/레저 > 구기스포츠","name":"야구","level":3,"position":0},{"id":"erp-06-44-02","key":"스포츠/레저 > 구기스포츠 > 농구","parentKey":"스포츠/레저 > 구기스포츠","name":"농구","level":3,"position":1},{"id":"erp-06-44-03","key":"스포츠/레저 > 구기스포츠 > 축구","parentKey":"스포츠/레저 > 구기스포츠","name":"축구","level":3,"position":2},{"id":"erp-06-44-04","key":"스포츠/레저 > 구기스포츠 > 테니스","parentKey":"스포츠/레저 > 구기스포츠","name":"테니스","level":3,"position":3},{"id":"erp-08","key":"기타","parentKey":null,"name":"기타","level":1,"position":7},{"id":"erp-08-42","key":"기타 > 기타","parentKey":"기타","name":"기타","level":2,"position":41},{"id":"erp-08-42-01","key":"기타 > 기타 > 기타","parentKey":"기타 > 기타","name":"기타","level":3,"position":0},{"id":"erp-08-42-02","key":"기타 > 기타 > 비매품","parentKey":"기타 > 기타","name":"비매품","level":3,"position":1},{"id":"erp-09","key":"화장품/미용","parentKey":null,"name":"화장품/미용","level":1,"position":8},{"id":"erp-09-01","key":"화장품/미용 > 향수","parentKey":"화장품/미용","name":"향수","level":2,"position":0},{"id":"erp-09-01-01","key":"화장품/미용 > 향수 > 고체향수","parentKey":"화장품/미용 > 향수","name":"고체향수","level":3,"position":0},{"id":"erp-09-01-02","key":"화장품/미용 > 향수 > 일반향수","parentKey":"화장품/미용 > 향수","name":"일반향수","level":3,"position":1},{"id":"erp-09-47","key":"화장품/미용 > 색조메이크업","parentKey":"화장품/미용","name":"색조메이크업","level":2,"position":46},{"id":"erp-09-47-01","key":"화장품/미용 > 색조메이크업 > 립케어","parentKey":"화장품/미용 > 색조메이크업","name":"립케어","level":3,"position":0},{"id":"erp-09-48","key":"화장품/미용 > 선케어","parentKey":"화장품/미용","name":"선케어","level":2,"position":47},{"id":"erp-09-48-01","key":"화장품/미용 > 선케어 > 선파우더/쿠션","parentKey":"화장품/미용 > 선케어","name":"선파우더/쿠션","level":3,"position":0},{"id":"erp-09-49","key":"화장품/미용 > 바디케어","parentKey":"화장품/미용","name":"바디케어","level":2,"position":48},{"id":"erp-09-49-01","key":"화장품/미용 > 바디케어 > 핸드케어","parentKey":"화장품/미용 > 바디케어","name":"핸드케어","level":3,"position":0},{"id":"erp-09-50","key":"화장품/미용 > 뷰티소품2","parentKey":"화장품/미용","name":"뷰티소품2","level":2,"position":49}]$erp$::jsonb);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.categories where source = 'erp';
  if v_count <> 350 then
    raise exception 'erp category seed expected 350 nodes, got %', v_count;
  end if;
end;
$$;
