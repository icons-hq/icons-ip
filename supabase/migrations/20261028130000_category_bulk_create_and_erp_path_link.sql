-- R9 (10/27 회의 06:16~09:32, MD-0028): 카테고리 일괄 등록과 ERP 분류 전체 경로 자동 연결.
--
-- · 일괄 등록: 붙여넣은 `대>중>소` 경로(한 줄 하나, 1~4단계)를 한 번에 만든다. 같은 부모 아래 같은 이름
--   (NFKC·소문자·공백 무시)은 새로 만들지 않고 건너뛴다. 경로마다 하위 트랜잭션으로 처리해 한 줄이
--   실패해도(깊이 초과·상품 연결된 부모 등) 나머지 줄은 들어간다. 코드(ASCII slug 필수)는 경로로 자동 생성한다.
-- · ERP 자동 연결: ERP 품목 화면에서 따로 연결하지 않은 ERP 분류는 고객 카테고리 화면의 정본 ERP 매핑을 먼저 보고,
--   없으면 ERP 분류 원문을 `>`로 나눈 **전체 경로**가 같은 활성 말단 하나에 연결한다(말단 이름 단독 매칭은 하지 않는다).
--   반입 때 행을 쓰지 않고 조회 시점에 판정하므로 카테고리를 나중에 만들어도 연결되고, ERP 품목 화면에서 다른
--   말단을 골라 저장하면 그 연결이 먼저다. 분류 이름의 `/`는 구분자가 아니다('메모/수첩').
begin;

-- 이름 비교 키. 일괄 등록의 중복 판정과 ERP 경로 매칭이 같은 키를 써야 등록한 트리에 그대로 연결된다.
create function private.catalog_category_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(pg_catalog.lower(pg_catalog.regexp_replace(
    pg_catalog.normalize(coalesce(p_name, ''), 'NFKC'),
    '[\s   -​    　﻿]+', '', 'g')), '')
$$;

-- `대>중>소` 원문 → 이름 배열. 각 이름은 ERP 원문과 같은 규칙(private.erp_item_text)으로 다듬는다.
-- 빈 이름이 하나라도 있으면 null(잘못된 경로). erp_item_text가 남기는 제로폭 공백(U+200B)만으로 된 이름도
-- 비교 키(catalog_category_name_key)가 비므로 빈 이름이다 — 남기면 '같은 부모·같은 이름' 판정이 늘 거짓이라
-- 보이지 않는 카테고리가 붙여넣을 때마다 쌓인다.
create function private.catalog_category_path_segments(p_path text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  part text;
  result text[] := array[]::text[];
begin
  if p_path is null then return null; end if;
  foreach part in array pg_catalog.string_to_array(p_path, '>') loop
    part := private.erp_item_text(part, true);
    if part is null or private.catalog_category_name_key(part) is null then return null; end if;
    result := pg_catalog.array_append(result, part);
  end loop;
  return case when pg_catalog.cardinality(result) > 0 then result end;
end;
$$;

-- 전체 경로가 같은 활성 말단 하나. 단계마다 같은 키의 활성 카테고리가 정확히 하나여야 하고, 끝이 말단이어야 한다.
create function private.catalog_category_path_target(p_path text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  segments text[] := private.catalog_category_path_segments(p_path);
  segment text;
  current_id uuid;
  matched uuid[];
begin
  if segments is null or pg_catalog.cardinality(segments) > 4 then return null; end if;
  foreach segment in array segments loop
    select pg_catalog.array_agg(category.id) into matched
    from public.catalog_categories as category
    where category.archived_at is null
      and case when current_id is null then category.parent_id is null else category.parent_id = current_id end
      and private.catalog_category_name_key(category.name) = private.catalog_category_name_key(segment);
    if coalesce(pg_catalog.cardinality(matched), 0) <> 1 then return null; end if;
    current_id := matched[1];
  end loop;
  if exists (
    select 1 from public.catalog_categories as child
    where child.parent_id = current_id and child.archived_at is null
  ) then return null; end if;
  return current_id;
end;
$$;

-- 정본 ERP 매핑(이름·코드 정확히 일치, 하나뿐) → 없으면 전체 경로 일치.
-- private.erp_category_target(ERP 품목 화면의 명시 연결 → 이 함수)과 admin_list_erp_categories의
-- fallback_category_id가 이 함수를 쓰므로, 옵션의 카테고리 제안과 연결 표가 함께 바뀐다.
create or replace function private.erp_category_legacy_target(p_erp_category text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select case when pg_catalog.count(*) = 1 then (pg_catalog.array_agg(legacy.category_id))[1] end
    from public.catalog_category_erp_mappings as legacy
    join public.catalog_categories as category on category.id = legacy.category_id
    where p_erp_category is not null
      and (private.erp_item_text(legacy.erp_name, true) = p_erp_category
        or private.erp_item_text(legacy.erp_code, true) = p_erp_category)
      and category.archived_at is null
      and not exists (
        select 1
        from public.catalog_categories as child
        where child.parent_id = category.id
          and child.archived_at is null
      )
  ), private.catalog_category_path_target(p_erp_category))
$$;

create function public.admin_bulk_create_categories(p_operation_id uuid, p_paths jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  request jsonb;
  receipt jsonb;
  entry record;
  segments text[];
  segment text;
  path_keys text[];
  parent uuid;
  matched uuid[];
  new_id uuid;
  base_code text;
  new_code text;
  suffix integer;
  line_ids uuid[];
  created_ids uuid[] := array[]::uuid[];
  lines jsonb[] := array[]::jsonb[];
  reason text;
  created_lines integer := 0;
  skipped_lines integer := 0;
  failed_lines integer := 0;
begin
  perform private.require_operator_capability('catalog.manage', false);
  if actor is null or not public.has_operator_capability('catalog.manage', false) then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if p_operation_id is null or p_paths is null or pg_catalog.jsonb_typeof(p_paths) <> 'array'
     or pg_catalog.jsonb_array_length(p_paths) not between 1 and 1000
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(p_paths) as item(value)
       where pg_catalog.jsonb_typeof(item.value) <> 'string' or pg_catalog.char_length(item.value #>> '{}') > 1000
     ) then
    raise invalid_parameter_value using message = 'invalid_category_paths';
  end if;

  request := pg_catalog.jsonb_build_object('paths', p_paths);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || p_operation_id::text, 0));
  receipt := private.operator_lifecycle_replay(actor, p_operation_id, 'admin.catalog.category.bulk_created', request);
  if receipt is not null then return receipt; end if;
  perform private.lock_catalog_category_tree();

  for entry in
    select item.value #>> '{}' as raw, item.ordinality::integer as line
    from pg_catalog.jsonb_array_elements(p_paths) with ordinality as item(value, ordinality)
    order by item.ordinality
  loop
    segments := private.catalog_category_path_segments(entry.raw);
    reason := null;
    line_ids := array[]::uuid[];
    if segments is null then
      reason := 'invalid_category_path';
    elsif pg_catalog.cardinality(segments) > 4 then
      reason := 'category_depth_exceeded';
    elsif exists (select 1 from pg_catalog.unnest(segments) as name where pg_catalog.char_length(name) > 120) then
      reason := 'invalid_category_name';
    end if;

    if reason is null then
      begin
        parent := null;
        path_keys := array[]::text[];
        foreach segment in array segments loop
          path_keys := pg_catalog.array_append(path_keys, private.catalog_category_name_key(segment));
          select pg_catalog.array_agg(category.id) into matched
          from public.catalog_categories as category
          where category.archived_at is null
            and case when parent is null then category.parent_id is null else category.parent_id = parent end
            and private.catalog_category_name_key(category.name) = private.catalog_category_name_key(segment);
          if pg_catalog.cardinality(matched) > 1 then
            raise check_violation using message = 'category_path_ambiguous';
          end if;
          if matched is not null then
            parent := matched[1];
            continue;
          end if;
          new_id := extensions.gen_random_uuid();
          base_code := 'c-' || pg_catalog.left(pg_catalog.md5(pg_catalog.array_to_string(path_keys, '>')), 10);
          new_code := base_code;
          suffix := 1;
          while exists (select 1 from public.catalog_categories as category where category.code = new_code) loop
            suffix := suffix + 1;
            new_code := base_code || '-' || suffix::text;
          end loop;
          insert into public.catalog_categories (id, code, name, parent_id, depth, sort_order)
          values (
            new_id, new_code, segment, parent, pg_catalog.cardinality(path_keys),
            coalesce((
              select pg_catalog.max(sibling.sort_order) + 1 from public.catalog_categories as sibling
              where case when parent is null then sibling.parent_id is null else sibling.parent_id = parent end
            ), 0)
          );
          line_ids := pg_catalog.array_append(line_ids, new_id);
          parent := new_id;
        end loop;
      exception when check_violation or foreign_key_violation or unique_violation or invalid_parameter_value then
        get stacked diagnostics reason = message_text;
        line_ids := array[]::uuid[];
      end;
    end if;

    if reason is not null then
      failed_lines := failed_lines + 1;
      lines := pg_catalog.array_append(lines, pg_catalog.jsonb_build_object(
        'line', entry.line, 'path', pg_catalog.left(entry.raw, 300), 'status', 'failed', 'created', 0, 'reason', reason));
    elsif pg_catalog.cardinality(line_ids) > 0 then
      created_lines := created_lines + 1;
      created_ids := created_ids || line_ids;
      lines := pg_catalog.array_append(lines, pg_catalog.jsonb_build_object(
        'line', entry.line, 'path', pg_catalog.array_to_string(segments, '>'), 'status', 'created',
        'created', pg_catalog.cardinality(line_ids), 'reason', null));
    else
      skipped_lines := skipped_lines + 1;
      lines := pg_catalog.array_append(lines, pg_catalog.jsonb_build_object(
        'line', entry.line, 'path', pg_catalog.array_to_string(segments, '>'), 'status', 'skipped', 'created', 0, 'reason', null));
    end if;
  end loop;

  receipt := pg_catalog.jsonb_build_object(
    'createdCategories', pg_catalog.cardinality(created_ids),
    'createdLines', created_lines,
    'skippedLines', skipped_lines,
    'failedLines', failed_lines,
    'lines', pg_catalog.to_jsonb(lines));
  insert into public.audit_log (id, actor_id, action, target, diff)
  values (p_operation_id, actor, 'admin.catalog.category.bulk_created', 'catalog_categories',
    pg_catalog.jsonb_build_object('request', request, 'result', receipt, 'created_ids', pg_catalog.to_jsonb(created_ids)));
  return receipt;
end;
$$;

revoke all on function private.catalog_category_name_key(text) from public, anon, authenticated, service_role;
revoke all on function private.catalog_category_path_segments(text) from public, anon, authenticated, service_role;
revoke all on function private.catalog_category_path_target(text) from public, anon, authenticated, service_role;
revoke all on function private.erp_category_legacy_target(text) from public, anon, authenticated, service_role;
revoke all on function public.admin_bulk_create_categories(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_bulk_create_categories(uuid, jsonb) to authenticated;

select private.register_operator_rpc_contract('public.admin_bulk_create_categories(uuid,jsonb)'::regprocedure, 'catalog.manage', 'write', false);

notify pgrst, 'reload schema';
commit;
