-- 카테고리 관리: 근거 칸 없이 저장하고(2026-11-25 결정 D3), 같은 상위 아래의 순서를 한 번에 바꾼다.
--
-- 1. 근거 칸을 없앤다.
--    '고객 화면·ERP 사용 설정'은 켜는 쪽마다 출처·참조·검증 시각 세 칸을, 'ERP 분류 매핑' 표는 줄마다 출처·검증 시각 두 칸을
--    채워야 저장됐다. 화면에서 그 칸을 걷어 내므로 두 함수의 필수 검사만 없앤다. 누가 언제 바꿨는지는 감사 기록(audit_log)이 그대로 남긴다.
--    - 인자 시그니처는 그대로다. 근거 값을 보내는 옛 호출도 전과 같이 저장된다.
--    - 이미 저장된 근거 값은 지우지 않는다. 근거를 보내지 않은 저장은 저장돼 있던 값을 그대로 둔다.
--    - 근거와 관계없는 조건은 그대로다: 고객 화면은 보관하지 않은 카테고리가 하나 이상 있어야 켜지고,
--      ERP 분류는 마지막 단계 카테고리마다 ERP 코드가 있어야 켜진다(category_activation_unready).
--    - catalog_category_erp_mappings의 source·verified_at은 근거 없이 새로 저장한 줄에서 비어 있을 수 있게 not null만 푼다.
--      (source의 빈 글자 금지 check는 null을 통과시키므로 그대로 둔다. verified_by는 마지막으로 근거를 적은 사람이고, 근거 없는 새 줄은 저장한 사람이다.)
--
-- 2. 순서 바꾸기(admin_reorder_categories).
--    순서를 숫자 칸('노출 순서')에 적게 하지 않고 카테고리 목록에서 [위로]·[아래로]로 옮긴다. 같은 상위 아래의 카테고리 전체를
--    새 순서대로 받아 0부터 다시 매긴다 — 두 줄만 맞바꾸면 순서 값이 같은 줄(직접 만든 카테고리는 모두 0)에서 아무 일도 일어나지 않는다.
--    보낸 목록이 지금 그 상위 아래의 카테고리 전체와 다르면(그사이 누가 더하거나 옮겼으면) category_changed로 거절한다.
--    권한·감사·같은 작업 번호 재시도 처리는 admin_upsert_category와 같다(catalog.manage, audit_log, operation_conflict).

alter table public.catalog_category_erp_mappings
  alter column source drop not null,
  alter column verified_at drop not null;

create or replace function public.admin_set_category_activation(
  target_operation_id uuid,
  target_customer_enabled boolean,
  target_erp_enabled boolean,
  target_evidence jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  customer jsonb := coalesce(target_evidence->'customer', '{}'::jsonb);
  erp jsonb := coalesce(target_evidence->'erp', '{}'::jsonb);
  stored_evidence jsonb;
  existing_actor_id uuid;
  existing_action text;
  existing_diff jsonb;
  request_payload jsonb;
begin
  perform private.require_operator_capability('platform.manage',false);

  if v_actor_id is null or not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or target_customer_enabled is null or target_erp_enabled is null then raise invalid_parameter_value using message = 'invalid_category_activation'; end if;
  request_payload := jsonb_build_object(
    'customer_enabled', target_customer_enabled,
    'erp_enabled', target_erp_enabled,
    'evidence', coalesce(target_evidence, '{}'::jsonb)
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.diff into existing_actor_id, existing_action, existing_diff
  from public.audit_log as audit where audit.id = target_operation_id;
  if found then
    if existing_actor_id = v_actor_id and existing_action = 'admin.catalog.category.activation_updated' and existing_diff -> 'request' = request_payload then
      return true;
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  if target_customer_enabled and not exists(select 1 from public.catalog_categories where archived_at is null)
  then raise check_violation using message = 'category_activation_unready'; end if;
  if target_erp_enabled and (
    not exists(
      select 1 from public.catalog_categories as category
      where category.archived_at is null
        and not exists (select 1 from public.catalog_categories as child where child.parent_id = category.id and child.archived_at is null)
    ) or exists(
      select 1
      from public.catalog_categories as category
      left join public.catalog_category_erp_mappings as mapping on mapping.category_id = category.id
      where category.archived_at is null
        and not exists (select 1 from public.catalog_categories as child where child.parent_id = category.id and child.archived_at is null)
        and mapping.category_id is null
    )
  ) then raise check_violation using message = 'category_activation_unready'; end if;
  -- 근거는 보낸 쪽만 바꾼다. 세 칸이 모두 빈 쪽은 저장돼 있던 값을 그대로 둔다.
  select control.evidence into stored_evidence from public.category_activation_control as control where control.id = 'catalog' for update;
  stored_evidence := coalesce(stored_evidence, '{}'::jsonb);
  if btrim(coalesce(customer->>'source', '')) <> '' or btrim(coalesce(customer->>'reference', '')) <> '' or btrim(coalesce(customer->>'verifiedAt', '')) <> '' then
    stored_evidence := stored_evidence || jsonb_build_object('customer', customer);
  end if;
  if btrim(coalesce(erp->>'source', '')) <> '' or btrim(coalesce(erp->>'reference', '')) <> '' or btrim(coalesce(erp->>'verifiedAt', '')) <> '' then
    stored_evidence := stored_evidence || jsonb_build_object('erp', erp);
  end if;
  update public.category_activation_control
  set customer_enabled = target_customer_enabled, erp_enabled = target_erp_enabled, evidence = stored_evidence,
      actor_id = v_actor_id, updated_at = pg_catalog.now()
  where id = 'catalog';
  insert into public.audit_log(id, actor_id, action, target, diff)
  values (target_operation_id, v_actor_id, 'admin.catalog.category.activation_updated', 'category_activation_control:catalog',
    jsonb_build_object('request', request_payload));
  return true;
end;
$$;

create or replace function public.admin_set_category_erp_mapping(
  target_operation_id uuid,
  target_category_id uuid,
  target_erp_code text,
  target_erp_name text,
  target_source text,
  target_verified_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  next_source text := nullif(btrim(coalesce(target_source, '')), '');
  existing_actor_id uuid;
  existing_action text;
  existing_diff jsonb;
  request_payload jsonb;
begin
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null or not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or target_category_id is null or btrim(coalesce(target_erp_code, '')) = ''
     or btrim(coalesce(target_erp_name, '')) = '' then
    raise invalid_parameter_value using message = 'invalid_category_erp_mapping';
  end if;
  request_payload := jsonb_build_object(
    'category_id', target_category_id,
    'erp_code', btrim(target_erp_code),
    'erp_name', btrim(target_erp_name),
    'source', next_source,
    'verified_at', target_verified_at
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.diff into existing_actor_id, existing_action, existing_diff
  from public.audit_log as audit where audit.id = target_operation_id;
  if found then
    if existing_actor_id = actor_id and existing_action = 'admin.catalog.category.erp_mapping_updated' and existing_diff -> 'request' = request_payload then
      return true;
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  perform private.lock_catalog_category_tree();
  if not exists (select 1 from public.catalog_categories where id = target_category_id and archived_at is null) then raise no_data_found using message = 'category_not_found'; end if;
  if exists (select 1 from public.catalog_category_erp_mappings where erp_code = btrim(target_erp_code) and category_id <> target_category_id) then raise unique_violation using message = 'category_erp_code_taken'; end if;
  -- 근거(출처·검증 시각)는 보낸 값만 바꾼다. 보내지 않으면 저장돼 있던 출처·검증 시각·검증한 사람을 그대로 둔다.
  insert into public.catalog_category_erp_mappings as mapping(category_id, erp_code, erp_name, source, verified_at, verified_by)
  values (target_category_id, btrim(target_erp_code), btrim(target_erp_name), next_source, target_verified_at, actor_id)
  on conflict(category_id) do update set erp_code = excluded.erp_code, erp_name = excluded.erp_name,
    source = coalesce(excluded.source, mapping.source),
    verified_at = coalesce(excluded.verified_at, mapping.verified_at),
    verified_by = case when excluded.source is not null or excluded.verified_at is not null then excluded.verified_by else mapping.verified_by end,
    updated_at = pg_catalog.now();
  insert into public.audit_log(id, actor_id, action, target, diff)
  values (target_operation_id, actor_id, 'admin.catalog.category.erp_mapping_updated', 'catalog_categories:' || target_category_id::text,
    jsonb_build_object('request', request_payload));
  return true;
end;
$$;

create function public.admin_reorder_categories(
  target_operation_id uuid,
  target_parent_id uuid,
  target_ordered_ids uuid[]
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  existing_actor_id uuid;
  existing_action text;
  existing_diff jsonb;
  request_payload jsonb;
  changed_count integer;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor_id is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or target_ordered_ids is null
     or pg_catalog.cardinality(target_ordered_ids) not between 1 and 2000
     or pg_catalog.array_position(target_ordered_ids, null) is not null
     or (select pg_catalog.count(distinct item.id) from pg_catalog.unnest(target_ordered_ids) as item(id)) <> pg_catalog.cardinality(target_ordered_ids) then
    raise invalid_parameter_value using message = 'invalid_category_order';
  end if;
  request_payload := jsonb_build_object('parent_id', target_parent_id, 'ordered_ids', pg_catalog.to_jsonb(target_ordered_ids));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.diff into existing_actor_id, existing_action, existing_diff
  from public.audit_log as audit where audit.id = target_operation_id;
  if found then
    if existing_actor_id = actor_id and existing_action = 'admin.catalog.category.reordered' and existing_diff -> 'request' = request_payload then
      return coalesce((existing_diff ->> 'changed')::integer, 0) > 0;
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  perform private.lock_catalog_category_tree();
  -- 보낸 목록은 지금 그 상위 아래의 카테고리 전체(보관한 것 포함)와 같아야 한다.
  if (select pg_catalog.count(*) from public.catalog_categories as category
      where category.parent_id is not distinct from target_parent_id) <> pg_catalog.cardinality(target_ordered_ids)
     or exists (select 1 from public.catalog_categories as category
      where category.parent_id is not distinct from target_parent_id and category.id <> all(target_ordered_ids)) then
    raise exception using errcode = 'PT409', message = 'category_changed';
  end if;
  with ordered as (
    select item.id, (item.position - 1)::integer as next_order
    from pg_catalog.unnest(target_ordered_ids) with ordinality as item(id, position)
  )
  update public.catalog_categories as category
  set sort_order = ordered.next_order, updated_at = pg_catalog.now()
  from ordered
  where category.id = ordered.id and category.sort_order is distinct from ordered.next_order;
  get diagnostics changed_count = row_count;
  insert into public.audit_log(id, actor_id, action, target, diff)
  values (target_operation_id, actor_id, 'admin.catalog.category.reordered',
    'catalog_categories:' || coalesce(target_parent_id::text, 'root'),
    jsonb_build_object('request', request_payload, 'changed', changed_count));
  return changed_count > 0;
end;
$$;

-- Supabase default privileges가 새 public 함수에 anon·authenticated·service_role 실행 권한을 붙인다. 모두 거둔 뒤 필요한 롤에만 준다.
revoke all on function public.admin_reorder_categories(uuid, uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_reorder_categories(uuid, uuid, uuid[]) to authenticated;

-- 다시 정의한 두 함수의 본문 지문과 새 함수를 운영자 계약에 (재)등록한다.
select private.register_operator_rpc_contract(
  'public.admin_set_category_activation(uuid,boolean,boolean,jsonb)'::regprocedure, 'platform.manage', 'write', false
);
select private.register_operator_rpc_contract(
  'public.admin_set_category_erp_mapping(uuid,uuid,text,text,text,timestamptz)'::regprocedure, 'platform.manage', 'write', false
);
select private.register_operator_rpc_contract(
  'public.admin_reorder_categories(uuid,uuid,uuid[])'::regprocedure, 'catalog.manage', 'write', false
);
