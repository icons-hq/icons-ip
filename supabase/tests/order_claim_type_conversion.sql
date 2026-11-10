\set ON_ERROR_STOP on
begin;
load 'safeupdate';
create function pg_temp.convert_id(kind text,n integer) returns uuid language sql immutable as $$select md5('claim-conversion:'||kind||':'||n)::uuid$$;
create function pg_temp.convert_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected convertal error: %',expected;end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.convert_id('user',n),'authenticated','authenticated','claim-conversion-'||n||'@example.test','{}','{}' from generate_series(1,4)n;
update public.profiles set role='staff' where id in(pg_temp.convert_id('user',1),pg_temp.convert_id('user',2));
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.convert_id('user',1),'primary'),(pg_temp.convert_id('user',2),'logistics');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values(pg_temp.convert_id('origin',1),'claim-conversion-origin','전환 합성 출고지','hanjin',3000,'합성 반송 주소',true);
insert into public.ips(id,title,vertical_key) values('claim-conversion-ip','전환 검증 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
 values('claim-conversion-good','claim-conversion-ip','전환 검증 상품','문구',10000,'ok',100,pg_temp.convert_id('origin',1));
insert into public.orders(id,user_id,status,total,shipping_fee,address,delivered_at)
 select pg_temp.convert_id('order',n),pg_temp.convert_id('user',3),case when n in(1,9,10) then 'paid'::public.order_status else 'delivered'::public.order_status end,13000,3000,
 '{"recipientName":"합성 고객","phone":"01000000000","postalCode":"12345","address1":"합성시 검증로 1"}',case when n in(1,9,10) then null else now()-interval '1 day' end from generate_series(1,12)n;
insert into public.order_items(id,order_id,good_id,variant_id,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,qty,unit_price)
 select pg_temp.convert_id('item',n),pg_temp.convert_id('order',n),'claim-conversion-good',v.id,'전환 검증 상품','문구','claim-conversion-ip',1,10000
 from generate_series(1,12)n cross join public.goods_variants v where v.good_id='claim-conversion-good' and v.is_default;
create function pg_temp.convert_shipments(n integer) returns void language plpgsql as $$declare lines jsonb;quote jsonb;begin
 select jsonb_agg(jsonb_build_object('origin_id',origin_id_snapshot,'good_id',good_id,'qty',qty,'unit_price',unit_price,'fee_type',shipping_fee_type_snapshot,'individual_fee',individual_fee_snapshot)) into lines
 from public.order_items where order_id=pg_temp.convert_id('order',n);
 quote:=private.apply_shipping_region_quote(private.calculate_goods_shipping(lines),lines,'{"postalCode":"12345","address1":"합성시 검증로 1"}',clock_timestamp());
 update public.orders set shipping_fee_breakdown=quote->'groups' where id=pg_temp.convert_id('order',n);
 perform private.create_order_shipments(pg_temp.convert_id('order',n));end $$;
select pg_temp.convert_shipments(n) from generate_series(1,12)n;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,held_from,hold_reason,collected_at)
 select pg_temp.convert_id('claim',n),pg_temp.convert_id('order',n),pg_temp.convert_id('user',3),'합성 최초 신청',
 case when n in(1,9,10) then 'cancel' when n=3 then 'exchange' else 'return' end,
 case n when 3 then 'on_hold' when 4 then 'collecting' when 5 then 'collected' when 6 then 'processing' when 7 then 'on_hold' else 'requested' end,
 case n when 3 then 'in_review' when 7 then 'needs_review' else null end,
 case when n in(3,7) then '합성 고객 요청에 대한 검토 보류' else null end,
 case when n=5 then now() else null end from generate_series(1,12)n;
insert into private.seller_order_claim_intakes(claim_id,actor_id,payload,collection_snapshot)
 values(pg_temp.convert_id('claim',8),pg_temp.convert_id('user',1),'{"collections":[{"method":"customer_sent"}]}','[]');
insert into public.order_cancellation_claims(order_id,requested_by,previous_status) values(pg_temp.convert_id('order',9),pg_temp.convert_id('user',3),'paid');
insert into private.claim_refund_accounts(claim_id,bank_name,account_number,account_holder,masked_account,masked_holder)
 values(pg_temp.convert_id('claim',2),'합성 은행','1234567890','합성 고객','합성 은행 ******7890','합*객');
create temp table conversion_order_before as select o.id,o.status,o.total,o.shipping_fee,o.shipping_fee_breakdown,o.discount_total,o.store_credit_total,o.delivered_at,o.address
 from public.orders o where id in(select pg_temp.convert_id('order',n)from generate_series(1,12)n);

update public.orders set payment_method='bank_transfer' where id in(pg_temp.convert_id('order',2),pg_temp.convert_id('order',3));
update public.order_cancellation_requests set claim_type='return' where id=pg_temp.convert_id('claim',9);
update public.order_cancellation_requests set reshipped_at=clock_timestamp() where id=pg_temp.convert_id('claim',11);
create temp table conversion_before as select * from public.order_cancellation_requests where id in(select pg_temp.convert_id('claim',n)from generate_series(1,12)n);
create function pg_temp.do_convert(n integer,op integer,destination text,account jsonb default null) returns jsonb language plpgsql as $$
declare ctx jsonb;begin
 ctx:=public.admin_order_claim_type_change_context(pg_temp.convert_id('claim',n));
 return public.admin_convert_order_claim_type(pg_temp.convert_id('claim',n),pg_temp.convert_id('op',op),(ctx->>'revision')::int,destination,'합성 상담에서 유형 및 비용 처리 합의',true,account);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.convert_id('user',3)::text,true);
select pg_temp.convert_error('select pg_temp.do_convert(2,2,''exchange'')','42501');
select set_config('request.jwt.claim.sub',pg_temp.convert_id('user',2)::text,true);
select pg_temp.convert_error('select pg_temp.do_convert(2,2,''exchange'')','42501');
select set_config('request.jwt.claim.sub',pg_temp.convert_id('user',1)::text,true);
select pg_temp.convert_error('select pg_temp.do_convert(1,1,''exchange'')','claim_conversion_type_unavailable');
select pg_temp.convert_error('select pg_temp.do_convert(2,2,''return'')','claim_conversion_same_type');
select pg_temp.do_convert(2,2,'exchange') as receipt \gset
select 1/case when :'receipt'::jsonb->>'fromType'='return' and :'receipt'::jsonb->>'toType'='exchange'
 and public.admin_read_order_claim_type_change(pg_temp.convert_id('op',2))=:'receipt'::jsonb
 and public.admin_convert_order_claim_type(pg_temp.convert_id('claim',2),pg_temp.convert_id('op',2),0,'exchange','합성 상담에서 유형 및 비용 처리 합의',true,null)=:'receipt'::jsonb then 1 else 0 end as exact_replay;
select pg_temp.convert_error('select public.admin_convert_order_claim_type(pg_temp.convert_id(''claim'',2),pg_temp.convert_id(''op'',2),0,''return'',''합성 상담에서 유형 및 비용 처리 합의'',true,null)','23505');
reset role;
select 1/case when (select purge_after is not null from private.claim_refund_accounts where claim_id=pg_temp.convert_id('claim',2))then 1 else 0 end as unnecessary_account_scheduled;
set local role authenticated;
select pg_temp.do_convert(2,22,'return');
select pg_temp.convert_error('select pg_temp.do_convert(3,3,''return'')','claim_conversion_account_required');
select pg_temp.do_convert(3,3,'return','{"bankName":"합성은행","accountNumber":"8765432190","accountHolder":"합성고객"}');
select pg_temp.convert_error('select public.admin_convert_order_claim_type(pg_temp.convert_id(''claim'',3),pg_temp.convert_id(''op'',3),0,''return'',''합성 상담에서 유형 및 비용 처리 합의'',true,''{"bankName":"합성은행","accountNumber":"8765432191","accountHolder":"합성고객"}'')','23505');
select pg_temp.do_convert(4,4,'exchange');
select pg_temp.do_convert(5,5,'exchange');
select pg_temp.do_convert(8,8,'exchange');
select pg_temp.convert_error('select pg_temp.do_convert(6,6,''exchange'')','claim_conversion_stage_unavailable');
select pg_temp.convert_error('select pg_temp.do_convert(7,7,''exchange'')','claim_conversion_stage_unavailable');
select pg_temp.convert_error('select pg_temp.do_convert(9,9,''exchange'')','claim_conversion_finance_started');
select pg_temp.convert_error('select pg_temp.do_convert(11,11,''exchange'')','claim_conversion_reshipped');
select pg_temp.convert_error('select public.admin_convert_order_claim_type(pg_temp.convert_id(''claim'',12),pg_temp.convert_id(''op'',12),0,''exchange'',''동의하지 않음'',false,null)','22023');
select pg_temp.convert_error('select pg_temp.do_convert(12,12,''exchange'',''{"bankName":"합성은행","accountNumber":"8765432190","accountHolder":"합성고객"}'')','22023');
select pg_temp.convert_error('select public.admin_convert_order_claim_type(pg_temp.convert_id(''claim'',2),pg_temp.convert_id(''op'',23),0,''exchange'',''오래된 화면 동의'',true,null)','PT409');
-- No raw account or private agreement appears in the customer projection.
select set_config('request.jwt.claim.sub',pg_temp.convert_id('user',3)::text,true);
select 1/case when jsonb_array_length(public.get_my_order_claim_type_changes(pg_temp.convert_id('order',2)))=2
 and not(public.get_my_order_claim_type_changes(pg_temp.convert_id('order',3))->0?'agreement')
 and not(public.get_my_order_claim_type_changes(pg_temp.convert_id('order',3))->0?'accountSupplied') then 1 else 0 end as customer_history;
select set_config('request.jwt.claim.sub',pg_temp.convert_id('user',4)::text,true);
select pg_temp.convert_error('select public.get_my_order_claim_type_changes(pg_temp.convert_id(''order'',2))','P0002');
reset role;
select 1/case when (select count(*) from private.order_claim_type_changes where order_id in(select id from conversion_order_before))=6 then 1 else 0 end as conversion_count;
select 1/case when not exists(select 1 from conversion_before b join public.order_cancellation_requests c using(id)
 where (b.order_id,b.requested_by,b.requested_at,b.stage,b.held_from,b.hold_reason,b.held_at,b.collected_at,b.collection_policy,b.reason,b.operational_fee_kind,b.operational_fee_amount)
 is distinct from (c.order_id,c.requested_by,c.requested_at,c.stage,c.held_from,c.hold_reason,c.held_at,c.collected_at,c.collection_policy,c.reason,c.operational_fee_kind,c.operational_fee_amount))
 and (select claim_revision from public.order_cancellation_requests where id=pg_temp.convert_id('claim',2))=2
 and (select purge_after is null from private.claim_refund_accounts where claim_id=pg_temp.convert_id('claim',2))
 and (select account_number='8765432190' from private.claim_refund_accounts where claim_id=pg_temp.convert_id('claim',3))
 and not exists(select 1 from private.order_claim_type_changes where agreement like '%8765432190%')
 and (select count(*)from public.audit_log where action='admin.order.claim_type_changed' and target in(select 'order:'||id from conversion_order_before))=6
 and not exists(select 1 from public.audit_log where action='admin.order.claim_type_changed' and(diff?'agreement' or diff::text like '%8765432190%'))
 and not exists(select 1 from conversion_order_before b join public.orders o using(id) where (b.status,b.total,b.shipping_fee,b.shipping_fee_breakdown,b.discount_total,b.store_credit_total,b.delivered_at,b.address)
 is distinct from(o.status,o.total,o.shipping_fee,o.shipping_fee_breakdown,o.discount_total,o.store_credit_total,o.delivered_at,o.address))
 and (select stock_qty from public.goods where id='claim-conversion-good')=100 then 1 else 0 end as original_evidence_and_financials_preserved;
-- Purged accounts must be re-entered; reconversion may not revive null raw fields.
update private.claim_refund_accounts set bank_name=null,account_number=null,account_holder=null,purged_at=clock_timestamp() where claim_id=pg_temp.convert_id('claim',2);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.convert_id('user',1)::text,true);
select pg_temp.do_convert(2,24,'exchange');
select pg_temp.convert_error('select pg_temp.do_convert(2,25,''return'')','claim_conversion_account_required');
select 1/case when public.admin_order_claim_type_change_context(pg_temp.convert_id('claim',2))->'savedAccount'='null'::jsonb then 1 else 0 end as purged_account_hidden;
reset role;
update private.operator_memberships set manager_role='logistics' where profile_id=pg_temp.convert_id('user',1);
set local role authenticated;
select pg_temp.convert_error('select public.admin_read_order_claim_type_change(pg_temp.convert_id(''op'',2))','42501');
reset role;
select 1/case when not has_table_privilege('authenticated','private.order_claim_type_changes','SELECT')
 and not has_function_privilege('service_role','public.admin_convert_order_claim_type(uuid,uuid,integer,text,text,boolean,jsonb)','EXECUTE')
 and not has_function_privilege('anon','public.get_my_order_claim_type_changes(uuid)','EXECUTE')
 and not has_function_privilege('authenticated','private.order_claim_type_change_receipt(uuid,uuid)','EXECUTE') then 1 else 0 end as sealed_conversion_contract;
rollback;
