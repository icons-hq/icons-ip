\set ON_ERROR_STOP on
begin;
create function pg_temp.st_id(n integer) returns uuid language sql immutable as $$select ('a7150000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.st_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'shipping template assertion: %',label;end if;raise notice 'PASS %',label;end $$;
create function pg_temp.st_error(q text,wanted text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if position(wanted in sqlerrm)>0 then raise notice 'PASS rejected %',wanted;return;end if;raise;end;
 raise exception 'Expected error: %',wanted;
end $$;
create function pg_temp.st_auth(actor integer default 1,session integer default 11) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.st_id(actor)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.st_id(actor),'role','authenticated','session_id',pg_temp.st_id(session))::text,true);
end $$;
create function pg_temp.st_policy(status text default 'active',mode text default 'collect',kind text default 'tier3') returns jsonb language sql immutable as $$
 select jsonb_build_object('status',status,'paymentMode',mode,'draftValues','{}'::jsonb,'quantityTerms',case kind
  when 'repeat' then '{"kind":"repeat","baseFee":3000,"interval":2}'::jsonb
  when 'tier2' then '{"kind":"tier2","baseFee":3000,"firstLimit":2,"extra1":1000}'::jsonb
  else '{"kind":"tier3","baseFee":3000,"firstLimit":2,"secondLimit":5,"extra1":1000,"extra2":2500}'::jsonb end);
$$;
create function pg_temp.st_settings(directive jsonb default null,origin integer default 102,fee text default 'free') returns jsonb language sql immutable as $$
 select jsonb_build_object('originId',pg_temp.st_id(origin),'feeType',fee,'individualFee',100,
  'claimPolicy',jsonb_build_object('returnAllowed',true,'exchangeAllowed',true,'restrictionReason',null,'returnFee',0,'returnFreeShippingFee',null,'exchangeFee',6000))
  ||case when directive is null then '{}'::jsonb else jsonb_build_object('delivery',directive) end;
$$;
create function pg_temp.st_context(operation integer,command text default 'apply',template integer default 201,revision integer default 1,
 actor integer default 1,session integer default 11) returns jsonb language sql immutable as $$
 select jsonb_build_object('operationId',pg_temp.st_id(operation),'command',command,'templateId',pg_temp.st_id(template),
  'expectedRevision',revision,'expectedActorId',pg_temp.st_id(actor),'expectedSessionId',pg_temp.st_id(session));
$$;
create function pg_temp.st_save(operation integer,template integer,settings jsonb,revision integer default 0) returns jsonb language sql immutable as $$
 select pg_temp.st_context(operation,'save',template,revision)||jsonb_build_object('name','TEST 배송 템플릿 '||template,'enabled',true,'settings',settings);
$$;
create function pg_temp.st_apply(operation integer,preview jsonb) returns jsonb language sql immutable as $$
 select jsonb_build_object('operationId',pg_temp.st_id(operation),'command','apply','templateId',preview#>'{template,id}',
  'expectedRevision',preview#>'{template,revision}','expectedActorId',preview->'actorId','expectedSessionId',preview->'sessionId',
  'originUpdatedAt',preview#>'{origin,updatedAt}','collectRevision',preview#>'{origin,collectRevision}','collectVersionId',preview#>'{origin,collectVersionId}',
  'goods',(select jsonb_agg(value-array['name','code','editable','blocker','before','after','effectiveBefore','effectiveAfter'] order by value->>'id') from jsonb_array_elements(preview->'goods')));
$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.st_id(n),'authenticated','authenticated','shipping-delivery-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,3)n;
update public.profiles set role=case when id=pg_temp.st_id(1) then 'admin'::public.user_role else 'staff'::public.user_role end
 where id in(pg_temp.st_id(1),pg_temp.st_id(2));
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.st_id(1),'primary'),(pg_temp.st_id(2),'deputy');
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
 values(pg_temp.st_id(11),pg_temp.st_id(1),now(),now(),now()+interval '1 hour'),(pg_temp.st_id(12),pg_temp.st_id(2),now(),now(),now()+interval '1 hour'),
 (pg_temp.st_id(13),pg_temp.st_id(1),now(),now(),now()+interval '1 hour'),(pg_temp.st_id(14),pg_temp.st_id(1),now(),now(),now()-interval '1 hour'),
 (pg_temp.st_id(15),pg_temp.st_id(3),now(),now(),now()+interval '1 hour');
insert into public.verticals(key,label,color) values('shipping-delivery-test','TEST 배송','#000');
insert into public.ips(id,title,vertical_key,published_at) values('shipping-delivery-ip','TEST 배송 IP','shipping-delivery-test',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active) values
 (pg_temp.st_id(101),'shipping-delivery-unready','TEST 수납 미준비','hanjin',3000,null,'TEST 반송주소',true),
 (pg_temp.st_id(102),'shipping-delivery-ready','TEST 수납 출고지','hanjin',3000,null,'TEST 반송주소',true),
 (pg_temp.st_id(103),'shipping-delivery-inactive','TEST 비활성','hanjin',3000,null,'TEST 반송주소',false);
insert into public.goods(id,code,ip_id,name,type,price,stock,origin_id,shipping_fee_type,individual_fee)
 select 'st-good-'||lpad(n::text,3,'0'),'ST-GOOD-'||lpad(n::text,3,'0'),'shipping-delivery-ip','TEST 상품 '||n,'문구',1000,'ok',pg_temp.st_id(102),'individual',100 from generate_series(1,101)n;
insert into public.goods(id,code,ip_id,name,type,price,stock,origin_id,shipping_fee_type,individual_fee)
 select id,upper(id),'shipping-delivery-ip','TEST 공유 상품','문구',1000,'ok',pg_temp.st_id(102),'individual',100 from unnest(array['st-family-owner','st-family-child','st-family-new'])id;
insert into public.orders(id,user_id,status,total,address) values(pg_temp.st_id(501),pg_temp.st_id(3),'pending',1000,'{}');
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.st_id(501),'st-good-001',id,1,1000,'TEST 기존 주문','문구','shipping-delivery-ip' from public.goods_variants where good_id='st-good-001' and is_default;
create temp table st_old_order as select to_jsonb(i) value from public.order_items i where order_id=pg_temp.st_id(501);
create temp table st_old_origins as select id,to_jsonb(o) value from public.fulfillment_origins o where id in(pg_temp.st_id(101),pg_temp.st_id(102),pg_temp.st_id(103));
select pg_temp.st_auth();
select private.bind_goods_aggregation('st-family-owner',array['st-family-child'],pg_temp.st_id(550),pg_temp.st_id(1));
update private.goods_transaction_runtime set enabled=true where singleton;
set local role authenticated;
select public.admin_save_shipping_collect_contract(pg_temp.st_id(102),0,'active',
 '{"collectorName":"TEST 수납사","collectionMethod":"TEST 배송 시 지급","refundContact":"TEST 환급담당","customerInstructions":"TEST 합성 계약","contractReference":"TEST 계약","dispatchMappingReference":"TEST 인계","receiptReference":"TEST 영수증","disputeContact":"TEST 분쟁담당"}',pg_temp.st_id(551),pg_temp.st_id(1));
select public.admin_save_good_transaction_terms('st-good-001',0,(select updated_at from public.goods where id='st-good-001'),
 '{"status":"active","terms":{"condition":"quantity","threshold":2,"discountKind":"fixed","discountValue":100,"startsAt":null,"endsAt":null},"draftValues":{}}',
 pg_temp.st_policy('active','buyer_choice','repeat'),pg_temp.st_id(552),pg_temp.st_id(1));
select public.admin_save_shipping_settings_template(pg_temp.st_id(201),0,'TEST legacy 무료',true,pg_temp.st_settings());
reset role;
create temp table st_original_versions as select to_jsonb(d) value from private.goods_delivery_versions d where good_id='st-good-001';
create temp table st_original_volume as select volume_version_id from private.goods_transaction_configs where good_id='st-good-001';
update private.goods_transaction_runtime set enabled=false where singleton;
-- SHIPPING_TEMPLATE_FIXTURE_END

set local role authenticated;
select pg_temp.st_auth();
select public.admin_preview_shipping_settings_template_v2(pg_temp.st_id(201),array['st-good-001'],pg_temp.st_id(1),pg_temp.st_id(11)) as legacy_preview \gset
select pg_temp.st_assert(:'legacy_preview'::jsonb->>'canApply'='true' and :'legacy_preview'::jsonb#>>'{goods,0,effectiveAfter,delivery,paymentMode}'='buyer_choice'
 and :'legacy_preview'::jsonb#>>'{goods,0,effectiveAfter,delivery,quantityTerms,kind}'='repeat'
 and :'legacy_preview'::jsonb#>>'{goods,0,after,feeType}'='free','legacy free preview discloses retained effective quantity and payment mode');
select public.admin_apply_shipping_settings_template_v2(pg_temp.st_apply(301,:'legacy_preview')) as legacy_receipt \gset
select pg_temp.st_assert(public.admin_apply_shipping_settings_template_v2(pg_temp.st_apply(301,:'legacy_preview'))=:'legacy_receipt'::jsonb,'exact legacy-preserving apply replay');
reset role;
select pg_temp.st_assert((select count(*)=1 from private.goods_delivery_versions where good_id='st-good-001')
 and (select volume_version_id from private.goods_transaction_configs where good_id='st-good-001')=(select volume_version_id from st_original_volume),
 'legacy directive omission preserves delivery version and volume pointer');
set local role authenticated;
select public.admin_save_shipping_settings_template_v2(pg_temp.st_save(302,202,pg_temp.st_settings(jsonb_build_object('mode','replace','policy',pg_temp.st_policy())))) as saved \gset
select 'SHIPPING_DTO:'||jsonb_build_object('kind','save','request',pg_temp.st_save(302,202,pg_temp.st_settings(jsonb_build_object('mode','replace','policy',pg_temp.st_policy()))),'value',:'saved'::jsonb)::text;
select pg_temp.st_assert(public.admin_save_shipping_settings_template_v2(pg_temp.st_save(302,202,pg_temp.st_settings(jsonb_build_object('mode','replace','policy',pg_temp.st_policy()))))=:'saved'::jsonb,'save replay does not increment template revision');
select pg_temp.st_assert(public.admin_read_shipping_settings_operation(pg_temp.st_context(302,'save',202,0))=:'saved'::jsonb
 and public.admin_seal_shipping_settings_operation(pg_temp.st_context(302,'save',202,0))=:'saved'::jsonb,'read and seal return the already saved receipt');
select pg_temp.st_error(format('select public.admin_save_shipping_settings_template_v2(%L)',pg_temp.st_save(302,202,pg_temp.st_settings())||'{"name":"다른 원문"}'),'shipping_settings_operation_conflict');
select pg_temp.st_error(format('select public.admin_apply_shipping_settings_template(%L,%L,1,%L,%L)',pg_temp.st_id(303),pg_temp.st_id(202),
 (:'legacy_preview'::jsonb#>>'{origin,updatedAt}'),jsonb_build_array(jsonb_build_object('id','st-good-003','updatedAt',(select updated_at from public.goods where id='st-good-003')))),
 'shipping_settings_preview_upgrade_required');
select public.admin_preview_shipping_settings_template_v2(pg_temp.st_id(202),array['st-good-001','st-good-002'],pg_temp.st_id(1),pg_temp.st_id(11)) as blocked_preview \gset
select pg_temp.st_assert(:'blocked_preview'::jsonb->>'canApply'='false' and :'blocked_preview'::jsonb#>>'{goods,0,blocker}'='checkout_contract_upgrade_required','template save does not activate runtime');
select pg_temp.st_error(format('select public.admin_apply_shipping_settings_template_v2(%L)',pg_temp.st_apply(304,:'blocked_preview')),'checkout_contract_upgrade_required');
reset role;
select pg_temp.st_assert(not exists(select 1 from private.shipping_settings_operations where operation_id=pg_temp.st_id(304))
 and not exists(select 1 from private.goods_transaction_configs where good_id='st-good-002'),'activation rejection rolls back all operation and product writes');
update private.goods_transaction_runtime set enabled=true where singleton;
set local role authenticated;
select public.admin_preview_shipping_settings_template_v2(pg_temp.st_id(202),array['st-good-001','st-good-002'],pg_temp.st_id(1),pg_temp.st_id(11)) as preview \gset
select 'SHIPPING_DTO:'||jsonb_build_object('kind','preview','value',:'preview'::jsonb)::text;
select pg_temp.st_assert(:'preview'::jsonb->>'canApply'='true','ready origin and runtime allow copy');
select public.admin_apply_shipping_settings_template_v2(pg_temp.st_apply(305,:'preview')) as applied \gset
select 'SHIPPING_DTO:'||jsonb_build_object('kind','apply','request',pg_temp.st_apply(305,:'preview'),'value',:'applied'::jsonb)::text;
select pg_temp.st_assert(:'applied'::jsonb->>'appliedCount'='2' and public.admin_apply_shipping_settings_template_v2(pg_temp.st_apply(305,:'preview'))=:'applied'::jsonb,'two-product copy is exact and idempotent');
reset role;
select pg_temp.st_assert((select volume_version_id from private.goods_transaction_configs where good_id='st-good-001')=(select volume_version_id from st_original_volume)
 and (select count(*)=2 from private.goods_delivery_versions where good_id='st-good-001')
 and (select count(*)=1 from private.goods_delivery_versions where good_id='st-good-002')
 and (select count(*)=2 from public.goods where id in('st-good-001','st-good-002') and shipping_settings_template_id=pg_temp.st_id(202)),'copy creates per-product immutable delivery versions and keeps volume');
select pg_temp.st_assert(not exists(select 1 from st_original_versions old where not exists(select 1 from private.goods_delivery_versions d where to_jsonb(d)=old.value)),
 'previous delivery versions remain byte-for-byte unchanged');
select pg_temp.st_assert(private.goods_quantity_delivery_fee(1,pg_temp.st_policy()->'quantityTerms')=3000
 and private.goods_quantity_delivery_fee(3,pg_temp.st_policy()->'quantityTerms')=4000 and private.goods_quantity_delivery_fee(6,pg_temp.st_policy()->'quantityTerms')=5500,
 'copied tier3 values use the existing quantity calculator');
set local role authenticated;
select pg_temp.st_assert(public.admin_get_good_transaction_terms('st-good-001')#>>'{delivery,paymentMode}'='collect'
 and public.admin_get_good_transaction_terms('st-good-001')#>>'{delivery,quantityTerms,kind}'='tier3','existing transaction reader returns the copied canonical policy');

select public.admin_preview_shipping_settings_template_v2(pg_temp.st_id(202),array['st-good-003','st-good-004'],pg_temp.st_id(1),pg_temp.st_id(11)) as stale \gset
reset role;
update public.goods set individual_fee=111 where id='st-good-004';
set local role authenticated;
select pg_temp.st_error(format('select public.admin_apply_shipping_settings_template_v2(%L)',pg_temp.st_apply(306,:'stale')),'shipping_settings_goods_changed');
reset role;
select pg_temp.st_assert(not exists(select 1 from private.goods_delivery_versions where good_id in('st-good-003','st-good-004'))
 and not exists(select 1 from private.shipping_settings_operations where operation_id=pg_temp.st_id(306))
 and not exists(select 1 from public.audit_log where diff->>'requestId'=pg_temp.st_id(306)::text),'stale second product never commits a prefix');
set local role authenticated;
select public.admin_preview_shipping_settings_template_v2(pg_temp.st_id(202),array['st-good-003'],pg_temp.st_id(1),pg_temp.st_id(11)) as collector_stale \gset
select public.admin_save_shipping_collect_contract(pg_temp.st_id(102),1,'active',
 '{"collectorName":"TEST 새 수납사","collectionMethod":"TEST 배송 시 지급","refundContact":"TEST 환급담당","customerInstructions":"TEST 합성 계약","contractReference":"TEST 계약2","dispatchMappingReference":"TEST 인계","receiptReference":"TEST 영수증","disputeContact":"TEST 분쟁담당"}',pg_temp.st_id(553),pg_temp.st_id(1));
select pg_temp.st_error(format('select public.admin_apply_shipping_settings_template_v2(%L)',pg_temp.st_apply(307,:'collector_stale')),'shipping_settings_origin_changed');
select public.admin_save_shipping_settings_template_v2(pg_temp.st_save(308,203,pg_temp.st_settings('{"mode":"preserve"}',101))) as unready_saved \gset
select public.admin_preview_shipping_settings_template_v2(pg_temp.st_id(203),array['st-good-001'],pg_temp.st_id(1),pg_temp.st_id(11)) as unready_preview \gset
select pg_temp.st_assert(:'unready_preview'::jsonb#>>'{goods,0,blocker}'='collect_contract_not_ready','preserved active collect also requires the final origin contract');
select pg_temp.st_error(format('select public.admin_apply_shipping_settings_template_v2(%L)',pg_temp.st_apply(309,:'unready_preview')),'collect_contract_not_ready');

select public.admin_save_shipping_settings_template_v2(pg_temp.st_save(310,204,pg_temp.st_settings(jsonb_build_object('mode','replace','policy',pg_temp.st_policy('disabled'))))) as disabled_saved \gset
select public.admin_preview_shipping_settings_template_v2(pg_temp.st_id(204),array['st-good-002'],pg_temp.st_id(1),pg_temp.st_id(11)) as disabled_preview \gset
select public.admin_apply_shipping_settings_template_v2(pg_temp.st_apply(311,:'disabled_preview'));
select pg_temp.st_assert(public.admin_get_good_transaction_terms('st-good-002')#>>'{delivery,status}'='disabled','explicit disabled copy deactivates the policy without deleting history');
select public.admin_save_good_transaction_terms('st-good-002',2,(select updated_at from public.goods where id='st-good-002'),
 '{"status":"draft","terms":null,"draftValues":{}}',null,pg_temp.st_id(554),pg_temp.st_id(1));
reset role;
select pg_temp.st_assert((select shipping_settings_template_id=pg_temp.st_id(204) from public.goods where id='st-good-002'),'volume-only edit preserves copied delivery association');
set local role authenticated;
select public.admin_save_good_transaction_terms('st-good-002',3,(select updated_at from public.goods where id='st-good-002'),null,
 pg_temp.st_policy('active','prepaid','tier2'),pg_temp.st_id(555),pg_temp.st_id(1));
reset role;
select pg_temp.st_assert((select shipping_settings_template_id is null and shipping_settings_snapshot is null from public.goods where id='st-good-002'),
 'separate delivery edit detaches an explicit copied delivery policy');
set local role authenticated;
select pg_temp.st_assert(public.admin_read_shipping_settings_operation(pg_temp.st_context(312,'save',205,0)) is null,'absent metadata is not a completed operation');
select public.admin_seal_shipping_settings_operation(pg_temp.st_context(312,'save',205,0)) as sealed \gset
select 'SHIPPING_DTO:'||jsonb_build_object('kind','seal','request',pg_temp.st_context(312,'save',205,0),'value',:'sealed'::jsonb)::text;
select pg_temp.st_assert(public.admin_save_shipping_settings_template_v2(pg_temp.st_save(312,205,pg_temp.st_settings()))=:'sealed'::jsonb,'late save returns the terminal sealed receipt');
reset role;
select pg_temp.st_assert(not exists(select 1 from public.shipping_settings_templates where id=pg_temp.st_id(205)),'sealed save created no template');
set local role authenticated;
select pg_temp.st_auth(1,13);
select pg_temp.st_error(format('select public.admin_read_shipping_settings_operation(%L)',pg_temp.st_context(302,'save',202,0,1,13)),'shipping_settings_operation_conflict');
select pg_temp.st_auth(2,12);
select pg_temp.st_error(format('select public.admin_read_shipping_settings_operation(%L)',pg_temp.st_context(302,'save',202,0,2,12)),'shipping_settings_operation_conflict');
select pg_temp.st_auth(1,14);
select pg_temp.st_error(format('select public.admin_read_shipping_settings_operation(%L)',pg_temp.st_context(302,'save',202,0,1,14)),'shipping_settings_auth_changed');
select pg_temp.st_auth(3,15);
select pg_temp.st_error(format('select public.admin_read_shipping_settings_operation(%L)',pg_temp.st_context(302,'save',202,0,3,15)),'operator_capability_required');
select pg_temp.st_auth();

select public.admin_preview_shipping_settings_template_v2(pg_temp.st_id(202),array['st-family-child'],pg_temp.st_id(1),pg_temp.st_id(11)) as child_preview \gset
select pg_temp.st_assert(:'child_preview'::jsonb#>>'{goods,0,editable}'='false' and :'child_preview'::jsonb#>>'{goods,0,ownerGoodId}'='st-family-owner'
 and jsonb_array_length(:'child_preview'::jsonb#>'{goods,0,familyGoodIds}')=2,'child preview exposes owner and shared family');
select pg_temp.st_error(format('select public.admin_apply_shipping_settings_template_v2(%L)',pg_temp.st_apply(313,:'child_preview')),'goods_aggregation_policy_owned_by_source');
select public.admin_preview_shipping_settings_template_v2(pg_temp.st_id(202),array['st-family-owner'],pg_temp.st_id(1),pg_temp.st_id(11)) as family_stale \gset
reset role;
select private.bind_goods_aggregation('st-family-owner',array['st-family-new'],pg_temp.st_id(556),pg_temp.st_id(1));
set local role authenticated;
select pg_temp.st_error(format('select public.admin_apply_shipping_settings_template_v2(%L)',pg_temp.st_apply(314,:'family_stale')),'shipping_settings_goods_changed');
select public.admin_preview_shipping_settings_template_v2(pg_temp.st_id(202),array['st-family-owner'],pg_temp.st_id(1),pg_temp.st_id(11)) as family_preview \gset
reset role;
create temp table st_family_before as select to_jsonb(g) value from public.goods g where id in('st-family-child','st-family-new');
set local role authenticated;
select public.admin_apply_shipping_settings_template_v2(pg_temp.st_apply(315,:'family_preview')) as family_applied \gset
select pg_temp.st_assert(:'family_applied'::jsonb->>'appliedCount'='1'
 and public.admin_get_good_transaction_terms('st-family-child')#>>'{delivery,paymentMode}'='collect','only root is written while the existing shared policy is effective');
reset role;
select pg_temp.st_assert(not exists(select 1 from st_family_before b where not exists(select 1 from public.goods g where to_jsonb(g)=b.value))
 and not exists(select 1 from private.goods_transaction_configs where good_id in('st-family-child','st-family-new')),'no child rows or independent child policies are silently written');

set local role authenticated;
select public.admin_save_shipping_settings_template_v2(pg_temp.st_save(316,206,pg_temp.st_settings('{"mode":"preserve"}')));
select public.admin_preview_shipping_settings_template_v2(pg_temp.st_id(206),(select array_agg('st-good-'||lpad(n::text,3,'0')) from generate_series(1,100)n),pg_temp.st_id(1),pg_temp.st_id(11)) as hundred \gset
select public.admin_apply_shipping_settings_template_v2(pg_temp.st_apply(317,:'hundred')) as hundred_applied \gset
select pg_temp.st_assert(:'hundred_applied'::jsonb->>'appliedCount'='100' and public.admin_apply_shipping_settings_template_v2(pg_temp.st_apply(317,:'hundred'))=:'hundred_applied'::jsonb,
 '100 targets are atomic and repeated operation is identical');
select pg_temp.st_error(format('select public.admin_preview_shipping_settings_template_v2(%L,%L,%L,%L)',pg_temp.st_id(206),
 (select array_agg('st-good-'||lpad(n::text,3,'0')) from generate_series(1,101)n),pg_temp.st_id(1),pg_temp.st_id(11)),'invalid_shipping_settings_targets');
select pg_temp.st_error(format('select public.admin_preview_shipping_settings_template_v2(%L,%L,%L,%L)',pg_temp.st_id(206),array['st-good-001','st-good-001'],pg_temp.st_id(1),pg_temp.st_id(11)),'invalid_shipping_settings_targets');
select pg_temp.st_error(format('select public.admin_save_shipping_settings_template_v2(%L)',pg_temp.st_save(318,207,pg_temp.st_settings('null'))),'invalid_shipping_settings_delivery');
select pg_temp.st_error(format('select public.admin_save_shipping_settings_template_v2(%L)',pg_temp.st_save(319,207,pg_temp.st_settings('{"mode":"preserve","policy":null}'))),'invalid_shipping_settings_delivery');
select pg_temp.st_error(format('select public.admin_save_shipping_settings_template_v2(%L)',pg_temp.st_save(320,207,pg_temp.st_settings('{"mode":"replace","policy":{"status":"active","paymentMode":"collect","quantityTerms":{"kind":"tier3","baseFee":1,"firstLimit":3,"secondLimit":2,"extra1":0,"extra2":0},"draftValues":{}}}'))),'invalid_shipping_settings_delivery');
select pg_temp.st_error(format('select public.admin_apply_shipping_settings_template_v2(%L)',pg_temp.st_apply(321,:'hundred')||'{"extra":true}'),'invalid_shipping_settings_application');
select 'SHIPPING_DTO:'||jsonb_build_object('kind','search','value',public.admin_search_goods_for_shipping_settings_v2('ST-GOOD-001',1,pg_temp.st_id(1),pg_temp.st_id(11)))::text;
reset role;
select pg_temp.st_assert((select to_jsonb(i) from public.order_items i where order_id=pg_temp.st_id(501))=(select value from st_old_order)
 and not exists(select 1 from st_old_origins old where not exists(select 1 from public.fulfillment_origins o where to_jsonb(o)=old.value)),
 'historical order and origin policies remain untouched');
select pg_temp.st_assert(not has_table_privilege('authenticated','private.shipping_settings_operations','select,insert,update,delete')
 and not has_table_privilege('service_role','private.shipping_settings_operations','select,insert,update,delete')
 and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in('admin_read_shipping_settings_operation','admin_seal_shipping_settings_operation','admin_save_shipping_settings_template_v2',
 'admin_search_goods_for_shipping_settings_v2','admin_preview_shipping_settings_template_v2','admin_apply_shipping_settings_template_v2')
 and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or not has_function_privilege('authenticated',p.oid,'execute'))),
 'private operations and RPC grants stay sealed');
rollback;
