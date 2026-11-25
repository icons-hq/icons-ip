\set ON_ERROR_STOP on
-- 카테고리 관리: 근거 칸 없이 저장(admin_set_category_activation·admin_set_category_erp_mapping)과 순서 바꾸기(admin_reorder_categories).
-- 근거를 보내지 않아도 저장되고, 저장돼 있던 근거는 지워지지 않으며, 근거와 관계없는 조건·권한·감사·재시도는 그대로인지 본다.
-- 준비물은 모두 rollback된다. 다른 카테고리가 있는 DB에서도 같은 결과가 나오게 이 시험이 만든 카테고리만 단언한다.
begin;

create function pg_temp.expect_error(statement text, expected_message text, expected_code text default null)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate='42501' and sqlerrm='operator_capability_required' and expected_message='forbidden' then return; end if;
    if position(expected_message in sqlerrm) = 0
       or (expected_code is not null and sqlstate <> expected_code) then
      raise;
    end if;
    return;
  end;
  raise exception 'Expected rejection: %', expected_message;
end $$;

insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('0a400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'category-evidence-staff@example.test', now(), '{}', '{}', now(), now()),
  ('0a400000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'category-evidence-buyer@example.test', now(), '{}', '{}', now(), now()),
  ('0a400000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'category-evidence-deputy@example.test', now(), '{}', '{}', now(), now());
-- 0001은 계정 주매니저(platform.manage·catalog.manage), 0003은 계정 부매니저(catalog.manage만), 0002는 운영자가 아닌 회원이다.
update public.profiles set role = 'staff' where id in ('0a400000-0000-4000-8000-000000000001', '0a400000-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id, manager_role) values
  ('0a400000-0000-4000-8000-000000000001', 'primary'),
  ('0a400000-0000-4000-8000-000000000003', 'deputy');
update private.operator_access_state set configured = true where id;

-- 1. 실행 권한과 운영자 계약: 다시 정의한 두 함수의 권한은 그대로이고, 새 함수는 authenticated만 실행한다. 지문은 지금 본문과 같다.
select 1 / case when (
  select bool_and(has_function_privilege('authenticated', signature, 'execute')
    and not has_function_privilege('anon', signature, 'execute')
    and not has_function_privilege('service_role', signature, 'execute'))
  from unnest(array[
    'public.admin_set_category_activation(uuid,boolean,boolean,jsonb)',
    'public.admin_set_category_erp_mapping(uuid,uuid,text,text,text,timestamptz)',
    'public.admin_reorder_categories(uuid,uuid,uuid[])'
  ]) as signature
) then 1 else 0 end as assert_execute_is_sealed_to_authenticated;
select 1 / case when (
  select count(*) from private.operator_rpc_contracts contract
  join pg_proc p on p.oid = to_regprocedure(contract.signature)
  where contract.guard_kind = 'write' and not contract.legacy_admin_only and contract.body_md5 = md5(p.prosrc)
    and exists(select 1 from private.operator_internal_contracts internal where internal.signature = contract.signature)
    and (contract.signature, contract.capability) in (
      ('public.admin_set_category_activation(uuid,boolean,boolean,jsonb)', 'platform.manage'),
      ('public.admin_set_category_erp_mapping(uuid,uuid,text,text,text,timestamp with time zone)', 'platform.manage'),
      ('public.admin_reorder_categories(uuid,uuid,uuid[])', 'catalog.manage'))
) = 3 then 1 else 0 end as assert_operator_contracts_registered;

set local role authenticated;
select set_config('request.jwt.claim.sub', '0a400000-0000-4000-8000-000000000001', true);

select (public.admin_upsert_category('0a400000-0000-4000-8000-000000000101', null, 'category-evidence-root', '근거 검증 상위', null, 0, null)::jsonb ->> 'id') as root_id \gset
select (public.admin_upsert_category('0a400000-0000-4000-8000-000000000102', null, 'category-evidence-a', '근거 검증 가', :'root_id'::uuid, 0, null)::jsonb ->> 'id') as a_id \gset
select (public.admin_upsert_category('0a400000-0000-4000-8000-000000000103', null, 'category-evidence-b', '근거 검증 나', :'root_id'::uuid, 0, null)::jsonb ->> 'id') as b_id \gset
select (public.admin_upsert_category('0a400000-0000-4000-8000-000000000104', null, 'category-evidence-c', '근거 검증 다', :'root_id'::uuid, 0, null)::jsonb ->> 'id') as c_id \gset

-- 2. 고객 화면 사용 설정은 근거 없이 켜고 끈다. 근거 인자는 빈 객체여도, null이어도 된다.
select public.admin_set_category_activation('0a400000-0000-4000-8000-000000000201', true, false, '{}'::jsonb);
select 1 / case when (select customer_enabled and not erp_enabled from public.category_activation_control where id = 'catalog')
  and (select count(*) from public.audit_log where id = '0a400000-0000-4000-8000-000000000201' and action = 'admin.catalog.category.activation_updated') = 1
then 1 else 0 end as assert_customer_gate_opens_without_evidence;
select public.admin_set_category_activation('0a400000-0000-4000-8000-000000000202', false, false, null);
select 1 / case when (select not customer_enabled from public.category_activation_control where id = 'catalog')
then 1 else 0 end as assert_null_evidence_is_accepted;
-- 같은 작업 번호·같은 내용은 한 번만 처리하고, 다른 내용은 거절한다.
select public.admin_set_category_activation('0a400000-0000-4000-8000-000000000202', false, false, null);
select pg_temp.expect_error($sql$select public.admin_set_category_activation('0a400000-0000-4000-8000-000000000202', true, false, null)$sql$, 'operation_conflict', '23505');
select pg_temp.expect_error($sql$select public.admin_set_category_activation(null, true, false, null)$sql$, 'invalid_category_activation', '22023');

-- 3. 저장돼 있던 근거는 지워지지 않는다. 근거를 보낸 쪽만 바뀐다(세 칸이 모두 빈 쪽은 그대로).
select public.admin_set_category_activation('0a400000-0000-4000-8000-000000000203', true, false,
  '{"customer":{"source":"고객 분류표","reference":"CAT-EV","verifiedAt":"2026-09-10T00:00:00Z"},"erp":{}}'::jsonb);
select public.admin_set_category_activation('0a400000-0000-4000-8000-000000000204', false, false,
  '{"customer":{"source":"","reference":"","verifiedAt":""},"erp":{"source":"","reference":"","verifiedAt":""}}'::jsonb);
select public.admin_set_category_activation('0a400000-0000-4000-8000-000000000205', true, false, '{}'::jsonb);
select 1 / case when (select evidence #>> '{customer,source}' = '고객 분류표' and evidence #>> '{customer,reference}' = 'CAT-EV'
    and evidence #>> '{customer,verifiedAt}' = '2026-09-10T00:00:00Z' and customer_enabled
  from public.category_activation_control where id = 'catalog')
then 1 else 0 end as assert_stored_activation_evidence_is_kept;
select public.admin_set_category_activation('0a400000-0000-4000-8000-000000000206', true, false,
  '{"erp":{"source":"ERP 분류표","reference":"ERP-EV","verifiedAt":"2026-09-11T00:00:00Z"}}'::jsonb);
select 1 / case when (select evidence #>> '{customer,source}' = '고객 분류표' and evidence #>> '{erp,source}' = 'ERP 분류표'
  from public.category_activation_control where id = 'catalog')
then 1 else 0 end as assert_sent_side_only_replaces_evidence;

-- 4. ERP 분류는 근거가 아니라 ERP 코드가 조건이다. 마지막 단계 카테고리에 ERP 코드가 없으면 켜지지 않는다.
select pg_temp.expect_error($sql$select public.admin_set_category_activation('0a400000-0000-4000-8000-000000000207', true, true, '{}'::jsonb)$sql$,
  'category_activation_unready', '23514');

-- 5. ERP 코드·품명은 출처·검증 시각 없이 저장된다. 빈 출처는 없는 값으로 둔다.
select public.admin_set_category_erp_mapping('0a400000-0000-4000-8000-000000000301', :'a_id'::uuid, ' EV-ERP-A ', ' 근거 없는 품명 ', null, null);
select public.admin_set_category_erp_mapping('0a400000-0000-4000-8000-000000000302', :'b_id'::uuid, 'EV-ERP-B', '빈 출처 품명', '  ', null);
select 1 / case when (select erp_code = 'EV-ERP-A' and erp_name = '근거 없는 품명' and source is null and verified_at is null
    and verified_by = '0a400000-0000-4000-8000-000000000001'
  from public.catalog_category_erp_mappings where category_id = :'a_id'::uuid)
  and (select source is null and verified_at is null from public.catalog_category_erp_mappings where category_id = :'b_id'::uuid)
  and (select count(*) from public.audit_log where id = '0a400000-0000-4000-8000-000000000301' and action = 'admin.catalog.category.erp_mapping_updated') = 1
then 1 else 0 end as assert_erp_values_save_without_evidence;
-- ERP 코드·품명은 여전히 꼭 있어야 하고, 다른 카테고리가 쓰는 ERP 코드는 받지 않는다.
select pg_temp.expect_error(format('select public.admin_set_category_erp_mapping(%L::uuid,%L::uuid,%L,%L,null,null)',
  '0a400000-0000-4000-8000-000000000303', :'c_id', ' ', '품명'), 'invalid_category_erp_mapping', '22023');
select pg_temp.expect_error(format('select public.admin_set_category_erp_mapping(%L::uuid,%L::uuid,%L,%L,null,null)',
  '0a400000-0000-4000-8000-000000000303', :'c_id', 'EV-ERP-C', ''), 'invalid_category_erp_mapping', '22023');
select pg_temp.expect_error(format('select public.admin_set_category_erp_mapping(%L::uuid,%L::uuid,%L,%L,null,null)',
  '0a400000-0000-4000-8000-000000000303', :'c_id', 'EV-ERP-A', '겹친 코드'), 'category_erp_code_taken', '23505');
-- 같은 작업 번호·같은 내용은 한 번만 처리하고, 다른 내용은 거절한다.
select public.admin_set_category_erp_mapping('0a400000-0000-4000-8000-000000000301', :'a_id'::uuid, ' EV-ERP-A ', ' 근거 없는 품명 ', null, null);
select pg_temp.expect_error(format('select public.admin_set_category_erp_mapping(%L::uuid,%L::uuid,%L,%L,null,null)',
  '0a400000-0000-4000-8000-000000000301', :'a_id', 'EV-ERP-A', '다른 품명'), 'operation_conflict', '23505');

-- 6. 근거를 보낸 옛 호출도 그대로 저장되고, 그 뒤 근거 없이 고쳐도 출처·검증 시각·검증한 사람은 남는다.
select public.admin_set_category_erp_mapping('0a400000-0000-4000-8000-000000000304', :'c_id'::uuid, 'EV-ERP-C', '근거 있는 품명', 'ERP 분류표 v1', '2026-09-10T00:00:00Z');
reset role;
update public.catalog_category_erp_mappings set verified_by = '0a400000-0000-4000-8000-000000000002' where category_id = :'c_id'::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', '0a400000-0000-4000-8000-000000000001', true);
select public.admin_set_category_erp_mapping('0a400000-0000-4000-8000-000000000305', :'c_id'::uuid, 'EV-ERP-C2', '고친 품명', null, null);
select 1 / case when (select erp_code = 'EV-ERP-C2' and erp_name = '고친 품명' and source = 'ERP 분류표 v1'
    and verified_at = '2026-09-10T00:00:00Z'::timestamptz and verified_by = '0a400000-0000-4000-8000-000000000002'
  from public.catalog_category_erp_mappings where category_id = :'c_id'::uuid)
then 1 else 0 end as assert_stored_mapping_evidence_is_kept;
-- 새 근거를 보내면 그 값과 보낸 사람으로 바뀐다.
select public.admin_set_category_erp_mapping('0a400000-0000-4000-8000-000000000306', :'c_id'::uuid, 'EV-ERP-C2', '고친 품명', 'ERP 분류표 v2', null);
select 1 / case when (select source = 'ERP 분류표 v2' and verified_at = '2026-09-10T00:00:00Z'::timestamptz
    and verified_by = '0a400000-0000-4000-8000-000000000001'
  from public.catalog_category_erp_mappings where category_id = :'c_id'::uuid)
then 1 else 0 end as assert_new_mapping_evidence_replaces_only_what_was_sent;

-- 7. 마지막 단계 카테고리마다 ERP 코드가 있으면 ERP 분류가 근거 없이 켜진다. 다른 카테고리가 있는 DB에서는 그 DB의 준비 상태대로 판정한다.
do $$
declare ready boolean;
begin
  ready := not exists(
    select 1 from public.catalog_categories category
    left join public.catalog_category_erp_mappings mapping on mapping.category_id = category.id
    where category.archived_at is null and mapping.category_id is null
      and not exists(select 1 from public.catalog_categories child where child.parent_id = category.id and child.archived_at is null));
  begin
    perform public.admin_set_category_activation('0a400000-0000-4000-8000-000000000208', true, true, null);
    if not ready then raise exception 'Expected rejection: category_activation_unready'; end if;
    if not (select erp_enabled from public.category_activation_control where id = 'catalog') then raise exception 'ERP gate did not open'; end if;
  exception when check_violation then
    if ready or sqlerrm <> 'category_activation_unready' then raise; end if;
  end;
end $$;

-- 8. 순서 바꾸기: 같은 상위 아래의 카테고리 전체를 새 순서대로 받아 0부터 다시 매긴다. 순서 값이 모두 같아도(0) 바뀐다.
-- 한 트랜잭션 안에서는 now()가 같으므로, 고친 시각이 바뀌는지 보려고 먼저 옛 시각으로 돌려 둔다.
reset role;
update public.catalog_categories set updated_at = '2026-01-01T00:00:00Z' where parent_id = :'root_id'::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', '0a400000-0000-4000-8000-000000000001', true);
select public.admin_reorder_categories('0a400000-0000-4000-8000-000000000401', :'root_id'::uuid,
  array[:'c_id', :'a_id', :'b_id']::uuid[]) as reordered \gset
select 1 / case when :'reordered'::boolean
  and (select array_agg(code order by sort_order) from public.catalog_categories where parent_id = :'root_id'::uuid)
    = array['category-evidence-c', 'category-evidence-a', 'category-evidence-b']
  and (select array_agg(sort_order order by sort_order) from public.catalog_categories where parent_id = :'root_id'::uuid) = array[0, 1, 2]
  -- 순서가 바뀐 줄만 고친 시각이 바뀐다(가: 0 → 1). 그대로인 줄(다: 0 → 0)은 건드리지 않는다.
  and (select updated_at > '2026-01-01T00:00:00Z'::timestamptz from public.catalog_categories where id = :'a_id'::uuid)
  and (select updated_at = '2026-01-01T00:00:00Z'::timestamptz from public.catalog_categories where id = :'c_id'::uuid)
  and (select diff ->> 'changed' = '2' and target = 'catalog_categories:' || :'root_id'
    from public.audit_log where id = '0a400000-0000-4000-8000-000000000401' and action = 'admin.catalog.category.reordered')
then 1 else 0 end as assert_siblings_are_renumbered;
-- 같은 작업 번호·같은 내용은 한 번만 처리하고(결과도 같다), 다른 내용은 거절한다.
select 1 / case when public.admin_reorder_categories('0a400000-0000-4000-8000-000000000401', :'root_id'::uuid, array[:'c_id', :'a_id', :'b_id']::uuid[])
  and (select count(*) from public.audit_log where id = '0a400000-0000-4000-8000-000000000401') = 1
then 1 else 0 end as assert_reorder_replay;
select pg_temp.expect_error(format('select public.admin_reorder_categories(%L::uuid,%L::uuid,array[%L,%L,%L]::uuid[])',
  '0a400000-0000-4000-8000-000000000401', :'root_id', :'a_id', :'b_id', :'c_id'), 'operation_conflict', '23505');
-- 이미 그 순서면 바뀐 것이 없다고 돌려준다.
select 1 / case when not public.admin_reorder_categories('0a400000-0000-4000-8000-000000000402', :'root_id'::uuid, array[:'c_id', :'a_id', :'b_id']::uuid[])
then 1 else 0 end as assert_same_order_changes_nothing;
-- 그 상위 아래의 카테고리 전체가 아니면(빠졌거나, 다른 상위의 카테고리가 섞였으면) 거절한다.
select pg_temp.expect_error(format('select public.admin_reorder_categories(%L::uuid,%L::uuid,array[%L,%L]::uuid[])',
  '0a400000-0000-4000-8000-000000000403', :'root_id', :'a_id', :'b_id'), 'category_changed', 'PT409');
select pg_temp.expect_error(format('select public.admin_reorder_categories(%L::uuid,%L::uuid,array[%L,%L,%L]::uuid[])',
  '0a400000-0000-4000-8000-000000000403', :'root_id', :'a_id', :'b_id', :'root_id'), 'category_changed', 'PT409');
select pg_temp.expect_error(format('select public.admin_reorder_categories(%L::uuid,%L::uuid,array[%L,%L,%L,%L]::uuid[])',
  '0a400000-0000-4000-8000-000000000403', :'root_id', :'a_id', :'b_id', :'c_id', :'root_id'), 'category_changed', 'PT409');
-- 빈 목록·겹친 번호·빈 값은 조회 전에 거절한다.
select pg_temp.expect_error(format('select public.admin_reorder_categories(%L::uuid,%L::uuid,array[]::uuid[])',
  '0a400000-0000-4000-8000-000000000403', :'root_id'), 'invalid_category_order', '22023');
select pg_temp.expect_error(format('select public.admin_reorder_categories(%L::uuid,%L::uuid,array[%L,%L,%L]::uuid[])',
  '0a400000-0000-4000-8000-000000000403', :'root_id', :'a_id', :'a_id', :'b_id'), 'invalid_category_order', '22023');
select pg_temp.expect_error(format('select public.admin_reorder_categories(%L::uuid,%L::uuid,array[%L,null]::uuid[])',
  '0a400000-0000-4000-8000-000000000403', :'root_id', :'a_id'), 'invalid_category_order', '22023');
select pg_temp.expect_error(format('select public.admin_reorder_categories(null,%L::uuid,array[%L]::uuid[])', :'root_id', :'a_id'), 'invalid_category_order', '22023');
-- 최상위(상위 없음)도 같은 방식이다. 이 시험이 만든 최상위를 맨 앞으로 옮긴다.
select array_agg(id order by (id = :'root_id'::uuid) desc, sort_order, code) as root_order from public.catalog_categories where parent_id is null \gset
select public.admin_reorder_categories('0a400000-0000-4000-8000-000000000404', null, :'root_order'::uuid[]);
select 1 / case when (select sort_order = 0 from public.catalog_categories where id = :'root_id'::uuid)
  and (select count(distinct sort_order) = count(*) from public.catalog_categories where parent_id is null)
then 1 else 0 end as assert_root_level_reorder;

-- 9. 계정 부매니저는 순서를 바꿀 수 있지만(catalog.manage) 사용 설정과 ERP 코드는 못 바꾼다(platform.manage).
select set_config('request.jwt.claim.sub', '0a400000-0000-4000-8000-000000000003', true);
select 1 / case when public.admin_reorder_categories('0a400000-0000-4000-8000-000000000405', :'root_id'::uuid, array[:'a_id', :'b_id', :'c_id']::uuid[])
then 1 else 0 end as assert_deputy_can_reorder;
select pg_temp.expect_error($sql$select public.admin_set_category_activation('0a400000-0000-4000-8000-000000000504', false, false, null)$sql$, 'forbidden', '42501');
select pg_temp.expect_error(format('select public.admin_set_category_erp_mapping(%L::uuid,%L::uuid,%L,%L,null,null)',
  '0a400000-0000-4000-8000-000000000505', :'a_id', 'EV-ERP-Y', '불허'), 'forbidden', '42501');

-- 10. 운영자가 아닌 회원은 셋 다 못 쓴다.
select set_config('request.jwt.claim.sub', '0a400000-0000-4000-8000-000000000002', true);
select pg_temp.expect_error($sql$select public.admin_set_category_activation('0a400000-0000-4000-8000-000000000501', true, false, null)$sql$, 'forbidden', '42501');
select pg_temp.expect_error(format('select public.admin_set_category_erp_mapping(%L::uuid,%L::uuid,%L,%L,null,null)',
  '0a400000-0000-4000-8000-000000000502', :'a_id', 'EV-ERP-X', '불허'), 'forbidden', '42501');
select pg_temp.expect_error(format('select public.admin_reorder_categories(%L::uuid,%L::uuid,array[%L,%L,%L]::uuid[])',
  '0a400000-0000-4000-8000-000000000503', :'root_id', :'a_id', :'b_id', :'c_id'), 'forbidden', '42501');

reset role;
rollback;
