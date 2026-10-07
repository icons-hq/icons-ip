-- MD 회의(2026-10-07) ⑦: ERP '품목 생성' 데이터(ERP 코드·품명·ERP 분류, 있으면 판매가·바코드)를
-- 붙여넣기·파일로 반입해 두고, 상품 옵션의 ERP 품명 입력에서 품목을 제안한다.
-- ERP와 실시간 연동하지 않는다. 반입 값은 제안일 뿐이며 상품·옵션 저장 계약은 바꾸지 않는다.
-- 신제품이 생기면 MD가 다시 반입한다(ERP 코드 기준 upsert).

-- ---------------------------------------------------------------------------
-- 정규화 헬퍼 — 서버 액션(lib/admin/erp-item-import.ts)과 같은 규칙을 DB가 한 번 더 강제한다.
-- 앞뒤 공백(전각·NBSP·BOM 포함)을 걷어내고, 품명·분류는 줄바꿈·탭을 공백 하나로 합친다.
-- 로캘에 따라 [[:space:]]가 달라지지 않도록 공백 문자를 명시한다.
-- ---------------------------------------------------------------------------
create function private.erp_item_text(p_value text, p_collapse boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    pg_catalog.regexp_replace(
      case when p_collapse
        then pg_catalog.regexp_replace(
          p_value,
          '[ \t\n\r\f\v   -     　﻿]+',
          ' ', 'g')
        else p_value
      end,
      '^[ \t\n\r\f\v   -     　﻿]+|[ \t\n\r\f\v   -     　﻿]+$',
      '', 'g'),
    '')
$$;

create table public.erp_items (
  -- ERP 코드(품번). 텍스트 그대로 보존한다 — 선행 0을 숫자로 바꾸지 않는다.
  code text primary key
    check (pg_catalog.length(code) between 1 and 120
      and code = private.erp_item_text(code, false)
      and code !~ '[\u0001-\u001f\u007f-\u009f]'),
  name text not null
    check (pg_catalog.length(name) between 1 and 200
      and name = private.erp_item_text(name, true)
      and name !~ '[\u0001-\u001f\u007f-\u009f]'),
  -- ERP 분류 원문. 빈 값은 null.
  category text
    check (category is null or (pg_catalog.length(category) between 1 and 200
      and category = private.erp_item_text(category, true)
      and category !~ '[\u0001-\u001f\u007f-\u009f]')),
  sale_price integer check (sale_price is null or sale_price >= 0),
  barcode text
    check (barcode is null or (pg_catalog.length(barcode) between 1 and 120
      and barcode = private.erp_item_text(barcode, false)
      and barcode !~ '[\u0001-\u001f\u007f-\u009f]')),
  imported_at timestamptz not null default now(),
  imported_by uuid not null references public.profiles (id),
  updated_at timestamptz not null default now()
);

create index erp_items_name_trgm on public.erp_items using gin (name extensions.gin_trgm_ops);
create index erp_items_code_trgm on public.erp_items using gin (code extensions.gin_trgm_ops);
create index erp_items_category_idx on public.erp_items (category);

-- ERP 분류 원문 → 고객 카테고리 말단. 상품 옵션에서 ERP 품목을 고르면 이 연결로 카테고리를 제안한다.
-- 카테고리는 보관이 기본이고 하드 삭제는 드물다. 삭제되면 제안 연결만 함께 사라진다.
create table public.erp_category_mappings (
  erp_category text primary key
    check (pg_catalog.length(erp_category) between 1 and 200
      and erp_category = private.erp_item_text(erp_category, true)
      and erp_category !~ '[\u0001-\u001f\u007f-\u009f]'),
  category_id uuid not null references public.catalog_categories (id) on delete cascade,
  updated_by uuid not null references public.profiles (id),
  updated_at timestamptz not null default now()
);
create index erp_category_mappings_category_idx on public.erp_category_mappings (category_id);

alter table public.erp_items enable row level security;
alter table public.erp_category_mappings enable row level security;

create policy erp_items_staff_read on public.erp_items
  for select using ((select public.is_staff()));
create policy erp_category_mappings_staff_read on public.erp_category_mappings
  for select using ((select public.is_staff()));

revoke all on public.erp_items, public.erp_category_mappings from public, anon, authenticated, service_role;
grant all on public.erp_items, public.erp_category_mappings to postgres;
grant select on public.erp_items, public.erp_category_mappings to authenticated;

-- 반입 행 하나를 정규화한다. 열이 아예 없는 키(category·sale_price·barcode)는 "기존 값 유지"로,
-- null·빈 값은 "값 지움"으로 구분하도록 o_has_* 플래그를 함께 돌려준다.
create function private.normalize_erp_item_row(
  p_item jsonb,
  out o_code text,
  out o_name text,
  out o_category text,
  out o_sale_price integer,
  out o_barcode text,
  out o_has_category boolean,
  out o_has_sale_price boolean,
  out o_has_barcode boolean,
  out o_reason text
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_price_text text;
  v_price numeric;
begin
  if p_item is null or pg_catalog.jsonb_typeof(p_item) <> 'object' then
    o_reason := 'invalid_row';
    return;
  end if;

  if p_item -> 'code' is null or pg_catalog.jsonb_typeof(p_item -> 'code') = 'null' then
    o_reason := 'missing_code';
    return;
  end if;
  if pg_catalog.jsonb_typeof(p_item -> 'code') <> 'string' then
    o_reason := 'invalid_code';
    return;
  end if;
  o_code := private.erp_item_text(p_item ->> 'code', false);
  if o_code is null then
    o_reason := 'missing_code';
    return;
  end if;
  if pg_catalog.length(o_code) > 120 or o_code ~ '[\u0001-\u001f\u007f-\u009f]' then
    o_code := null;
    o_reason := 'invalid_code';
    return;
  end if;

  if p_item -> 'name' is null or pg_catalog.jsonb_typeof(p_item -> 'name') = 'null' then
    o_reason := 'missing_name';
    return;
  end if;
  if pg_catalog.jsonb_typeof(p_item -> 'name') <> 'string' then
    o_reason := 'invalid_name';
    return;
  end if;
  o_name := private.erp_item_text(p_item ->> 'name', true);
  if o_name is null then
    o_reason := 'missing_name';
    return;
  end if;
  if pg_catalog.length(o_name) > 200 or o_name ~ '[\u0001-\u001f\u007f-\u009f]' then
    o_name := null;
    o_reason := 'invalid_name';
    return;
  end if;

  o_has_category := p_item ? 'category';
  if o_has_category and pg_catalog.jsonb_typeof(p_item -> 'category') <> 'null' then
    if pg_catalog.jsonb_typeof(p_item -> 'category') <> 'string' then
      o_reason := 'invalid_category';
      return;
    end if;
    o_category := private.erp_item_text(p_item ->> 'category', true);
    if pg_catalog.length(coalesce(o_category, '')) > 200 or o_category ~ '[\u0001-\u001f\u007f-\u009f]' then
      o_category := null;
      o_reason := 'invalid_category';
      return;
    end if;
  end if;

  o_has_sale_price := p_item ? 'sale_price';
  if o_has_sale_price and pg_catalog.jsonb_typeof(p_item -> 'sale_price') <> 'null' then
    if pg_catalog.jsonb_typeof(p_item -> 'sale_price') = 'number' then
      v_price := (p_item ->> 'sale_price')::numeric;
    elsif pg_catalog.jsonb_typeof(p_item -> 'sale_price') = 'string' then
      -- 엑셀 서식 값(12,000원 · ₩12,000)을 허용한다. 서버 액션은 이미 정수로 보낸다.
      v_price_text := pg_catalog.regexp_replace(
        p_item ->> 'sale_price', '[ \t 　,원₩￦\\]', '', 'g');
      if v_price_text = '' then
        v_price := null;
      elsif v_price_text ~ '^[0-9]{1,12}([.]0+)?$' then
        v_price := v_price_text::numeric;
      else
        o_reason := 'invalid_sale_price';
        return;
      end if;
    else
      o_reason := 'invalid_sale_price';
      return;
    end if;
    if v_price is not null then
      if v_price <> pg_catalog.trunc(v_price) or v_price < 0 or v_price > 2147483647 then
        o_reason := 'invalid_sale_price';
        return;
      end if;
      o_sale_price := v_price::integer;
    end if;
  end if;

  o_has_barcode := p_item ? 'barcode';
  if o_has_barcode and pg_catalog.jsonb_typeof(p_item -> 'barcode') <> 'null' then
    if pg_catalog.jsonb_typeof(p_item -> 'barcode') <> 'string' then
      o_reason := 'invalid_barcode';
      return;
    end if;
    o_barcode := private.erp_item_text(p_item ->> 'barcode', false);
    if pg_catalog.length(coalesce(o_barcode, '')) > 120 or o_barcode ~ '[\u0001-\u001f\u007f-\u009f]' then
      o_barcode := null;
      o_reason := 'invalid_barcode';
      return;
    end if;
  end if;
end;
$$;

-- ERP 분류에 연결된 고객 카테고리 중 지금 상품에 연결할 수 있는 활성 말단만 제안한다.
create function private.erp_category_target(p_erp_category text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select mapping.category_id
  from public.erp_category_mappings as mapping
  join public.catalog_categories as category on category.id = mapping.category_id
  where mapping.erp_category = p_erp_category
    and category.archived_at is null
    and not exists (
      select 1
      from public.catalog_categories as child
      where child.parent_id = category.id
        and child.archived_at is null
    )
$$;

-- ---------------------------------------------------------------------------
-- 반입: ERP 코드 기준 upsert. 한 번에 최대 5,000행, 행마다 정규화·검증하고
-- {inserted, updated, unchanged, rejected:[{row, code, reason}]}를 돌려준다.
-- 같은 ERP 코드가 여러 번 오면 마지막 행만 반영하고 앞 행은 duplicate_code로 돌려준다.
-- ---------------------------------------------------------------------------
create function public.admin_import_erp_items(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_row record;
  v_existing public.erp_items;
  v_category text;
  v_sale_price integer;
  v_barcode text;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_rejected jsonb[] := array[]::jsonb[];
  v_changed_codes text[] := array[]::text[];
  v_now timestamptz := pg_catalog.now();
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if p_rows is null
     or pg_catalog.jsonb_typeof(p_rows) <> 'array'
     or pg_catalog.jsonb_array_length(p_rows) not between 1 and 5000 then
    raise invalid_parameter_value using message = 'invalid_erp_item_rows';
  end if;

  -- 같은 ERP 코드를 다른 순서로 잠그는 동시 반입끼리 교착하지 않도록 반입을 직렬화한다.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.erp_items.import', 0));

  for v_row in
    with input as (
      select element.value as item, element.ordinality::integer as ord
      from pg_catalog.jsonb_array_elements(p_rows) with ordinality as element(value, ordinality)
    ), normalized as (
      select
        input.ord,
        case
          when pg_catalog.jsonb_typeof(input.item -> 'row') = 'number'
            and (input.item ->> 'row') ~ '^[0-9]{1,9}$'
          then (input.item ->> 'row')::integer
          else input.ord
        end as source_row,
        case
          when pg_catalog.jsonb_typeof(input.item -> 'code') = 'string'
          then pg_catalog.left(
            pg_catalog.regexp_replace(input.item ->> 'code', '[\u0001-\u001f\u007f-\u009f]', ' ', 'g'), 120)
        end as raw_code,
        normalized_row.*
      from input
      cross join lateral private.normalize_erp_item_row(input.item) as normalized_row
    )
    select
      normalized.*,
      coalesce(
        normalized.o_reason is null
          and normalized.ord < pg_catalog.max(normalized.ord)
            filter (where normalized.o_reason is null)
            over (partition by normalized.o_code),
        false
      ) as superseded
    from normalized
    order by normalized.ord
  loop
    if v_row.o_reason is not null or v_row.superseded then
      v_rejected := pg_catalog.array_append(v_rejected, pg_catalog.jsonb_build_object(
        'row', v_row.source_row,
        'code', coalesce(v_row.o_code, v_row.raw_code),
        'reason', coalesce(v_row.o_reason, 'duplicate_code')));
      continue;
    end if;

    select * into v_existing
    from public.erp_items as item
    where item.code = v_row.o_code
    for update;

    if not found then
      insert into public.erp_items (code, name, category, sale_price, barcode, imported_at, imported_by, updated_at)
      values (v_row.o_code, v_row.o_name, v_row.o_category, v_row.o_sale_price, v_row.o_barcode, v_now, v_actor, v_now);
      v_inserted := v_inserted + 1;
      if pg_catalog.cardinality(v_changed_codes) < 100 then
        v_changed_codes := pg_catalog.array_append(v_changed_codes, v_row.o_code);
      end if;
      continue;
    end if;

    v_category := case when v_row.o_has_category then v_row.o_category else v_existing.category end;
    v_sale_price := case when v_row.o_has_sale_price then v_row.o_sale_price else v_existing.sale_price end;
    v_barcode := case when v_row.o_has_barcode then v_row.o_barcode else v_existing.barcode end;

    if (v_existing.name, v_existing.category, v_existing.sale_price, v_existing.barcode)
       is not distinct from (v_row.o_name, v_category, v_sale_price, v_barcode) then
      v_unchanged := v_unchanged + 1;
    else
      update public.erp_items as item
      set name = v_row.o_name,
          category = v_category,
          sale_price = v_sale_price,
          barcode = v_barcode,
          imported_at = v_now,
          imported_by = v_actor,
          updated_at = v_now
      where item.code = v_row.o_code;
      v_updated := v_updated + 1;
      if pg_catalog.cardinality(v_changed_codes) < 100 then
        v_changed_codes := pg_catalog.array_append(v_changed_codes, v_row.o_code);
      end if;
    end if;
  end loop;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.erp_items.imported', 'erp_items', pg_catalog.jsonb_build_object(
    'rows', pg_catalog.jsonb_array_length(p_rows),
    'inserted', v_inserted,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'rejected', pg_catalog.cardinality(v_rejected),
    'changed_codes', pg_catalog.to_jsonb(v_changed_codes),
    'changed_codes_truncated', v_inserted + v_updated > pg_catalog.cardinality(v_changed_codes)));

  return pg_catalog.jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'rejected', pg_catalog.to_jsonb(v_rejected));
end;
$$;

-- ---------------------------------------------------------------------------
-- 제안 검색: ERP 품명·ERP 코드 부분 일치. `%`·`_`·`\`는 검색어 글자로만 다룬다.
-- 정확한 ERP 코드와 품명 앞부분 일치를 먼저 보여 준다.
-- ---------------------------------------------------------------------------
create function public.admin_search_erp_items(p_query text, p_limit integer default 8)
returns table (
  code text,
  name text,
  category text,
  sale_price integer,
  barcode text,
  mapped_category_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_needle text := private.erp_item_text(p_query, true);
  v_escaped text;
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if p_limit is null or p_limit not between 1 and 50
     or pg_catalog.length(coalesce(v_needle, '')) > 100 then
    raise invalid_parameter_value using message = 'invalid_erp_item_search';
  end if;
  if v_needle is null then
    return;
  end if;

  v_escaped := pg_catalog.replace(
    pg_catalog.replace(pg_catalog.replace(v_needle, E'\\', E'\\\\'), '%', E'\\%'),
    '_', E'\\_');

  return query
    select
      item.code,
      item.name,
      item.category,
      item.sale_price,
      item.barcode,
      private.erp_category_target(item.category)
    from public.erp_items as item
    where item.name ilike '%' || v_escaped || '%' escape E'\\'
       or item.code ilike '%' || v_escaped || '%' escape E'\\'
    order by
      case
        when pg_catalog.lower(item.code) = pg_catalog.lower(v_needle) then 0
        when item.name ilike v_escaped || '%' escape E'\\' then 1
        when item.code ilike v_escaped || '%' escape E'\\' then 2
        else 3
      end,
      pg_catalog.length(item.name),
      item.name,
      item.code
    limit p_limit;
end;
$$;

-- 목록·검색(ERP 코드·ERP 품명)과 총 개수.
create function public.admin_list_erp_items(p_query text, p_offset integer, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_needle text := private.erp_item_text(p_query, true);
  v_pattern text;
  v_total bigint;
  v_items jsonb;
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if p_limit is null or p_limit not between 1 and 100
     or p_offset is null or p_offset not between 0 and 1000000
     or pg_catalog.length(coalesce(v_needle, '')) > 100 then
    raise invalid_parameter_value using message = 'invalid_erp_item_list';
  end if;

  if v_needle is not null then
    v_pattern := '%' || pg_catalog.replace(
      pg_catalog.replace(pg_catalog.replace(v_needle, E'\\', E'\\\\'), '%', E'\\%'),
      '_', E'\\_') || '%';
  end if;

  select pg_catalog.count(*) into v_total
  from public.erp_items as item
  where v_pattern is null
     or item.name ilike v_pattern escape E'\\'
     or item.code ilike v_pattern escape E'\\';

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'code', page.code,
      'name', page.name,
      'category', page.category,
      'sale_price', page.sale_price,
      'barcode', page.barcode,
      'mapped_category_id', private.erp_category_target(page.category),
      'imported_at', page.imported_at,
      'updated_at', page.updated_at
    ) order by page.code), '[]'::jsonb)
  into v_items
  from (
    select item.code, item.name, item.category, item.sale_price, item.barcode, item.imported_at, item.updated_at
    from public.erp_items as item
    where v_pattern is null
       or item.name ilike v_pattern escape E'\\'
       or item.code ilike v_pattern escape E'\\'
    order by item.code
    offset p_offset
    limit p_limit
  ) as page;

  return pg_catalog.jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

-- 반입된 서로 다른 ERP 분류·품목 수·현재 연결. 품목이 사라진 연결도 해제할 수 있게 함께 보여 준다.
create function public.admin_list_erp_categories()
returns table (
  erp_category text,
  item_count bigint,
  category_id uuid,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  return query
    with counts as (
      select item.category as erp_category, pg_catalog.count(*)::bigint as item_count
      from public.erp_items as item
      where item.category is not null
      group by item.category
    )
    select
      coalesce(counts.erp_category, mapping.erp_category),
      coalesce(counts.item_count, 0::bigint),
      mapping.category_id,
      mapping.updated_at
    from counts
    full join public.erp_category_mappings as mapping on mapping.erp_category = counts.erp_category
    order by 1;
end;
$$;

-- ERP 분류 ↔ 고객 카테고리 연결. p_category_id가 null이면 연결을 해제한다.
-- 연결 대상은 상품에 연결할 수 있는 활성 말단만 허용한다. 실제로 바뀐 경우만 감사 기록을 남긴다.
create function public.admin_set_erp_category_mapping(p_erp_category text, p_category_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_erp_category text := private.erp_item_text(p_erp_category, true);
  v_before uuid;
  v_archived_at timestamptz;
  v_changed boolean := false;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if v_erp_category is null
     or pg_catalog.length(v_erp_category) > 200
     or v_erp_category ~ '[\u0001-\u001f\u007f-\u009f]' then
    raise invalid_parameter_value using message = 'invalid_erp_category';
  end if;

  -- 카테고리 보관·이동과 같은 트리 잠금을 잡아 말단 검사와 연결 저장 사이에 트리가 바뀌지 않게 한다.
  perform private.lock_catalog_category_tree();

  select mapping.category_id into v_before
  from public.erp_category_mappings as mapping
  where mapping.erp_category = v_erp_category
  for update;

  if p_category_id is null then
    if v_before is not null then
      delete from public.erp_category_mappings as mapping
      where mapping.erp_category = v_erp_category;
      v_changed := true;
    end if;
  else
    select category.archived_at into v_archived_at
    from public.catalog_categories as category
    where category.id = p_category_id
    for share;
    if not found then
      raise no_data_found using message = 'category_not_found';
    end if;
    if v_archived_at is not null then
      raise check_violation using message = 'category_archived';
    end if;
    if exists (
      select 1
      from public.catalog_categories as child
      where child.parent_id = p_category_id
        and child.archived_at is null
    ) then
      raise check_violation using message = 'category_not_leaf';
    end if;
    if v_before is distinct from p_category_id then
      insert into public.erp_category_mappings (erp_category, category_id, updated_by, updated_at)
      values (v_erp_category, p_category_id, v_actor, pg_catalog.now())
      on conflict (erp_category) do update
        set category_id = excluded.category_id,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at;
      v_changed := true;
    end if;
  end if;

  if v_changed then
    insert into public.audit_log (actor_id, action, target, diff)
    values (v_actor, 'admin.erp_items.category_mapping_updated', 'erp_category_mappings:' || v_erp_category,
      pg_catalog.jsonb_build_object('erp_category', v_erp_category, 'before', v_before, 'after', p_category_id));
  end if;

  return pg_catalog.jsonb_build_object(
    'erp_category', v_erp_category,
    'category_id', p_category_id,
    'changed', v_changed);
end;
$$;

revoke all on function private.erp_item_text(text, boolean),
  private.normalize_erp_item_row(jsonb),
  private.erp_category_target(text)
from public, anon, authenticated, service_role;

revoke all on function public.admin_import_erp_items(jsonb),
  public.admin_search_erp_items(text, integer),
  public.admin_list_erp_items(text, integer, integer),
  public.admin_list_erp_categories(),
  public.admin_set_erp_category_mapping(text, uuid)
from public, anon, authenticated, service_role;

grant execute on function public.admin_import_erp_items(jsonb),
  public.admin_search_erp_items(text, integer),
  public.admin_list_erp_items(text, integer, integer),
  public.admin_list_erp_categories(),
  public.admin_set_erp_category_mapping(text, uuid)
to authenticated;
