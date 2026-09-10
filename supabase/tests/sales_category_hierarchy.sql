\set ON_ERROR_STOP on
begin;

create function pg_temp.expect_error(statement text, expected_message text, expected_code text default null)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
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
  ('00000000-0000-4000-8000-000000047471', 'authenticated', 'authenticated', 'category-staff-0474@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000047472', 'authenticated', 'authenticated', 'category-buyer-0474@example.test', now(), '{}', '{}', now(), now());
update public.profiles set role = 'staff' where id = '00000000-0000-4000-8000-000000047471';
update public.profiles set nickname = '카테고리 검증 구매자', birth_date = '2000-01-01', onboarded_at = now(), consents = '{"terms":true,"privacy":true}'
where id = '00000000-0000-4000-8000-000000047472';
insert into public.verticals(key, label, color) values ('category-hierarchy-0474', '카테고리 계층 검증', '#000000');
insert into public.ips(id, title, vertical_key) values ('category-hierarchy-0474', '카테고리 계층 검증', 'category-hierarchy-0474');
insert into public.goods(id, ip_id, name, type, price, stock) values
  ('category-good-0474', 'category-hierarchy-0474', '카테고리 연결 검증', '문구', 1000, 'ok');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000047471', true);

select (public.admin_upsert_category('00000000-0000-4000-8000-000000047401', null, 'category-root-0474', '검증 대분류', null, 1, null)::jsonb ->> 'id') as root_id \gset
select (public.admin_upsert_category('00000000-0000-4000-8000-000000047402', null, 'category-mid-0474', '검증 중분류', :'root_id'::uuid, 1, null)::jsonb ->> 'id') as mid_id \gset
select (public.admin_upsert_category('00000000-0000-4000-8000-000000047403', null, 'category-small-0474', '검증 소분류', :'mid_id'::uuid, 1, null)::jsonb ->> 'id') as small_id \gset
select (public.admin_upsert_category('00000000-0000-4000-8000-000000047404', null, 'category-leaf-0474', '검증 말단', :'small_id'::uuid, 1, null)::jsonb ->> 'id') as leaf_id \gset

select pg_temp.expect_error(format(
  'select public.admin_upsert_category(%L::uuid,null,%L,%L,%L::uuid,1,null::timestamptz)',
  '00000000-0000-4000-8000-000000047405', 'category-fifth-0474', '다섯째', :'leaf_id'
), 'category_depth_exceeded', '23514');
select updated_at as root_updated_at from public.catalog_categories where id = :'root_id'::uuid \gset
select pg_temp.expect_error(format(
  'select public.admin_upsert_category(%L::uuid,%L::uuid,%L,%L,%L::uuid,1,%L::timestamptz)',
  '00000000-0000-4000-8000-000000047406', :'root_id', 'category-root-0474', '검증 대분류', :'leaf_id', :'root_updated_at'
), 'category_cycle', '23514');

-- The operation id is the audit id: a byte-for-byte retry returns the same category.
select (public.admin_upsert_category('00000000-0000-4000-8000-000000047407', null, 'category-retry-0474', '재시도 카테고리', null, 2, null)::jsonb ->> 'id') as retry_id \gset
select (public.admin_upsert_category('00000000-0000-4000-8000-000000047407', null, 'category-retry-0474', '재시도 카테고리', null, 2, null)::jsonb ->> 'id') as retry_id_again \gset
select (public.admin_upsert_category('00000000-0000-4000-8000-000000047424', null, 'category-assigned-parent-0474', '연결 부모', null, 4, null)::jsonb ->> 'id') as assigned_parent_id \gset
select 1 / case when :'retry_id' = :'retry_id_again'
  and (select count(*) from public.audit_log where id = '00000000-0000-4000-8000-000000047407') = 1
  and (select count(*) from public.catalog_categories where code = 'category-retry-0474') = 1
then 1 else 0 end as assert_category_operation_is_idempotent;

-- Customer and ERP gates are independent. The ERP gate cannot open with an unmapped leaf.
select public.admin_set_category_activation(
  '00000000-0000-4000-8000-000000047408', true, false,
  '{"customer":{"source":"customer-catalog-0474","reference":"CAT-0474","verifiedAt":"2026-09-10T00:00:00Z"},"erp":{}}'::jsonb
);
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select 1 / case when exists(select 1 from public.catalog_categories where code = 'category-root-0474')
  and not has_table_privilege('anon', 'public.catalog_category_erp_mappings', 'select')
then 1 else 0 end as assert_customer_gate_is_public_and_erp_is_private;
select 1 / case when (select count(*) from public.get_catalog_categories()) = 6
  and not exists(select 1 from public.get_catalog_categories() where code = 'category-retry-0474' and depth <> 1)
then 1 else 0 end as assert_public_category_rpc_is_safe;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000047471', true);
select pg_temp.expect_error($sql$
  select public.admin_set_category_activation(
    '00000000-0000-4000-8000-000000047409', true, true,
    '{"customer":{"source":"customer-catalog-0474","reference":"CAT-0474","verifiedAt":"2026-09-10T00:00:00Z"},"erp":{"source":"erp-catalog-0474","reference":"ERP-0474","verifiedAt":"2026-09-10T00:00:00Z"}}'::jsonb
  )
$sql$, 'category_activation_unready', '23514');

select public.admin_set_category_erp_mapping(
  '00000000-0000-4000-8000-000000047410', :'leaf_id'::uuid, 'ERP-0474-LEAF', '실제 ERP 말단', 'erp-catalog-0474', '2026-09-10T00:00:00Z'
);
select public.admin_set_category_erp_mapping(
  '00000000-0000-4000-8000-000000047421', :'retry_id'::uuid, 'ERP-0474-RETRY', '실제 ERP 재시도', 'erp-catalog-0474', '2026-09-10T00:00:00Z'
);
select public.admin_set_category_erp_mapping(
  '00000000-0000-4000-8000-000000047425', :'assigned_parent_id'::uuid, 'ERP-0474-PARENT', '실제 ERP 연결 부모', 'erp-catalog-0474', '2026-09-10T00:00:00Z'
);
select public.admin_set_category_activation(
  '00000000-0000-4000-8000-000000047411', true, true,
  '{"customer":{"source":"customer-catalog-0474","reference":"CAT-0474","verifiedAt":"2026-09-10T00:00:00Z"},"erp":{"source":"erp-catalog-0474","reference":"ERP-0474","verifiedAt":"2026-09-10T00:00:00Z"}}'::jsonb
);

-- Only active leaves are assignable; null remains a valid unclassified value.
select public.admin_assign_good_category('00000000-0000-4000-8000-000000047426', 'category-good-0474', :'assigned_parent_id'::uuid, null);
select pg_temp.expect_error(format(
  'select public.admin_upsert_category(%L::uuid,null,%L,%L,%L::uuid,1,null::timestamptz)',
  '00000000-0000-4000-8000-000000047427', 'category-under-assigned-0474', '연결된 부모 하위', :'assigned_parent_id'
), 'category_has_goods', '23514');
select updated_at as retry_updated_at from public.catalog_categories where id = :'retry_id'::uuid \gset
select pg_temp.expect_error(format(
  'select public.admin_upsert_category(%L::uuid,%L::uuid,%L,%L,%L::uuid,1,%L::timestamptz)',
  '00000000-0000-4000-8000-000000047428', :'retry_id', 'category-retry-0474', '재시도 카테고리', :'assigned_parent_id', :'retry_updated_at'
), 'category_has_goods', '23514');
select public.admin_assign_good_category('00000000-0000-4000-8000-000000047429', 'category-good-0474', null, null);
select public.admin_assign_good_category('00000000-0000-4000-8000-000000047412', 'category-good-0474', :'leaf_id'::uuid, null);
select pg_temp.expect_error(format(
  'select public.admin_assign_good_category(%L::uuid,%L,%L::uuid,null)',
  '00000000-0000-4000-8000-000000047413', 'category-good-0474', :'root_id'
), 'category_not_leaf', '23514');
select public.admin_assign_good_category('00000000-0000-4000-8000-000000047414', 'category-good-0474', null, null);
select 1 / case when (select category_id from public.goods where id = 'category-good-0474') is null
then 1 else 0 end as assert_unclassified_goods_remain_valid;

select public.admin_assign_good_category('00000000-0000-4000-8000-000000047415', 'category-good-0474', :'leaf_id'::uuid, null);
select updated_at as leaf_updated_at from public.catalog_categories where id = :'leaf_id'::uuid \gset
select public.admin_archive_category('00000000-0000-4000-8000-000000047416', :'leaf_id'::uuid, :'leaf_updated_at'::timestamptz);
select 1 / case when (select archived_at is not null from public.catalog_categories where id = :'leaf_id'::uuid)
  and (select category_id from public.goods where id = 'category-good-0474') = :'leaf_id'::uuid
then 1 else 0 end as assert_referenced_category_is_archived_without_detaching_goods;
select public.admin_assign_good_category('00000000-0000-4000-8000-000000047422', 'category-good-0474', :'leaf_id'::uuid, null);
select public.admin_assign_good_category('00000000-0000-4000-8000-000000047423', 'category-good-0474', null, null);
select pg_temp.expect_error(format(
  'select public.admin_assign_good_category(%L::uuid,%L,%L::uuid,null)',
  '00000000-0000-4000-8000-000000047417', 'category-good-0474', :'leaf_id'
), 'category_archived', '23514');

select updated_at as archived_leaf_updated_at from public.catalog_categories where id = :'leaf_id'::uuid \gset
select public.admin_unarchive_category('00000000-0000-4000-8000-000000047418', :'leaf_id'::uuid, :'archived_leaf_updated_at'::timestamptz);
select public.admin_set_category_type_migration('00000000-0000-4000-8000-000000047419', '문구', :'leaf_id'::uuid, 'suggested', '운영 확인 전 제안');
select 1 / case when exists(select 1 from public.goods_type_category_migrations where type = '문구' and status = 'suggested')
then 1 else 0 end as assert_legacy_type_migration_is_optional;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000047472', true);
select pg_temp.expect_error($sql$select public.admin_upsert_category('00000000-0000-4000-8000-000000047420',null,'buyer-category-0474','불허',null,1,null)$sql$, 'forbidden', '42501');
select pg_temp.expect_error($sql$insert into public.catalog_categories(code,name) values ('direct-write-0474','직접 쓰기')$sql$, 'permission denied', '42501');
select 1 / case when not has_function_privilege('anon', 'public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamptz)', 'execute')
  and not has_table_privilege('authenticated', 'public.catalog_categories', 'insert')
then 1 else 0 end as assert_category_acl;

rollback;
