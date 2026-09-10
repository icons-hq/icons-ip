\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_error(statement text,expected_message text,expected_code text default null)
returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if position(expected_message in sqlerrm)=0 or (expected_code is not null and sqlstate<>expected_code) then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',expected_message;
end $$;
create function pg_temp.good_payload(good_id text) returns jsonb language sql as $$
  select record->'good'||jsonb_build_object('previous_id',good_id,
    'variant_baseline',(select coalesce(jsonb_agg(value->'id'),'[]') from jsonb_array_elements(record->'variants') where value->>'archived_at' is null),
    'variants',(select jsonb_agg(jsonb_build_object('id',value->'id','name',value->'name','code',value->'code','attributes',value->'attributes',
      'extraPrice',(value->>'price')::integer-(record#>>'{good,price}')::integer,'stockQty',value->'stock_qty',
      'expectedStockQty',value->'stock_qty','isActive',value->>'archived_at' is null,'lowStockThreshold',value->'low_stock_threshold'))
      from jsonb_array_elements(record->'variants')))
  from public.admin_goods_import_records('{}',array[good_id]) record;
$$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000047501','authenticated','authenticated','purchase-cost-admin@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000047502','authenticated','authenticated','purchase-cost-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000047503','authenticated','authenticated','purchase-cost-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin',nickname='원가관리자7501' where id='00000000-0000-4000-8000-000000047501';
update public.profiles set role='staff',nickname='원가스태프7502' where id='00000000-0000-4000-8000-000000047502';
update public.profiles set nickname='원가구매자7503',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id='00000000-0000-4000-8000-000000047503';
insert into public.verticals(key,label,color) values('purchase-cost-tests','매입단가 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('purchase-cost-tests','매입단가 검증','purchase-cost-tests',now());

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047502',true);
select public.admin_save_good('{"id":"purchase-cost-good","ip_id":"purchase-cost-tests","name":"매입단가 상품","price":10000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"PURCHASE-COST-01","attributes":{},"extraPrice":0,"stockQty":10}]}');
select id as variant_id from public.goods_variants where good_id='purchase-cost-good' and is_default \gset
select pg_temp.expect_error($sql$select public.admin_list_goods_variant_purchase_costs('purchase-cost-good')$sql$,'purchase_cost_admin_required','42501');
select pg_temp.expect_error(format('select public.admin_save_goods_variant_purchase_cost(%L,%L,0,%L,null)',
 'purchase-cost-good',:'variant_id','included'),'purchase_cost_admin_required','42501');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047501',true);
select 1/case when exists(select 1 from public.admin_list_goods_variant_purchase_costs('purchase-cost-good') where unit_cost_krw is null and tax_basis is null and revision is null)
 then 1 else 0 end as assert_unconfigured_cost_is_not_zero;
select pg_temp.expect_error(format('select public.admin_save_goods_variant_purchase_cost(%L,%L,0,null,null)',
 'purchase-cost-good',:'variant_id'),'invalid_goods_purchase_cost','23514');
select pg_temp.expect_error(format('select public.admin_save_goods_variant_purchase_cost(%L,%L,null,%L,null)',
 'purchase-cost-good',:'variant_id','included'),'invalid_goods_purchase_cost','23514');
select pg_temp.expect_error(format('select public.admin_save_goods_variant_purchase_cost(%L,%L,-1,%L,null)',
 'purchase-cost-good',:'variant_id','included'),'invalid_goods_purchase_cost','23514');
select public.admin_save_goods_variant_purchase_cost('purchase-cost-good',:'variant_id',0,'included',null);
select 1/case when exists(select 1 from public.admin_list_goods_variant_purchase_costs('purchase-cost-good') where unit_cost_krw=0 and tax_basis='included' and revision=1)
 then 1 else 0 end as assert_explicit_zero_with_tax_basis_is_effective;
select 1/case when public.admin_save_goods_variant_purchase_cost('purchase-cost-good',:'variant_id',0,'included',1)->>'changed'='false'
 then 1 else 0 end as assert_unchanged_save_does_not_add_history;
select public.admin_save_goods_variant_purchase_cost('purchase-cost-good',:'variant_id',1250,'excluded',1);
select pg_temp.expect_error(format('select public.admin_save_goods_variant_purchase_cost(%L,%L,2000,%L,1)',
 'purchase-cost-good',:'variant_id','included'),'goods_purchase_cost_changed','PT409');
select 1/case when exists(select 1 from public.admin_list_goods_variant_purchase_costs('purchase-cost-good') where unit_cost_krw=1250 and tax_basis='excluded' and revision=2)
 and jsonb_array_length(public.admin_list_goods_purchase_cost_history('purchase-cost-good',:'variant_id'))=2
 and public.admin_list_goods_purchase_cost_history('purchase-cost-good',:'variant_id')#>>'{0,before,unitCostKrw}'='0'
 and public.admin_list_goods_purchase_cost_history('purchase-cost-good',:'variant_id')#>>'{0,after,unitCostKrw}'='1250'
 then 1 else 0 end as assert_private_cost_history_preserves_exact_inputs;
select public.admin_save_goods_variant_purchase_cost('purchase-cost-good',:'variant_id',null,null,2);
select 1/case when exists(select 1 from public.admin_list_goods_variant_purchase_costs('purchase-cost-good') where unit_cost_krw is null and tax_basis is null and revision=3)
 and public.admin_list_goods_purchase_cost_history('purchase-cost-good',:'variant_id')#>'{0,after}'='{"unitCostKrw":null,"taxBasis":null}'::jsonb
 then 1 else 0 end as assert_clear_preserves_revision_and_history;

-- Workbook-style nested cost input shares the product transaction and exact option.
select public.admin_save_good(jsonb_set(pg_temp.good_payload('purchase-cost-good'),'{variants,0,purchaseCost}',
 '{"unitCostKrw":1459,"taxBasis":"exempt","expectedRevision":3}'::jsonb));
select 1/case when exists(select 1 from public.admin_goods_import_records('{}','{purchase-cost-good}') record
 where record#>>'{variants,0,purchase_cost_krw}'='1459' and record#>>'{variants,0,purchase_tax_basis}'='exempt'
   and record#>>'{variants,0,purchase_cost_revision}'='4')
 then 1 else 0 end as assert_admin_workbook_receives_private_cost_and_revision;
select record->>'fingerprint' as previous_fingerprint from public.admin_goods_import_records('{}','{purchase-cost-good}') record \gset
select public.admin_save_goods_variant_purchase_cost('purchase-cost-good',:'variant_id',1460,'exempt',4);
select 1/case when exists(select 1 from public.admin_goods_import_records('{}','{purchase-cost-good}') record where record->>'fingerprint'<>:'previous_fingerprint')
 then 1 else 0 end as assert_cost_revision_invalidates_stale_import;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047502',true);
select 1/case when not exists(select 1 from public.admin_goods_import_records('{}','{purchase-cost-good}') record,
 jsonb_array_elements(record->'variants') variant where variant ?| array['purchase_cost_krw','purchase_tax_basis','purchase_cost_revision'])
 then 1 else 0 end as assert_staff_workbook_has_no_cost_keys;
select pg_temp.expect_error(format('select public.admin_list_goods_purchase_cost_history(%L,%L)',
 'purchase-cost-good',:'variant_id'),'purchase_cost_admin_required','42501');
select pg_temp.expect_error($sql$select public.admin_save_good(jsonb_set(pg_temp.good_payload('purchase-cost-good'),'{variants,0,purchaseCost}',
 '{"unitCostKrw":null,"taxBasis":null,"expectedRevision":5}'::jsonb)||'{"name":"권한 우회 변경"}')$sql$,
 'purchase_cost_admin_required','42501');
select public.admin_save_good(pg_temp.good_payload('purchase-cost-good')||'{"name":"스태프 일반 수정"}');
select 1/case when (select name from public.goods where id='purchase-cost-good')='스태프 일반 수정'
 and exists(select 1 from public.audit_log where action='admin.good.purchase_cost_saved' and target='goods:purchase-cost-good')
 and not exists(select 1 from public.audit_log where action='admin.good.purchase_cost_saved' and target='goods:purchase-cost-good'
   and (jsonb_path_exists(diff,'$.**.unitCostKrw') or jsonb_path_exists(diff,'$.**.taxBasis')))
 then 1 else 0 end as assert_staff_registration_and_audit_metadata_do_not_expose_costs;

reset role;
select set_config('request.jwt.claim.sub','',true);
select 1/case when not has_table_privilege('authenticated','private.goods_variant_purchase_costs','select,insert,update,delete')
 and not has_table_privilege('service_role','private.goods_variant_purchase_costs','select,insert,update,delete')
 and not has_table_privilege('authenticated','private.goods_variant_purchase_cost_changes','select,insert,update,delete')
 and (select unit_cost_krw from private.goods_variant_purchase_costs where variant_id=:'variant_id')=1460
 and (select count(*) from private.goods_variant_purchase_cost_changes where variant_id=:'variant_id')=5
 then 1 else 0 end as assert_private_ledgers_are_sealed_and_staff_did_not_clear;
update public.goods set type='문구',image_path='public-media/purchase-cost-fixture.webp',
 notice_maker='제조사',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026-09',
 notice_as_manager='CS',notice_as_contact='02-000' where id='purchase-cost-good';
select pg_temp.publish_goods_kc_fixture('purchase-cost-good');
set local role anon;
select 1/case when exists(select 1 from public.goods where id='purchase-cost-good' and price=10000)
 and exists(select 1 from public.goods_variants where id=:'variant_id' and price=10000)
 and not exists(select 1 from public.goods_variants variant where id=:'variant_id' and to_jsonb(variant)?'purchase_cost_krw')
 then 1 else 0 end as assert_public_catalog_has_only_selling_price;
select pg_temp.expect_error($sql$select public.admin_list_goods_variant_purchase_costs('purchase-cost-good')$sql$,'permission denied','42501');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047503',true);
select public.set_cart_item_quantity('purchase-cost-good',:'variant_id',1);
reset role;
set local role service_role;
select public.place_order('00000000-0000-4000-8000-000000047503',
 '{"recipientName":"원가 검증","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}',
 '00000000-0000-4000-8000-000000047520','card') as order_id \gset
reset role;
select 1/case when exists(select 1 from public.order_items where order_id=:'order_id' and unit_price=10000 and regular_unit_price_snapshot=10000)
 and exists(select 1 from public.orders where id=:'order_id' and total=10000+shipping_fee and discount_total=0)
 then 1 else 0 end as assert_purchase_cost_does_not_reprice_customer_order;

-- Administrative workbook payloads and their source object metadata remain
-- confidential when the uploading administrator is later demoted to staff.
select set_config('request.jwt.claim.sub','',true);
insert into public.admin_goods_imports(id,actor_id,state,plan) values
 ('00000000-0000-4000-8000-000000047530','00000000-0000-4000-8000-000000047501','ready','[]'),
 ('00000000-0000-4000-8000-000000047531','00000000-0000-4000-8000-000000047502','uploading','[]');
insert into storage.objects(bucket_id,name) values('admin-goods-imports',
 '00000000-0000-4000-8000-000000047501/00000000-0000-4000-8000-000000047530/workbook.xlsx');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047501',true);
select 1/case when exists(select 1 from public.admin_goods_imports where id='00000000-0000-4000-8000-000000047530' and requires_admin)
 and exists(select 1 from storage.objects where bucket_id='admin-goods-imports'
 and name='00000000-0000-4000-8000-000000047501/00000000-0000-4000-8000-000000047530/workbook.xlsx')
 then 1 else 0 end as assert_admin_can_read_own_confidential_upload;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000047501';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047501',true);
select 1/case when not exists(select 1 from public.admin_goods_imports where id='00000000-0000-4000-8000-000000047530')
 and not exists(select 1 from storage.objects where bucket_id='admin-goods-imports'
 and name='00000000-0000-4000-8000-000000047501/00000000-0000-4000-8000-000000047530/workbook.xlsx')
 then 1 else 0 end as assert_demoted_admin_cannot_read_cost_upload_or_source;
select pg_temp.expect_error($sql$select public.admin_commit_goods_import_group('00000000-0000-4000-8000-000000047530',0)$sql$,
 'purchase_cost_admin_required','42501');
select pg_temp.expect_error($sql$select public.admin_list_goods_variant_purchase_costs('purchase-cost-good')$sql$,'purchase_cost_admin_required','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047502',true);
select 1/case when exists(select 1 from public.admin_goods_imports where id='00000000-0000-4000-8000-000000047531' and not requires_admin)
 then 1 else 0 end as assert_ordinary_staff_upload_remains_available;
rollback;
