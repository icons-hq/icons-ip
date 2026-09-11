\set ON_ERROR_STOP on
begin;

-- #472: ERP identity belongs to an option, stays private, preserves leading
-- zeroes, and is copied only when a new order item is inserted.
insert into auth.users(
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000047201', 'authenticated', 'authenticated',
  'sales-erp@example.test', now(), '{}', '{}', now(), now()
);
update public.profiles
set role='staff', nickname='sales_erp_staff', birth_date='1990-01-01',
  consents='{"terms":true,"privacy":true}', onboarded_at=now()
where id='00000000-0000-4000-8000-000000047201';
insert into public.verticals(key,label,color)
values ('sales-erp','ERP 식별자 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at)
values ('sales-erp','ERP 식별자 검증','sales-erp',now());

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047201',true);
select public.admin_save_good(jsonb_build_object(
  'id','sales-erp-good','ip_id','sales-erp','name','ERP 옵션 상품','type','키링','price',1000
));
select id as erp_variant_id
from public.goods_variants
where good_id='sales-erp-good' and is_default
\gset

-- Leading zeroes survive and surrounding whitespace is removed. The product's
-- own option code remains a separate value.
select public.admin_save_goods_variant_external_identity(
  'sales-erp-good', :'erp_variant_id'::uuid, '  0000123  ', '  ERP 옵션 품명  ', ' 0088012345678 ', null
);
select 1 / case when exists (
  select 1
  from public.admin_list_goods_variant_external_identities('sales-erp-good') identity
  join public.goods_variants variant on variant.id=identity.variant_id
  where variant.id=:'erp_variant_id'::uuid
    and variant.code <> identity.erp_code
    and identity.erp_code='0000123'
    and identity.erp_name='ERP 옵션 품명'
    and identity.barcode='0088012345678'
) then 1 else 0 end as assert_external_identity_is_trimmed_and_separate;

select updated_at as erp_identity_updated_at
from public.admin_list_goods_variant_external_identities('sales-erp-good')
where variant_id=:'erp_variant_id'::uuid
\gset
do $$
declare
  variant_id uuid := (select id from public.goods_variants where good_id='sales-erp-good' and is_default);
begin
  begin
    perform public.admin_save_goods_variant_external_identity(
      'sales-erp-good', variant_id, '0000999', 'stale', '00999',
      '2000-01-01T00:00:00Z'::timestamptz
    );
    raise exception 'stale external identity write accepted';
  exception when sqlstate 'PT409' then
    null;
  end;
end
$$;

-- The authenticated boundary can read/write through the two staff RPCs, but
-- no application role can read the private source table directly.
select 1 / case when (
  has_function_privilege('authenticated','public.admin_save_goods_variant_external_identity(text,uuid,text,text,text,timestamptz)','execute')
  and has_function_privilege('authenticated','public.admin_list_goods_variant_external_identities(text)','execute')
  and not has_function_privilege('anon','public.admin_save_goods_variant_external_identity(text,uuid,text,text,text,timestamptz)','execute')
  and not has_function_privilege('service_role','public.admin_save_goods_variant_external_identity(text,uuid,text,text,text,timestamptz)','execute')
  and not has_table_privilege('authenticated','private.goods_variant_external_identity','select')
  and not has_table_privilege('authenticated','private.order_item_external_identity_snapshots','select')
) then 1 else 0 end as assert_external_identity_acl;

-- New order items snapshot the current values. A later catalog edit does not
-- rewrite the historical copy.
reset role;
insert into public.orders(id,user_id,status,total,address)
values (
  '10000000-0000-4000-8000-000000047201',
  '00000000-0000-4000-8000-000000047201',
  'pending', 1000, '{}'
);
insert into public.order_items(
  id,order_id,good_id,variant_id,qty,unit_price,
  good_name_snapshot,good_type_snapshot,good_ip_id_snapshot
) values (
  '20000000-0000-4000-8000-000000047201',
  '10000000-0000-4000-8000-000000047201',
  'sales-erp-good',:'erp_variant_id'::uuid,1,1000,
  'ERP 옵션 상품','키링','sales-erp'
);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047201',true);
select public.admin_save_goods_variant_external_identity(
  'sales-erp-good', :'erp_variant_id'::uuid, '0000999', '변경된 ERP 품명', '00999', :'erp_identity_updated_at'
);
select updated_at as erp_identity_updated_at_after_update
from public.admin_list_goods_variant_external_identities('sales-erp-good')
where variant_id=:'erp_variant_id'::uuid
\gset
reset role;
select 1 / case when exists (
  select 1 from private.order_item_external_identity_snapshots snapshot
  where snapshot.order_item_id='20000000-0000-4000-8000-000000047201'
    and snapshot.erp_code='0000123'
    and snapshot.erp_name='ERP 옵션 품명'
    and snapshot.barcode='0088012345678'
) then 1 else 0 end as assert_new_order_keeps_original_external_identity;

-- A row created while the identity was unset remains NULL even if the option
-- receives an ERP value later. There is deliberately no historical backfill.
insert into public.orders(id,user_id,status,total,address)
values (
  '10000000-0000-4000-8000-000000047202',
  '00000000-0000-4000-8000-000000047201',
  'pending', 1000, '{}'
);
set local role authenticated;
select public.admin_save_goods_variant_external_identity(
  'sales-erp-good', :'erp_variant_id'::uuid, null, null, null, :'erp_identity_updated_at_after_update'
);
reset role;
insert into public.order_items(
  id,order_id,good_id,variant_id,qty,unit_price,
  good_name_snapshot,good_type_snapshot,good_ip_id_snapshot
) values (
  '20000000-0000-4000-8000-000000047202',
  '10000000-0000-4000-8000-000000047202',
  'sales-erp-good',:'erp_variant_id'::uuid,1,1000,
  'ERP 옵션 상품','키링','sales-erp'
);
set local role authenticated;
select public.admin_save_goods_variant_external_identity(
  'sales-erp-good', :'erp_variant_id'::uuid, '0000444', '나중에 등록', '00444', null
);
reset role;
select 1 / case when exists (
  select 1 from private.order_item_external_identity_snapshots snapshot
  where snapshot.order_item_id='20000000-0000-4000-8000-000000047202'
    and snapshot.erp_code is null
    and snapshot.erp_name is null
    and snapshot.barcode is null
) then 1 else 0 end as assert_missing_historical_external_identity_stays_null;

-- The private ERP values are searchable by staff without becoming columns in
-- the public goods/variant shape.
set local role authenticated;
select 1 / case when (
  (select count(*) from public.admin_search_goods('0000444') where id='sales-erp-good')=1
  and not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='goods_variants'
      and column_name in ('erp_code','erp_name','barcode')
  )
) then 1 else 0 end as assert_admin_search_matches_private_erp;

-- The normal product save seam carries ERP values in option rows and applies
-- them atomically. A row that omits those keys keeps its existing identity.
select public.admin_save_good(jsonb_build_object(
  'id','sales-erp-bulk-good','ip_id','sales-erp','name','ERP 일괄 저장 상품','type','키링','price',1000,
  'variant_baseline','[]'::jsonb,
  'variants',jsonb_build_array(jsonb_build_object(
    'name','기본 옵션','attributes','{}'::jsonb,'code','',
    'extraPrice',0,'stockQty',2,'erpCode','0000777','erpName','일괄 ERP 품명','barcode','00077'
  ))
));
select id as bulk_variant_id
from public.goods_variants
where good_id='sales-erp-bulk-good' and is_default
\gset
select 1 / case when exists (
  select 1 from public.admin_list_goods_variant_external_identities('sales-erp-bulk-good') identity
  where identity.variant_id=:'bulk_variant_id'::uuid
    and identity.erp_code='0000777' and identity.erp_name='일괄 ERP 품명' and identity.barcode='00077'
) then 1 else 0 end as assert_bulk_save_writes_external_identity;
select updated_at as bulk_identity_updated_at
from public.admin_list_goods_variant_external_identities('sales-erp-bulk-good')
where variant_id=:'bulk_variant_id'::uuid
\gset
select 1 / case when exists (
  select 1
  from public.admin_goods_import_records('{}','{sales-erp-bulk-good}') record
  where record#>>'{variants,0,erp_code}'='0000777'
    and record#>>'{variants,0,erp_name}'='일괄 ERP 품명'
    and record#>>'{variants,0,barcode}'='00077'
    and nullif(record->>'fingerprint','') is not null
) then 1 else 0 end as assert_import_record_carries_external_identity;
select public.admin_save_good(jsonb_build_object(
  'previous_id','sales-erp-bulk-good','id','sales-erp-bulk-good','ip_id','sales-erp',
  'name','ERP 일괄 저장 상품','type','키링','price',1000,
  'variant_baseline',jsonb_build_array(:'bulk_variant_id'::text),
  'variants',jsonb_build_array(jsonb_build_object(
    'id',:'bulk_variant_id'::text,'name','기본 옵션','attributes','{}'::jsonb,'code','',
    'extraPrice',0,'stockQty',2,'expectedStockQty',2,
    'erpCode','0000888','erpName','변경된 ERP 품명','barcode','00088',
    'externalUpdatedAt',:'bulk_identity_updated_at'
  ))
));
select 1 / case when exists (
  select 1 from public.admin_list_goods_variant_external_identities('sales-erp-bulk-good') identity
  where identity.variant_id=:'bulk_variant_id'::uuid and identity.erp_code='0000888'
) then 1 else 0 end as assert_bulk_revision_update_writes_current_identity;
do $$
declare
  variant_id uuid := (select id from public.goods_variants where good_id='sales-erp-bulk-good' and is_default);
begin
  begin
    perform public.admin_save_good(jsonb_build_object(
      'previous_id','sales-erp-bulk-good','id','sales-erp-bulk-good','ip_id','sales-erp',
      'name','ERP 일괄 저장 상품','type','키링','price',1000,
      'variant_baseline',jsonb_build_array(variant_id::text),
      'variants',jsonb_build_array(jsonb_build_object(
        'id',variant_id::text,'name','기본 옵션','attributes','{}'::jsonb,'code','',
        'extraPrice',0,'stockQty',2,'expectedStockQty',2,
        'erpCode','0000999','erpName','stale','barcode','00099',
        'externalUpdatedAt','2000-01-01T00:00:00Z'
      ))
    ));
    raise exception 'stale bulk identity write was accepted';
  exception when sqlstate 'PT409' then
    null;
  end;
end
$$;

-- ERP code and barcode are one-to-one across options; descriptive ERP names
-- may repeat. The duplicate constraint is exposed as a normal unique error.
select public.admin_save_good(jsonb_build_object(
  'id','sales-erp-good-two','ip_id','sales-erp','name','ERP 두번째 상품','type','키링','price',1000
));
select id as erp_variant_two_id
from public.goods_variants
where good_id='sales-erp-good-two' and is_default
\gset
do $$
declare
  variant_id uuid := (select id from public.goods_variants where good_id='sales-erp-good-two' and is_default);
begin
  begin
    perform public.admin_save_goods_variant_external_identity(
      'sales-erp-good-two', variant_id, '0000444', '나중에 등록', '00555', null
    );
    raise exception 'duplicate ERP code accepted';
  exception when unique_violation then
    if sqlerrm not like '%goods_variant_external_identity_erp_code_key%' then
      raise;
    end if;
  end;
end
$$;
-- PR #499: replacing a stopped option with the same combination creates a
-- different option. Give the historical row a lower UUID than every generated
-- v4 UUID so the old attributes/sort-order resolver fails deterministically.
select public.admin_save_good('{"id":"sales-erp-replacement","ip_id":"sales-erp","name":"ERP 옵션 재생성","price":1000,"variant_baseline":[],"variants":[{"name":"이전 옵션","attributes":{},"extraPrice":0,"stockQty":0}]}');
reset role;
select set_config('request.jwt.claim.sub','',true);
delete from public.goods_variants where good_id='sales-erp-replacement';
insert into public.goods_variants(id,good_id,name,attributes,price,code,sort_order,is_default)
 values('00000000-0000-0000-0000-000000047299','sales-erp-replacement','이전 옵션','{}',1000,'ERP-REPLACEMENT-OLD',0,true);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047201',true);
select public.admin_set_goods_variant_active('sales-erp-replacement','00000000-0000-0000-0000-000000047299',false,
 (select updated_at from public.goods_variants where id='00000000-0000-0000-0000-000000047299'));
select public.admin_save_good('{"id":"sales-erp-replacement","previous_id":"sales-erp-replacement","ip_id":"sales-erp","name":"ERP 옵션 재생성","price":1000,"variant_baseline":[],"variants":[{"name":"재생성 옵션","attributes":{},"extraPrice":0,"stockQty":0,"externalIdentity":{"erpCode":"000047299","erpName":"새 ERP 옵션","barcode":"0088047299"}}]}');
select variant.id,variant.archived_at is null as active,identity.erp_code,identity.barcode
 from public.goods_variants variant
 left join public.admin_list_goods_variant_external_identities('sales-erp-replacement') identity on identity.variant_id=variant.id
 where variant.good_id='sales-erp-replacement' order by variant.id;
select 1 / case when exists(
 select 1 from public.admin_list_goods_variant_external_identities('sales-erp-replacement') identity
 join public.goods_variants variant on variant.id=identity.variant_id
 where variant.archived_at is null and variant.is_default
   and identity.erp_code='000047299' and identity.barcode='0088047299'
) and not exists(
 select 1 from public.admin_list_goods_variant_external_identities('sales-erp-replacement')
 where variant_id='00000000-0000-0000-0000-000000047299' and erp_code is not null
) then 1 else 0 end as assert_recreated_option_owns_its_external_identity;
select public.admin_set_goods_variant_active('sales-erp-replacement',id,false,updated_at)
 from public.goods_variants where good_id='sales-erp-replacement' and archived_at is null;
select public.admin_save_good('{"id":"sales-erp-replacement","previous_id":"sales-erp-replacement","ip_id":"sales-erp","name":"ERP 옵션 재생성","price":1000,"variant_baseline":[],"variants":[{"name":"중지 상태로 새로 등록","attributes":{},"extraPrice":0,"stockQty":0,"isActive":false,"externalIdentity":{"erpCode":"000047298","erpName":"새 중지 옵션","barcode":"0088047298"}}]}');
select 1 / case when exists(
 select 1 from public.admin_list_goods_variant_external_identities('sales-erp-replacement') identity
 join public.goods_variants variant on variant.id=identity.variant_id
 where variant.archived_at is not null and variant.is_default and identity.erp_code='000047298'
) and exists(
 select 1 from public.admin_list_goods_variant_external_identities('sales-erp-replacement') where erp_code='000047299'
) then 1 else 0 end as assert_new_stopped_option_owns_its_external_identity;
select public.admin_save_good('{"id":"sales-erp-replacement","previous_id":"sales-erp-replacement","ip_id":"sales-erp","name":"ERP 옵션 재생성","price":1000,"variant_baseline":[],"variants":[{"id":"00000000-0000-0000-0000-000000047299","name":"기존 중지 옵션 명시","attributes":{},"extraPrice":0,"stockQty":0,"expectedStockQty":0,"isActive":false,"externalIdentity":{"erpCode":"000047297","erpName":"명시한 기존 옵션","barcode":"0088047297"}}]}');
select 1 / case when exists(
 select 1 from public.admin_list_goods_variant_external_identities('sales-erp-replacement') identity
 join public.goods_variants variant on variant.id=identity.variant_id
 where variant.id='00000000-0000-0000-0000-000000047299' and variant.archived_at is not null
   and identity.erp_code='000047297' and identity.barcode='0088047297'
) then 1 else 0 end as assert_explicit_stopped_option_identity_is_preserved;
rollback;
