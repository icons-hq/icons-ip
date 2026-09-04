-- D-9/D-10 ③ — 분류·판매 기간·검색/SEO 어드민 RPC (설계서 v2 §1-2 RPC 표)
--
-- 공통: security definer · is_staff 게이트 · audit_log · authenticated 에만 execute.
-- 순서·집합 교체는 클라이언트 요청 id 를 audit_log.id 로 써서 재전송을 「이미 적용」으로 읽는다(admin_adjust_stock 선례).

create or replace function private.record_admin_action(
  p_request_id uuid,
  p_actor uuid,
  p_action text,
  p_target text,
  p_diff jsonb
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_existing record;
begin
  if p_request_id is null then
    insert into public.audit_log (actor_id, action, target, diff)
    values (p_actor, p_action, p_target, p_diff);
    return true;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_request:' || p_request_id::text, 0)
  );
  select audit.actor_id, audit.action, audit.target, audit.diff into v_existing
  from public.audit_log as audit
  where audit.id = p_request_id;
  if found then
    if v_existing.actor_id = p_actor and v_existing.action = p_action and v_existing.target = p_target then
      -- 같은 요청의 재전송. 이미 적용됐다.
      return false;
    end if;
    raise exception 'request_conflict' using errcode = '23505';
  end if;

  insert into public.audit_log (id, actor_id, action, target, diff)
  values (p_request_id, p_actor, p_action, p_target, p_diff);
  return true;
end;
$$;
revoke all on function private.record_admin_action(uuid, uuid, text, text, jsonb) from public;

-- ---------------------------------------------------------------------------
-- 분류
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
    name = excluded.name,
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
  select category.id, category.parent_id, category.path, category.kind into v_current
  from public.categories as category
  where category.id = target_id
  for update;
  if not found then
    raise exception 'category_missing' using errcode = 'P0002';
  end if;
  if v_current.kind = 'collection' and v_parent is not null then
    raise exception 'category_collection_flat' using errcode = '23514';
  end if;
  if v_parent is not null then
    if not exists (select 1 from public.categories as parent where parent.id = v_parent) then
      raise exception 'category_parent_missing' using errcode = 'P0002';
    end if;
    -- 자기 자신·자기 자손 아래로는 못 옮긴다(트리거도 막지만 여기서 도메인 이름으로 먼저 거른다).
    if exists (
      select 1 from public.categories as parent
      where parent.id = v_parent and parent.path like v_current.path || '%'
    ) then
      raise exception 'category_cycle' using errcode = '23514';
    end if;
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

create or replace function public.admin_reorder_categories(
  target_parent_id text,
  target_ordered_ids text[],
  target_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_parent text := nullif(btrim(coalesce(target_parent_id, '')), '');
  v_expected integer;
  v_given integer := cardinality(coalesce(target_ordered_ids, '{}'::text[]));
begin
  select count(*) into v_expected
  from public.categories as sibling
  where sibling.parent_id is not distinct from v_parent;

  if v_given <> v_expected or v_given <> (select count(distinct id) from unnest(target_ordered_ids) as id) then
    raise exception 'category_reorder_incomplete' using errcode = '23514';
  end if;
  if exists (
    select 1 from unnest(target_ordered_ids) as given(id)
    where not exists (
      select 1 from public.categories as sibling
      where sibling.id = given.id and sibling.parent_id is not distinct from v_parent
    )
  ) then
    raise exception 'category_reorder_incomplete' using errcode = '23514';
  end if;

  if not private.record_admin_action(
    target_request_id, v_actor, 'catalog.category.reorder', 'category:' || coalesce(v_parent, 'root'),
    jsonb_build_object('order', to_jsonb(target_ordered_ids))
  ) then
    return;
  end if;

  update public.categories as category
  set position = ordered.ordinality::integer - 1
  from unnest(target_ordered_ids) with ordinality as ordered(id, ordinality)
  where category.id = ordered.id;
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

-- ---------------------------------------------------------------------------
-- 상품 ↔ 분류
-- ---------------------------------------------------------------------------
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
end;
$$;

create or replace function public.admin_reorder_category_goods(
  target_category_id text,
  target_ordered_good_ids text[],
  target_pinned_good_ids text[] default '{}'::text[],
  target_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_mode text;
  v_expected integer;
  v_given integer := cardinality(coalesce(target_ordered_good_ids, '{}'::text[]));
begin
  select category.display_mode into v_mode
  from public.categories as category
  where category.id = target_category_id;
  if v_mode is null then
    raise exception 'category_missing' using errcode = 'P0002';
  end if;
  if v_mode = 'auto' then
    raise exception 'category_auto_sorted' using errcode = '23514';
  end if;

  select count(*) into v_expected
  from public.good_categories as membership
  where membership.category_id = target_category_id;
  if v_given <> v_expected then
    raise exception 'category_reorder_incomplete' using errcode = '23514';
  end if;

  if not private.record_admin_action(
    target_request_id, v_actor, 'catalog.category.reorder_goods', 'category:' || target_category_id,
    jsonb_build_object('order', to_jsonb(target_ordered_good_ids), 'pinned', to_jsonb(target_pinned_good_ids))
  ) then
    return;
  end if;

  update public.good_categories as membership
  set position = ordered.ordinality::integer - 1,
      pinned = ordered.id = any(coalesce(target_pinned_good_ids, '{}'::text[]))
  from unnest(target_ordered_good_ids) with ordinality as ordered(id, ordinality)
  where membership.category_id = target_category_id
    and membership.good_id = ordered.id;
end;
$$;

create or replace function public.admin_set_category_good_display_window(
  target_category_id text,
  target_good_id text,
  target_display_from timestamptz default null,
  target_display_until timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
begin
  if target_display_from is not null and target_display_until is not null
    and target_display_until <= target_display_from
  then
    raise exception 'display_window_invalid' using errcode = '23514';
  end if;

  update public.good_categories
  set display_from = target_display_from, display_until = target_display_until
  where category_id = target_category_id and good_id = target_good_id;
  if not found then
    raise exception 'category_membership_missing' using errcode = 'P0002';
  end if;

  perform private.record_admin_action(
    null, v_actor, 'catalog.category.display_window', 'category:' || target_category_id,
    jsonb_build_object('good_id', target_good_id, 'from', target_display_from, 'until', target_display_until)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 판매 기간 · 스위치 · 검색/SEO
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_good_sale_window(
  target_good_id text,
  target_sale_starts_at timestamptz default null,
  target_sale_ends_at timestamptz default null,
  target_sale_mode text default 'regular',
  target_preorder_ships_at date default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_good public.goods;
begin
  if target_sale_mode not in ('regular', 'preorder') then
    raise exception 'sale_mode_invalid' using errcode = '22023';
  end if;
  if target_sale_starts_at is not null and target_sale_ends_at is not null
    and target_sale_ends_at <= target_sale_starts_at
  then
    raise exception 'sale_window_invalid' using errcode = '23514';
  end if;
  if target_sale_mode = 'preorder' and target_preorder_ships_at is null then
    raise exception 'preorder_ship_date_required' using errcode = '23514';
  end if;

  update public.goods
  set sale_starts_at = target_sale_starts_at,
      sale_ends_at = target_sale_ends_at,
      sale_mode = target_sale_mode,
      preorder_ships_at = case when target_sale_mode = 'preorder' then target_preorder_ships_at end
  where id = target_good_id
  returning * into v_good;
  if not found then
    raise exception 'good_not_found' using errcode = 'P0002';
  end if;

  perform private.record_admin_action(
    null, v_actor, 'catalog.good.sale_window', 'goods:' || target_good_id,
    jsonb_build_object('starts_at', target_sale_starts_at, 'ends_at', target_sale_ends_at,
                       'mode', target_sale_mode, 'ships_at', target_preorder_ships_at)
  );
  return public.good_sale_state(v_good);
end;
$$;

-- 판매 중지·숨김은 저장 폼과 분리한 스위치다(고시정보 7칸을 다시 제출하지 않고 즉시 멈출 수 있어야 한다).
create or replace function public.admin_set_good_switch(
  target_good_id text,
  target_switch text,
  target_enabled boolean,
  target_reason text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_reason text := nullif(btrim(coalesce(target_reason, '')), '');
  v_good public.goods;
begin
  if target_switch not in ('selling', 'visible') then
    raise exception 'switch_invalid' using errcode = '22023';
  end if;
  -- 끄는 쪽(판매 중지·진열 안 함)에만 사유를 요구한다 — 되돌릴 때 왜 멈췄는지가 남아야 한다.
  if not target_enabled and v_reason is null then
    raise exception 'reason_required' using errcode = '23514';
  end if;

  update public.goods
  set stopped_at = case
        when target_switch = 'selling' then case when target_enabled then null else coalesce(stopped_at, now()) end
        else stopped_at
      end,
      hidden_at = case
        when target_switch = 'visible' then case when target_enabled then null else coalesce(hidden_at, now()) end
        else hidden_at
      end
  where id = target_good_id
  returning * into v_good;
  if not found then
    raise exception 'good_not_found' using errcode = 'P0002';
  end if;

  perform private.record_admin_action(
    null, v_actor, 'catalog.good.' || target_switch, 'goods:' || target_good_id,
    jsonb_build_object('enabled', target_enabled, 'reason', v_reason)
  );
  return public.good_sale_state(v_good);
end;
$$;

create or replace function public.admin_set_good_search_seo(
  target_good_id text,
  target_summary text default null,
  target_search_keywords text[] default '{}'::text[],
  target_seo_title text default null,
  target_seo_description text default null,
  target_image_alt text default null,
  target_gallery_alts text[] default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_keywords text[] := coalesce(target_search_keywords, '{}'::text[]);
begin
  if cardinality(v_keywords) > 50 then
    raise exception 'goods_keywords_limit' using errcode = '23514';
  end if;
  if target_gallery_alts is not null and exists (
    select 1 from public.goods as good
    where good.id = target_good_id
      and cardinality(target_gallery_alts) <> cardinality(good.gallery_paths)
  ) then
    raise exception 'goods_gallery_alts_mismatch' using errcode = '23514';
  end if;

  update public.goods
  set summary = nullif(btrim(coalesce(target_summary, '')), ''),
      search_keywords = v_keywords,
      seo_title = nullif(btrim(coalesce(target_seo_title, '')), ''),
      seo_description = nullif(btrim(coalesce(target_seo_description, '')), ''),
      image_alt = nullif(btrim(coalesce(target_image_alt, '')), ''),
      gallery_alts = target_gallery_alts
  where id = target_good_id;
  if not found then
    raise exception 'good_not_found' using errcode = 'P0002';
  end if;

  perform private.record_admin_action(
    null, v_actor, 'catalog.good.search_seo', 'goods:' || target_good_id,
    jsonb_build_object('keywords', cardinality(v_keywords), 'has_summary', target_summary is not null)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 읽기 — 분류 트리(상품 수 포함)
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_categories(p_include_archived boolean default false)
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
  descendant_goods_count bigint
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
     where descendant.path like category.path || '%')
  from public.categories as category
  where p_include_archived or category.archived_at is null
  order by category.path;
end;
$$;

-- ---------------------------------------------------------------------------
-- ACL
-- ---------------------------------------------------------------------------
do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.admin_upsert_category(text, text, text, text, text, text, boolean, text, text, boolean, boolean, text, text, text, text)',
    'public.admin_move_category(text, text, integer)',
    'public.admin_reorder_categories(text, text[], uuid)',
    'public.admin_archive_category(text, boolean)',
    'public.admin_set_good_categories(text, text, text[], uuid)',
    'public.admin_reorder_category_goods(text, text[], text[], uuid)',
    'public.admin_set_category_good_display_window(text, text, timestamptz, timestamptz)',
    'public.admin_set_good_sale_window(text, timestamptz, timestamptz, text, date)',
    'public.admin_set_good_switch(text, text, boolean, text)',
    'public.admin_set_good_search_seo(text, text, text[], text, text, text, text[])',
    'public.admin_list_categories(boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, service_role', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
  end loop;
end;
$$;
