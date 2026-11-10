\set ON_ERROR_STOP on
begin;
load 'safeupdate';
create function pg_temp.withdraw_id(kind text,n integer) returns uuid language sql immutable as $$select md5('claim-withdrawal:'||kind||':'||n)::uuid$$;
create function pg_temp.withdraw_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected withdrawal error: %',expected;end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.withdraw_id('user',n),'authenticated','authenticated','claim-withdrawal-'||n||'@example.test','{}','{}' from generate_series(1,4)n;
update public.profiles set role='staff' where id in(pg_temp.withdraw_id('user',1),pg_temp.withdraw_id('user',2));
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.withdraw_id('user',1),'primary'),(pg_temp.withdraw_id('user',2),'logistics');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values(pg_temp.withdraw_id('origin',1),'claim-withdrawal-origin','철회 합성 출고지','hanjin',3000,'합성 반송 주소',true);
insert into public.ips(id,title,vertical_key) values('claim-withdrawal-ip','철회 검증 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
 values('claim-withdrawal-good','claim-withdrawal-ip','철회 검증 상품','문구',10000,'ok',100,pg_temp.withdraw_id('origin',1));
insert into public.orders(id,user_id,status,total,shipping_fee,address,delivered_at)
 select pg_temp.withdraw_id('order',n),pg_temp.withdraw_id('user',3),case when n in(1,9,10) then 'paid'::public.order_status else 'delivered'::public.order_status end,13000,3000,
 '{"recipientName":"합성 고객","phone":"01000000000","postalCode":"12345","address1":"합성시 검증로 1"}',case when n in(1,9,10) then null else now()-interval '1 day' end from generate_series(1,12)n;
insert into public.order_items(id,order_id,good_id,variant_id,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,qty,unit_price)
 select pg_temp.withdraw_id('item',n),pg_temp.withdraw_id('order',n),'claim-withdrawal-good',v.id,'철회 검증 상품','문구','claim-withdrawal-ip',1,10000
 from generate_series(1,12)n cross join public.goods_variants v where v.good_id='claim-withdrawal-good' and v.is_default;
create function pg_temp.withdraw_shipments(n integer) returns void language plpgsql as $$declare lines jsonb;quote jsonb;begin
 select jsonb_agg(jsonb_build_object('origin_id',origin_id_snapshot,'good_id',good_id,'qty',qty,'unit_price',unit_price,'fee_type',shipping_fee_type_snapshot,'individual_fee',individual_fee_snapshot)) into lines
 from public.order_items where order_id=pg_temp.withdraw_id('order',n);
 quote:=private.apply_shipping_region_quote(private.calculate_goods_shipping(lines),lines,'{"postalCode":"12345","address1":"합성시 검증로 1"}',clock_timestamp());
 update public.orders set shipping_fee_breakdown=quote->'groups' where id=pg_temp.withdraw_id('order',n);
 perform private.create_order_shipments(pg_temp.withdraw_id('order',n));end $$;
select pg_temp.withdraw_shipments(n) from generate_series(1,12)n;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,held_from,hold_reason,collected_at)
 select pg_temp.withdraw_id('claim',n),pg_temp.withdraw_id('order',n),pg_temp.withdraw_id('user',3),'합성 최초 신청',
 case when n in(1,9,10) then 'cancel' when n=3 then 'exchange' else 'return' end,
 case n when 3 then 'on_hold' when 4 then 'collecting' when 5 then 'collected' when 6 then 'processing' when 7 then 'on_hold' else 'requested' end,
 case n when 3 then 'in_review' when 7 then 'needs_review' else null end,
 case when n in(3,7) then '합성 고객 요청에 대한 검토 보류' else null end,
 case when n=5 then now() else null end from generate_series(1,12)n;
insert into private.seller_order_claim_intakes(claim_id,actor_id,payload,collection_snapshot)
 values(pg_temp.withdraw_id('claim',8),pg_temp.withdraw_id('user',1),'{"collections":[{"method":"customer_sent"}]}','[]');
insert into public.order_cancellation_claims(order_id,requested_by,previous_status) values(pg_temp.withdraw_id('order',9),pg_temp.withdraw_id('user',3),'paid');
insert into private.claim_refund_accounts(claim_id,bank_name,account_number,account_holder,masked_account,masked_holder)
 values(pg_temp.withdraw_id('claim',2),'합성 은행','1234567890','합성 고객','합성 은행 ******7890','합*객');
create temp table withdrawal_before as select o.id,o.status,o.total,o.shipping_fee,o.shipping_fee_breakdown,o.discount_total,o.store_credit_total,o.delivered_at,o.address
 from public.orders o where id in(select pg_temp.withdraw_id('order',n)from generate_series(1,12)n);
create function pg_temp.do_withdraw(n integer,operation integer,as_operator boolean default false) returns jsonb language plpgsql as $$
declare c jsonb;
begin
 if as_operator then
 c:=public.admin_order_claim_withdrawal_context(pg_temp.withdraw_id('claim',n));
 return public.admin_withdraw_order_claim(pg_temp.withdraw_id('claim',n),pg_temp.withdraw_id('op',operation),(c->>'revision')::integer,'합성 고객의 요청 철회 동의',true);
 else
 c:=public.get_my_order_claim_withdrawal_context(pg_temp.withdraw_id('claim',n));
 return public.withdraw_my_order_claim(pg_temp.withdraw_id('claim',n),pg_temp.withdraw_id('op',operation),(c->>'revision')::integer,'합성 고객의 요청 철회 동의',true);
 end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.withdraw_id('user',3)::text,true);
select pg_temp.do_withdraw(1,1) as receipt \gset
select 1/case when :'receipt'::jsonb->>'stage'='withdrawn' and :'receipt'::jsonb->>'actorKind'='customer'
 and public.read_my_order_claim_withdrawal(pg_temp.withdraw_id('op',1))=:'receipt'::jsonb
 and public.withdraw_my_order_claim(pg_temp.withdraw_id('claim',1),pg_temp.withdraw_id('op',1),0,'합성 고객의 요청 철회 동의',true)=:'receipt'::jsonb then 1 else 0 end as exact_replay;
select pg_temp.withdraw_error('select public.withdraw_my_order_claim(pg_temp.withdraw_id(''claim'',1),pg_temp.withdraw_id(''op'',1),0,''다른 내용'',true)','23505');
select pg_temp.withdraw_error('select pg_temp.do_withdraw(1,11)','claim_already_withdrawn');
select pg_temp.do_withdraw(2,2);
select pg_temp.do_withdraw(3,3);
select pg_temp.withdraw_error('select pg_temp.do_withdraw(5,5)','claim_withdrawal_started');
select pg_temp.withdraw_error('select pg_temp.do_withdraw(6,6)','claim_withdrawal_started');
select pg_temp.withdraw_error('select pg_temp.do_withdraw(7,7)','claim_withdrawal_started');
select pg_temp.withdraw_error('select pg_temp.do_withdraw(8,8)','claim_withdrawal_collection_started');
select pg_temp.withdraw_error('select pg_temp.do_withdraw(9,9)','claim_withdrawal_finance_started');
select pg_temp.withdraw_error('select public.withdraw_my_order_claim(pg_temp.withdraw_id(''claim'',10),pg_temp.withdraw_id(''op'',10),0,''고객 미확인'',false)','22023');
select set_config('request.jwt.claim.sub',pg_temp.withdraw_id('user',4)::text,true);
select pg_temp.withdraw_error('select pg_temp.do_withdraw(10,10)','claim_not_found');
select 1/case when public.read_my_order_claim_withdrawal(pg_temp.withdraw_id('op',1)) is null then 1 else 0 end as other_actor_hidden;
select set_config('request.jwt.claim.sub',pg_temp.withdraw_id('user',2)::text,true);
select pg_temp.withdraw_error('select pg_temp.do_withdraw(4,4,true)','42501');
select set_config('request.jwt.claim.sub',pg_temp.withdraw_id('user',1)::text,true);
select pg_temp.do_withdraw(4,4,true);
select 1/case when public.admin_read_order_claim_withdrawal(pg_temp.withdraw_id('op',4))->>'actorKind'='operator'
 and public.read_my_order_claim_withdrawal(pg_temp.withdraw_id('op',4)) is null then 1 else 0 end as operator_receipt_needs_current_permission;
select pg_temp.withdraw_error('select public.admin_decide_order_claim(pg_temp.withdraw_id(''claim'',4),''hold'',''철회된 요청을 다시 보류하려는 합성 근거'')','claim_hold_version_required');
select 1/case when (select total from public.admin_order_claim_stage_counts_console() where stage='withdrawn')=4
 and (select count(*) from public.admin_search_order_claims_console(null,'withdrawn',null,null,null,null,20,0))=4 then 1 else 0 end as withdrawn_filter_counts;
select 1/case when (select sum((row->>'withdrawn')::int) from jsonb_array_elements(public.admin_claims_report(now()-interval '1 day',now()+interval '1 day')->'byType')row)=4 then 1 else 0 end as withdrawn_report;
reset role;
select 1/case when (select count(*)from private.order_claim_withdrawals where order_id in(select id from withdrawal_before))=4
 and (select count(*)from public.order_cancellation_requests where id in(select pg_temp.withdraw_id('claim',n)from generate_series(1,4)n) and stage='withdrawn' and status='rejected' and withdrawn_at is not null and completed_at is null and claim_revision=1)=4
 and (select purge_after is not null from private.claim_refund_accounts where claim_id=pg_temp.withdraw_id('claim',2))
 and not exists(select 1 from withdrawal_before b join public.orders o using(id) where (b.status,b.total,b.shipping_fee,b.shipping_fee_breakdown,b.discount_total,b.store_credit_total,b.delivered_at,b.address) is distinct from (o.status,o.total,o.shipping_fee,o.shipping_fee_breakdown,o.discount_total,o.store_credit_total,o.delivered_at,o.address))
 and (select count(*)from public.audit_log where action='order.claim_withdrawn' and target in(select 'order:'||id from withdrawal_before))=4
 and not exists(select 1 from public.audit_log where action='order.claim_withdrawn' and diff?'reason')
 and (select stock_qty from public.goods where id='claim-withdrawal-good')=100 then 1 else 0 end as request_only_finance_and_inventory_unchanged;
-- The closed projection frees the active-request uniqueness slot without deleting history.
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type) values(pg_temp.withdraw_id('claim',101),pg_temp.withdraw_id('order',1),pg_temp.withdraw_id('user',3),'새 합성 요청','cancel');
update public.order_cancellation_requests set reason='다른 담당자의 합성 확인' where id=pg_temp.withdraw_id('claim',10);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.withdraw_id('user',3)::text,true);
select pg_temp.withdraw_error('select public.withdraw_my_order_claim(pg_temp.withdraw_id(''claim'',10),pg_temp.withdraw_id(''op'',10),0,''이전 화면에서 철회'',true)','PT409');
reset role;
update private.operator_memberships set manager_role='logistics' where profile_id=pg_temp.withdraw_id('user',1);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.withdraw_id('user',1)::text,true);
select pg_temp.withdraw_error('select public.admin_read_order_claim_withdrawal(pg_temp.withdraw_id(''op'',4))','42501');
reset role;
select 1/case when not has_table_privilege('authenticated','private.order_claim_withdrawals','SELECT')
 and not has_function_privilege('service_role','public.withdraw_my_order_claim(uuid,uuid,integer,text,boolean)','EXECUTE')
 and not has_function_privilege('anon','public.get_my_order_claim_withdrawal_context(uuid)','EXECUTE')
 and not has_function_privilege('authenticated','private.apply_order_claim_withdrawal(uuid,uuid,integer,text,boolean,boolean)','EXECUTE') then 1 else 0 end as sealed_withdrawal_contract;
rollback;
