\set ON_ERROR_STOP on
begin;
load 'safeupdate';
create function pg_temp.cc_id(kind text,n integer) returns uuid language sql immutable as $$select md5('claim-contact-full:'||kind||':'||n)::uuid$$;
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
 select pg_temp.cc_id('user',n),'authenticated','authenticated','claim-contact-full-'||n||'@example.test',now(),'{}','{}' from generate_series(1,5)n;
update public.profiles set nickname='TEST contact '||right(id::text,8),role=case when id in(pg_temp.cc_id('user',1),pg_temp.cc_id('user',5)) then 'admin'::public.user_role else 'user'::public.user_role end where id in(select pg_temp.cc_id('user',n) from generate_series(1,5)n);
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) select pg_temp.cc_id('session',n),pg_temp.cc_id('user',n),now(),now(),'aal1',now()+interval '1 hour' from generate_series(1,5)n;
insert into private.operator_memberships(profile_id,manager_role) select pg_temp.cc_id('user',5),'owner' where not exists(select 1 from private.operator_memberships where manager_role='owner');
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.cc_id('user',1),'primary');
update private.operator_access_state set configured=true where id;
select pg_temp.cc_assert((select configured from private.operator_access_state where id) and(select count(*)=1 from private.operator_memberships where manager_role='owner'),'configured single owner');
insert into public.ips(id,title,vertical_key) values('cc-full-ip','TEST Contact','character');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active) values(pg_temp.cc_id('origin',1),'cc-full-origin','TEST Contact','hanjin',0,'TEST warehouse',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values('cc-full-good','cc-full-ip','TEST Contact Good','문구',1000,'ok',100,pg_temp.cc_id('origin',1));
insert into public.orders(id,user_id,status,total,shipping_fee,address,shipped_at,delivered_at)
 select pg_temp.cc_id('order',n),pg_temp.cc_id('user',2),'delivered',1000,0,
 jsonb_build_object('recipientName','원래 수령인','phone','010-1234-5678','postalCode',' 1234 ','address1',' 원본 기본 주소 ','address2','원래 상세'),now()-interval '45 days',now()-interval '44 days' from generate_series(1,18)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.cc_id('item',n),pg_temp.cc_id('order',n),'cc-full-good',(select id from public.goods_variants where good_id='cc-full-good' and is_default),1,1000,'TEST Contact Good','문구','cc-full-ip' from generate_series(1,18)n;
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

update private.order_claim_contact_runtime set enabled=true where singleton;
update public.orders set address=jsonb_set(address,'{postalCode}','"01234"') where id in(select pg_temp.cc_id('order',n) from generate_series(1,18)n);
update public.order_shipments set shipping_fee_snapshot=jsonb_build_object('chargeGroupContract',jsonb_build_object('groups','[]'::jsonb,'originRegionPolicy',jsonb_build_object('configuration',jsonb_build_object('unlistedDisposition','standard','rules',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'postalFrom','60000','postalTo','69999','addressPrefix','','disposition','surcharge','amount',5000))))))
 where order_id in(select pg_temp.cc_id('order',n) from generate_series(1,18)n);
create function pg_temp.full_change(n integer,postal text) returns jsonb language sql volatile as $$select pg_temp.cc_change(n)||jsonb_build_object('changedFields','["postalCode","address1"]'::jsonb,'destinationCheck',jsonb_build_object('before',jsonb_build_object('postalCode','01234','address1','원본 기본 주소'),'after',jsonb_build_object('postalCode',postal,'address1','TEST 다른 기본 주소')))$$;
create temp table full_result(value jsonb);
insert into full_result select pg_temp.cc_write(1,1,pg_temp.cc_context(1),pg_temp.full_change(1,'45678'));
select pg_temp.cc_assert((select value->>'state'='saved' and value->'changedFields'='["postalCode","address1"]'::jsonb from full_result),'same tariff full address saved');
select pg_temp.cc_assert((select address->>'postalCode'='01234' from public.orders where id=pg_temp.cc_id('order',1)),'original order address immutable');
select pg_temp.cc_error(format('select pg_temp.cc_write(2,2,%L::jsonb,%L::jsonb)',pg_temp.cc_context(2)::text,pg_temp.full_change(2,'61234')::text),'claim_contact_address_price_changed');
select pg_temp.cc_assert(not exists(select 1 from private.order_claim_contact_operations where id=pg_temp.cc_id('operation',2)),'changed price has no receipt');
update public.order_shipments set shipping_fee_snapshot='{}' where order_id=pg_temp.cc_id('order',3);
select pg_temp.cc_error(format('select pg_temp.cc_write(3,3,%L::jsonb,%L::jsonb)',pg_temp.cc_context(3)::text,pg_temp.full_change(3,'45678')::text),'claim_contact_address_price_unknown');
-- Contact-only edits remain possible without a regional contract.
select pg_temp.cc_write(3,3,pg_temp.cc_context(3),pg_temp.cc_change(3));
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cc_id('user',1),'role','authenticated','session_id',pg_temp.cc_id('session',1))::text,true);
set local role authenticated;
create temp table collection_context(value jsonb);
insert into collection_context select public.admin_read_claim_collection_plan(pg_temp.cc_id('claim',4),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1));
create temp table collection_result(value jsonb);
insert into collection_result select public.admin_save_claim_collection_plan(pg_temp.cc_id('claim',4),pg_temp.cc_id('shipment',4),0,(value->>'claimRevision')::integer,
 '{"method":"customer_sent","carrier":"hanjin","trackingNumber":"CLAIM12345678","evidence":"TEST carrier confirmed","confirmed":true}',pg_temp.cc_id('collection_op',1),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1)) from collection_context;
select pg_temp.cc_assert((select value#>>'{rows,0,method}'='customer_sent' and value#>>'{rows,0,revision}'='1' from collection_result),'collection shipment stored');
select pg_temp.cc_assert((select public.admin_save_claim_collection_plan(pg_temp.cc_id('claim',4),pg_temp.cc_id('shipment',4),0,(value->>'claimRevision')::integer,
 '{"method":"customer_sent","carrier":"hanjin","trackingNumber":"CLAIM12345678","evidence":"TEST carrier confirmed","confirmed":true}',pg_temp.cc_id('collection_op',1),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1))=(select value from collection_result) from collection_context),'same operation replay');
select pg_temp.cc_error(format('select public.admin_save_claim_collection_plan(%L,%L,1,%s,%L::jsonb,%L,%L,%L)',pg_temp.cc_id('claim',4),pg_temp.cc_id('shipment',4),(select value->>'claimRevision' from collection_result),'{"method":"not_requested","carrier":null,"trackingNumber":null,"evidence":"TEST reverse","confirmed":true}',pg_temp.cc_id('collection_op',2),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1)),'claim_collection_already_started');
reset role;
select pg_temp.cc_assert((select count(*)=1 from private.claim_collection_events where claim_id=pg_temp.cc_id('claim',4)),'duplicate no event');
select pg_temp.cc_assert(private.contact_blocker((select c from public.order_cancellation_requests c where id=pg_temp.cc_id('claim',4)),'collection','change')='collection_started','collection plan locks address');
select pg_temp.cc_assert(private.order_claim_withdrawal_blocker((select c from public.order_cancellation_requests c where id=pg_temp.cc_id('claim',4)))='claim_withdrawal_collection_started','sent once blocks withdrawal');
select pg_temp.cc_assert((select collected_at is null from public.order_cancellation_requests where id=pg_temp.cc_id('claim',4)) and not exists(select 1 from public.refunds where cancellation_request_id=pg_temp.cc_id('claim',4)),'recording metadata never proves receipt or refund');
select set_config('request.jwt.claim.sub',pg_temp.cc_id('user',2)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cc_id('user',2),'role','authenticated','session_id',pg_temp.cc_id('session',2))::text,true);
set local role authenticated;
select pg_temp.cc_assert(public.read_my_claim_collection_plan(pg_temp.cc_id('claim',4),pg_temp.cc_id('user',2),pg_temp.cc_id('session',2))#>>'{rows,0,trackingNumber}'='CLAIM12345678','owner sees tracking');
select pg_temp.cc_assert(public.read_my_claim_collection_plan(pg_temp.cc_id('claim',4),pg_temp.cc_id('user',2),pg_temp.cc_id('session',2))#>>'{rows,0,evidence}'='','internal evidence withheld');
select pg_temp.cc_assert(public.read_my_claim_collection_plan(pg_temp.cc_id('claim',4),pg_temp.cc_id('user',2),pg_temp.cc_id('session',2))#>>'{rows,0,carrierLabel}'='한진택배','customer registry carrier label');
select pg_temp.cc_error(format('select public.admin_read_claim_collection_plan(%L,%L,%L)',pg_temp.cc_id('claim',4),pg_temp.cc_id('user',2),pg_temp.cc_id('session',2)),'42501');
reset role;
-- Gift delivery identifiers are visible to the recipient, never the sender.
update public.orders set address=null where id=pg_temp.cc_id('order',9);
insert into private.gift_intents(id,sender_id,recipient_id,state,sender_label,recipient_label,expires_at,order_id,ordered_source_revision)
 values(pg_temp.cc_id('gift',9),pg_temp.cc_id('user',2),pg_temp.cc_id('user',3),'ordered','TEST sender','TEST recipient',now()+interval '1 day',pg_temp.cc_id('order',9),'1:synthetic');
set local role authenticated;
select pg_temp.cc_assert(public.read_my_claim_collection_plan(pg_temp.cc_id('claim',9),pg_temp.cc_id('user',2),pg_temp.cc_id('session',2)) is null,'gift sender collection withheld');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.cc_id('user',3)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cc_id('user',3),'role','authenticated','session_id',pg_temp.cc_id('session',3))::text,true);
set local role authenticated;
select pg_temp.cc_assert(public.read_my_claim_collection_plan(pg_temp.cc_id('claim',9),pg_temp.cc_id('user',3),pg_temp.cc_id('session',3))->>'claimId'=pg_temp.cc_id('claim',9)::text,'gift recipient collection visible');
select pg_temp.cc_error(format('select public.read_my_claim_collection_plan(%L,%L,%L)',pg_temp.cc_id('claim',4),pg_temp.cc_id('user',3),pg_temp.cc_id('session',3)),'claim_not_found');
reset role;
select pg_temp.cc_assert(not has_function_privilege('authenticated','private.assert_claim_destination_same_price(uuid,jsonb,jsonb)','execute'),'price helper sealed');
select pg_temp.cc_assert(not has_table_privilege('authenticated','private.claim_collection_plans','select'),'plan table sealed');
rollback;
