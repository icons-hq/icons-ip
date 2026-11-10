\set ON_ERROR_STOP on
begin;
load 'safeupdate';
create function pg_temp.cc_id(kind text,n integer) returns uuid language sql immutable as $$select md5('claim-contact:'||kind||':'||n)::uuid$$;
create function pg_temp.cc_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'claim contact assertion: %',label;end if;end$$;
create function pg_temp.cc_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;raise exception 'Expected claim contact rejection: %',expected;end$$;
create function pg_temp.cc_field(k text default 'k1') returns jsonb language sql immutable as $$select jsonb_build_object('v',1,'kid',k,'iv','AAAAAAAAAAAAAAAA','tag','AAAAAAAAAAAAAAAAAAAAAA','ct','YQ')$$;
create function pg_temp.cc_address() returns jsonb language sql immutable as $$select jsonb_build_object('recipientName',pg_temp.cc_field(),'phone',pg_temp.cc_field(),'postalCode',pg_temp.cc_field(),'address1',pg_temp.cc_field(),'address2',pg_temp.cc_field())$$;
create function pg_temp.cc_change(n integer,plan_n integer default null,noop boolean default false) returns jsonb language sql immutable as $$
 select jsonb_build_object('effect',case when noop then 'noop' else 'change' end,'changedFields',case when noop then '[]'::jsonb else '["recipientName"]'::jsonb end,
 'beforeAddressHmac',repeat('a',64),'afterAddressHmac',repeat(case when noop then 'a' else 'b' end,64),'addressHmacKeyVersion','k1',
 'plan',case when noop then null else jsonb_build_object('planId',pg_temp.cc_id('plan',coalesce(plan_n,n)),'piiVersion',pg_temp.cc_id('pii',n),'keyVersion','k1','addressHmac',repeat('b',64),'addressHmacKeyVersion','k1','address',pg_temp.cc_address()) end,
 'history',case when noop then null else jsonb_build_object('piiVersion',pg_temp.cc_id('history-pii',n),'keyVersion','k1','before',pg_temp.cc_address(),'after',pg_temp.cc_address(),'agreement',pg_temp.cc_field()) end)
$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.cc_id('user',n),'authenticated','authenticated','claim-contact-'||n||'@example.test',now(),'{}','{}' from generate_series(1,5)n;
update public.profiles set nickname='TEST contact '||right(id::text,8),role=case when id in(pg_temp.cc_id('user',1),pg_temp.cc_id('user',5)) then 'admin'::public.user_role else 'user'::public.user_role end where id in(select pg_temp.cc_id('user',n) from generate_series(1,5)n);
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) select pg_temp.cc_id('session',n),pg_temp.cc_id('user',n),now(),now(),'aal1',now()+interval '1 hour' from generate_series(1,5)n;
insert into private.operator_memberships(profile_id,manager_role) select pg_temp.cc_id('user',5),'owner' where not exists(select 1 from private.operator_memberships where manager_role='owner');
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.cc_id('user',1),'primary');
update private.operator_access_state set configured=true where id;
select pg_temp.cc_assert((select configured from private.operator_access_state where id) and(select count(*)=1 from private.operator_memberships where manager_role='owner'),'configured single owner');
insert into public.ips(id,title,vertical_key) values('cc-ip','TEST Contact','character');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active) values(pg_temp.cc_id('origin',1),'cc-origin','TEST Contact','hanjin',0,'TEST warehouse',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values('cc-good','cc-ip','TEST Contact Good','문구',1000,'ok',100,pg_temp.cc_id('origin',1));
insert into public.orders(id,user_id,status,total,shipping_fee,address,shipped_at,delivered_at)
 select pg_temp.cc_id('order',n),pg_temp.cc_id('user',2),'delivered',1000,0,
 jsonb_build_object('recipientName','원래 수령인','phone','010-1234-5678','postalCode',' 1234 ','address1',' 원본 기본 주소 ','address2','원래 상세'),now()-interval '45 days',now()-interval '44 days' from generate_series(1,18)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.cc_id('item',n),pg_temp.cc_id('order',n),'cc-good',(select id from public.goods_variants where good_id='cc-good' and is_default),1,1000,'TEST Contact Good','문구','cc-ip' from generate_series(1,18)n;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at)
 select pg_temp.cc_id('shipment',n),pg_temp.cc_id('order',n),pg_temp.cc_id('origin',1),'TEST Contact',0,'{}','delivered','hanjin','CONTACT'||lpad(n::text,8,'0'),now()-interval '45 days',now()-interval '44 days' from generate_series(1,18)n;
insert into public.order_shipment_items(shipment_id,order_id,order_item_id,qty) select pg_temp.cc_id('shipment',n),pg_temp.cc_id('order',n),pg_temp.cc_id('item',n),1 from generate_series(1,18)n;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,collection_policy,collection_required)
 select pg_temp.cc_id('claim',n),pg_temp.cc_id('order',n),pg_temp.cc_id('user',2),'TEST contact','exchange','requested','legacy',false from generate_series(1,18)n;
create temp table cc_original as select id,to_jsonb(o) value from public.orders o where id in(select pg_temp.cc_id('order',n) from generate_series(1,18)n);
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub',pg_temp.cc_id('user',1)::text,true);
create function pg_temp.cc_context(n integer,target text default 'reshipment',command text default 'change') returns jsonb language sql volatile as $$
 select public.service_get_order_claim_contact_context(pg_temp.cc_id('order',n),pg_temp.cc_id('claim',n),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),target,command)$$;
create function pg_temp.cc_expected(ctx jsonb) returns jsonb language sql immutable as $$select ctx#>'{current,source}'||jsonb_build_object('addressHmac',repeat('a',64),'addressHmacKeyVersion','k1')$$;
create function pg_temp.cc_write(n integer,operation_n integer,ctx jsonb,sealed jsonb,hmac text default repeat('c',64)) returns jsonb language sql volatile as $$
 select public.service_change_order_claim_contact(pg_temp.cc_id('order',n),pg_temp.cc_id('claim',n),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),pg_temp.cc_id('operation',operation_n),ctx->>'target',ctx->>'claimType',(ctx->>'claimRevision')::integer,pg_temp.cc_expected(ctx),sealed,hmac,'k1',true)$$;
update private.order_claim_contact_runtime set enabled=false where singleton;
select pg_temp.cc_error('select pg_temp.cc_context(1)','feature_disabled');
update private.order_claim_contact_runtime set enabled=true where singleton;
select pg_temp.cc_assert((pg_temp.cc_context(1)#>>'{current,sourceAddress,postalCode}')=' 1234 ' and(pg_temp.cc_context(1)#>>'{current,sourceAddress,address1}')=' 원본 기본 주소 ','exact readonly source strings');
create temp table cc_contexts(n integer primary key,value jsonb);
insert into cc_contexts values(1,pg_temp.cc_context(1));
create temp table cc_receipts(n integer primary key,value jsonb);
insert into cc_receipts values(1,pg_temp.cc_write(1,1,(select value from cc_contexts where n=1),pg_temp.cc_change(1)));
select pg_temp.cc_assert((select value->>'state'='saved' from cc_receipts where n=1) and(select claim_revision=(select (value->>'claimRevision')::integer+1 from cc_contexts where n=1) from public.order_cancellation_requests where id=pg_temp.cc_id('claim',1)),'save increments one revision');
select pg_temp.cc_assert((select count(*)=1 from private.order_claim_contact_plans where claim_id=pg_temp.cc_id('claim',1)) and(select count(*)=1 from private.order_claim_contact_operations where claim_id=pg_temp.cc_id('claim',1)),'one plan one operation');
select pg_temp.cc_assert(not exists(select 1 from public.orders o join cc_original b on b.id=o.id where b.value<>to_jsonb(o)),'original order unchanged');
select pg_temp.cc_assert(pg_temp.cc_write(1,1,(select value from cc_contexts where n=1),null)=(select value from cc_receipts where n=1),'exact replay accepts null seal and old revision');
select pg_temp.cc_error(format('select pg_temp.cc_write(1,1,%L::jsonb,null,%L)',(select value::text from cc_contexts where n=1),repeat('d',64)),'claim_contact_operation_conflict');
select pg_temp.cc_error(format('select pg_temp.cc_write(1,2,%L::jsonb,%L::jsonb)',(select value::text from cc_contexts where n=1),pg_temp.cc_change(2)::text),'claim_contact_changed');
insert into cc_contexts values(2,pg_temp.cc_context(1));
select pg_temp.cc_write(1,2,(select value from cc_contexts where n=2),pg_temp.cc_change(2,1));
select pg_temp.cc_assert((select revision=2 and id=pg_temp.cc_id('plan',1) and pii_version=pg_temp.cc_id('pii',2) from private.order_claim_contact_plans where claim_id=pg_temp.cc_id('claim',1)),'plan identity stable revision advances');
-- Noop leaves the claim, history, plan, audit and notification unchanged.
insert into cc_contexts values(3,pg_temp.cc_context(2));
create temp table cc_before_noop as select (select count(*) from public.audit_log) audits,(select count(*) from public.notifications) notices;
select pg_temp.cc_write(2,3,(select value from cc_contexts where n=3),pg_temp.cc_change(3,null,true));
select pg_temp.cc_assert(not exists(select 1 from private.order_claim_contact_plans where claim_id=pg_temp.cc_id('claim',2))
 and(select history is null and state='noop' from private.order_claim_contact_operations where id=pg_temp.cc_id('operation',3))
 and(select claim_revision=(select(value->>'claimRevision')::integer from cc_contexts where n=3) from public.order_cancellation_requests where id=pg_temp.cc_id('claim',2))
 and(select audits=(select count(*) from public.audit_log) and notices=(select count(*) from public.notifications) from cc_before_noop),'noop minimal only');
-- Sealed UUID can never become a write, including after runtime disables.
select pg_temp.cc_assert(public.service_read_order_claim_contact_operation(pg_temp.cc_id('order',3),pg_temp.cc_id('claim',3),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),pg_temp.cc_id('operation',4),'change','reshipment','exchange',0,false)->'receipt'='null'::jsonb,'read absent is null');
select public.service_read_order_claim_contact_operation(pg_temp.cc_id('order',3),pg_temp.cc_id('claim',3),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),pg_temp.cc_id('operation',4),'change','reshipment','exchange',0,true);
select pg_temp.cc_error(format('select pg_temp.cc_write(3,4,%L::jsonb,%L::jsonb)',pg_temp.cc_context(3)::text,pg_temp.cc_change(4)::text),'claim_contact_operation_sealed');
update private.order_claim_contact_runtime set enabled=false where singleton;
select pg_temp.cc_assert(pg_temp.cc_write(1,1,(select value from cc_contexts where n=1),null)=(select value from cc_receipts where n=1),'disabled exact replay');
select pg_temp.cc_assert(public.service_read_order_claim_contact_operation(pg_temp.cc_id('order',3),pg_temp.cc_id('claim',3),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),pg_temp.cc_id('operation',4),'change','reshipment','exchange',0,false)#>>'{receipt,state}'='sealed','disabled metadata read');
update private.order_claim_contact_runtime set enabled=true where singleton;
-- Current capability and session apply even to replay.
update private.operator_memberships set manager_role='deputy' where profile_id=pg_temp.cc_id('user',1) and manager_role<>'owner';
select pg_temp.cc_error(format('select pg_temp.cc_write(1,1,%L::jsonb,null)',(select value::text from cc_contexts where n=1)),'auth_changed');
update private.operator_memberships set manager_role='primary' where profile_id=pg_temp.cc_id('user',1) and manager_role<>'owner';
update auth.sessions set not_after=now()-interval '1 second' where id=pg_temp.cc_id('session',1);
select pg_temp.cc_error('select pg_temp.cc_context(1)','auth_changed');
update auth.sessions set not_after=now()+interval '1 hour' where id=pg_temp.cc_id('session',1);
-- Customer never receives operator identity or agreement ciphertext.
select pg_temp.cc_assert(public.service_read_order_claim_contact_history(pg_temp.cc_id('order',1),pg_temp.cc_id('claim',1),pg_temp.cc_id('user',2),pg_temp.cc_id('session',2),'customer',20,null)#>'{entries,0,actorId}'='null'::jsonb
 and public.service_read_order_claim_contact_history(pg_temp.cc_id('order',1),pg_temp.cc_id('claim',1),pg_temp.cc_id('user',2),pg_temp.cc_id('session',2),'customer',20,null)#>'{entries,0,ciphertext,agreement}'='null'::jsonb,'customer projection');
select pg_temp.cc_error(format('select public.service_read_order_claim_contact_history(%L,%L,%L,%L,%L,20,null)',pg_temp.cc_id('order',1),pg_temp.cc_id('claim',1),pg_temp.cc_id('user',3),pg_temp.cc_id('session',3),'customer'),'claim_not_found');
-- Source normalization must match the server's Unicode codepoint rules.
select pg_temp.cc_assert(private.contact_source_address(jsonb_build_object('recipientName',chr(160)||chr(65279)||'이름'||chr(8232),'phone','01012345678','postalCode',' 1 ','address1',' 기본 ','address2',chr(8233)||'상세'||chr(160)))->>'recipientName'='이름'
 and private.contact_source_address(jsonb_build_object('recipientName','이름','phone','01012345678','postalCode','1','address1','기본','address2',chr(65279)||'상세'||chr(8233)))->>'address2'='상세','Unicode trim matches JS');
select pg_temp.cc_assert(private.contact_source_address(jsonb_build_object('recipientName','이름'||chr(133),'phone','01012345678','postalCode','1','address1','기본','address2','')) is null
 and private.contact_source_address(jsonb_build_object('recipientName','이름','phone','01012345678','postalCode',chr(160),'address1','기본','address2','')) is null,'C1 controls and Unicode blank source rejected');
-- Strict envelopes fail before any new side effects.
select pg_temp.cc_error(format('select pg_temp.cc_write(4,5,%L::jsonb,%L::jsonb)',pg_temp.cc_context(4)::text,jsonb_set(pg_temp.cc_change(5),'{plan,address,phone,tag}','"AAAAAAAAAAAAAAAAAAAAAB"')::text),'invalid_claim_contact_request');
select pg_temp.cc_error(format('select pg_temp.cc_write(4,5,%L::jsonb,%L::jsonb)',pg_temp.cc_context(4)::text,(pg_temp.cc_change(5)||'{"unexpected":true}')::text),'invalid_claim_contact_request');
select pg_temp.cc_error(format('select pg_temp.cc_write(4,5,%L::jsonb,%L::jsonb)',pg_temp.cc_context(4)::text,jsonb_set(pg_temp.cc_change(5),'{effect}','null')::text),'invalid_claim_contact_request');
select pg_temp.cc_error(format('select pg_temp.cc_write(4,5,%L::jsonb,%L::jsonb)',pg_temp.cc_context(4)::text,jsonb_set(pg_temp.cc_change(5),'{plan,address,recipientName,ct}','""')::text),'invalid_claim_contact_request');
select pg_temp.cc_error(format('select pg_temp.cc_write(4,5,%L::jsonb,%L::jsonb)',pg_temp.cc_context(4)::text,jsonb_set(pg_temp.cc_change(5),'{history,agreement,ct}','""')::text),'invalid_claim_contact_request');
-- Explicit unknown hold stage and real collection handoff block edits.
update public.order_cancellation_requests set stage='on_hold',held_from='processing',held_at=now(),hold_reason='TEST hold reason' where id=pg_temp.cc_id('claim',4);
select pg_temp.cc_assert(not(pg_temp.cc_context(4)->>'allowed')::boolean,'held processing blocked');
update public.order_cancellation_requests set stage='collecting',collecting_at=now() where id=pg_temp.cc_id('claim',5);
select pg_temp.cc_assert(not(pg_temp.cc_context(5,'collection')->>'allowed')::boolean and(pg_temp.cc_context(5,'reshipment')->>'allowed')::boolean,'collection and reshipment stage gates distinct');
-- Original-source revision change is caught independently of claim revision.
insert into cc_contexts values(6,pg_temp.cc_context(6));
update public.orders set address=jsonb_set(address,'{recipientName}','"다른 이름"') where id=pg_temp.cc_id('order',6);
select pg_temp.cc_error(format('select pg_temp.cc_write(6,6,%L::jsonb,%L::jsonb)',(select value::text from cc_contexts where n=6),pg_temp.cc_change(6)::text),'claim_contact_changed');
-- Old entry points only replay already completed dispatches.
update public.order_cancellation_requests set stage='collected',collected_at=now() where id=pg_temp.cc_id('claim',7);
select pg_temp.cc_error(format('select public.admin_record_order_claim_reshipment(%L,%L,%L)',pg_temp.cc_id('claim',7),'hanjin','CONTACT7000'),'claim_contact_blocked');
select pg_temp.cc_error(format('select public.admin_record_order_claim_reshipment(%L,%L,%L,%L::jsonb)',pg_temp.cc_id('claim',7),'hanjin','CONTACT7000','[]'),'claim_contact_blocked');
insert into cc_contexts values(7,pg_temp.cc_context(7,'reshipment','reshipment'));
create function pg_temp.cc_destination(ctx jsonb,n integer) returns jsonb language sql immutable as $$
 select jsonb_build_object('piiVersion',pg_temp.cc_id('destination-pii',n),'keyVersion','k1','address',pg_temp.cc_address(),'addressHmac',repeat('a',64),'addressHmacKeyVersion','k1',
 'sourceKind',ctx#>'{current,source,sourceKind}','sourceId',ctx#>'{current,source,sourceId}','sourceRevision',ctx#>'{current,source,sourceRevision}',
 'sourcePlanRevision',ctx#>'{current,source,planRevision}','sourcePiiVersion',ctx#>'{current,source,piiVersion}')$$;
insert into cc_receipts select 7,public.service_record_order_claim_reshipment_v2(pg_temp.cc_id('order',7),pg_temp.cc_id('claim',7),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),pg_temp.cc_id('operation',7),(value->>'claimRevision')::integer,pg_temp.cc_expected(value),pg_temp.cc_destination(value,7),repeat('7',64),'k1','hanjin','CONTACT7000','[]',true) from cc_contexts where n=7;
select pg_temp.cc_assert((select stage='completed' and reship_tracking_number='CONTACT7000' from public.order_cancellation_requests where id=pg_temp.cc_id('claim',7))
 and(select count(*)=1 from private.order_claim_reshipment_destinations where claim_id=pg_temp.cc_id('claim',7))
 and current_setting('request.jwt.claim.sub')=pg_temp.cc_id('user',1)::text,'v2 dispatch snapshot atomic and actor restored');
select public.admin_record_order_claim_reshipment(pg_temp.cc_id('claim',7),'hanjin','CONTACT7000');
select pg_temp.cc_assert(private.contact_order_reshipment_pending(pg_temp.cc_id('order',7)) and private.account_deletion_blockers(pg_temp.cc_id('user',2))@>'[{"code":"active_order"}]','replacement delivery blocks account deletion');
-- Due PII is hidden before physical purge, including noop-only/no-plan fallback.
update public.order_cancellation_requests set stage='rejected',decided_at=now()-interval '40 days',decided_by=pg_temp.cc_id('user',1),decision_note='TEST terminal' where id in(select pg_temp.cc_id('claim',n) from generate_series(1,3)n);
select pg_temp.cc_assert(pg_temp.cc_context(1)#>>'{current,piiState}'='unavailable' and pg_temp.cc_context(1)#>>'{current,unavailableReason}'='retention_due'
 and pg_temp.cc_context(2)#>>'{current,unavailableReason}'='retention_due' and pg_temp.cc_context(3)#>>'{current,unavailableReason}'='retention_due','due read gate before plan and original fallback');
select pg_temp.cc_assert((select sealed_plan is not null from private.order_claim_contact_plans where claim_id=pg_temp.cc_id('claim',1)),'due is not false physical deletion');
create function pg_temp.cc_case(n integer,operation_n integer,revision bigint,reference text,action text,until_at timestamptz default null,occurred timestamptz default now()-interval '1 minute',basis text default 'statutory_preservation') returns jsonb language sql volatile as $$
 select public.service_record_order_claim_contact_retention_case(pg_temp.cc_id('order',n),pg_temp.cc_id('claim',n),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),pg_temp.cc_id('retention-operation',operation_n),revision,
 jsonb_build_object('action',action,'caseRef',reference,'approvalRef','TEST-APPROVAL','legalBasis',basis,'retainUntil',until_at,'occurredAt',occurred))$$;
insert into cc_receipts values(20,pg_temp.cc_case(1,20,0,'case-one','hold',now()+interval '1 day'));
select pg_temp.cc_assert(private.contact_retention(pg_temp.cc_id('claim',1),now())->>'state'='held' and pg_temp.cc_context(1)#>>'{current,piiState}'='available','finite hold extends due');
select pg_temp.cc_case(1,21,0,'case-two','hold',now()+interval '2 days');
select pg_temp.cc_case(1,22,1,'case-one','release',null,now());
select pg_temp.cc_assert(private.contact_retention(pg_temp.cc_id('claim',1),now())->>'state'='held','independent second hold remains');
select pg_temp.cc_error('select pg_temp.cc_case(1,23,0,''case-two'',''extend'',now()+interval ''3 days'')','claim_contact_changed');
select pg_temp.cc_error('select pg_temp.cc_case(1,24,1,''case-two'',''extend'',now()+interval ''1 day'')','claim_contact_blocked');
select pg_temp.cc_assert(pg_temp.cc_case(1,20,0,'case-one','hold',now()+interval '1 day')=(select value from cc_receipts where n=20),'case exact replay frozen even after release');
-- Default no exception purges without an assessment and runtime/key access.
update private.order_claim_contact_runtime set enabled=false where singleton;
insert into cc_receipts values(30,public.service_purge_order_claim_contact_data(pg_temp.cc_id('user',2),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),pg_temp.cc_id('retention-operation',30),now(),1));
select pg_temp.cc_assert(jsonb_array_length((select value->'purgedClaimIds' from cc_receipts where n=30))=1 and (select (value->>'selectedResidualPiiFields')::integer=0 and(value#>>'{remaining,eligibleScopes}')::integer>=1 from cc_receipts where n=30),'bounded purge reports remaining');
select pg_temp.cc_assert(public.service_purge_order_claim_contact_data(pg_temp.cc_id('user',2),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),pg_temp.cc_id('retention-operation',30),now(),1)=(select value from cc_receipts where n=30),'purge exact replay freezes selected subset');
select public.service_purge_order_claim_contact_data(pg_temp.cc_id('user',2),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),pg_temp.cc_id('retention-operation',31),now(),100);
select pg_temp.cc_assert((select count(*)=4 from private.order_claim_contact_plans where claim_id in(pg_temp.cc_id('claim',2),pg_temp.cc_id('claim',3)) and purged_at is not null),'noop-only and absent plans receive both tombstones');
select pg_temp.cc_assert((select request_hmac is null and hmac_key_version is null and purged_at is not null from private.order_claim_contact_operations where id=pg_temp.cc_id('operation',3)),'noop request binding purged');
select pg_temp.cc_assert(public.service_read_order_claim_contact_operation(pg_temp.cc_id('order',3),pg_temp.cc_id('claim',3),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),pg_temp.cc_id('operation',4),'change','reshipment','exchange',0,false)#>>'{receipt,piiState}'='not_stored','sealed receipt unchanged by purge');
select pg_temp.cc_case(1,32,1,'case-two','release',null,now());
select pg_temp.cc_assert(private.contact_retention(pg_temp.cc_id('claim',1),now())->>'state'='due','release does not restart 30 days');
select public.service_purge_order_claim_contact_data(pg_temp.cc_id('user',2),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),pg_temp.cc_id('retention-operation',33),now(),100);
select pg_temp.cc_assert(private.contact_count_sum(private.contact_counts(pg_temp.cc_id('claim',1)))=0,'all selected ciphertext and HMAC removed');
select pg_temp.cc_error(format('select pg_temp.cc_write(1,1,%L::jsonb,null)',(select value::text from cc_contexts where n=1)),'claim_contact_purged');
update private.order_claim_contact_runtime set enabled=true where singleton;
select pg_temp.cc_assert(pg_temp.cc_context(1)#>>'{current,piiState}'='purged' and pg_temp.cc_context(2)#>'{current,sourceAddress}'='null'::jsonb,'permanent purge tombstone blocks fallback');
select pg_temp.cc_error(format('select public.service_purge_order_claim_contact_data(%L,%L,%L,%L,now()+interval ''1 second'',1)',pg_temp.cc_id('user',2),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),pg_temp.cc_id('retention-operation',34)),'invalid_claim_contact_request');
-- Immutable seller intake identity is its claim_id primary key.
insert into private.seller_order_claim_intakes(claim_id,actor_id,payload,collection_snapshot) values(pg_temp.cc_id('claim',8),pg_temp.cc_id('user',1),
 jsonb_build_object('collectionAddress',jsonb_build_object('recipientName','판매자 접수','phone','01022223333','postalCode','98765','address1','접수 기본','address2','접수 상세'),
 'collections',jsonb_build_array(jsonb_build_object('shipmentId',pg_temp.cc_id('shipment',8),'method','not_requested','carrier',null,'trackingNumber',null,'note',''))),'[]');
select pg_temp.cc_assert(pg_temp.cc_context(8,'collection')#>>'{current,source,sourceKind}'='seller_intake'
 and pg_temp.cc_context(8,'collection')#>>'{current,source,sourceId}'=pg_temp.cc_id('claim',8)::text
 and pg_temp.cc_context(8,'collection')#>>'{current,sourceAddress,recipientName}'='판매자 접수'
 and not(pg_temp.cc_context(8,'collection')#>>'{current,referenceOnly}')::boolean,'seller intake uses immutable claim identity');
select pg_temp.cc_write(8,8,pg_temp.cc_context(8,'collection'),pg_temp.cc_change(8));
select pg_temp.cc_assert((select payload#>>'{collectionAddress,recipientName}'='판매자 접수' from private.seller_order_claim_intakes where claim_id=pg_temp.cc_id('claim',8)),'seller immutable source retained');
-- Gift sender cannot obtain recipient address from either source or new history.
update public.orders set address=null where id=pg_temp.cc_id('order',9);
insert into private.gift_intents(id,sender_id,recipient_id,state,sender_label,recipient_label,expires_at,order_id,ordered_source_revision)
 values(pg_temp.cc_id('gift',9),pg_temp.cc_id('user',2),pg_temp.cc_id('user',3),'ordered','TEST sender','TEST recipient',now()+interval '1 day',pg_temp.cc_id('order',9),'1:synthetic');
insert into private.order_delivery_private_snapshots(order_id,gift_id,recipient_id,address,gift_address_revision,source_revision,shipping_evidence)
 values(pg_temp.cc_id('order',9),pg_temp.cc_id('gift',9),pg_temp.cc_id('user',3),jsonb_build_object('recipientName','선물 수취인','phone','01099998888','postalCode','00000','address1','선물 전용 주소','address2',''),1,'1:synthetic','[]');
select pg_temp.cc_assert(pg_temp.cc_context(9)#>>'{current,sourceAddress,recipientName}'='선물 수취인','gift uses private delivery snapshot');
select pg_temp.cc_write(9,9,pg_temp.cc_context(9),pg_temp.cc_change(9));
create temp table cc_gift_views as select public.service_read_order_claim_contact_history(pg_temp.cc_id('order',9),pg_temp.cc_id('claim',9),pg_temp.cc_id('user',2),pg_temp.cc_id('session',2),'customer',20,null) sender,
 public.service_read_order_claim_contact_history(pg_temp.cc_id('order',9),pg_temp.cc_id('claim',9),pg_temp.cc_id('user',3),pg_temp.cc_id('session',3),'customer',20,null) recipient;
select pg_temp.cc_assert((select sender->>'viewerKind'='gift_sender' and sender#>'{current,collection,sourceAddress}'='null'::jsonb and sender#>'{current,reshipment,plan}'='null'::jsonb
 and sender#>'{entries,0,ciphertext}'='null'::jsonb and sender#>'{entries,0,actorId}'='null'::jsonb
 and recipient->>'viewerKind'='gift_recipient' and recipient#>>'{current,reshipment,piiState}'='available' and recipient#>'{entries,0,ciphertext,agreement}'='null'::jsonb from cc_gift_views),'gift party DB boundary');
-- Inventory is bounded and resolves the actual address subject.
select pg_temp.cc_assert(jsonb_array_length(public.service_inventory_order_claim_contact_data(pg_temp.cc_id('user',3),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),1,null)->'scopes')=1
 and public.service_inventory_order_claim_contact_data(pg_temp.cc_id('user',3),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),1,null)#>>'{scopes,0,subjectKind}'='gift_recipient','gift inventory uses recipient');
select pg_temp.cc_assert(public.service_inventory_order_claim_contact_data(pg_temp.cc_id('user',1),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),1,null)->>'operatorReferenceCount'<>'0'
 and public.service_inventory_order_claim_contact_data(pg_temp.cc_id('user',1),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),1,null)->'scopes'='[]'::jsonb,'operator reference is not customer scope');
-- Closed dispute time, not recording/releasing a hold, moves purpose end.
update public.order_cancellation_requests set stage='rejected',decided_at=now()-interval '40 days',decided_by=pg_temp.cc_id('user',1),decision_note='TEST terminal' where id in(pg_temp.cc_id('claim',10),pg_temp.cc_id('claim',11));
select pg_temp.cc_case(10,40,0,'short-hold','hold',clock_timestamp()+interval '1 second',now()-interval '1 minute');
select pg_sleep(1.05);
select pg_temp.cc_assert(private.contact_retention(pg_temp.cc_id('claim',10),clock_timestamp())->>'state'='due'
 and(private.contact_retention(pg_temp.cc_id('claim',10),clock_timestamp())->>'expiredHoldCount')::integer=1
 and(select state='held' and case_closed_at is null from private.order_claim_contact_retention_cases where claim_id=pg_temp.cc_id('claim',10)),'expired finite hold stays held and permits due');
select pg_temp.cc_case(11,41,0,'closed-dispute','close',null,now()-interval '1 day','dispute_resolution');
select pg_temp.cc_assert(private.contact_retention(pg_temp.cc_id('claim',11),clock_timestamp())->>'state'='not_due'
 and(private.contact_retention(pg_temp.cc_id('claim',11),clock_timestamp())->>'purposeEndedAt')::timestamptz=now()-interval '1 day','actual dispute closure restarts purpose clock');
select pg_temp.cc_error('select pg_temp.cc_case(11,42,1,''closed-dispute'',''hold'',clock_timestamp()+interval ''1 day'',now(),''dispute_resolution'')','claim_contact_blocked');
select pg_temp.cc_error('select pg_temp.cc_case(11,43,0,''future'',''hold'',clock_timestamp()+interval ''1 day'',clock_timestamp()+interval ''1 hour'')','invalid_claim_contact_request');
-- Canceled returned orders use historical shipment and actual return evidence.
update public.order_cancellation_requests set claim_type='return',stage='collected',collected_at=now()-interval '41 days' where id=pg_temp.cc_id('claim',12);
insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,raw,provider) values(pg_temp.cc_id('payment',12),pg_temp.cc_id('user',2),'order',pg_temp.cc_id('order',12),1000,'refunded','cc-synthetic-refunded','cc-synthetic-refunded','{}','toss');
insert into public.refunds(id,payment_id,amount,reason,status,cancellation_request_id,completed_at) values(pg_temp.cc_id('refund',12),pg_temp.cc_id('payment',12),1000,'TEST resolved return','done',pg_temp.cc_id('claim',12),now()-interval '40 days');
update public.orders set status='canceled' where id=pg_temp.cc_id('order',12);
update public.order_cancellation_requests set stage='completed',completed_at=now()-interval '40 days' where id=pg_temp.cc_id('claim',12);
select pg_temp.cc_assert(not private.order_all_items_delivered(pg_temp.cc_id('order',12)) and private.contact_retention(pg_temp.cc_id('claim',12),clock_timestamp())->>'state'='due','canceled order does not permanently depend on delivered status');
update public.order_cancellation_requests set claim_type='return',stage='completed',completed_at=now()-interval '40 days' where id=pg_temp.cc_id('claim',13);
select pg_temp.cc_assert(private.contact_retention(pg_temp.cc_id('claim',13),clock_timestamp())->>'state'='operational_unknown','missing actual return evidence blocks purge');
-- A known completed replacement's actual delivery date controls retention.
update public.order_cancellation_requests set reshipped_at=now()-interval '43 days',completed_at=now()-interval '43 days',collected_at=now()-interval '44 days',
 reship_delivered_at=now()-interval '40 days',reship_delivered_by=pg_temp.cc_id('user',1),reship_delivery_evidence='TEST actual delivered' where id=pg_temp.cc_id('claim',7);
select pg_temp.cc_assert(private.contact_retention(pg_temp.cc_id('claim',7),clock_timestamp())->>'state'='due','replacement delivery closes obligation');
select public.service_purge_order_claim_contact_data(pg_temp.cc_id('user',2),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),pg_temp.cc_id('retention-operation',44),clock_timestamp(),100);
select pg_temp.cc_assert((select destination is null and purged_at is not null from private.order_claim_reshipment_destinations where claim_id=pg_temp.cc_id('claim',7)),'final destination purged with operation');
-- Type changes invalidate contexts while the same claim/target plan is retained.
insert into cc_contexts values(15,pg_temp.cc_context(15));
update public.order_cancellation_requests set claim_type='return' where id=pg_temp.cc_id('claim',15);
select pg_temp.cc_assert(pg_temp.cc_context(15)#>>'{current,piiState}'='not_applicable','return reshipment is not applicable');
update public.order_cancellation_requests set claim_type='exchange' where id=pg_temp.cc_id('claim',15);
select pg_temp.cc_error(format('select pg_temp.cc_write(15,15,%L::jsonb,%L::jsonb)',(select value::text from cc_contexts where n=15),pg_temp.cc_change(15)::text),'claim_contact_changed');
-- Purge reports every retained target even after exchange-to-return conversion.
select pg_temp.cc_write(15,151,pg_temp.cc_context(15),pg_temp.cc_change(151));
update public.order_cancellation_requests set claim_type='return',stage='rejected',decided_at=now()-interval '40 days',decided_by=pg_temp.cc_id('user',1),decision_note='TEST return terminal' where id=pg_temp.cc_id('claim',15);
insert into cc_receipts values(50,public.service_purge_order_claim_contact_data(pg_temp.cc_id('user',2),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),pg_temp.cc_id('retention-operation',50),clock_timestamp(),100));
select pg_temp.cc_assert((select (value->>'purgedTargetCount')::integer=2 and value->'purgedClaimIds'=jsonb_build_array(pg_temp.cc_id('claim',15)) from cc_receipts where n=50)
 and(select count(*)=2 from private.order_claim_contact_plans where claim_id=pg_temp.cc_id('claim',15) and purged_at is not null),'purge counts historical reshipment target');
-- Every entry carries its own state and page cursor is scoped/ordered.
select pg_temp.cc_assert(jsonb_array_length(public.service_read_order_claim_contact_history(pg_temp.cc_id('order',1),pg_temp.cc_id('claim',1),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),'operator',1,null)->'entries')=1
 and public.service_read_order_claim_contact_history(pg_temp.cc_id('order',1),pg_temp.cc_id('claim',1),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1),'operator',1,null)->'nextCursor'<>'null'::jsonb,'history pagination remains metadata after purge');
select pg_temp.cc_error(format('select public.service_read_order_claim_contact_history(%L,%L,%L,%L,''operator'',21,null)',pg_temp.cc_id('order',1),pg_temp.cc_id('claim',1),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1)),'invalid_claim_contact_request');

-- ACL and default runtime are part of the public contract.
select pg_temp.cc_assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and(p.proname like 'contact_%' or p.proname='record_order_claim_reshipment_physical') and(has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE'))),'private helpers closed to client and service roles');
select pg_temp.cc_assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and(p.proname like 'service_%claim_contact%' or p.proname='service_record_order_claim_reshipment_v2')
 and(has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))),'service RPC closed to clients');
select pg_temp.cc_assert(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and(c.relname like 'order_claim_contact_%' or c.relname='order_claim_reshipment_destinations')
 and(not c.relrowsecurity or has_table_privilege('authenticated',c.oid,'SELECT') or has_table_privilege('service_role',c.oid,'SELECT'))),'private state RLS and no direct grants');
set constraints all immediate;
rollback;
