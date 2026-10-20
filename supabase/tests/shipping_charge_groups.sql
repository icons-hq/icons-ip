\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. Synthetic data only; the complete test rolls back.
-- No named/remote database execution is authorized by the existence of this file.
begin;
create function pg_temp.sc_id(n integer) returns uuid language sql immutable as $$select ('a7160000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.sc_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'shipping charge assertion: %',label;end if;raise notice 'PASS %',label;end $$;
create function pg_temp.sc_error(q text,wanted text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if position(wanted in sqlerrm)>0 then raise notice 'PASS rejected %',wanted;return;end if;raise;end;
 raise exception 'Expected error: %',wanted;
end $$;
create function pg_temp.sc_auth(actor integer default 1,session integer default 11) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.sc_id(actor)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.sc_id(actor),'role','authenticated','session_id',pg_temp.sc_id(session))::text,true);
end $$;
create function pg_temp.sc_values(mode text default 'min',enabled boolean default true,regional jsonb default '{"mode":"inherit","policy":null}',default_group boolean default false) returns jsonb
language sql immutable as $$select jsonb_build_object('name','TEST 배송비 그룹','enabled',enabled,'archived',false,'isDefault',default_group,'calculationMode',mode,'regional',regional)$$;
create function pg_temp.sc_region(amount integer default 3000) returns jsonb language sql stable as $$
 select jsonb_build_object('mode','override','policy',jsonb_build_object('carrierCode','hanjin','startsAt',now()-interval '1 day','endsAt',null,
  'openEnded',true,'sourceEvidence','TEST-ONLY synthetic regional evidence','unlistedDisposition','standard','noRulesConfirmed',false,
  'rules',jsonb_build_array(jsonb_build_object('id',pg_temp.sc_id(901),'postalFrom','12345','postalTo','12345','addressPrefix','',
   'regionLabel','TEST 지역','disposition','surcharge','amount',amount))));
$$;
create function pg_temp.sc_context(operation integer,command text,group_number integer,revision integer,actor integer default 1,session integer default 11) returns jsonb
language sql immutable as $$select jsonb_build_object('operationId',pg_temp.sc_id(operation),'command',command,
 'groupId',case when group_number is null then null else pg_temp.sc_id(group_number) end,'expectedRevision',revision,
 'expectedActorId',pg_temp.sc_id(actor),'expectedSessionId',pg_temp.sc_id(session))$$;
create function pg_temp.sc_save(operation integer,group_number integer,revision integer,group_values jsonb,origin_number integer default 101,
 actor integer default 1,session integer default 11,attest boolean default false) returns jsonb language plpgsql volatile as $$declare origin jsonb;begin
 origin:=public.admin_list_shipping_charge_groups(pg_temp.sc_id(origin_number),'','all',1,pg_temp.sc_id(actor),pg_temp.sc_id(session))#>'{origins,0}';
 return pg_temp.sc_context(operation,'save',group_number,revision,actor,session)||jsonb_build_object('originId',origin->'id','originUpdatedAt',origin->'updatedAt',
  'expectedDefaultGroupId',origin->'defaultGroupId','expectedDefaultGroupRevision',origin->'defaultGroupRevision','values',group_values,'attestRegional',attest);
end $$;
create function pg_temp.sc_apply(operation integer,preview jsonb) returns jsonb language sql immutable as $$
 select jsonb_build_object('operationId',pg_temp.sc_id(operation),'command','assign','groupId',preview#>'{group,id}',
  'expectedRevision',coalesce(preview#>'{group,revision}','0'::jsonb),'expectedActorId',preview->'actorId','expectedSessionId',preview->'sessionId',
  'origins',preview->'origins','goods',(select jsonb_agg(value-array['name','code','editable','blocker','effectiveCount','beforeGroup','afterGroup'] order by value->>'id')
   from jsonb_array_elements(preview->'goods')));
$$;
create function pg_temp.sc_lines(ids text[],quantities integer[] default null,prices bigint[] default null) returns jsonb language sql stable as $$
 select jsonb_agg(jsonb_build_object('good_id',g.id,'origin_id',g.origin_id,'qty',coalesce(quantities[n],1),
  'unit_price',coalesce(prices[n],g.price),'fee_type',g.shipping_fee_type,'individual_fee',g.individual_fee) order by n)
 from unnest(ids) with ordinality selected(id,n) join public.goods g on g.id=selected.id;
$$;
create function pg_temp.sc_calculate(ids text[],quantities integer[] default null,prices bigint[] default null,choices jsonb default '{}',
 destination jsonb default '{"postalCode":"12345","address1":"TEST 합성주소"}') returns jsonb language sql stable as $$
 select private.calculate_goods_transaction_shipping(pg_temp.sc_lines(ids,quantities,prices),destination,choices,statement_timestamp());
$$;
create function pg_temp.sc_delivery(terms jsonb,mode text default 'prepaid') returns jsonb language sql immutable as $$
 select jsonb_build_object('status','active','paymentMode',mode,'quantityTerms',terms,'draftValues','{}'::jsonb);
$$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.sc_id(n),'authenticated','authenticated','shipping-charge-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,4)n;
update public.profiles set role=case when id in(pg_temp.sc_id(1),pg_temp.sc_id(4)) then 'admin'::public.user_role when id=pg_temp.sc_id(2) then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='TEST 배송비 '||right(id::text,3),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id in(pg_temp.sc_id(1),pg_temp.sc_id(2),pg_temp.sc_id(3),pg_temp.sc_id(4));
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.sc_id(1),'primary'),(pg_temp.sc_id(2),'deputy'),(pg_temp.sc_id(4),'owner');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values
 (pg_temp.sc_id(11),pg_temp.sc_id(1),now(),now(),now()+interval '1 hour'),(pg_temp.sc_id(12),pg_temp.sc_id(2),now(),now(),now()+interval '1 hour'),
 (pg_temp.sc_id(13),pg_temp.sc_id(1),now(),now(),now()+interval '1 hour'),(pg_temp.sc_id(14),pg_temp.sc_id(1),now(),now(),now()-interval '1 hour'),
 (pg_temp.sc_id(15),pg_temp.sc_id(3),now(),now(),now()+interval '1 hour');
insert into public.ips(id,title,vertical_key,published_at) values('shipping-charge-ip','TEST 배송비 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active) values
 (pg_temp.sc_id(101),'shipping-charge-main','TEST 배송비 출고지','hanjin',3000,50000,'TEST 반송주소',true),
 (pg_temp.sc_id(102),'shipping-charge-other','TEST 다른 출고지','hanjin',4000,null,'TEST 반송주소',true),
 (pg_temp.sc_id(103),'shipping-charge-inactive','TEST 정리 출고지','hanjin',3000,null,'TEST 반송주소',false);
insert into public.goods(id,code,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee)
 select 'sc-good-'||lpad(n::text,3,'0'),'SC-GOOD-'||lpad(n::text,3,'0'),'shipping-charge-ip','TEST 상품 '||n,'문구',10000,'ok',100,pg_temp.sc_id(101),'individual',2500
 from generate_series(1,110)n;
update public.goods set shipping_fee_type='free',individual_fee=0 where id in('sc-good-002','sc-good-003');
update public.goods set individual_fee=0 where id='sc-good-004';
update public.goods set shipping_fee_type='policy',individual_fee=0 where id in('sc-good-005','sc-good-007');
update public.goods set individual_fee=5000 where id='sc-good-006';
update public.goods set individual_fee=1,price=1 where id in('sc-good-008','sc-good-009');
insert into public.goods(id,code,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee)
 select id,upper(id),'shipping-charge-ip','TEST 공유 상품','문구',10000,'ok',100,pg_temp.sc_id(101),'individual',5000
 from unnest(array['sc-family-owner','sc-family-child'])id;
insert into public.goods(id,code,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee)
 values('sc-no-origin','SC-NO-ORIGIN','shipping-charge-ip','TEST 출고지 없음','문구',10000,'ok',100,null,'individual',0),
 ('sc-other-origin','SC-OTHER-ORIGIN','shipping-charge-ip','TEST 다른 출고지','문구',10000,'ok',100,pg_temp.sc_id(102),'individual',7000),
 ('sc-inactive-origin','SC-INACTIVE-ORIGIN','shipping-charge-ip','TEST 정리 대상','문구',10000,'ok',100,pg_temp.sc_id(103),'individual',1000);
insert into public.orders(id,user_id,status,total,address) values(pg_temp.sc_id(501),pg_temp.sc_id(3),'pending',10000,'{}');
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.sc_id(501),'sc-good-001',id,1,10000,'TEST 기존 주문','문구','shipping-charge-ip' from public.goods_variants where good_id='sc-good-001' and is_default;
create temp table sc_old_order as select to_jsonb(i) value from public.order_items i where order_id=pg_temp.sc_id(501);
select pg_temp.sc_auth();
select private.bind_goods_aggregation('sc-family-owner',array['sc-family-child'],pg_temp.sc_id(550),pg_temp.sc_id(1));
update private.goods_transaction_runtime set enabled=true where singleton;
set local role authenticated;
select public.admin_save_shipping_collect_contract(pg_temp.sc_id(101),0,'active',
 '{"collectorName":"TEST 수납사","collectionMethod":"TEST 배송 시 지급","refundContact":"TEST 환급담당","customerInstructions":"TEST 합성 계약","contractReference":"TEST 계약","dispatchMappingReference":"TEST 인계","receiptReference":"TEST 영수증","disputeContact":"TEST 분쟁담당"}',pg_temp.sc_id(551),pg_temp.sc_id(1));
select public.admin_save_good_transaction_terms('sc-good-002',0,(select updated_at from public.goods where id='sc-good-002'),null,
 pg_temp.sc_delivery('{"kind":"repeat","baseFee":3000,"interval":2}','buyer_choice'),pg_temp.sc_id(552),pg_temp.sc_id(1));
reset role;
update private.goods_transaction_runtime set enabled=false where singleton;
-- SHIPPING_CHARGE_GROUP_FIXTURE_END

set local role authenticated;
select public.admin_list_shipping_charge_groups(pg_temp.sc_id(101),'','all',1,pg_temp.sc_id(1),pg_temp.sc_id(11)) as initial_list \gset
select pg_temp.sc_assert(:'initial_list'::jsonb->>'total'='0' and :'initial_list'::jsonb#>>'{origins,0,id}'=pg_temp.sc_id(101)::text,'empty group list still provides origin/default CAS');
select pg_temp.sc_save(301,201,0,pg_temp.sc_values('min',false)) as draft_request \gset
select public.admin_save_shipping_charge_group(:'draft_request') as draft_receipt \gset
select pg_temp.sc_assert(public.admin_save_shipping_charge_group(:'draft_request')=:'draft_receipt'::jsonb
 and public.admin_read_shipping_charge_group_operation(pg_temp.sc_context(301,'save',201,0))=:'draft_receipt'::jsonb
 and public.admin_seal_shipping_charge_group_operation(pg_temp.sc_context(301,'save',201,0))=:'draft_receipt'::jsonb,'inactive draft save/read/seal exact replay works with runtime off');
select pg_temp.sc_error(format('select public.admin_save_shipping_charge_group(%L)',pg_temp.sc_save(302,201,1,pg_temp.sc_values())),'checkout_contract_upgrade_required');
select pg_temp.sc_error(format('select public.admin_save_shipping_charge_group(%L)',jsonb_set(:'draft_request','{values,name}','"다른 요청"')),'shipping_charge_group_operation_conflict');
select pg_temp.sc_auth(1,13);
select pg_temp.sc_error(format('select public.admin_read_shipping_charge_group_operation(%L)',pg_temp.sc_context(301,'save',201,0,1,13)),'shipping_charge_group_operation_conflict');
select pg_temp.sc_auth(2,12);
select pg_temp.sc_error(format('select public.admin_read_shipping_charge_group_operation(%L)',pg_temp.sc_context(301,'save',201,0,2,12)),'shipping_charge_group_operation_conflict');
select pg_temp.sc_auth();
select pg_temp.sc_assert(public.admin_read_shipping_charge_group_operation(pg_temp.sc_context(303,'save',203,0)) is null,'unobserved operation reads null');
select public.admin_seal_shipping_charge_group_operation(pg_temp.sc_context(303,'save',203,0)) as sealed \gset
select pg_temp.sc_assert(public.admin_save_shipping_charge_group(pg_temp.sc_save(303,203,0,pg_temp.sc_values('max',false)))=:'sealed'::jsonb,'sealed operation blocks a late save without raw payload recovery');
select 'SHIPPING_CHARGE_DTO:'||jsonb_build_object('kind','seal','request',pg_temp.sc_context(303,'save',203,0),'value',:'sealed'::jsonb)::text;
reset role;
select pg_temp.sc_assert(not exists(select 1 from private.shipping_charge_group_operations where operation_id=pg_temp.sc_id(302))
 and not exists(select 1 from private.shipping_charge_groups where id=pg_temp.sc_id(203)),'rejected activation and sealed late save create no group/version prefix');
update private.goods_transaction_runtime set enabled=true where singleton;
set local role authenticated;
select pg_temp.sc_save(304,201,1,pg_temp.sc_values('min',true,'{"mode":"inherit","policy":null}',true)) as active_request \gset
select public.admin_save_shipping_charge_group(:'active_request') as active_receipt \gset
select 'SHIPPING_CHARGE_DTO:'||jsonb_build_object('kind','save','request',:'active_request'::jsonb,'value',:'active_receipt'::jsonb)::text;
select public.admin_save_shipping_charge_group(pg_temp.sc_save(305,202,0,pg_temp.sc_values('max',true,'{"mode":"inherit","policy":null}',true))) as new_default \gset
select pg_temp.sc_assert(:'new_default'::jsonb#>>'{changedDefaultGroup,id}'=pg_temp.sc_id(201)::text
 and :'new_default'::jsonb#>>'{changedDefaultGroup,revision}'='3' and :'new_default'::jsonb#>>'{changedDefaultGroup,isDefault}'='false','default replacement versions only the old/default groups');
select public.admin_list_shipping_charge_groups(null,'','all',1,pg_temp.sc_id(1),pg_temp.sc_id(11)) as list_result \gset
select 'SHIPPING_CHARGE_DTO:'||jsonb_build_object('kind','list','request',jsonb_build_object('p_origin_id',null,'p_query','','p_status','all','p_page',1,'p_expected_actor_id',pg_temp.sc_id(1),'p_expected_session_id',pg_temp.sc_id(11)),'value',:'list_result'::jsonb)::text;
select public.admin_get_good_shipping_charge_group('sc-no-origin',pg_temp.sc_id(1),pg_temp.sc_id(11)) as no_origin \gset
select pg_temp.sc_assert(:'no_origin'::jsonb->'origin'='null'::jsonb and :'no_origin'::jsonb#>>'{good,blocker}'='shipping_charge_group_origin_unavailable','originless catalog item remains readable with diagnostic');
select public.admin_preview_shipping_charge_group_assignment(null,array['sc-no-origin'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as clear_originless \gset
select pg_temp.sc_assert(:'clear_originless'::jsonb->>'canAssign'='true' and :'clear_originless'::jsonb->'origins'='[]'::jsonb,'originless already-clear preview is a valid no-op');
select public.admin_assign_shipping_charge_group(pg_temp.sc_apply(306,:'clear_originless')) as clear_originless_result \gset
select pg_temp.sc_assert(:'clear_originless_result'::jsonb#>>'{goods,0,assignmentRevision}'='0','originless no-op clear does not invent an assignment head');
reset role;
select pg_temp.sc_assert(pg_temp.sc_calculate(array['sc-good-001','sc-good-002'],array[2,2])=
 private.calculate_shipping_charge_groups_legacy(pg_temp.sc_lines(array['sc-good-001','sc-good-002'],array[2,2]),'{"postalCode":"12345","address1":"TEST 합성주소"}','{}',statement_timestamp()),'unassigned full calculator delegates exactly to the preserved legacy result');
set local role authenticated;
select public.admin_preview_shipping_charge_group_assignment(pg_temp.sc_id(201),array['sc-good-001','sc-good-002'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as assignment_preview \gset
select pg_temp.sc_apply(307,:'assignment_preview') as assignment_request \gset
select public.admin_assign_shipping_charge_group(:'assignment_request') as assigned \gset
select 'SHIPPING_CHARGE_DTO:'||jsonb_build_object('kind','preview','request',jsonb_build_object('p_group_id',pg_temp.sc_id(201),'p_good_ids',jsonb_build_array('sc-good-001','sc-good-002'),'p_expected_actor_id',pg_temp.sc_id(1),'p_expected_session_id',pg_temp.sc_id(11)),'value',:'assignment_preview'::jsonb)::text;
select 'SHIPPING_CHARGE_DTO:'||jsonb_build_object('kind','assign','request',:'assignment_request'::jsonb,'value',:'assigned'::jsonb)::text;
select pg_temp.sc_assert(public.admin_assign_shipping_charge_group(:'assignment_request')=:'assigned'::jsonb and :'assigned'::jsonb->>'appliedCount'='2','assignment exact retry returns original two-product receipt');
select public.admin_preview_shipping_charge_group_assignment(pg_temp.sc_id(201),array['sc-good-001'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as noop_preview \gset
select public.admin_assign_shipping_charge_group(pg_temp.sc_apply(308,:'noop_preview')) as noop_result \gset
select pg_temp.sc_assert(:'noop_result'::jsonb#>>'{goods,0,assignmentRevision}'=:'noop_preview'::jsonb#>>'{goods,0,assignmentRevision}'
 and :'noop_result'::jsonb#>>'{goods,0,updatedAt}'=:'noop_preview'::jsonb#>>'{goods,0,updatedAt}','same-group assignment keeps version and product timestamp');
select pg_temp.sc_error(format('select public.admin_save_shipping_charge_group(%L)',pg_temp.sc_save(309,201,3,pg_temp.sc_values('min',false))),'shipping_charge_group_has_assignments');
select public.admin_save_shipping_charge_group(pg_temp.sc_save(310,201,3,pg_temp.sc_values('max'))) as max_saved \gset
reset role;
select pg_temp.sc_assert(pg_temp.sc_calculate(array['sc-good-001','sc-good-002'],array[2,2])#>>'{rawGroups,0,chargeDetails,groups,0,quantity}'='4'
 and pg_temp.sc_calculate(array['sc-good-001','sc-good-002'],array[2,2])->>'prepaidFee'='6000','repeat candidate evaluates Qgroup4 and max selects6000');
select pg_temp.sc_calculate(array['sc-good-001','sc-good-002'],array[2,2],null,'{"sc-good-002":"collect"}') as mixed \gset
select pg_temp.sc_assert(:'mixed'::jsonb->>'prepaidFee'='3000' and :'mixed'::jsonb->>'collectFee'='3000','equal S shares group basic fee across prepaid and collect');
select pg_temp.sc_assert(private.calculate_shipping_charge_group_base(private.shipping_charge_group_effective_lines(pg_temp.sc_lines(array['sc-good-001','sc-good-002'],array[2,2])))->>'totalFee'='6000','shipping savings base helper uses the exact full-calculation basic charge');
select pg_temp.sc_assert((select value from jsonb_array_elements(pg_temp.sc_calculate(array['sc-good-001','sc-other-origin'])->'rawGroups') where value->>'originId'=pg_temp.sc_id(102)::text)=
 (private.calculate_shipping_charge_groups_legacy(pg_temp.sc_lines(array['sc-other-origin']),'{"postalCode":"12345","address1":"TEST 합성주소"}','{}',statement_timestamp())#>'{rawGroups,0}'),'an unassigned second origin retains exact legacy metadata in a mixed cart');

create function pg_temp.sc_set_delivery(operation integer,good_id text,terms jsonb,mode text default 'prepaid') returns jsonb language plpgsql volatile as $$declare current_terms jsonb;begin
 current_terms:=public.admin_get_good_transaction_terms(good_id);
 return public.admin_save_good_transaction_terms(good_id,(current_terms->>'revision')::integer,(current_terms->>'goodUpdatedAt')::timestamptz,
  null,pg_temp.sc_delivery(terms,mode),pg_temp.sc_id(operation),pg_temp.sc_id(1));
end $$;
set local role authenticated;
select public.admin_preview_shipping_charge_group_assignment(pg_temp.sc_id(201),array['sc-good-003'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as free_preview \gset
select public.admin_assign_shipping_charge_group(pg_temp.sc_apply(311,:'free_preview'));
reset role;
select pg_temp.sc_assert(pg_temp.sc_calculate(array['sc-good-001','sc-good-002','sc-good-003'])->>'prepaidFee'='0','effective free wins even when mode=max');
set local role authenticated;
select public.admin_preview_shipping_charge_group_assignment(null,array['sc-good-003'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as free_clear \gset
select public.admin_assign_shipping_charge_group(pg_temp.sc_apply(312,:'free_clear'));
select public.admin_preview_shipping_charge_group_assignment(pg_temp.sc_id(201),array['sc-good-004'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as zero_preview \gset
select public.admin_assign_shipping_charge_group(pg_temp.sc_apply(313,:'zero_preview'));
reset role;
select pg_temp.sc_assert(pg_temp.sc_calculate(array['sc-good-001','sc-good-004'])->>'prepaidFee'='0','confirmed zero individual candidate wins before max');
set local role authenticated;
select public.admin_preview_shipping_charge_group_assignment(null,array['sc-good-004'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as zero_clear \gset
select public.admin_assign_shipping_charge_group(pg_temp.sc_apply(314,:'zero_clear'));
select pg_temp.sc_set_delivery(560,'sc-good-002','{"kind":"tier2","baseFee":3000,"firstLimit":3,"extra1":1000}','buyer_choice');
reset role;
select pg_temp.sc_assert(pg_temp.sc_calculate(array['sc-good-001','sc-good-002'],array[2,2])->>'prepaidFee'='4000','tier2 uses total group quantity across different goods');
set local role authenticated;
select pg_temp.sc_set_delivery(561,'sc-good-002','{"kind":"tier3","baseFee":3000,"firstLimit":3,"secondLimit":5,"extra1":1000,"extra2":2500}','buyer_choice');
reset role;
select pg_temp.sc_assert(pg_temp.sc_calculate(array['sc-good-001','sc-good-002'],array[3,3])->>'prepaidFee'='5500','tier3 uses group total six rather than own three');
set local role authenticated;
select pg_temp.sc_set_delivery(562,'sc-good-002','{"kind":"repeat","baseFee":0,"interval":2}','buyer_choice');
reset role;
select pg_temp.sc_assert(pg_temp.sc_calculate(array['sc-good-001','sc-good-002'],array[2,2])->>'prepaidFee'='0','active quantity zero candidate is confirmed free');
set local role authenticated;
select pg_temp.sc_set_delivery(563,'sc-good-002','{"kind":"repeat","baseFee":3000,"interval":2}','buyer_choice');
select public.admin_save_shipping_charge_group(pg_temp.sc_save(315,204,0,pg_temp.sc_values('max')));
select public.admin_preview_shipping_charge_group_assignment(pg_temp.sc_id(204),array['sc-good-005','sc-good-006'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as threshold_preview \gset
select public.admin_assign_shipping_charge_group(pg_temp.sc_apply(316,:'threshold_preview'));
reset role;
select pg_temp.sc_assert(pg_temp.sc_calculate(array['sc-good-005','sc-good-006'],array[1,1],array[20000,40000]::bigint[])->>'prepaidFee'='0','group policy threshold uses all S including individual-fee good');
set local role authenticated;
select public.admin_save_shipping_region_policy(null,jsonb_build_object('originId',pg_temp.sc_id(101),'carrierCode','hanjin','name','TEST 상속 지역료',
 'startsAt',now()-interval '1 day','endsAt',null,'openEnded',true,'sourceEvidence','TEST-ONLY origin carrier evidence','unlistedDisposition','standard',
 'feeUnit','per_shipment','chargePolicyGoods',true,'waivePolicyThreshold',true,'chargeFreeGoods',true,'chargeIndividualGoods',true,'noRulesConfirmed',false,
 'rules',jsonb_build_array(jsonb_build_object('id',pg_temp.sc_id(902),'postalFrom','12345','postalTo','12345','addressPrefix','',
  'regionLabel','TEST 상속 지역','disposition','surcharge','amount',1000))),null) as origin_region \gset
select public.admin_set_shipping_region_policy_status((:'origin_region'::jsonb->>'id')::uuid,'active',1,true);
reset role;
select pg_temp.sc_assert(pg_temp.sc_calculate(array['sc-good-005','sc-good-006'],array[1,1],array[20000,40000]::bigint[])#>>'{rawGroups,0,chargeDetails,originRegionalFee}'='1000'
 and pg_temp.sc_calculate(array['sc-good-005','sc-good-006'],array[1,1],array[20000,40000]::bigint[])->>'prepaidFee'='1000','group basic free does not waive independent origin region fee');
set local role authenticated;
select pg_temp.sc_auth(2,12);
select pg_temp.sc_error(format('select public.admin_save_shipping_charge_group(%L)',pg_temp.sc_save(317,203,0,pg_temp.sc_values('max',true,pg_temp.sc_region()),101,2,12,true)),
 'operator_capability_required');
select pg_temp.sc_auth();
select pg_temp.sc_error(format('select public.admin_save_shipping_charge_group(%L)',pg_temp.sc_save(317,203,0,pg_temp.sc_values('max',true,pg_temp.sc_region()))),
 'shipping_charge_group_region_confirmation_required');
select public.admin_save_shipping_charge_group(pg_temp.sc_save(318,203,0,pg_temp.sc_values('max',true,pg_temp.sc_region()),101,1,11,true)) as override_saved \gset
select pg_temp.sc_auth(2,12);
select pg_temp.sc_save(319,203,1,jsonb_set((:'override_saved'::jsonb->'group')-array['id','originId','revision','versionId','assignedCount','createdAt','updatedAt'],
 '{name}','"TEST catalog name only"'),101,2,12,false) as catalog_edit \gset
select public.admin_save_shipping_charge_group(:'catalog_edit') as catalog_saved \gset
select pg_temp.sc_assert(:'catalog_saved'::jsonb#>>'{group,revision}'='2','catalog-only operator may edit name while confirmed override remains identical');
select pg_temp.sc_error(format('select public.admin_save_shipping_charge_group(%L)',pg_temp.sc_save(320,203,2,pg_temp.sc_values('max',true,pg_temp.sc_region(4000)),101,2,12,true)),
 'operator_capability_required');
select pg_temp.sc_auth();
select public.admin_preview_shipping_charge_group_assignment(pg_temp.sc_id(203),array['sc-good-006','sc-good-007'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as override_preview \gset
select public.admin_assign_shipping_charge_group(pg_temp.sc_apply(321,:'override_preview'));
reset role;
select pg_temp.sc_calculate(array['sc-good-005','sc-good-006','sc-good-007'],array[1,1,1],array[20000,40000,60000]::bigint[]) as region_mixed \gset
select pg_temp.sc_assert(:'region_mixed'::jsonb#>>'{rawGroups,0,chargeDetails,originRegionalFee}'='1000'
 and :'region_mixed'::jsonb->>'prepaidFee'='7000','override-priced members are excluded from inherited policy S and regional target set');
select pg_temp.sc_assert(pg_temp.sc_calculate(array['sc-good-001','sc-good-005'],array[1,1],array[10000,20000]::bigint[])#>>'{rawGroups,0,chargeDetails,originRegionalFee}'='1000',
 'multiple inherited charge groups at one origin incur per_shipment once');
select pg_temp.sc_assert(jsonb_array_length(:'region_mixed'::jsonb->'rawGroups')=1
 and not(private.goods_transaction_public_shipping('cart',:'region_mixed'::jsonb->'rawGroups')::text like '%sourceEvidence%')
 and not(private.goods_transaction_public_shipping('cart',:'region_mixed'::jsonb->'rawGroups')::text like '%ownerGoodId%')
 and not(private.goods_transaction_public_shipping('gift',:'region_mixed'::jsonb->'rawGroups')::text like '%12345%'),
 'one physical origin and explicit normal/gift allowlists hide regional evidence, owners and address');
select 'SHIPPING_CHARGE_DTO:'||jsonb_build_object('kind','orderShipping','value',private.goods_transaction_public_shipping('cart',:'region_mixed'::jsonb->'rawGroups'))::text;
set local role authenticated;
select public.admin_save_shipping_charge_group(pg_temp.sc_save(322,209,0,pg_temp.sc_values('min',true,pg_temp.sc_region()),101,1,11,true));
select public.admin_preview_shipping_charge_group_assignment(pg_temp.sc_id(209),array['sc-good-008','sc-good-009'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as rounding_preview \gset
select public.admin_assign_shipping_charge_group(pg_temp.sc_apply(323,:'rounding_preview'));
reset role;
select pg_temp.sc_calculate(array['sc-good-008','sc-good-009']) as rounded \gset
select pg_temp.sc_assert(:'rounded'::jsonb#>>'{rawGroups,0,components,0,baseFee}'='1' and :'rounded'::jsonb#>>'{rawGroups,0,components,1,baseFee}'='0'
 and :'rounded'::jsonb#>>'{rawGroups,0,components,0,regionalFee}'='1500' and :'rounded'::jsonb#>>'{rawGroups,0,components,1,regionalFee}'='1500',
 'custom regional allocation uses S rather than an already rounded one-won base');
select pg_temp.sc_assert(pg_temp.sc_calculate(array['sc-good-008','sc-good-009'],array[2,2])#>>'{rawGroups,0,chargeDetails,groups,0,regionalFee}'='3000',
 'custom regional charge occurs once per charge group independent of Q');
select pg_temp.sc_assert(private.shipping_charge_group_region_match(jsonb_set(pg_temp.sc_region()->'policy','{rules,0,addressPrefix}','"TEST A"'),
 '{"postalCode":"12345","address1":"TEST B"}')->>'status'='manual_review'
 and private.shipping_charge_group_region_match(pg_temp.sc_region()->'policy',null)->>'status'='address_required','regional address mismatch and absent address remain unresolved');
set local role authenticated;
select public.admin_get_shipping_charge_group(pg_temp.sc_id(209),pg_temp.sc_id(1),pg_temp.sc_id(11)) as group209 \gset
select 'SHIPPING_CHARGE_DTO:'||jsonb_build_object('kind','get','request',jsonb_build_object('p_group_id',pg_temp.sc_id(209),'p_expected_actor_id',pg_temp.sc_id(1),'p_expected_session_id',pg_temp.sc_id(11)),'value',:'group209'::jsonb)::text;
select public.admin_save_shipping_charge_group(pg_temp.sc_save(324,209,1,pg_temp.sc_values('min',true,pg_temp.sc_region(0)),101,1,11,true));
reset role;
select pg_temp.sc_calculate(array['sc-good-008','sc-good-009']) as zero_region \gset
select pg_temp.sc_assert(:'zero_region'::jsonb#>>'{rawGroups,0,chargeDetails,groups,0,regionalFee}'='0'
 and :'zero_region'::jsonb#>>'{rawGroups,0,chargeDetails,groups,0,regionMode}'='override','confirmed zero group region fee keeps its explicit source marker');
set local role authenticated;
select public.admin_save_shipping_charge_group(pg_temp.sc_save(325,209,2,pg_temp.sc_values('min',true,
 jsonb_set(jsonb_set(jsonb_set(pg_temp.sc_region(0),'{policy,endsAt}',to_jsonb((now()-interval '1 hour')::text)),
 '{policy,openEnded}','false'),'{policy,startsAt}',to_jsonb((now()-interval '2 hours')::text))),101,1,11,true));
reset role;
select pg_temp.sc_assert(pg_temp.sc_calculate(array['sc-good-008','sc-good-009'])->>'state'='blocked','expired explicit group region never falls back to origin or zero');

set local role authenticated;
select public.admin_preview_shipping_charge_group_assignment(pg_temp.sc_id(201),array['sc-family-owner'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as family_preview \gset
select public.admin_assign_shipping_charge_group(pg_temp.sc_apply(330,:'family_preview'));
select public.admin_preview_shipping_charge_group_assignment(pg_temp.sc_id(202),array['sc-family-child'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as child_preview \gset
select pg_temp.sc_assert(:'child_preview'::jsonb->>'canAssign'='false' and :'child_preview'::jsonb#>>'{goods,0,blocker}'='goods_aggregation_policy_owned_by_source'
 and :'child_preview'::jsonb#>>'{goods,0,editable}'='false','family child shows owner scope and rejects independent assignment');
select pg_temp.sc_error(format('select public.admin_assign_shipping_charge_group(%L)',pg_temp.sc_apply(331,:'child_preview')),'goods_aggregation_policy_owned_by_source');
select public.admin_get_good_shipping_charge_group('sc-family-child',pg_temp.sc_id(1),pg_temp.sc_id(11)) as child_get \gset
select 'SHIPPING_CHARGE_DTO:'||jsonb_build_object('kind','getgood','request',jsonb_build_object('p_good_id','sc-family-child','p_expected_actor_id',pg_temp.sc_id(1),'p_expected_session_id',pg_temp.sc_id(11)),'value',:'child_get'::jsonb)::text;
reset role;
select pg_temp.sc_calculate(array['sc-family-child','sc-good-001']) as family_calculation \gset
select pg_temp.sc_assert(:'family_calculation'::jsonb#>'{rawGroups,0,chargeDetails,groups,0,goodIds}'='["sc-family-child","sc-good-001"]'::jsonb
 and private.goods_transaction_public_shipping('cart',:'family_calculation'::jsonb->'rawGroups')::text not like '%sc-family-owner%',
 'family expansion publishes only actual selected IDs in charge details');
select pg_temp.sc_assert(pg_temp.sc_calculate(array['sc-family-child','sc-family-child'],array[1,1])=
 pg_temp.sc_calculate(array['sc-family-child'],array[2]),'splitting a selected family member into equal-price lines preserves charge result');
set local role authenticated;
select public.admin_preview_shipping_charge_group_assignment(pg_temp.sc_id(201),array['sc-other-origin'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as mismatch \gset
select pg_temp.sc_assert(:'mismatch'::jsonb#>>'{goods,0,blocker}'='shipping_charge_group_origin_mismatch','same-origin ownership is explicit in preview');
select pg_temp.sc_error(format('select public.admin_assign_shipping_charge_group(%L)',pg_temp.sc_apply(332,:'mismatch')),'shipping_charge_group_origin_mismatch');
select public.admin_preview_shipping_charge_group_assignment(pg_temp.sc_id(201),array['sc-good-010'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as late_preview \gset
select public.admin_seal_shipping_charge_group_operation(pg_temp.sc_context(333,'assign',201,4)) as late_seal \gset
select pg_temp.sc_assert(public.admin_assign_shipping_charge_group(pg_temp.sc_apply(333,:'late_preview'))=:'late_seal'::jsonb,'seal blocks a late assignment after null metadata');
select public.admin_preview_shipping_charge_group_assignment(pg_temp.sc_id(201),array['sc-good-010','sc-good-011'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as stale_preview \gset
reset role;
update public.goods set individual_fee=1234 where id='sc-good-011';
set local role authenticated;
select pg_temp.sc_error(format('select public.admin_assign_shipping_charge_group(%L)',pg_temp.sc_apply(334,:'stale_preview')),'shipping_charge_group_goods_changed');
reset role;
select pg_temp.sc_assert(not exists(select 1 from private.shipping_charge_group_assignments where owner_good_id='sc-good-010')
 and not exists(select 1 from private.shipping_charge_group_operations where operation_id=pg_temp.sc_id(334)),'stale second target never commits a first-target prefix');
set local role authenticated;
select pg_temp.sc_error(format('select public.admin_preview_shipping_charge_group_assignment(%L,%L,%L,%L)',pg_temp.sc_id(201),array['sc-good-010','sc-good-010'],pg_temp.sc_id(1),pg_temp.sc_id(11)),
 'invalid_shipping_charge_group_targets');
select pg_temp.sc_error(format('select public.admin_preview_shipping_charge_group_assignment(%L,%L,%L,%L)',pg_temp.sc_id(201),
 (select array_agg('sc-good-'||lpad(n::text,3,'0')) from generate_series(1,101)n),pg_temp.sc_id(1),pg_temp.sc_id(11)),'invalid_shipping_charge_group_targets');
select public.admin_preview_shipping_charge_group_assignment(pg_temp.sc_id(201),
 (select array_agg('sc-good-'||lpad(n::text,3,'0')) from generate_series(11,110)n),pg_temp.sc_id(1),pg_temp.sc_id(11)) as hundred_preview \gset
select public.admin_assign_shipping_charge_group(pg_temp.sc_apply(335,:'hundred_preview')) as hundred_result \gset
select pg_temp.sc_assert(:'hundred_result'::jsonb->>'appliedCount'='100'
 and public.admin_assign_shipping_charge_group(pg_temp.sc_apply(335,:'hundred_preview'))=:'hundred_result'::jsonb,'100 targets apply atomically with exact fixed-request retry');
reset role;
create temp table sc_rename_head as select id,version_id,revision from private.shipping_charge_group_assignments where owner_good_id='sc-good-110';
create temp table sc_rename_versions as select to_jsonb(v) value from private.shipping_charge_group_assignment_versions v
 where assignment_id=(select id from sc_rename_head);
update public.goods set id='sc-good-renamed' where id='sc-good-110';
set constraints all immediate;
set constraints all deferred;
select pg_temp.sc_assert((select a.id=h.id and a.version_id=h.version_id and a.revision=h.revision from private.shipping_charge_group_assignments a cross join sc_rename_head h where a.owner_good_id='sc-good-renamed')
 and not exists(select 1 from sc_rename_versions old where not exists(select 1 from private.shipping_charge_group_assignment_versions v where to_jsonb(v)=old.value)),
 'catalog ID cascade preserves stable assignment identity and original immutable history');
select pg_temp.sc_error('update private.shipping_charge_group_assignment_versions set owner_good_id_at_write=''rewritten'' where owner_good_id_at_write=''sc-good-110''',
 'shipping_charge_group_history_immutable');
select pg_temp.sc_error('update public.goods set origin_id='''||pg_temp.sc_id(102)||''' where id=''sc-good-001''; set constraints all immediate',
 'shipping_charge_group_origin_mismatch');
select pg_temp.sc_assert((select origin_id=pg_temp.sc_id(101) from public.goods where id='sc-good-001'),'deferred origin guard rolls back an incompatible independent editor update');
update public.fulfillment_origins set is_active=true where id=pg_temp.sc_id(103);
set local role authenticated;
select public.admin_save_shipping_charge_group(pg_temp.sc_save(336,205,0,pg_temp.sc_values('min'),103));
select public.admin_preview_shipping_charge_group_assignment(pg_temp.sc_id(205),array['sc-inactive-origin'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as cleanup_assign \gset
select public.admin_assign_shipping_charge_group(pg_temp.sc_apply(337,:'cleanup_assign'));
reset role;
update public.fulfillment_origins set is_active=false where id=pg_temp.sc_id(103);
set local role authenticated;
select public.admin_get_good_shipping_charge_group('sc-inactive-origin',pg_temp.sc_id(1),pg_temp.sc_id(11)) as cleanup_diagnostic \gset
select public.admin_preview_shipping_charge_group_assignment(null,array['sc-inactive-origin'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as cleanup_clear \gset
select pg_temp.sc_assert(:'cleanup_diagnostic'::jsonb#>>'{good,blocker}'='shipping_charge_group_origin_unavailable'
 and :'cleanup_clear'::jsonb->>'canAssign'='true','inactive origin remains diagnosed while explicit clear is allowed');
select public.admin_assign_shipping_charge_group(pg_temp.sc_apply(338,:'cleanup_clear'));
select public.admin_save_shipping_charge_group(pg_temp.sc_save(339,205,1,jsonb_set(pg_temp.sc_values('min',false),'{archived}','true'),103)) as archived \gset
select pg_temp.sc_assert(:'archived'::jsonb#>>'{group,archived}'='true' and :'archived'::jsonb#>>'{group,assignedCount}'='0','explicit detach enables safe archive without deleting versions');
select public.admin_save_shipping_collect_contract(pg_temp.sc_id(101),1,'disabled',
 '{"collectorName":"TEST 수납사","collectionMethod":"TEST 배송 시 지급","refundContact":"TEST 환급담당","customerInstructions":"TEST 합성 계약","contractReference":"TEST 계약","dispatchMappingReference":"TEST 인계","receiptReference":"TEST 영수증","disputeContact":"TEST 분쟁담당"}',pg_temp.sc_id(564),pg_temp.sc_id(1));
select public.admin_get_good_shipping_charge_group('sc-good-002',pg_temp.sc_id(1),pg_temp.sc_id(11)) as collect_diagnostic \gset
select public.admin_preview_shipping_charge_group_assignment(null,array['sc-good-002'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as collect_clear \gset
select pg_temp.sc_assert(:'collect_diagnostic'::jsonb#>>'{good,blocker}'='collect_contract_not_ready' and :'collect_clear'::jsonb->>'canAssign'='true',
 'collector outage does not prevent explicit assignment removal');
select public.admin_assign_shipping_charge_group(pg_temp.sc_apply(340,:'collect_clear'));
select public.admin_save_shipping_collect_contract(pg_temp.sc_id(101),2,'active',
 '{"collectorName":"TEST 수납사","collectionMethod":"TEST 배송 시 지급","refundContact":"TEST 환급담당","customerInstructions":"TEST 합성 계약","contractReference":"TEST 계약","dispatchMappingReference":"TEST 인계","receiptReference":"TEST 영수증","disputeContact":"TEST 분쟁담당"}',pg_temp.sc_id(565),pg_temp.sc_id(1));
select public.admin_preview_shipping_charge_group_assignment(pg_temp.sc_id(201),array['sc-good-002'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as collect_reassign \gset
select public.admin_assign_shipping_charge_group(pg_temp.sc_apply(341,:'collect_reassign'));
select pg_temp.sc_auth(1,14);
select pg_temp.sc_error(format('select public.admin_get_shipping_charge_group(%L,%L,%L)',pg_temp.sc_id(201),pg_temp.sc_id(1),pg_temp.sc_id(14)),
 'shipping_charge_group_auth_changed');
select pg_temp.sc_auth(3,15);
select pg_temp.sc_error(format('select public.admin_get_shipping_charge_group(%L,%L,%L)',pg_temp.sc_id(201),pg_temp.sc_id(3),pg_temp.sc_id(15)),
 'operator_capability_required');
select pg_temp.sc_auth();
reset role;
select pg_temp.sc_assert(not exists(select 1 from sc_old_order old where not exists(select 1 from public.order_items i where to_jsonb(i)=old.value)),
 'all group and membership edits preserve pre-existing order-item snapshots');
select pg_temp.sc_assert(not exists(select 1 from pg_constraint where conrelid in('private.shipping_charge_groups'::regclass,'private.shipping_charge_group_versions'::regclass,
 'private.shipping_charge_group_assignments'::regclass,'private.shipping_charge_group_assignment_versions'::regclass,'private.shipping_charge_group_operations'::regclass)
 and confrelid in('auth.users'::regclass,'auth.sessions'::regclass,'public.profiles'::regclass)),
 'new immutable history does not block account deletion through auth/profile foreign keys');

-- Use the normal KC review helper for public synthetic products. It creates no
-- bypass and each fixture reviewer has the same explicit operator membership.
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','sc-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where id in('sc-good-001','sc-good-002','sc-good-005','sc-good-006','sc-family-child');
insert into private.operator_memberships(profile_id,manager_role)
 select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id in('sc-good-001','sc-good-002','sc-good-005','sc-good-006','sc-family-child');
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in('sc-good-001','sc-good-002','sc-good-005','sc-good-006','sc-family-child') order by id;
select id as variant_a from public.goods_variants where good_id='sc-good-001' and is_default \gset
select id as variant_b from public.goods_variants where good_id='sc-good-002' and is_default \gset
set local role anon;
select public.get_goods_transaction_offers(array['sc-good-001','sc-good-002','sc-family-child']) as public_offers \gset
select 'SHIPPING_CHARGE_DTO:'||jsonb_build_object('kind','offers','value',:'public_offers'::jsonb)::text;
select pg_temp.sc_assert(jsonb_array_length(:'public_offers'::jsonb)=3 and :'public_offers'::jsonb::text not like '%sc-family-owner%'
 and :'public_offers'::jsonb::text not like '%sourceEvidence%','public group offers expose neither owner identity nor contract evidence');
select pg_temp.sc_error(format('select public.quote_goods_shipping(%L)',jsonb_build_array(jsonb_build_object('goodId','sc-good-001','variantId',:'variant_a','qty',1))),
 'checkout_contract_upgrade_required');
reset role;
update private.product_detail_experience_settings set values=values||'{"shippingSavings":true}'::jsonb where section='discovery';
set local role anon;
select public.get_product_shipping_savings('sc-good-001',:'variant_a',1) as savings_max \gset
select pg_temp.sc_assert(exists(select 1 from jsonb_array_elements(:'savings_max'::jsonb->'items') item where item->>'goodId'='sc-good-002'
 and item->>'separateFee'='5500' and item->>'combinedFee'='3000' and item->>'savings'='2500'),
 'shipping savings uses max-group basic fee while excluding origin regional fee');
select pg_temp.sc_assert(not exists(select 1 from jsonb_array_elements(public.get_product_shipping_savings('sc-good-001',:'variant_a',2)->'items') item
 where item->>'goodId'='sc-good-002'),'shipping savings respects repeated quantity that can eliminate savings');
reset role;
set local role authenticated;
select pg_temp.sc_auth();
select public.admin_get_shipping_charge_group(pg_temp.sc_id(201),pg_temp.sc_id(1),pg_temp.sc_id(11)) as before_min \gset
select public.admin_save_shipping_charge_group(pg_temp.sc_save(350,201,(:'before_min'::jsonb#>>'{group,revision}')::integer,pg_temp.sc_values('min')));
reset role;
set local role anon;
select pg_temp.sc_assert(exists(select 1 from jsonb_array_elements(public.get_product_shipping_savings('sc-good-001',:'variant_a',1)->'items') item
 where item->>'goodId'='sc-good-002' and item->>'separateFee'='5500' and item->>'combinedFee'='2500' and item->>'savings'='3000'),
 'shipping savings uses the same minimum basic-fee rule');
reset role;
set local role authenticated;
select public.admin_get_shipping_charge_group(pg_temp.sc_id(201),pg_temp.sc_id(1),pg_temp.sc_id(11)) as before_max \gset
select public.admin_save_shipping_charge_group(pg_temp.sc_save(351,201,(:'before_max'::jsonb#>>'{group,revision}')::integer,pg_temp.sc_values('max')));
select public.admin_preview_shipping_charge_group_assignment(pg_temp.sc_id(204),array['sc-good-006'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as threshold_rejoin \gset
select public.admin_assign_shipping_charge_group(pg_temp.sc_apply(352,:'threshold_rejoin'));
reset role;
update public.goods set price=20000 where id='sc-good-005';update public.goods_variants set price=20000 where good_id='sc-good-005' and is_default;
update public.goods set price=40000 where id='sc-good-006';update public.goods_variants set price=40000 where good_id='sc-good-006' and is_default;
set local role anon;
select pg_temp.sc_assert(exists(select 1 from jsonb_array_elements(public.get_product_shipping_savings('sc-good-005',
 (select id from public.goods_variants where good_id='sc-good-005' and is_default),1)->'items') item
 where item->>'goodId'='sc-good-006' and item->>'separateFee'='8000' and item->>'combinedFee'='0' and item->>'savings'='8000'),
 'shipping savings honors whole-group conditional free while regional fee remains excluded');
reset role;
update private.goods_transaction_runtime set enabled=false where singleton;
set local role anon;
select pg_temp.sc_error(format('select public.get_product_shipping_savings(%L,%L,1)','sc-good-001',:'variant_a'),'checkout_contract_upgrade_required');
reset role;
update private.goods_transaction_runtime set enabled=true where singleton;
set local role authenticated;
select pg_temp.sc_auth(3,15);
select public.set_cart_item_quantity('sc-good-001',:'variant_a',2);
select public.set_cart_item_quantity('sc-good-002',:'variant_b',2);
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values) order by good_id) as cart_selection
 from public.cart_items where user_id=pg_temp.sc_id(3) \gset
select '{"recipientName":"TEST 수취인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성주소"}' as transaction_address \gset
select pg_temp.sc_error(format('select public.place_order(%L::jsonb,%L::uuid,%L::public.order_payment_method)',:'transaction_address',pg_temp.sc_id(601),'card'),'checkout_contract_upgrade_required');
reset role;
set local role service_role;
select public.quote_cart_goods_transaction(pg_temp.sc_id(3),:'cart_selection',:'transaction_address','{"sc-good-002":"collect"}',null,0) as quote_before_change \gset
select pg_temp.sc_assert(:'quote_before_change'::jsonb->>'state'='quoted'
 and :'quote_before_change'::jsonb#>>'{display,totals,prepaidShippingTotal}'='3500'
 and :'quote_before_change'::jsonb#>>'{display,totals,collectShippingTotal}'='3500','real cart quote binds max basic allocation and one origin region allocation');
reset role;
set local role authenticated;
select pg_temp.sc_auth();
select public.admin_get_shipping_charge_group(pg_temp.sc_id(201),pg_temp.sc_id(1),pg_temp.sc_id(11)) as order_group \gset
select public.admin_save_shipping_charge_group(pg_temp.sc_save(353,201,(:'order_group'::jsonb#>>'{group,revision}')::integer,pg_temp.sc_values('min')));
reset role;
set local role service_role;
select pg_temp.sc_error(format('select public.place_cart_goods_transaction(%L,%L,%L,%L,%L,%L)',pg_temp.sc_id(3),:'cart_selection',:'transaction_address',
 (:'quote_before_change'::jsonb->>'quoteId'),pg_temp.sc_id(602),'card'),'transaction_quote_changed');
select public.quote_cart_goods_transaction(pg_temp.sc_id(3),:'cart_selection',:'transaction_address','{"sc-good-002":"collect"}',null,0) as quote \gset
select 'SHIPPING_CHARGE_DTO:'||jsonb_build_object('kind','quote','value',:'quote'::jsonb)::text;
select pg_temp.sc_assert(:'quote'::jsonb#>>'{display,totals,prepaidShippingTotal}'='1750'
 and :'quote'::jsonb#>>'{display,totals,collectShippingTotal}'='1750','new quote resolves min base H/D without reusing stale group contract');
select public.place_cart_goods_transaction(pg_temp.sc_id(3),:'cart_selection',:'transaction_address',(:'quote'::jsonb->>'quoteId')::uuid,pg_temp.sc_id(603),'card') as created_order \gset
select pg_temp.sc_assert(public.place_cart_goods_transaction(pg_temp.sc_id(3),:'cart_selection',:'transaction_address',(:'quote'::jsonb->>'quoteId')::uuid,pg_temp.sc_id(603),'card')=:'created_order'::uuid,
 'same checkout key recovers the original group-priced order');
reset role;
select pg_temp.sc_assert((select count(*)=1 from public.order_shipments where order_id=:'created_order')
 and (select count(*)=2 from private.shipping_charge_components where order_id=:'created_order')
 and private.goods_order_snapshot_matches(:'created_order',(:'quote'::jsonb#>>'{display,totals,onlineTotal}')::bigint,1750),
 'group-priced order has one shipment, two actual components and valid financial snapshot');
select pg_temp.sc_assert((select bool_and(terms_snapshot#>>'{deliveryTerms,groupVersionId}' is not null
 and terms_snapshot#>>'{deliveryTerms,assignmentVersionId}' is not null) from private.shipping_charge_components where order_id=:'created_order'),
 'durable component terms bind immutable group and membership versions');
select 'SHIPPING_CHARGE_DTO:'||jsonb_build_object('kind','orderShipping','value',shipping_fee_breakdown)::text from public.orders where id=:'created_order';
create temp table sc_order_after as select to_jsonb(o) value from public.orders o where id=:'created_order';
create temp table sc_components_after as select to_jsonb(c) value from private.shipping_charge_components c where order_id=:'created_order';
select pg_temp.sc_assert(private.subscription_retention_display(:'quote'::jsonb->'display',clock_timestamp())#>'{shipping,0,chargeDetails}'=
 :'quote'::jsonb#>'{display,shipping,0,chargeDetails}','subscription retention preserves safe group charge evidence');
set local role authenticated;
select pg_temp.sc_auth();
select public.admin_get_shipping_charge_group(pg_temp.sc_id(201),pg_temp.sc_id(1),pg_temp.sc_id(11)) as after_order_group \gset
select public.admin_save_shipping_charge_group(pg_temp.sc_save(354,201,(:'after_order_group'::jsonb#>>'{group,revision}')::integer,pg_temp.sc_values('max')));
reset role;
delete from private.goods_transaction_quotes where id=(:'quote'::jsonb->>'quoteId')::uuid;
update private.goods_transaction_runtime set enabled=false where singleton;
set local role service_role;
select pg_temp.sc_assert(public.resume_cart_goods_transaction(pg_temp.sc_id(3),(:'quote'::jsonb->>'quoteId')::uuid,pg_temp.sc_id(603),'card',false)=:'created_order'::uuid,
 'successful receipt recovery survives current group edits, quote purge and runtime off');
reset role;
select pg_temp.sc_assert(not exists(select 1 from sc_order_after old where not exists(select 1 from public.orders o where to_jsonb(o)=old.value))
 and not exists(select 1 from sc_components_after old where not exists(select 1 from private.shipping_charge_components c where to_jsonb(c)=old.value)),
 'post-order group changes never rewrite order or component snapshots');
select pg_temp.sc_assert(not has_table_privilege('anon','private.shipping_charge_groups','select')
 and not has_table_privilege('authenticated','private.shipping_charge_group_versions','select')
 and not has_table_privilege('service_role','private.shipping_charge_group_assignments','insert')
 and not has_function_privilege('service_role','public.admin_save_shipping_charge_group(jsonb)','execute')
 and not has_function_privilege('authenticated','private.calculate_shipping_charge_group_shipping(jsonb,jsonb,jsonb,timestamptz)','execute')
 and has_function_privilege('authenticated','public.admin_read_shipping_charge_group_operation(jsonb)','execute'),
 'new state and internal calculators stay sealed behind operator RPCs');
set constraints all immediate;
rollback;
