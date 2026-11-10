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

-- Shipping-charge template integration starts here; all changes roll back.
update private.goods_transaction_runtime set enabled=true where singleton;
create function pg_temp.st_group_request(operation integer,group_n integer,origin_n integer,revision integer default 0,mode text default 'min') returns jsonb language sql stable as $$
 select jsonb_build_object('operationId',pg_temp.st_id(operation),'command','save','groupId',pg_temp.st_id(group_n),'expectedRevision',revision,
  'expectedActorId',pg_temp.st_id(1),'expectedSessionId',pg_temp.st_id(11),'originId',pg_temp.st_id(origin_n),
  'originUpdatedAt',(select updated_at from public.fulfillment_origins where id=pg_temp.st_id(origin_n)),
  'expectedDefaultGroupId',null,'expectedDefaultGroupRevision',0,'attestRegional',false,
  'values',jsonb_build_object('name','TEST 그룹 '||group_n,'enabled',true,'archived',false,'isDefault',false,'calculationMode',mode,'regional',jsonb_build_object('mode','inherit','policy',null)));
$$;
create function pg_temp.st_apply_v3(operation integer,preview jsonb) returns jsonb language sql immutable as $$
 select pg_temp.st_apply(operation,preview)||jsonb_build_object('targetGroup',case when preview->'targetGroup'='null'::jsonb then 'null'::jsonb
  else jsonb_build_object('id',preview#>'{targetGroup,id}','revision',preview#>'{targetGroup,revision}') end);
$$;
create function pg_temp.st_charge_settings(mode text,group_n integer default 601,origin_n integer default 102) returns jsonb language sql immutable as $$
 select pg_temp.st_settings('{"mode":"preserve"}'::jsonb,origin_n,'individual')||jsonb_build_object('chargeGroup',
  case when mode='assign' then jsonb_build_object('mode',mode,'groupId',pg_temp.st_id(group_n)) else jsonb_build_object('mode',mode) end);
$$;
set local role authenticated;
select pg_temp.st_auth();
select public.admin_save_shipping_charge_group(pg_temp.st_group_request(700,601,102)) as group_one \gset
select public.admin_save_shipping_charge_group(pg_temp.st_group_request(701,602,101)) as group_two \gset
select public.admin_save_shipping_settings_template_v3(pg_temp.st_save(710,210,pg_temp.st_charge_settings('assign'))) as saved \gset
select pg_temp.st_assert(:'saved'::jsonb#>>'{template,settings,chargeGroup,groupId}'=pg_temp.st_id(601)::text,'save resolves actual group policy_values');
select pg_temp.st_assert(public.admin_save_shipping_settings_template_v3(pg_temp.st_save(710,210,pg_temp.st_charge_settings('assign')))=:'saved'::jsonb,'exact save replay');
select public.admin_preview_shipping_settings_template_v3(pg_temp.st_id(210),array['st-good-002','st-good-003'],pg_temp.st_id(1),pg_temp.st_id(11)) as preview \gset
select pg_temp.st_assert(:'preview'::jsonb->>'canApply'='true' and :'preview'::jsonb#>>'{goods,0,assignmentRevision}'='0'
 and :'preview'::jsonb#>>'{goods,0,effectiveAfter,chargeGroup,id}'=pg_temp.st_id(601)::text,'fresh v3 preview binds before and after group');
select public.admin_apply_shipping_settings_template_v3(pg_temp.st_apply_v3(711,:'preview')) as applied \gset
select pg_temp.st_assert(:'applied'::jsonb->>'chargeGroupVersion'='1' and :'applied'::jsonb->>'appliedCount'='2'
 and :'applied'::jsonb#>>'{goods,0,assignmentRevision}'='1','applied marker and exact assignment guards');
select pg_temp.st_assert(public.admin_apply_shipping_settings_template_v3(pg_temp.st_apply_v3(711,:'preview'))=:'applied'::jsonb,'exact apply replay');
select pg_temp.st_assert(public.admin_read_shipping_settings_operation(pg_temp.st_context(711,'apply',210))=:'applied'::jsonb,'readback has same v3 marker and guards');
select pg_temp.st_assert(public.admin_seal_shipping_settings_operation(pg_temp.st_context(711,'apply',210))=:'applied'::jsonb,'seal after success returns the original receipt');
reset role;
select pg_temp.st_assert((select shipping_settings_template_id=pg_temp.st_id(210) and shipping_settings_snapshot#>>'{appliedChargeGroup,groupId}'=pg_temp.st_id(601)::text
 from public.goods where id='st-good-002'),'template association survives own group change');
create temp table st_assignment_before as select owner_good_id,version_id,revision from private.shipping_charge_group_assignments where owner_good_id in('st-good-002','st-good-003');
update private.goods_transaction_runtime set enabled=false where singleton;
set local role authenticated;
select pg_temp.st_assert(public.admin_apply_shipping_settings_template_v3(pg_temp.st_apply_v3(711,:'preview'))=:'applied'::jsonb,'prior successful replay precedes runtime gate');
reset role;
update private.goods_transaction_runtime set enabled=true where singleton;
set local role authenticated;
select public.admin_preview_shipping_settings_template_v3(pg_temp.st_id(210),array['st-good-002','st-good-003'],pg_temp.st_id(1),pg_temp.st_id(11)) as same_preview \gset
select public.admin_apply_shipping_settings_template_v3(pg_temp.st_apply_v3(712,:'same_preview')) as same_applied \gset
reset role;
select pg_temp.st_assert(not exists(select 1 from st_assignment_before b join private.shipping_charge_group_assignments a using(owner_good_id)
 where a.revision<>b.revision or a.version_id<>b.version_id),'same group application preserves assignment version');
set local role authenticated;
select public.admin_preview_shipping_settings_template_v3(pg_temp.st_id(210),array['st-good-004'],pg_temp.st_id(1),pg_temp.st_id(11)) as stale_preview \gset
select public.admin_save_shipping_charge_group(pg_temp.st_group_request(713,601,102,1,'max'));
select pg_temp.st_error(format('select public.admin_apply_shipping_settings_template_v3(%L::jsonb)',pg_temp.st_apply_v3(714,:'stale_preview')),'shipping_charge_group_changed');
select public.admin_preview_shipping_settings_template_v3(pg_temp.st_id(210),array['st-good-002'],pg_temp.st_id(1),pg_temp.st_id(11)) as legacy_blocked \gset
select pg_temp.st_error(format('select public.admin_apply_shipping_settings_template_v2(%L::jsonb)',
 (pg_temp.st_apply(715,:'legacy_blocked')||jsonb_build_object('goods',(select jsonb_agg(value-array['assignmentRevision','assignmentVersionId','groupId','groupRevision']) from jsonb_array_elements(pg_temp.st_apply(715,:'legacy_blocked')->'goods'))))),
 'invalid_shipping_settings');
select public.admin_save_shipping_settings_template_v3(pg_temp.st_save(720,211,pg_temp.st_charge_settings('preserve',601,101)));
select public.admin_preview_shipping_settings_template_v3(pg_temp.st_id(211),array['st-good-002'],pg_temp.st_id(1),pg_temp.st_id(11)) as mismatch \gset
select pg_temp.st_assert(:'mismatch'::jsonb->>'canApply'='false' and :'mismatch'::jsonb#>>'{goods,0,blocker}'='shipping_charge_group_origin_mismatch','preserve cannot move assigned group to another origin');
select public.admin_save_shipping_settings_template_v3(pg_temp.st_save(721,212,pg_temp.st_charge_settings('clear',601,101))) as clear_saved \gset
select public.admin_preview_shipping_settings_template_v3(pg_temp.st_id(212),array['st-good-002'],pg_temp.st_id(1),pg_temp.st_id(11)) as clear_preview \gset
select pg_temp.st_assert(:'clear_preview'::jsonb->>'canApply'='true','prepaid clear and origin change do not require collector');
select public.admin_apply_shipping_settings_template_v3(pg_temp.st_apply_v3(722,:'clear_preview')) as cleared \gset
reset role;
select pg_temp.st_assert((select g.origin_id=pg_temp.st_id(101) and a.group_id is null and a.revision=2
 and g.shipping_settings_template_id=pg_temp.st_id(212) and g.shipping_settings_snapshot#>'{appliedChargeGroup,groupId}'='null'::jsonb
 from public.goods g join private.shipping_charge_group_assignments a on a.owner_good_id=g.id where g.id='st-good-002'),'clear and origin move commit together');
update private.goods_transaction_runtime set enabled=false where singleton;
set local role authenticated;
select public.admin_preview_shipping_settings_template_v3(pg_temp.st_id(212),array['st-good-002'],pg_temp.st_id(1),pg_temp.st_id(11)) as clear_off \gset
select pg_temp.st_assert(:'clear_off'::jsonb->>'canApply'='false' and :'clear_off'::jsonb#>>'{goods,0,blocker}'='checkout_contract_upgrade_required','even no-op explicit clear requires runtime');
reset role;
update private.goods_transaction_runtime set enabled=true where singleton;
set local role authenticated;
select public.admin_save_shipping_settings_template_v3(pg_temp.st_save(723,213,pg_temp.st_charge_settings('assign',602,101)));
select public.admin_preview_shipping_settings_template_v3(pg_temp.st_id(213),array['st-good-003'],pg_temp.st_id(1),pg_temp.st_id(11)) as move_preview \gset
select public.admin_apply_shipping_settings_template_v3(pg_temp.st_apply_v3(724,:'move_preview')) as moved \gset
reset role;
select pg_temp.st_assert((select g.origin_id=pg_temp.st_id(101) and a.group_id=pg_temp.st_id(602) and a.revision=2
 from public.goods g join private.shipping_charge_group_assignments a on a.owner_good_id=g.id where g.id='st-good-003'),'explicit reassignment and origin change are atomic');
set local role authenticated;
select public.admin_preview_shipping_settings_template_v3(pg_temp.st_id(210),array['st-family-child'],pg_temp.st_id(1),pg_temp.st_id(11)) as child_preview \gset
select pg_temp.st_assert(:'child_preview'::jsonb->>'canApply'='false' and :'child_preview'::jsonb#>>'{goods,0,editable}'='false','family child stays read-only');
select public.admin_preview_shipping_settings_template_v3(pg_temp.st_id(210),array['st-family-owner'],pg_temp.st_id(1),pg_temp.st_id(11)) as family_preview \gset
select public.admin_apply_shipping_settings_template_v3(pg_temp.st_apply_v3(725,:'family_preview')) as family_applied \gset
select public.admin_search_goods_for_shipping_settings_v3('ST-GOOD-003',1,pg_temp.st_id(1),pg_temp.st_id(11)) as search_result \gset
reset role;
select pg_temp.st_assert(private.shipping_settings_charge_summary((select g from public.goods g where id='st-family-child'))->>'id'=pg_temp.st_id(601)::text,
 'family child reads source assignment without its own assignment row');
select pg_temp.st_assert(not exists(select 1 from private.shipping_charge_group_assignments where owner_good_id='st-family-child'),'no child assignment created');
select pg_temp.st_assert((select to_jsonb(i) from public.order_items i where order_id=pg_temp.st_id(501))=(select value from st_old_order),'historical order item unchanged');
select pg_temp.st_assert(not exists(select 1 from st_old_origins old join public.fulfillment_origins o using(id) where to_jsonb(o)<>old.value),'origin policy rows unchanged');
select pg_temp.st_assert(not has_function_privilege('anon','public.admin_apply_shipping_settings_template_v3(jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_apply_shipping_settings_template_v3(jsonb)','execute')
 and not has_function_privilege('authenticated','private.shipping_settings_charge_good_guard(public.goods)','execute'),'v3 RPC and internal ACL sealed');
select 'SHIPPING_CHARGE_TEMPLATE_DTO:'||jsonb_build_object('kind','save','input',pg_temp.st_save(710,210,pg_temp.st_charge_settings('assign')),'output',:'saved'::jsonb)::text;
select 'SHIPPING_CHARGE_TEMPLATE_DTO:'||jsonb_build_object('kind','preview','output',:'preview'::jsonb)::text;
select 'SHIPPING_CHARGE_TEMPLATE_DTO:'||jsonb_build_object('kind','apply','input',pg_temp.st_apply_v3(711,:'preview'),'output',:'applied'::jsonb)::text;
select 'SHIPPING_CHARGE_TEMPLATE_DTO:'||jsonb_build_object('kind','clear','input',pg_temp.st_apply_v3(722,:'clear_preview'),'output',:'cleared'::jsonb)::text;
select 'SHIPPING_CHARGE_TEMPLATE_DTO:'||jsonb_build_object('kind','move','input',pg_temp.st_apply_v3(724,:'move_preview'),'output',:'moved'::jsonb)::text;
select 'SHIPPING_CHARGE_TEMPLATE_DTO:'||jsonb_build_object('kind','search','output',:'search_result'::jsonb)::text;
rollback;
