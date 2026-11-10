\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql. Transaction rolls back every fixture.
begin;
create function pg_temp.expect_period_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('a5e06400-0000-4000-8000-000000000001','authenticated','authenticated','sale-period-admin@example.test',now(),'{}','{}',now(),now()),
 ('a5e06400-0000-4000-8000-000000000002','authenticated','authenticated','sale-period-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin',nickname='기간관리' where id='a5e06400-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('a5e06400-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
update public.profiles set nickname='기간구매',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id='a5e06400-0000-4000-8000-000000000002';
insert into public.ips(id,title,vertical_key,published_at) values('sale-period-tests','기간 검증','character',now());
insert into public.fulfillment_origins(id,code,name,base_fee,return_address,is_active) values('a5e06400-0000-4000-8000-000000000010','sale-period-tests','합성 출고지',0,'합성 주소',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','a5e06400-0000-4000-8000-000000000001',true);
select public.admin_save_good(jsonb_build_object('id','sale-period-good','ip_id','sale-period-tests','name','기간 상품','price',10000,'origin_id','a5e06400-0000-4000-8000-000000000010',
 'variant_baseline','[]'::jsonb,'variants','[{"name":"기본 옵션","attributes":{},"code":"SALE-PERIOD-01","extraPrice":0,"stockQty":20}]'::jsonb,
 'sale_period',jsonb_build_object('startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour','expectedRevision',0)));
select public.admin_save_good('{"id":"sale-period-preorder","ip_id":"sale-period-tests","name":"예약 상품","price":10000,"variant_baseline":[],"variants":[{"name":"기본 옵션","attributes":{},"code":"SALE-PERIOD-PRE","extraPrice":0,"stockQty":0}]}');
select id as variant from public.goods_variants where good_id='sale-period-good' \gset
select id as pre_variant from public.goods_variants where good_id='sale-period-preorder' \gset
select public.admin_save_good('{"id":"sale-period-good","previous_id":"sale-period-good","ip_id":"sale-period-tests","name":"기간 상품","price":10000}');
select 1/case when (select sale_starts_at=now()-interval '1 hour' and sale_period_revision=1 from public.goods where id='sale-period-good') then 1 else 0 end as assert_legacy_omission_preserves_period;
select pg_temp.expect_period_error($q$select public.admin_save_good('{"id":"sale-period-good","previous_id":"sale-period-good","ip_id":"sale-period-tests","name":"기간 상품","price":10000,"sale_period":{"startsAt":null,"endsAt":null,"expectedRevision":0}}')$q$,'goods_sale_period_changed');
select pg_temp.expect_period_error($q$select public.admin_save_good('{"id":"sale-period-good","previous_id":"sale-period-good","ip_id":"sale-period-tests","name":"기간 상품","price":10000,"sale_period":{"startsAt":null,"endsAt":null,"expectedRevision":1,"extra":true}}')$q$,'invalid_goods_sale_period');
select public.admin_clone_good('a5e06400-0000-4000-8000-000000000003','sale-period-good','sale-period-clone','SALE-PERIOD-COPY','기간 복사');
select 1/case when (select sale_starts_at is null and sale_ends_at is null and sale_period_revision=0 and published_at is null from public.goods where id='sale-period-clone') then 1 else 0 end as assert_clone_resets_window_and_publication;
select pg_temp.expect_period_error(format('select public.admin_save_goods_preorder(%L,%L,null,%L::jsonb)', 'sale-period-good',:'variant',
 jsonb_build_object('state','active','capacityQty',2,'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour','expectedShipDate',current_date+5,'approvalReference','TEST-ONLY 기간 충돌')::text),'goods_sale_period_preorder_conflict');
select public.admin_save_goods_preorder('sale-period-preorder',:'pre_variant',null,jsonb_build_object('state','active','capacityQty',2,'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour','expectedShipDate',current_date+5,'approvalReference','TEST-ONLY 예약 기간'));
select pg_temp.expect_period_error(format('select public.admin_save_good(%L::jsonb)',jsonb_build_object('id','sale-period-preorder','previous_id','sale-period-preorder','ip_id','sale-period-tests','name','예약 상품','price',10000,
 'sale_period',jsonb_build_object('startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour','expectedRevision',0))::text),'goods_sale_period_preorder_conflict');
reset role;
select set_config('request.jwt.claim.sub','',true);
-- The normal KC fixture reviewer gets an explicit scoped operator membership.
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at) values(('47c47700'||left(md5('sale-period-good'),24))::uuid,'authenticated','authenticated','sale-period-kc@example.test','{"testFixture":"goods-kc"}',now(),now());
insert into private.operator_memberships(profile_id,manager_role) values(('47c47700'||left(md5('sale-period-good'),24))::uuid,'primary');
select public.service_prepare_admin_artwork_upload('a5e06400-0000-4000-8000-000000000001','catalog/good/a5e06400-0000-4000-8000-000000000099.webp','good','image/webp',100,now()+interval '10 minutes');
select public.service_begin_admin_artwork_verification('a5e06400-0000-4000-8000-000000000001','catalog/good/a5e06400-0000-4000-8000-000000000099.webp');
select public.service_verify_admin_artwork_upload('a5e06400-0000-4000-8000-000000000001','catalog/good/a5e06400-0000-4000-8000-000000000099.webp',100);
select set_config('request.jwt.claim.sub','a5e06400-0000-4000-8000-000000000001',true);
update public.goods set type='문구',image_path='public-media/catalog/good/a5e06400-0000-4000-8000-000000000099.webp',notice_maker='합성',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026-10',notice_as_manager='합성 CS',notice_as_contact='02-0000' where id='sale-period-good';
select set_config('request.jwt.claim.sub','',true);
select pg_temp.publish_goods_kc_fixture('sale-period-good');
select 1/case when (select available_qty from private.resolve_goods_variant_supply(:'variant',now()-interval '1 hour'))=20
 and (select available_qty from private.resolve_goods_variant_supply(:'variant',now()+interval '1 hour'))=0
 and (select stock_qty from public.goods_variants where id=:'variant')=20 then 1 else 0 end as assert_start_inclusive_end_exclusive_inventory_unchanged;
set local role authenticated;
select set_config('request.jwt.claim.sub','a5e06400-0000-4000-8000-000000000002',true);
select public.set_cart_item_quantity('sale-period-good',:'variant',1);
set local role service_role;
select public.place_order('a5e06400-0000-4000-8000-000000000002'::uuid,'{"recipientName":"합성 수취인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}'::jsonb,'a5e06400-0000-4000-8000-000000000021'::uuid,'card') as order_id \gset
set local role authenticated;
reset role;
select public.prepare_goods_payment_attempt('a5e06400-0000-4000-8000-000000000002',:'order_id','toss')->>'id' as attempt_id \gset
select public.bind_goods_payment_callback_nonce(:'attempt_id',repeat('e',64));
select provider_order_id from public.payment_attempts where id=:'attempt_id' \gset
select public.claim_goods_payment_attempt('toss',:'provider_order_id',repeat('e',64),'a5e06400-0000-4000-8000-000000000031');
update public.goods set sale_starts_at=now()-interval '2 hours',sale_ends_at=now()-interval '1 hour' where id='sale-period-good';
select 1/case when (select public.goods_sale_period(g)->>'state' from public.goods g where id='sale-period-good')='ended'
 and (select public.goods_sale_period(jsonb_populate_record(null::public.goods,to_jsonb(g)||'{"sale_starts_at":null,"sale_ends_at":null}'::jsonb))->>'state' from public.goods g where id='sale-period-good')='ended'
 then 1 else 0 end as assert_public_calculation_reloads_trusted_row;
set local role anon;
select 1/case when exists(select 1 from public.goods where id='sale-period-good') then 1 else 0 end as assert_ended_good_remains_browsable;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','a5e06400-0000-4000-8000-000000000002',true);
select 1/case when not (public.quote_goods_sales(jsonb_build_array(jsonb_build_object('goodId','sale-period-good','variantId',:'variant','qty',1)))#>>'{lines,0,available}')::boolean then 1 else 0 end as assert_quote_closes_ended_good;
select pg_temp.expect_period_error(format('select public.set_cart_item_quantity(%L,%L,1)','sale-period-good',:'variant'),'out of stock');
set local role service_role;
select 1/case when public.place_order('a5e06400-0000-4000-8000-000000000002'::uuid,'{"recipientName":"합성 수취인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}'::jsonb,'a5e06400-0000-4000-8000-000000000021'::uuid,'card')=:'order_id'::uuid then 1 else 0 end as assert_ended_idempotent_checkout_replay;
set local role authenticated;
reset role;
select 1/case when public.finalize_goods_payment_attempt(:'attempt_id','a5e06400-0000-4000-8000-000000000031','unknown')='unknown' then 1 else 0 end as assert_existing_claim_can_record_unknown_after_end;
select public.claim_goods_payment_reconciliation(:'attempt_id','a5e06400-0000-4000-8000-000000000032','case_sale_period_expired');
select 1/case when public.finalize_goods_payment_reconciliation(:'attempt_id','a5e06400-0000-4000-8000-000000000032','approved',null,'TEST-PERIOD-APPROVED')='approved' then 1 else 0 end as assert_already_approved_money_can_finalize_after_end;
select 1/case when (select status='paid' from public.orders where id=:'order_id') then 1 else 0 end as assert_reconciled_paid_readback;
select 1/case when public.claim_goods_payment_attempt('toss',:'provider_order_id',repeat('e',64),'a5e06400-0000-4000-8000-000000000033')->>'claim_status'='terminal' then 1 else 0 end as assert_terminal_callback_replay_after_end;
-- New unpaid order: preparation and a still-prepared callback must both close.
update public.goods set sale_starts_at=now()-interval '1 hour',sale_ends_at=now()+interval '1 hour' where id='sale-period-good';
set local role authenticated;
select public.set_cart_item_quantity('sale-period-good',:'variant',1);
set local role service_role;
select public.place_order('a5e06400-0000-4000-8000-000000000002'::uuid,'{"recipientName":"합성 수취인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}'::jsonb,'a5e06400-0000-4000-8000-000000000022'::uuid,'card') as unpaid_order \gset
set local role authenticated;
reset role;
select public.prepare_goods_payment_attempt('a5e06400-0000-4000-8000-000000000002',:'unpaid_order','toss')->>'id' as unpaid_attempt \gset
select public.bind_goods_payment_callback_nonce(:'unpaid_attempt',repeat('f',64));
select provider_order_id as unpaid_provider_id from public.payment_attempts where id=:'unpaid_attempt' \gset
update public.goods set sale_starts_at=now()-interval '2 hours',sale_ends_at=now()-interval '1 hour' where id='sale-period-good';
select pg_temp.expect_period_error(format('select public.prepare_goods_payment_attempt(%L,%L,%L)','a5e06400-0000-4000-8000-000000000002',:'unpaid_order','toss'),'goods_sale_not_open');
select pg_temp.expect_period_error(format('select public.claim_goods_payment_attempt(%L,%L,%L,%L)','toss',:'unpaid_provider_id',repeat('f',64),'a5e06400-0000-4000-8000-000000000034'),'goods_sale_not_open');
select 1/case when (select state='prepared' from public.payment_attempts where id=:'unpaid_attempt')
 and not has_function_privilege('authenticated','private.assert_goods_sale_period(text)','execute')
 and not has_function_privilege('service_role','private.assert_order_goods_sale_period(uuid)','execute')
 and not has_function_privilege('anon','public.admin_save_good(jsonb)','execute') then 1 else 0 end as assert_rejected_claim_rolls_back_and_helpers_sealed;
-- An existing bank-transfer order retains the deposit deadline it already showed.
update public.goods set sale_starts_at=now()-interval '1 hour',sale_ends_at=now()+interval '1 hour' where id='sale-period-good';
set local role authenticated;
select set_config('request.jwt.claim.sub','a5e06400-0000-4000-8000-000000000002',true);
select public.set_cart_item_quantity('sale-period-good',:'variant',1);
set local role service_role;
select public.place_order('a5e06400-0000-4000-8000-000000000002'::uuid,'{"recipientName":"합성 수취인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}'::jsonb,'a5e06400-0000-4000-8000-000000000023'::uuid,'bank_transfer') as bank_order \gset
set local role authenticated;
reset role;
update public.goods set sale_starts_at=now()-interval '2 hours',sale_ends_at=now()-interval '1 hour' where id='sale-period-good';
set local role authenticated;
select set_config('request.jwt.claim.sub','a5e06400-0000-4000-8000-000000000001',true);
select 1/case when public.admin_confirm_bank_transfer_deposit(:'bank_order','TEST-ONLY 기간 종료 후 이미 안내한 합성 입금')='approved' then 1 else 0 end as assert_existing_bank_deposit_can_finish_after_period;
reset role;
select 1/case when (select status='paid' from public.orders where id=:'bank_order') then 1 else 0 end as assert_existing_bank_deposit_paid_readback;
rollback;
