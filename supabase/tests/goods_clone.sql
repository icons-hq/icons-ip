\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','',true);

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
  ('00000000-0000-4000-8000-000000047491', 'authenticated', 'authenticated', 'goods-clone-staff-0479@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000047492', 'authenticated', 'authenticated', 'goods-clone-buyer-0479@example.test', now(), '{}', '{}', now(), now());
update public.profiles set role = 'staff' where id = '00000000-0000-4000-8000-000000047491';
update public.profiles set nickname = '복제 검증 구매자', birth_date = '2000-01-01', onboarded_at = now(), consents = '{"terms":true,"privacy":true}'
where id = '00000000-0000-4000-8000-000000047492';
insert into public.verticals(key, label, color) values ('goods-clone-0479', '상품 복제 검증', '#000000');
insert into public.ips(id, title, vertical_key) values ('goods-clone-0479', '상품 복제 검증', 'goods-clone-0479');
insert into public.catalog_categories(id, code, name, sort_order)
values ('00000000-0000-4000-8000-000000047901', 'clone-category-0479', '복제 검증 카테고리', 1);
insert into public.shipping_notice_templates(
  code, version, name, shipping_notice, return_exchange_notice, cs_name, cs_phone, cs_email, confirmation_evidence, status
) values (
  'clone-notice-0479', 1, '복제 검증 배송 안내', '배송 안내 원문', '교환 반품 원문', 'ICONS', '02-0000-0479', 'clone@example.test', '검증 근거', 'draft'
) returning id as notice_template_id \gset

set local session authorization postgres;
insert into public.goods(
  id, code, ip_id, name, type, price, compare_at_price, badge, stock, bg, image_path,
  notice_maker, notice_origin, notice_material, notice_size, notice_made_on, notice_as_manager, notice_as_contact,
  description, gallery_paths, detail_image_path, name_en, search_keywords, category_id
) values (
  'source-good-0479', 'SRC-0479', 'goods-clone-0479', '원본 복제 상품', '문구', 1000, 1500, 'NEW', 'ok', '#fff',
  'public-media/goods-clone-0479/main.webp',
  '제조사', '한국', '종이', 'A5', '2026-09', 'CS', '02-0000',
  '원본 설명', '{"public-media/goods-clone-0479/gallery-1.webp"}'::text[], 'public-media/goods-clone-0479/detail.webp',
  'Source Clone Good', '{"복제","원본"}', '00000000-0000-4000-8000-000000047901'
);
update public.goods
set shipping_notice_template_id = :'notice_template_id'::uuid,
    shipping_notice_template_version = 1,
    shipping_notice_snapshot = '{"code":"clone-notice-0479","version":1,"shippingNotice":"배송 안내 원문","returnExchangeNotice":"교환 반품 원문","csName":"ICONS","csPhone":"02-0000-0479","csEmail":"clone@example.test"}'::jsonb
where id = 'source-good-0479';

update public.goods set shipping_fee_type='individual',individual_fee=4300,allow_card_payment=false,allow_bank_transfer=true,
 sale_restriction='adult',order_quantity_limit_enabled=true,min_order_qty=1,max_order_qty=3,
 member_purchase_limit_enabled=true,member_lifetime_qty_limit=5,claim_return_fee=0,claim_return_free_shipping_fee=4000,claim_exchange_fee=5000
 where id='source-good-0479';
select id as source_default_variant from public.goods_variants where good_id = 'source-good-0479' and is_default \gset
update public.goods_variants
set name = '기본 옵션', attributes = '{"색상":"검정"}'::jsonb, stock_qty = 5
where id = :'source_default_variant'::uuid;
insert into public.goods_variants(good_id, name, attributes, price, stock_qty, sort_order, is_default)
values ('source-good-0479', '추가 옵션', '{"색상":"흰색"}'::jsonb, 1200, 7, 1, false)
returning id as source_extra_variant \gset
-- Stopped historical options can share attributes with the current option and
-- retain a price below today's base price. A complete copy must preserve both.
insert into public.goods_variants(good_id,name,attributes,price,stock_qty,sort_order,is_default,low_stock_threshold,archived_at)
 values('source-good-0479','중지 옵션','{"색상":"흰색"}',900,0,2,false,4,now())
 returning id as source_stopped_variant \gset

reset session authorization;
insert into private.goods_variant_external_identity(variant_id, erp_code, erp_name, barcode)
values (:'source_default_variant'::uuid, 'ERP-SRC-0479', '원본 ERP 품명', '880000047901');
insert into private.goods_variant_purchase_costs(variant_id, unit_cost_krw, tax_basis, revision, updated_by)
values (:'source_default_variant'::uuid, 300, 'included', 1, '00000000-0000-4000-8000-000000047491');
insert into private.goods_variant_price_periods(
  good_id, variant_id, state, regular_price, discount_price, starts_at, ends_at, created_by, updated_by
) values (
  'source-good-0479', :'source_default_variant'::uuid, 'draft', 1000, null, null, null,
  '00000000-0000-4000-8000-000000047491', '00000000-0000-4000-8000-000000047491'
);

insert into public.orders(id, user_id, status, total, address)
values ('00000000-0000-4000-8000-000000047993', '00000000-0000-4000-8000-000000047492', 'pending', 1000, '{}'::jsonb);
insert into public.order_items(order_id, good_id, qty, unit_price, variant_id,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select '00000000-0000-4000-8000-000000047993',id,1,1000,:'source_default_variant'::uuid,name,type,ip_id from public.goods where id='source-good-0479';

select count(*)::integer as source_variant_count,
       coalesce(sum(stock_qty), 0)::integer as source_stock_total
from public.goods_variants where good_id = 'source-good-0479' and archived_at is null \gset
select pg_temp.review_goods_kc_fixture('source-good-0479');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000047491', true);

select public.admin_clone_good(
  '00000000-0000-4000-8000-000000047981', 'source-good-0479', 'clone-good-0479', 'CLONE-0479', '복사 상품'
) as first_result \gset
select (:'first_result'::jsonb ->> 'id') as first_clone_id \gset
select (:'first_result'::jsonb ->> 'code') as first_clone_code \gset
select 1/case when public.admin_read_goods_kc('source-good-0479')->>'status'='reviewed'
 and public.admin_read_goods_kc(:'first_clone_id')->>'status'='unreviewed'
 and public.admin_read_goods_kc(:'first_clone_id')->>'revision' is null
 and (select kc_disclosures='[]' from public.goods where id=:'first_clone_id')
 then 1 else 0 end as assert_clone_never_copies_kc_review_or_evidence;
select public.admin_clone_good(
  '00000000-0000-4000-8000-000000047981', 'source-good-0479', 'clone-good-0479', 'CLONE-0479', '복사 상품'
) as retry_result \gset

select 1 / case when (:'retry_result'::jsonb ->> 'id') = :'first_clone_id'
  and (:'retry_result'::jsonb ->> 'code') = :'first_clone_code'
  and (select count(*) from public.goods where id = :'first_clone_id') = 1
  and (select count(*) from public.audit_log where id = '00000000-0000-4000-8000-000000047981' and action = 'admin.catalog.good.cloned') = 1
then 1 else 0 end as assert_clone_retry_is_idempotent;

select 1 / case when exists(
    select 1 from public.goods as clone
    where clone.id = :'first_clone_id'
      and clone.code = 'CLONE-0479'
      and clone.name = '복사 상품'
      and clone.ip_id = 'goods-clone-0479'
      and clone.type = '문구'
      and clone.price = 1000
      and clone.compare_at_price = 1500
      and clone.image_path = 'public-media/goods-clone-0479/main.webp'
      and clone.description = '원본 설명'
      and clone.detail_image_path = 'public-media/goods-clone-0479/detail.webp'
      and clone.category_id = '00000000-0000-4000-8000-000000047901'
      and clone.published_at is null
      and clone.first_published_at is null
      and clone.archived_at is null
      and clone.stock_qty = 0
      and clone.shipping_fee_type='individual' and clone.individual_fee=4300
      and clone.allow_card_payment=false and clone.allow_bank_transfer=true and clone.sale_restriction='adult'
      and clone.order_quantity_limit_enabled and clone.min_order_qty=1 and clone.max_order_qty=3
      and clone.member_purchase_limit_enabled and clone.member_lifetime_qty_limit=5
      and clone.claim_return_fee=0 and clone.claim_return_free_shipping_fee=4000 and clone.claim_exchange_fee=5000
      and clone.shipping_notice_template_id = :'notice_template_id'::uuid
      and clone.shipping_notice_snapshot->>'shippingNotice' = '배송 안내 원문'
  ) then 1 else 0 end as assert_clone_safe_metadata_and_draft_state;

select pg_temp.expect_error($sql$
  select public.admin_save_good('{"id":"not-a-clone-0479","ip_id":"goods-clone-0479","name":"무단 이미지 재사용","type":"문구","price":1000,"stock":"ok","image_path":"public-media/goods-clone-0479/main.webp"}'::jsonb)
$sql$,'unverified_artwork','23514');
select pg_temp.expect_error($sql$
  select public.admin_clone_good('00000000-0000-4000-8000-000000047985','source-good-0479','clone-good-0479','CLONE-ID-DUP','중복 URL')
$sql$,'catalog_id_taken','23505');

-- The private ERP/cost/price tables intentionally have no authenticated
-- privileges. Keep the API caller above for the RPC checks, then inspect the
-- private rows as the test owner so the assertions do not weaken production
-- ACLs.
reset role;
select 1 / case when
  (select count(*) from public.goods_variants where good_id = :'first_clone_id' and archived_at is null) = :'source_variant_count'::integer
  and (select coalesce(sum(stock_qty), 0) from public.goods_variants where good_id = :'first_clone_id') = 0
  and not exists(select 1 from public.goods_variants where good_id = :'first_clone_id' and code in ('SRC-0479-01','SRC-0479-02'))
  and not exists(select 1 from private.goods_variant_external_identity identity where identity.variant_id in (select id from public.goods_variants where good_id = :'first_clone_id'))
  and not exists(select 1 from private.goods_variant_purchase_costs cost where cost.variant_id in (select id from public.goods_variants where good_id = :'first_clone_id'))
  and not exists(select 1 from private.goods_variant_price_periods period where period.good_id = :'first_clone_id')
then 1 else 0 end as assert_clone_options_reset_inventory_and_external_state;
select 1/case when exists(select 1 from public.goods_variants
 where good_id=:'first_clone_id' and name='중지 옵션' and attributes='{"색상":"흰색"}'
 and price=900 and low_stock_threshold=4 and stock_qty=0 and archived_at is not null
 and not is_default and id<>:'source_stopped_variant'::uuid)
 and (select count(*) from public.goods_variants where good_id=:'first_clone_id')=3
 then 1 else 0 end as assert_clone_keeps_stopped_configuration_without_reactivation;

select 1 / case when
  (select count(*) from public.goods_variants where good_id = 'source-good-0479' and archived_at is null) = :'source_variant_count'::integer
  and (select coalesce(sum(stock_qty), 0) from public.goods_variants where good_id = 'source-good-0479') = :'source_stock_total'::integer
  and (select count(*) from private.goods_variant_external_identity identity where identity.variant_id = :'source_default_variant'::uuid and identity.erp_code = 'ERP-SRC-0479' and identity.barcode = '880000047901') = 1
  and (select count(*) from private.goods_variant_purchase_costs cost where cost.variant_id = :'source_default_variant'::uuid and cost.unit_cost_krw = 300 and cost.tax_basis = 'included' and cost.revision = 1) = 1
  and (select count(*) from private.goods_variant_price_periods period where period.good_id = 'source-good-0479' and period.variant_id = :'source_default_variant'::uuid and period.state = 'draft') = 1
  and (select count(*) from public.order_items where order_id = '00000000-0000-4000-8000-000000047993' and good_id = 'source-good-0479') = 1
  and (select count(*) from public.goods where id = 'source-good-0479' and name = '원본 복제 상품' and stock_qty = :'source_stock_total'::integer) = 1
then 1 else 0 end as assert_source_and_order_history_are_unchanged;
-- A stopped default option can also retain a price below today's base price.
update public.goods_variants set archived_at=now(),price=800 where id=:'source_default_variant';
select public.admin_clone_good('00000000-0000-4000-8000-000000047988','source-good-0479','clone-stopped-default-0479','CLONE-STOPPED-0479','기본 중지 복사') as stopped_default_result \gset
select 1/case when exists(select 1 from public.goods_variants
 where good_id='clone-stopped-default-0479' and is_default and archived_at is not null and price=800 and stock_qty=0)
 and (select count(*) from public.goods_variants where good_id='clone-stopped-default-0479')=3
 and exists(select 1 from public.audit_log where id='00000000-0000-4000-8000-000000047988'
   and diff->'copiedOptions' @> '[{"price":800,"active":false}]'::jsonb)
 then 1 else 0 end as assert_stopped_default_keeps_its_original_price_and_audit;

select pg_temp.expect_error($sql$
  select public.admin_clone_good('00000000-0000-4000-8000-000000047982','source-good-0479','clone-conflict-0479','SRC-0479','코드 충돌')
$sql$, 'goods_code_key', '23505');
select 1 / case when not exists(select 1 from public.goods where id = 'clone-conflict-0479')
then 1 else 0 end as assert_code_collision_is_atomic;

select pg_temp.expect_error($sql$
  select public.admin_clone_good('00000000-0000-4000-8000-000000047981','source-good-0479','clone-other-0479','CLONE-OTHER','다른 요청')
$sql$, 'goods_clone_operation_conflict', '23505');

select set_config('request.jwt.claim.sub','',true);
insert into public.goods(id,ip_id,name,type,price,stock,archived_at) values('archived-source-0479','goods-clone-0479','보관 원본','문구',1000,'ok',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047491',true);
select pg_temp.expect_error($sql$
  select public.admin_clone_good('00000000-0000-4000-8000-000000047983','archived-source-0479','clone-archived-0479','CLONE-ARCHIVED','보관 복사')
$sql$, 'goods_clone_source_archived', '23514');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000047492', true);
select pg_temp.expect_error($sql$
  select public.admin_clone_good('00000000-0000-4000-8000-000000047984','source-good-0479','clone-buyer-0479','CLONE-BUYER','비허용 복사')
$sql$, 'forbidden', '42501');

select 1 / case when not has_function_privilege('anon', 'public.admin_clone_good(uuid,text,text,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_clone_good(uuid,text,text,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_clone_good(uuid,text,text,text,text)', 'execute')
then 1 else 0 end as assert_clone_rpc_acl;

reset role;
select 1 / case when not exists(select 1 from private.goods_artwork_copy_authorizations) then 1 else 0 end as assert_copy_authorization_does_not_escape_transaction;
rollback;
