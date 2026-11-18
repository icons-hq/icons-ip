-- ADR-0044 정리 단계: 상품 유형 층에서 남겨 둔 카테고리 쪽 저장 칸을 지운다.
--
-- 20261118161500_goods_type_layer_retire.sql이 동작을 바꾸고 배포됐다(#677). 지금 운영 앱은 아래 칸·표·RPC를 읽거나 부르지
-- 않으므로(카테고리 저장은 target_good_type에 null을 보낸다) 한 번에 지워도 배포 사이 이전 앱이 깨지지 않는다.
--   1. catalog_categories.good_type(+ 값 목록 CHECK)을 지운다. 카테고리 저장 RPC는 그 칸을 쓰지 않는다.
--      target_good_type 인자는 기본값 null이라 이전 화면이 보내도 맞으므로 받기만 하고 무시한다(시그니처 유지).
--   2. 쓰지 않는 기존 유형 이관 메모(goods_type_category_migrations, 0행)와 그 저장 RPC를 지운다.
--   3. 상품 목록 판매 준비 필터가 이전 앱 호환으로 받아 두던 옛 유형 사유 3종을 더 받지 않는다.
-- goods.type·order_items.good_type_snapshot과 KC 맥락의 type은 이 migration에서 건드리지 않는다.

-- --------------------------------------------------------------------------
-- 1. 카테고리 저장 RPC에서 유형 연결을 걷어낸 뒤 칸을 지운다.
-- --------------------------------------------------------------------------
create or replace function public.admin_upsert_category(target_operation_id uuid, target_category_id uuid, target_code text, target_name text, target_parent_id uuid, target_sort_order integer, target_expected_updated_at timestamp with time zone, target_good_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  category_row public.catalog_categories;
  next_depth integer;
  result_id uuid;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
  request_payload jsonb;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor_id is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or target_code is null or target_code !~ '^[a-z0-9][a-z0-9-]*$' or length(target_code) > 80
     or target_name is null or btrim(target_name) = '' or length(target_name) > 120
     or target_sort_order is null or target_sort_order < 0 then
    raise invalid_parameter_value using message = 'invalid_category';
  end if;
  -- ADR-0044: 상품 유형 연결은 없다. target_good_type은 배포 사이 이전 화면 호환으로만 받고 무시한다.
  request_payload := jsonb_build_object(
    'category_id', target_category_id,
    'code', target_code,
    'name', btrim(target_name),
    'parent_id', target_parent_id,
    'sort_order', target_sort_order,
    'expected_updated_at', target_expected_updated_at
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_operation_id;
  if found then
    if existing_actor_id = actor_id
       and existing_action in ('admin.catalog.category.created', 'admin.catalog.category.updated')
       -- 이 migration 전에 저장된 작업은 요청에 'good_type' 키가 있다. 같은 작업 ID 재시도가 충돌로 바뀌지 않게 그 키를 빼고 비교한다.
       and (existing_diff -> 'request') - 'good_type' = request_payload
    then
      result_id := coalesce(target_category_id, nullif(existing_diff ->> 'category_id', '')::uuid);
      next_depth := nullif(existing_diff #>> '{after,depth}', '')::integer;
      if result_id is not null and next_depth is not null then
        return jsonb_build_object('id', result_id, 'depth', next_depth);
      end if;
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  perform private.lock_catalog_category_tree();

  if target_category_id is null then
    if exists (select 1 from public.catalog_categories where code = target_code) then raise unique_violation using message = 'category_code_taken'; end if;
    result_id := extensions.gen_random_uuid();
    next_depth := private.category_validate_parent(result_id, target_parent_id);
    insert into public.catalog_categories (id, code, name, parent_id, depth, sort_order)
    values (result_id, target_code, btrim(target_name), target_parent_id, next_depth, target_sort_order);
    insert into public.audit_log(id, actor_id, action, target, diff)
    values (target_operation_id, actor_id, 'admin.catalog.category.created', 'catalog_categories:' || result_id::text,
      jsonb_build_object('category_id', result_id, 'request', request_payload,
        'after', jsonb_build_object('code', target_code, 'name', btrim(target_name), 'parent_id', target_parent_id, 'depth', next_depth)));
  else
    select * into category_row from public.catalog_categories where id = target_category_id for update;
    if not found then raise no_data_found using message = 'category_not_found'; end if;
    if target_expected_updated_at is null or category_row.updated_at is distinct from target_expected_updated_at then raise exception using errcode = 'PT409', message = 'category_changed'; end if;
    if exists (select 1 from public.catalog_categories where code = target_code and id <> target_category_id) then raise unique_violation using message = 'category_code_taken'; end if;
    next_depth := private.category_validate_parent(target_category_id, target_parent_id);
    update public.catalog_categories
    set code = target_code, name = btrim(target_name), parent_id = target_parent_id, depth = next_depth,
        sort_order = target_sort_order, updated_at = pg_catalog.now()
    where id = target_category_id;
    with recursive descendants as (
      select category.id, 1 as relative_depth
      from public.catalog_categories as category
      where category.parent_id = target_category_id
      union all
      select child.id, descendants.relative_depth + 1
      from descendants
      join public.catalog_categories as child on child.parent_id = descendants.id
    )
    update public.catalog_categories as child
    set depth = next_depth + descendants.relative_depth, updated_at = pg_catalog.now()
    from descendants
    where child.id = descendants.id;
    result_id := target_category_id;
    insert into public.audit_log(id, actor_id, action, target, diff)
    values (target_operation_id, actor_id, 'admin.catalog.category.updated', 'catalog_categories:' || target_category_id::text,
      jsonb_build_object('category_id', target_category_id, 'request', request_payload,
        'after', jsonb_build_object('code', target_code, 'name', btrim(target_name), 'parent_id', target_parent_id, 'depth', next_depth)));
  end if;
  return jsonb_build_object('id', result_id, 'depth', next_depth);
end;
$function$
;
-- create or replace라 소유자·권한이 그대로다. 봉인을 다시 확인하고 본문 지문을 다시 적는다(분류는 기존 행 그대로).
revoke all on function public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamp with time zone,text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamp with time zone,text) to authenticated;
select private.register_operator_rpc_contract(
  'public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamp with time zone,text)'::regprocedure,
  'catalog.manage', 'write', false);

alter table public.catalog_categories drop column good_type;

-- --------------------------------------------------------------------------
-- 2. 기존 유형 이관 메모: 표·RPC·운영자 계약 행을 함께 지운다.
-- --------------------------------------------------------------------------
drop function public.admin_set_category_type_migration(uuid, text, uuid, text, text);
delete from private.operator_rpc_contracts
  where signature = 'public.admin_set_category_type_migration(uuid,text,uuid,text,text)';
delete from private.operator_internal_contracts
  where signature = 'public.admin_set_category_type_migration(uuid,text,uuid,text,text)';
delete from private.operator_policy_contracts
  where schema_name = 'public' and table_name = 'goods_type_category_migrations';
drop table public.goods_type_category_migrations;

-- --------------------------------------------------------------------------
-- 3. 판매 준비 필터의 옛 유형 사유 3종을 지운다.
-- --------------------------------------------------------------------------
do $$
declare
  v_definition text := pg_catalog.pg_get_functiondef('private.admin_goods_workspace_matches(text,text,text,text,uuid,text)'::regprocedure);
  v_anchor text := $a$'category_missing','type_missing','type_category_mismatch','type_no_category','image_missing'$a$;
begin
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))) / pg_catalog.length(v_anchor) <> 1 then
    raise exception 'goods_type_cleanup_anchor_changed: admin_goods_workspace_matches';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor, $p$'category_missing','image_missing'$p$);
end $$;
revoke all on function private.admin_goods_workspace_matches(text,text,text,text,uuid,text) from public, anon, authenticated, service_role;

-- 남은 참조가 있으면 여기서 멈춘다(plpgsql은 의존을 추적하지 않는다).
do $$
declare
  callers text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into callers
  from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and (p.prosrc ~ 'goods_type_category_migrations' or p.prosrc ~ '''type_(missing|category_mismatch|no_category)'''
      or (p.prosrc ~ '\mgood_type\M' and p.oid <> 'public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamp with time zone,text)'::regprocedure));
  if callers is not null then
    raise exception 'goods_type_cleanup_remaining_callers: %', callers;
  end if;
end $$;
