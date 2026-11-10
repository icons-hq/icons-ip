\set ON_ERROR_STOP on
begin;
load 'safeupdate';
create function pg_temp.hold_id(kind text,n integer) returns uuid language sql immutable as $$select md5('claim-hold:'||kind||':'||n)::uuid$$;
create function pg_temp.hold_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected hold error: %',expected;end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.hold_id('user',n),'authenticated','authenticated','claim-hold-'||n||'@example.test','{}','{}' from generate_series(1,4)n;
update public.profiles set role='staff' where id in(pg_temp.hold_id('user',1),pg_temp.hold_id('user',2),pg_temp.hold_id('user',4));
insert into private.operator_memberships(profile_id,manager_role)
 values(pg_temp.hold_id('user',1),'primary'),(pg_temp.hold_id('user',2),'primary'),(pg_temp.hold_id('user',4),'logistics');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values(pg_temp.hold_id('origin',1),'claim-hold-origin','보류 합성 출고지','hanjin',3000,'합성 반송 주소',true);
insert into public.ips(id,title,vertical_key) values('claim-hold-ip','보류 검증 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
 values('claim-hold-good','claim-hold-ip','보류 검증 상품','문구',10000,'ok',100,pg_temp.hold_id('origin',1));
insert into public.orders(id,user_id,status,total,shipping_fee,address,delivered_at)
 select pg_temp.hold_id('order',n),pg_temp.hold_id('user',3),'delivered',13000,3000,
 '{"recipientName":"합성 고객","phone":"01000000000","postalCode":"12345","address1":"합성시 검증로 1"}',now()-interval '1 day' from generate_series(1,12)n;
insert into public.order_items(id,order_id,good_id,variant_id,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,qty,unit_price)
 select pg_temp.hold_id('item',n),pg_temp.hold_id('order',n),'claim-hold-good',v.id,'보류 검증 상품','문구','claim-hold-ip',1,10000
 from generate_series(1,12)n cross join public.goods_variants v where v.good_id='claim-hold-good' and v.is_default;
create function pg_temp.hold_shipments(n integer) returns void language plpgsql as $$declare lines jsonb;quote jsonb;begin
 select jsonb_agg(jsonb_build_object('origin_id',origin_id_snapshot,'good_id',good_id,'qty',qty,'unit_price',unit_price,'fee_type',shipping_fee_type_snapshot,'individual_fee',individual_fee_snapshot)) into lines
 from public.order_items where order_id=pg_temp.hold_id('order',n);
 quote:=private.apply_shipping_region_quote(private.calculate_goods_shipping(lines),lines,'{"postalCode":"12345","address1":"합성시 검증로 1"}',clock_timestamp());
 update public.orders set shipping_fee_breakdown=quote->'groups' where id=pg_temp.hold_id('order',n);
 perform private.create_order_shipments(pg_temp.hold_id('order',n));end $$;
select pg_temp.hold_shipments(n) from generate_series(1,12)n;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,held_from,hold_reason,withdrawn_at)
 select pg_temp.hold_id('claim',n),pg_temp.hold_id('order',n),pg_temp.hold_id('user',3),'합성 최초 신청',
 case when n=3 then 'exchange' else 'return' end,
 case n when 2 then 'on_hold' when 4 then 'withdrawn' when 5 then 'completed' when 6 then 'rejected'
  when 7 then 'processing' when 8 then 'needs_review' when 10 then 'on_hold' else 'requested' end,
 case n when 2 then 'collecting' when 10 then 'needs_review' else null end,
 case when n in(2,10) then '합성 고객 요청에 대한 검토 보류' else null end,
 case when n=4 then clock_timestamp() else null end from generate_series(1,12)n;
create temp table hold_order_before as select to_jsonb(o) value from public.orders o
 where id in(select pg_temp.hold_id('order',n)from generate_series(1,12)n);
create temp table hold_shipments_before as select to_jsonb(s) value from public.order_shipments s
 where order_id in(select pg_temp.hold_id('order',n)from generate_series(1,12)n);
create temp table hold_finance_before as select count(*) payments,(select count(*)from public.refunds) refunds,
 (select count(*)from public.order_cancellation_claims) cancellations from public.payments;

create function pg_temp.do_hold(n integer,op integer,decision text default 'hold',note text default '합성 고객 문의의 확인을 기다리는 중입니다') returns jsonb language plpgsql as $$
declare ctx jsonb;begin
 ctx:=public.admin_order_claim_hold_context(pg_temp.hold_id('claim',n));
 return public.admin_change_order_claim_hold(pg_temp.hold_id('claim',n),pg_temp.hold_id('op',op),(ctx->>'revision')::int,
  ctx->>'claimType',decision,note,auth.uid());end $$;
select 1/case when not has_function_privilege('anon','public.admin_change_order_claim_hold(uuid,uuid,integer,text,text,text,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_change_order_claim_hold(uuid,uuid,integer,text,text,text,uuid)','execute')
 and not has_function_privilege('authenticated','private.decide_order_claim(uuid,text,text)','execute')
 and not has_table_privilege('authenticated','private.order_claim_hold_operations','select,insert,update,delete')
 and not has_table_privilege('service_role','private.order_claim_hold_operations','select,insert,update,delete') then 1 else 0 end as sealed;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.hold_id('user',3)::text,true);
select pg_temp.hold_error('select pg_temp.do_hold(1,1)','42501');
select set_config('request.jwt.claim.sub',pg_temp.hold_id('user',4)::text,true);
select pg_temp.hold_error('select pg_temp.do_hold(1,1)','42501');
select set_config('request.jwt.claim.sub',pg_temp.hold_id('user',1)::text,true);
select pg_temp.hold_error('select public.admin_decide_order_claim(pg_temp.hold_id(''claim'',1),''hold'',''합성 보류 사유를 전달합니다'')','claim_hold_version_required');
select pg_temp.hold_error('select public.admin_decide_order_claim(pg_temp.hold_id(''claim'',2),''resume'',null)','claim_hold_version_required');
select pg_temp.hold_error('select pg_temp.do_hold(1,1,''hold'',''짧음'')','invalid hold reason');
select pg_temp.hold_error('select pg_temp.do_hold(1,1,''resume'',null)','claim_not_held');
select pg_temp.hold_error('select pg_temp.do_hold(2,2)','claim_already_held');
select pg_temp.hold_error('select pg_temp.do_hold(4,4)','claim_hold_unavailable');
select pg_temp.hold_error('select pg_temp.do_hold(5,5)','claim_hold_unavailable');
select pg_temp.hold_error('select pg_temp.do_hold(6,6)','claim_hold_unavailable');
select pg_temp.hold_error('select public.admin_change_order_claim_hold(pg_temp.hold_id(''claim'',1),pg_temp.hold_id(''op'',1),0,''return'',''hold'',''합성 고객 문의의 확인을 기다리는 중입니다'',pg_temp.hold_id(''user'',2))','42501');

select pg_temp.do_hold(1,1) as held \gset
select 1/case when :'held'::jsonb->>'stage'='on_hold' and :'held'::jsonb->>'fromStage'='requested'
 and :'held'::jsonb->>'claimType'='return' and :'held'::jsonb->>'resultRevision'='1'
 and public.admin_read_order_claim_hold(pg_temp.hold_id('op',1))=:'held'::jsonb
 and public.admin_change_order_claim_hold(pg_temp.hold_id('claim',1),pg_temp.hold_id('op',1),0,'return','hold',
 '합성 고객 문의의 확인을 기다리는 중입니다',pg_temp.hold_id('user',1))=:'held'::jsonb then 1 else 0 end as exact_hold_receipt;
select pg_temp.hold_error('select public.admin_change_order_claim_hold(pg_temp.hold_id(''claim'',1),pg_temp.hold_id(''op'',1),0,''return'',''hold'',''변경된 보류 사유를 전달합니다'',pg_temp.hold_id(''user'',1))','23505');
select pg_temp.hold_error('select public.admin_change_order_claim_hold(pg_temp.hold_id(''claim'',1),pg_temp.hold_id(''op'',1),0,''exchange'',''hold'',''합성 고객 문의의 확인을 기다리는 중입니다'',pg_temp.hold_id(''user'',1))','23505');
select set_config('request.jwt.claim.sub',pg_temp.hold_id('user',2)::text,true);
select 1/case when public.admin_read_order_claim_hold(pg_temp.hold_id('op',1)) is null then 1 else 0 end as other_actor_cannot_read;
select pg_temp.hold_error('select public.admin_change_order_claim_hold(pg_temp.hold_id(''claim'',1),pg_temp.hold_id(''op'',1),0,''return'',''hold'',''합성 고객 문의의 확인을 기다리는 중입니다'',pg_temp.hold_id(''user'',2))','23505');
select set_config('request.jwt.claim.sub',pg_temp.hold_id('user',1)::text,true);
select pg_temp.do_hold(1,11,'resume',null) as resumed \gset
select 1/case when :'resumed'::jsonb->>'stage'='requested' and :'resumed'::jsonb->>'resultRevision'='2'
 and public.admin_read_order_claim_hold(pg_temp.hold_id('op',1))=:'held'::jsonb then 1 else 0 end as durable_receipt_after_later_change;
select 1/case when pg_temp.do_hold(2,2,'resume',null)->>'stage'='collecting'
 and pg_temp.do_hold(10,10,'resume',null)->>'stage'='needs_review' then 1 else 0 end as resume_keeps_underlying_stage;
select pg_temp.do_hold(7,7);
select pg_temp.do_hold(8,8);
select pg_temp.do_hold(3,3);

-- Type conversion increments the revision; binding the type separately also
-- rejects a forged request that combines a new revision with an old type.
select public.admin_convert_order_claim_type(pg_temp.hold_id('claim',9),pg_temp.hold_id('convert',9),0,'exchange','합성 고객의 전환 및 비용 합의',true,null);
select pg_temp.hold_error('select public.admin_change_order_claim_hold(pg_temp.hold_id(''claim'',9),pg_temp.hold_id(''op'',9),0,''return'',''hold'',''이전 반품에 대한 오래된 보류 사유'',pg_temp.hold_id(''user'',1))','PT409');
select pg_temp.hold_error('select public.admin_change_order_claim_hold(pg_temp.hold_id(''claim'',9),pg_temp.hold_id(''op'',9),1,''return'',''hold'',''이전 반품에 대한 오래된 보류 사유'',pg_temp.hold_id(''user'',1))','PT409');
select pg_temp.do_hold(9,9);
-- Other public decisions still use the same implementation.
select 1/case when public.admin_decide_order_claim(pg_temp.hold_id('claim',11),'review',null)='in_review' then 1 else 0 end as review_unchanged;
reset role;
select 1/case when (select count(*)from private.order_claim_hold_operations where actor_id=pg_temp.hold_id('user',1))=8
 and (select count(*)from public.audit_log where action='admin.order.claim_held' and diff->>'claimId'=pg_temp.hold_id('claim',1)::text)=1
 and (select count(*)from public.notifications where source_type='order_claim' and source_id=pg_temp.hold_id('claim',1)::text)=2
 then 1 else 0 end as one_effect_per_operation;
select 1/case when not exists(select value from hold_order_before except select to_jsonb(o)from public.orders o where id in(select pg_temp.hold_id('order',n)from generate_series(1,12)n))
 and not exists(select value from hold_shipments_before except select to_jsonb(s)from public.order_shipments s where order_id in(select pg_temp.hold_id('order',n)from generate_series(1,12)n))
 and (select payments=(select count(*)from public.payments) and refunds=(select count(*)from public.refunds) and cancellations=(select count(*)from public.order_cancellation_claims)from hold_finance_before)
 and (select stock_qty=100 from public.goods where id='claim-hold-good') then 1 else 0 end as money_stock_shipping_untouched;
rollback;
