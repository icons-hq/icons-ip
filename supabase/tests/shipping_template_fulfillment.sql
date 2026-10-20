-- Isolated transaction fixtures shared in shape with shipping_settings_delivery_policies.sql.
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

create function pg_temp.st_apply_v3(operation integer,preview jsonb) returns jsonb language sql immutable as $$
 select pg_temp.st_apply(operation,preview)||jsonb_build_object('targetGroup',case when preview->'targetGroup'='null'::jsonb then 'null'::jsonb
  else jsonb_build_object('id',preview#>'{targetGroup,id}','revision',preview#>'{targetGroup,revision}') end);
$$;

-- Fulfillment settings remain per selected product. No family expansion.
update private.goods_transaction_runtime set enabled=true where singleton;
create function pg_temp.st_fulfillment(mode text default 'shipping') returns jsonb language sql immutable as $$
 select jsonb_build_object('mode',mode,'methods',case when mode='shipping' then
 '[{"method":"parcel","feeAmount":null,"feeBasis":"per_order","installationFee":500},{"method":"direct","feeAmount":2000,"feeBasis":"per_item","installationFee":3000},{"method":"pickup","feeAmount":0,"feeBasis":"per_order","installationFee":0}]'::jsonb
 else '[{"method":"none","feeAmount":0,"feeBasis":"per_order","installationFee":0}]'::jsonb end,
 'publicNote','TEST 수령 안내','evidence','TEST 계약 검토','confirmed',true);
$$;
create function pg_temp.st_new_settings(mode text default 'replace') returns jsonb language sql immutable as $$
 select pg_temp.st_settings('{"mode":"preserve"}')||jsonb_build_object('chargeGroup',jsonb_build_object('mode','preserve'),'fulfillment',
 case when mode='replace' then jsonb_build_object('mode',mode,'policy',pg_temp.st_fulfillment()) else jsonb_build_object('mode',mode) end);
$$;
insert into private.goods_digital_assets(id,actor_id,session_id,filename,mime_type,path,size_bytes,sha256,state,expires_at,verified_at)
 values(pg_temp.st_id(900),pg_temp.st_id(1),pg_temp.st_id(11),'TEST.pdf','application/pdf',pg_temp.st_id(1)||'/'||pg_temp.st_id(900)||'.pdf',12,repeat('a',64),'verified',now()+interval '1 hour',now());
select pg_temp.st_auth();set local role authenticated;
select public.admin_save_goods_fulfillment('st-good-002',jsonb_build_object('mode','digital','methods','[{"method":"digital","feeAmount":0,"feeBasis":"per_order","installationFee":0}]'::jsonb,
 'assetIds',jsonb_build_array(pg_temp.st_id(900)),'publicNote','TEST 기존 파일','evidence','TEST 검증','confirmed',true),0,pg_temp.st_id(901),pg_temp.st_id(1),pg_temp.st_id(11));
select public.admin_save_shipping_settings_template_v3(pg_temp.st_save(920,220,pg_temp.st_new_settings())) as saved \gset
select pg_temp.st_assert(:'saved'::jsonb#>>'{template,settings,fulfillment,policy,methods,1,installationFee}'='3000','save delivery methods and prepaid installation fee');
select pg_temp.st_assert(public.admin_save_shipping_settings_template_v3(pg_temp.st_save(920,220,pg_temp.st_new_settings()))=:'saved'::jsonb,'save replay does not create revision');
select pg_temp.st_error(format('select public.admin_save_shipping_settings_template_v3(%L::jsonb)',pg_temp.st_save(921,221,jsonb_set(pg_temp.st_new_settings(),'{fulfillment,policy,confirmed}','false'))),'invalid_shipping_settings_fulfillment');
select pg_temp.st_error(format('select public.admin_save_shipping_settings_template_v3(%L::jsonb)',pg_temp.st_save(922,222,jsonb_set(pg_temp.st_new_settings(),'{fulfillment,policy,mode}','"digital"'))),'invalid_shipping_settings_fulfillment');
select pg_temp.st_error(format('select public.admin_save_shipping_settings_template_v3(%L::jsonb)',pg_temp.st_save(923,223,jsonb_set(pg_temp.st_new_settings(),'{fulfillment,policy,methods,1,feeAmount}','-1'))),'invalid_shipping_settings_fulfillment');
select public.admin_preview_shipping_settings_template_v3(pg_temp.st_id(220),array['st-good-001','st-good-002'],pg_temp.st_id(1),pg_temp.st_id(11)) as preview \gset
select pg_temp.st_assert(:'preview'::jsonb#>>'{goods,0,fulfillmentRevision}'='0' and :'preview'::jsonb#>>'{goods,1,fulfillmentRevision}'='1'
 and :'preview'::jsonb#>>'{goods,1,effectiveBefore,fulfillment,mode}'='digital' and jsonb_array_length(:'preview'::jsonb#>'{goods,1,effectiveBefore,fulfillment,files}')=1
 and :'preview'::jsonb#>>'{goods,1,effectiveAfter,fulfillment,mode}'='shipping' and :'preview'::jsonb#>'{goods,1,effectiveAfter,fulfillment,files}'='[]'::jsonb,'preview binds current files and explicit removal for future orders');
select pg_temp.st_error(format('select public.admin_apply_shipping_settings_template_v3(%L::jsonb)',jsonb_set(pg_temp.st_apply_v3(924,:'preview'),'{goods}',
 (select jsonb_agg(value-'fulfillmentRevision') from jsonb_array_elements(:'preview'::jsonb->'goods') x(value) cross join lateral(select 1)z))),'invalid_shipping_settings_targets');
select pg_temp.st_error(format('select public.admin_apply_shipping_settings_template_v3(%L::jsonb)',jsonb_set(pg_temp.st_apply_v3(925,:'preview'),'{goods}',
 (select jsonb_agg(value-'fulfillmentRevision') from jsonb_array_elements(pg_temp.st_apply_v3(925,:'preview')->'goods')))),'shipping_settings_preview_upgrade_required');
select public.admin_apply_shipping_settings_template_v3(pg_temp.st_apply_v3(926,:'preview')) as applied \gset
select pg_temp.st_assert(:'applied'::jsonb->>'fulfillmentVersion'='1' and :'applied'::jsonb#>>'{goods,0,fulfillmentRevision}'='1' and :'applied'::jsonb#>>'{goods,1,fulfillmentRevision}'='2','all selected goods applied with fulfillment receipts');
select pg_temp.st_assert(public.admin_apply_shipping_settings_template_v3(pg_temp.st_apply_v3(926,:'preview'))=:'applied'::jsonb,'apply replay does not replace settings twice');
select pg_temp.st_assert((select shipping_settings_template_id=pg_temp.st_id(220) from public.goods where id='st-good-002'),'template remains associated after apply');
reset role;
select pg_temp.st_assert((select asset_ids='{}'::uuid[] and mode='shipping' from private.goods_fulfillment_settings where good_id='st-good-002'),'file association removed only for future purchases');
select pg_temp.st_assert((select state='verified' from private.goods_digital_assets where id=pg_temp.st_id(900)),'original purchased asset retained');
select pg_temp.st_assert((select count(*) from public.audit_log where action='goods.fulfillment.settings' and id=md5('shipping-settings-fulfillment:'||pg_temp.st_id(926)||':st-good-001')::uuid)=1,'one audit per child operation');
set local role authenticated;
select public.admin_save_goods_fulfillment('st-good-001',pg_temp.st_fulfillment('no_delivery')||'{"assetIds":[]}'::jsonb,1,pg_temp.st_id(927),pg_temp.st_id(1),pg_temp.st_id(11));
select pg_temp.st_assert((select shipping_settings_template_id is null from public.goods where id='st-good-001'),'manual fulfillment edit detaches replacement template');
-- Legacy request without a fulfillment guard remains safe only when preserving.
select public.admin_preview_shipping_settings_template_v3(pg_temp.st_id(201),array['st-good-002'],pg_temp.st_id(1),pg_temp.st_id(11)) as old_preview \gset
select public.admin_apply_shipping_settings_template_v3(jsonb_set(pg_temp.st_apply_v3(928,:'old_preview'),'{goods}',
 (select jsonb_agg(value-'fulfillmentRevision') from jsonb_array_elements(pg_temp.st_apply_v3(928,:'old_preview')->'goods')))) as legacy_applied \gset
select pg_temp.st_assert(:'legacy_applied'::jsonb#>>'{goods,0,fulfillmentRevision}'='2','legacy request preserves current fulfillment revision');
select public.admin_save_goods_fulfillment('st-good-002',pg_temp.st_fulfillment('no_delivery')||'{"assetIds":[]}'::jsonb,2,pg_temp.st_id(929),pg_temp.st_id(1),pg_temp.st_id(11));
select pg_temp.st_assert((select shipping_settings_template_id=pg_temp.st_id(201) from public.goods where id='st-good-002'),'legacy template stays associated after independent fulfillment edit');
-- CAS catches fulfillment-only changes even if the goods timestamp is unchanged.
select public.admin_preview_shipping_settings_template_v3(pg_temp.st_id(220),array['st-good-002','st-good-003'],pg_temp.st_id(1),pg_temp.st_id(11)) as stale \gset
select public.admin_save_goods_fulfillment('st-good-002',pg_temp.st_fulfillment()||'{"assetIds":[]}'::jsonb,3,pg_temp.st_id(930),pg_temp.st_id(1),pg_temp.st_id(11));
select pg_temp.st_assert((select updated_at from public.goods where id='st-good-002')=(:'stale'::jsonb#>>'{goods,0,updatedAt}')::timestamptz,'isolated fulfillment update leaves legacy template base timestamp unchanged');
select pg_temp.st_error(format('select public.admin_apply_shipping_settings_template_v3(%L::jsonb)',pg_temp.st_apply_v3(931,:'stale')),'shipping_settings_goods_changed');
reset role;
select pg_temp.st_assert(not exists(select 1 from private.goods_fulfillment_settings where good_id='st-good-003'),'stale multi-product request writes no partial settings');
-- Force failure on the second product after the first writer has run.
create temp table st_before_atomic as select id,to_jsonb(g) value,private.goods_fulfillment_document(id,false) fulfillment from public.goods g where id in('st-good-004','st-good-005');
create function pg_temp.st_fail_second() returns trigger language plpgsql as $$begin if new.good_id='st-good-005' then raise exception 'test_fulfillment_second_failure';end if;return new;end $$;
create trigger st_fail_second before insert or update on private.goods_fulfillment_settings for each row execute function pg_temp.st_fail_second();
set local role authenticated;
select public.admin_preview_shipping_settings_template_v3(pg_temp.st_id(220),array['st-good-004','st-good-005'],pg_temp.st_id(1),pg_temp.st_id(11)) as atomic_preview \gset
select pg_temp.st_error(format('select public.admin_apply_shipping_settings_template_v3(%L::jsonb)',pg_temp.st_apply_v3(932,:'atomic_preview')),'test_fulfillment_second_failure');
reset role;
select pg_temp.st_assert(not exists(select 1 from st_before_atomic b join public.goods g using(id) where b.value is distinct from to_jsonb(g) or b.fulfillment is distinct from private.goods_fulfillment_document(g.id,false)),'second product failure rolls back base fields and all fulfillment edits');
select pg_temp.st_assert(not exists(select 1 from public.audit_log where id=md5('shipping-settings-fulfillment:'||pg_temp.st_id(932)||':st-good-004')::uuid),'second failure rolls back first audit too');
drop trigger st_fail_second on private.goods_fulfillment_settings;
set local role authenticated;
select public.admin_apply_shipping_settings_template_v3(pg_temp.st_apply_v3(932,:'atomic_preview')) as atomic_ok \gset
select pg_temp.st_assert(:'atomic_ok'::jsonb->>'appliedCount'='2','same failed operation succeeds after transient cause removed');
select public.admin_preview_shipping_settings_template_v3(pg_temp.st_id(220),array['st-family-child'],pg_temp.st_id(1),pg_temp.st_id(11)) as family \gset
select pg_temp.st_assert(:'family'::jsonb->>'canApply'='false','family child still requires explicit owner selection');
reset role;
update private.goods_transaction_runtime set enabled=false where singleton;
set local role authenticated;
select public.admin_preview_shipping_settings_template_v3(pg_temp.st_id(220),array['st-good-006'],pg_temp.st_id(1),pg_temp.st_id(11)) as disabled \gset
select pg_temp.st_assert(:'disabled'::jsonb->>'canApply'='false' and :'disabled'::jsonb#>>'{goods,0,blocker}'='checkout_contract_upgrade_required','inactive checkout blocks fulfillment template before submission');
reset role;
select pg_temp.st_assert(not exists(select 1 from st_old_order o full join(select to_jsonb(i) value from public.order_items i where order_id=pg_temp.st_id(501))i on true where o.value is distinct from i.value),'existing order contract unchanged');
select pg_temp.st_auth(3,15);set local role authenticated;
select pg_temp.st_error(format('select public.admin_preview_shipping_settings_template_v3(%L,array[%L],%L,%L)',pg_temp.st_id(220),'st-good-001',pg_temp.st_id(3),pg_temp.st_id(15)),'operator_capability_required');
reset role;
select pg_temp.st_assert(not has_function_privilege('authenticated','private.validate_shipping_settings_fulfillment(jsonb)','EXECUTE') and not has_function_privilege('service_role','private.shipping_settings_fulfillment_after(text,jsonb)','EXECUTE'),'new internal helpers sealed from all application roles');
rollback;
