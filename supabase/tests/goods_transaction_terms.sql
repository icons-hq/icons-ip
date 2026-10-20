\set ON_ERROR_STOP on
begin;
create function pg_temp.expect_transaction_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
select 1/case when not private.goods_volume_terms_valid('{"condition":null,"threshold":3,"discountKind":"fixed","discountValue":1,"startsAt":null,"endsAt":null}')
 and not private.goods_volume_terms_valid('{"condition":"quantity","threshold":"3","discountKind":"fixed","discountValue":1,"startsAt":null,"endsAt":null}')
 and not private.goods_volume_terms_valid('{"condition":"quantity","threshold":3,"discountKind":"fixed","discountValue":1,"startsAt":"2026-02-30T00:00:00Z","endsAt":"2026-04-01T00:00:00Z"}')
 and private.goods_volume_terms_valid('{"condition":"regular_subtotal","threshold":999999999999,"discountKind":"percent","discountValue":100,"startsAt":"2028-02-29T00:00:00.123456+09:00","endsAt":"2028-03-01T00:00:00.123456+09:00"}')
 and not private.goods_delivery_quantity_terms_valid('{"kind":"tier3","baseFee":3000,"firstLimit":2,"secondLimit":2,"extra1":1000,"extra2":2000}')
 and not private.goods_delivery_quantity_terms_valid('{"kind":"tier3","baseFee":3000,"firstLimit":2,"secondLimit":5,"extra1":2000,"extra2":1000}')
 then 1 else 0 end as assert_strict_terms;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('aa140000-0000-4000-8000-000000000001','authenticated','authenticated','transaction-admin@example.test',now(),'{}','{}',now(),now()),
 ('aa140000-0000-4000-8000-000000000002','authenticated','authenticated','transaction-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin',nickname='TEST 거래 관리자' where id='aa140000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('aa140000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key,published_at) values('transaction-terms-tests','TEST 거래','character',now());
insert into public.fulfillment_origins(id,code,name,base_fee,return_address,is_active)
 values('aa140000-0000-4000-8000-000000000010','transaction-terms-tests','TEST 출고지',3000,'TEST 합성 주소',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','aa140000-0000-4000-8000-000000000001',true);
select public.admin_save_good('{"id":"transaction-policy-good","ip_id":"transaction-terms-tests","name":"TEST 거래 상품","price":10000,"origin_id":"aa140000-0000-4000-8000-000000000010","variant_baseline":[],"variants":[{"name":"기본 옵션","attributes":{},"code":"TRANSACTION-TERMS-01","extraPrice":0,"stockQty":20}]}');
select updated_at as good_updated from public.goods where id='transaction-policy-good' \gset
select public.admin_get_good_transaction_terms('transaction-policy-good') as before_terms \gset
select 1/case when :'before_terms'::jsonb->>'revision'='0' and :'before_terms'::jsonb->'volume'='null'::jsonb then 1 else 0 end as assert_initial_off;
select public.admin_save_good_transaction_terms('transaction-policy-good',0,:'good_updated',
 '{"status":"draft","terms":null,"draftValues":{"threshold":"입력 중"}}',null,'aa140000-0000-4000-8000-000000000020','aa140000-0000-4000-8000-000000000001') as draft_receipt \gset
select 1/case when :'draft_receipt'::jsonb->>'revision'='1' and :'draft_receipt'::jsonb#>>'{volume,draftValues,threshold}'='입력 중'
 and :'draft_receipt'::jsonb->'delivery'='null'::jsonb then 1 else 0 end as assert_draft_partial_preserved;
select 1/case when public.admin_save_good_transaction_terms('transaction-policy-good',0,:'good_updated',
 '{"status":"draft","terms":null,"draftValues":{"threshold":"입력 중"}}',null,'aa140000-0000-4000-8000-000000000020','aa140000-0000-4000-8000-000000000001')=:'draft_receipt'::jsonb then 1 else 0 end as assert_original_receipt_replay;
select pg_temp.expect_transaction_error(format('select public.admin_save_good_transaction_terms(%L,0,%L,null,null,%L,%L)',
 'transaction-policy-good',:'good_updated','aa140000-0000-4000-8000-000000000021','aa140000-0000-4000-8000-000000000001'),'goods_transaction_terms_changed');
select pg_temp.expect_transaction_error(format('select public.admin_save_good_transaction_terms(%L,1,%L,null,null,%L,%L)',
 'transaction-policy-good',(:'draft_receipt'::jsonb->>'goodUpdatedAt'),'aa140000-0000-4000-8000-000000000022','aa140000-0000-4000-8000-000000000002'),'auth_context_changed');
select pg_temp.expect_transaction_error(format('select public.admin_save_good_transaction_terms(%L,1,%L,%L,null,%L,%L)',
 'transaction-policy-good',(:'draft_receipt'::jsonb->>'goodUpdatedAt'),'{"status":"active","terms":{"condition":"quantity","threshold":3,"discountKind":"fixed","discountValue":1000,"startsAt":null,"endsAt":null},"draftValues":{}}',
 'aa140000-0000-4000-8000-000000000023','aa140000-0000-4000-8000-000000000001'),'checkout_contract_upgrade_required');
reset role;
update private.goods_transaction_runtime set enabled=true where singleton;
set local role authenticated;
select public.admin_save_good_transaction_terms('transaction-policy-good',1,(:'draft_receipt'::jsonb->>'goodUpdatedAt')::timestamptz,
 '{"status":"active","terms":{"condition":"quantity","threshold":3,"discountKind":"fixed","discountValue":1000,"startsAt":null,"endsAt":null},"draftValues":{}}',null,
 'aa140000-0000-4000-8000-000000000024','aa140000-0000-4000-8000-000000000001') as active_receipt \gset
select public.admin_save_good_transaction_terms('transaction-policy-good',2,(:'active_receipt'::jsonb->>'goodUpdatedAt')::timestamptz,null,null,
 'aa140000-0000-4000-8000-000000000025','aa140000-0000-4000-8000-000000000001') as unchanged_receipt \gset
select 1/case when :'unchanged_receipt'::jsonb->>'revision'='2' and :'unchanged_receipt'::jsonb->>'changed'='false'
 and :'unchanged_receipt'::jsonb->'volume'=:'active_receipt'::jsonb->'volume' then 1 else 0 end as assert_null_omission_preserves;
select pg_temp.expect_transaction_error(format('select public.admin_save_good_transaction_terms(%L,2,%L,null,%L,%L,%L)',
 'transaction-policy-good',(:'active_receipt'::jsonb->>'goodUpdatedAt'),'{"status":"active","paymentMode":"collect","quantityTerms":null,"draftValues":{}}',
 'aa140000-0000-4000-8000-000000000026','aa140000-0000-4000-8000-000000000001'),'collect_contract_not_ready');
select public.admin_save_shipping_collect_contract('aa140000-0000-4000-8000-000000000010',0,'active',
 '{"collectorName":"TEST 수납사","collectionMethod":"TEST 배송 시 지급","refundContact":"TEST 환급담당","customerInstructions":"TEST 합성 계약","contractReference":"TEST 계약","dispatchMappingReference":"TEST 인계","receiptReference":"TEST 영수증","disputeContact":"TEST 분쟁담당"}',
 'aa140000-0000-4000-8000-000000000030','aa140000-0000-4000-8000-000000000001') as contract_receipt \gset
select public.admin_save_good_transaction_terms('transaction-policy-good',2,(:'active_receipt'::jsonb->>'goodUpdatedAt')::timestamptz,null,
 '{"status":"active","paymentMode":"collect","quantityTerms":{"kind":"repeat","baseFee":3000,"interval":2},"draftValues":{}}',
 'aa140000-0000-4000-8000-000000000031','aa140000-0000-4000-8000-000000000001') as delivery_receipt \gset
select 1/case when :'delivery_receipt'::jsonb->>'revision'='3' and :'delivery_receipt'::jsonb#>>'{delivery,paymentMode}'='collect'
 and :'delivery_receipt'::jsonb->'volume'=:'active_receipt'::jsonb->'volume' then 1 else 0 end as assert_collect_contract_and_partial_preservation;
reset role;
select pg_temp.expect_transaction_error($q$update private.goods_volume_discount_versions set terms=terms||'{"discountValue":2000}' where good_id='transaction-policy-good'$q$,'transaction_terms_immutable');
select pg_temp.expect_transaction_error($q$delete from private.goods_delivery_versions where good_id='transaction-policy-good'$q$,'transaction_terms_immutable');
select 1/case when not has_table_privilege('authenticated','private.goods_transaction_configs','SELECT,INSERT,UPDATE,DELETE')
 and not has_table_privilege('service_role','private.goods_transaction_configs','SELECT,INSERT,UPDATE,DELETE')
 and not has_function_privilege('anon','public.admin_get_good_transaction_terms(text)','execute')
 and not has_function_privilege('authenticated','private.lock_goods_transaction_source(uuid,jsonb)','execute')
 and not has_function_privilege('service_role','private.lock_goods_transaction_source(uuid,jsonb)','execute')
 then 1 else 0 end as assert_private_acl;
select private.lock_goods_transaction_source('aa140000-0000-4000-8000-000000000002','{"kind":"cart","id":"aa140000-0000-4000-8000-000000000002","revision":"TEST"}');
select pg_temp.expect_transaction_error($q$select private.lock_goods_transaction_source('aa140000-0000-4000-8000-000000000002','{"kind":"cart","id":"aa140000-0000-4000-8000-000000000001","revision":"TEST"}')$q$,'transaction_source_forbidden');
set local role authenticated;
select set_config('request.jwt.claim.sub','aa140000-0000-4000-8000-000000000002',true);
select pg_temp.expect_transaction_error($q$select public.admin_get_good_transaction_terms('transaction-policy-good')$q$,'operator_capability_required');
rollback;
