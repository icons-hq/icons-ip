\set ON_ERROR_STOP on
begin;
load 'safeupdate';
create function pg_temp.reason_id(kind text,n integer) returns uuid language sql immutable as $$
 select (substr(md5('claim-reason:'||kind),1,8)||'-1111-4111-8111-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.reason_assert(condition boolean,label text) returns void language plpgsql as $$begin
 if condition is distinct from true then raise exception 'Assertion failed: %',label;end if;end $$;
create function pg_temp.reason_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected reason error: %',expected;end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.reason_id('user',n),'authenticated','authenticated','claim-reason-'||n||'@example.test',now(),'{}','{}' from generate_series(1,6)n;
update public.profiles set role='staff' where id in(pg_temp.reason_id('user',1),pg_temp.reason_id('user',2),pg_temp.reason_id('user',4),pg_temp.reason_id('user',6));
insert into private.operator_memberships(profile_id,manager_role) values
 (pg_temp.reason_id('user',1),'primary'),(pg_temp.reason_id('user',2),'primary'),(pg_temp.reason_id('user',4),'logistics');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values(pg_temp.reason_id('origin',1),'claim-reason-origin','사유 정정 합성 출고지','hanjin',3000,'합성 반송 주소',true);
insert into public.ips(id,title,vertical_key) values('claim-reason-ip','사유 정정 합성 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
 values('claim-reason-good','claim-reason-ip','사유 정정 합성 상품','문구',10000,'ok',100,pg_temp.reason_id('origin',1));
insert into public.orders(id,user_id,status,total,shipping_fee,address,created_at,delivered_at)
 select pg_temp.reason_id('order',n),pg_temp.reason_id('user',3),case when n=17 then 'canceled'::public.order_status else 'delivered'::public.order_status end,13000,3000,
 '{"recipientName":"합성 고객","phone":"01000000000","postalCode":"12345","address1":"합성시 검증로 1"}',
 '2019-12-20T00:00:00Z',case when n=24 then null else '2020-01-01T00:00:00Z'::timestamptz end from generate_series(1,28)n;
insert into public.order_items(id,order_id,good_id,variant_id,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,qty,unit_price)
 select pg_temp.reason_id('item',n),pg_temp.reason_id('order',n),'claim-reason-good',v.id,'사유 정정 합성 상품','문구','claim-reason-ip',1,10000
 from generate_series(1,28)n cross join public.goods_variants v where v.good_id='claim-reason-good' and v.is_default;
create function pg_temp.reason_shipments(n integer) returns void language plpgsql as $$declare lines jsonb;quote jsonb;begin
 select jsonb_agg(jsonb_build_object('origin_id',origin_id_snapshot,'good_id',good_id,'qty',qty,'unit_price',unit_price,'fee_type',shipping_fee_type_snapshot,'individual_fee',individual_fee_snapshot)) into lines
 from public.order_items where order_id=pg_temp.reason_id('order',n);
 quote:=private.apply_shipping_region_quote(private.calculate_goods_shipping(lines),lines,'{"postalCode":"12345","address1":"합성시 검증로 1"}',clock_timestamp());
 update public.orders set shipping_fee_breakdown=quote->'groups' where id=pg_temp.reason_id('order',n);
 perform private.create_order_shipments(pg_temp.reason_id('order',n));end $$;
select pg_temp.reason_shipments(n) from generate_series(1,28)n;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,reason_type,claim_type,stage,requested_at,held_from,hold_reason,held_at,collected_at,withdrawn_at,reshipped_at,reship_carrier,reship_tracking_number)
 select pg_temp.reason_id('claim',n),pg_temp.reason_id('order',n),pg_temp.reason_id('user',3),'합성 최초 설명',
 case when n in(2,3,4) then 'defect' else 'change_of_mind' end,
 case n when 18 then 'return' when 19 then 'cancel' else 'exchange' end,
 case n when 2 then 'in_review' when 3 then 'collecting' when 4 then 'collected' when 5 then 'on_hold'
  when 7 then 'processing' when 8 then 'needs_review' when 9 then 'completed' when 10 then 'rejected' when 11 then 'withdrawn' else 'requested' end,
 case n when 2 then '2020-01-11T00:00:00Z'::timestamptz when 3 then '2020-01-08T00:00:00Z'::timestamptz
  when 4 then '2020-01-08T00:00:00.000001Z'::timestamptz when 20 then '2020-04-01T00:00:00Z'::timestamptz
  when 21 then '2020-04-01T00:00:00.000001Z'::timestamptz else '2020-01-05T00:00:00Z'::timestamptz end,
 case when n=5 then 'collected' end,case when n=5 then '합성 보류 이유와 기존 물류 근거' end,case when n=5 then '2020-01-07T00:00:00Z'::timestamptz end,
 case when n in(4,5) then '2020-01-06T00:00:00Z'::timestamptz end,case when n=11 then '2020-01-07T00:00:00Z'::timestamptz end,
 case when n=12 then '2020-01-07T00:00:00Z'::timestamptz end,case when n in(12,13) then 'hanjin' end,case when n in(12,13) then '123456789012' end
 from generate_series(1,28)n;
insert into public.order_claim_reshipment_items(claim_id,order_item_id,good_id,source_variant_id,variant_id,variant_name_snapshot,variant_code_snapshot,qty)
 select pg_temp.reason_id('claim',14),pg_temp.reason_id('item',14),'claim-reason-good',v.id,v.id,v.name,v.code,1 from public.goods_variants v where v.good_id='claim-reason-good' and v.is_default;
insert into public.order_cancellation_claims(order_id,requested_by,previous_status) values(pg_temp.reason_id('order',15),pg_temp.reason_id('user',3),'delivered');
insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,provider)
 values(pg_temp.reason_id('payment',16),pg_temp.reason_id('user',3),'order',pg_temp.reason_id('order',16),13000,'paid','claim-reason-payment-16','claim-reason-payment-16','toss');
insert into public.refunds(id,payment_id,amount,reason,status,cancellation_request_id)
 values(pg_temp.reason_id('refund',16),pg_temp.reason_id('payment',16),13000,'합성 환급 시작 근거','requested',pg_temp.reason_id('claim',16));
update public.order_cancellation_requests set operational_fee_kind='exchange_shipping',operational_fee_amount=3000,
 operational_fee_note='기존 교환 배송비 협의',operational_fee_evidence='합성 비용 근거 비공개',operational_fee_confirmed_by=pg_temp.reason_id('user',1),operational_fee_confirmed_at='2020-01-07T00:00:00Z'
 where id=pg_temp.reason_id('claim',5);
insert into public.order_claim_collections(claim_id,shipment_id,origin_id,origin_name_snapshot,return_address_snapshot,items_snapshot,collected_at,collected_by,evidence)
 select pg_temp.reason_id('claim',5),s.id,s.origin_id,s.origin_name_snapshot,'합성 반송 주소',jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.reason_id('item',5),'goodName','사유 정정 합성 상품','qty',1)),'2020-01-06T00:00:00Z',pg_temp.reason_id('user',1),'합성 회수 완료 증거' from public.order_shipments s where order_id=pg_temp.reason_id('order',5);
-- FIXTURE END: immutable ledger evidence is synthetic and rolls back with this test.
create temp table reason_before_claims as select id,to_jsonb(c)-array['reason_type','reason','updated_at','claim_revision'] stable from public.order_cancellation_requests c where id in(select pg_temp.reason_id('claim',n)from generate_series(1,28)n);
create function pg_temp.reason_financial_snapshot() returns jsonb language sql as $$
 select jsonb_build_object(
 'orders',(select jsonb_agg(to_jsonb(o) order by o.id) from public.orders o where id in(select pg_temp.reason_id('order',n)from generate_series(1,28)n)),
 'shipments',(select jsonb_agg(to_jsonb(s) order by s.id) from public.order_shipments s where order_id in(select pg_temp.reason_id('order',n)from generate_series(1,28)n)),
 'collections',(select jsonb_agg(to_jsonb(c) order by c.shipment_id) from public.order_claim_collections c where claim_id=pg_temp.reason_id('claim',5)),
 'payments',(select jsonb_agg(to_jsonb(p)) from public.payments p where id=pg_temp.reason_id('payment',16)),
 'refunds',(select jsonb_agg(to_jsonb(r)) from public.refunds r where id=pg_temp.reason_id('refund',16)),
 'cancellations',(select jsonb_agg(to_jsonb(c)) from public.order_cancellation_claims c where order_id=pg_temp.reason_id('order',15)),
 'stock',(select stock_qty from public.goods where id='claim-reason-good'),
 'variants',(select jsonb_agg(to_jsonb(v) order by v.id) from public.goods_variants v where good_id='claim-reason-good'));
$$;
create temp table reason_before_finances as select pg_temp.reason_financial_snapshot() value;
create function pg_temp.change_reason(n integer,op integer,target text default 'defect',description text default '합성 실제 사유 정정',fee boolean default false) returns jsonb language plpgsql as $$
declare ctx jsonb;begin
 ctx:=public.admin_order_claim_reason_context(pg_temp.reason_id('claim',n));
 return public.admin_change_order_claim_reason(pg_temp.reason_id('claim',n),pg_temp.reason_id('op',op),(ctx->>'revision')::int,auth.uid(),target,description,'내부협의-민감근거는 고객에게 복사하지 않음',true,fee);
end $$;
select pg_temp.reason_assert(private.order_claim_reason_blocker(jsonb_populate_record(null::public.order_cancellation_requests,
 '{"id":"ce000000-1111-4111-8111-000000000001","claim_type":"exchange","stage":"on_hold","held_from":null}'))='claim_reason_stage_unavailable','unknown held-from is blocked');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.reason_id('user',3)::text,true);
select pg_temp.reason_error('select pg_temp.change_reason(1,1)','42501');
select set_config('request.jwt.claim.sub',pg_temp.reason_id('user',4)::text,true);
select pg_temp.reason_error('select pg_temp.change_reason(1,1)','42501');
select set_config('request.jwt.claim.sub',pg_temp.reason_id('user',6)::text,true);
select pg_temp.reason_error('select pg_temp.change_reason(1,1)','42501');
select set_config('request.jwt.claim.sub',pg_temp.reason_id('user',1)::text,true);
select pg_temp.reason_error('select public.admin_change_order_claim_reason(pg_temp.reason_id(''claim'',1),pg_temp.reason_id(''op'',1),0,pg_temp.reason_id(''user'',2),''defect'',''정정 설명'',''협의 근거'',true,false)','42501');
select pg_temp.change_reason(1,1) as saved \gset
select pg_temp.reason_assert(:'saved'::jsonb->>'changed'='true' and :'saved'::jsonb->>'revision'='0' and :'saved'::jsonb->>'resultRevision'='1'
 and public.admin_read_order_claim_reason_change(pg_temp.reason_id('op',1))=:'saved'::jsonb
 and public.admin_change_order_claim_reason(pg_temp.reason_id('claim',1),pg_temp.reason_id('op',1),0,auth.uid(),'defect','합성 실제 사유 정정','내부협의-민감근거는 고객에게 복사하지 않음',true,false)=:'saved'::jsonb,'same operation preserves exact receipt');
select pg_temp.reason_error('select public.admin_change_order_claim_reason(pg_temp.reason_id(''claim'',1),pg_temp.reason_id(''op'',1),0,auth.uid(),''defect'',''다른 설명'',''내부협의-민감근거는 고객에게 복사하지 않음'',true,false)','23505');
select pg_temp.reason_error('select public.admin_change_order_claim_reason(pg_temp.reason_id(''claim'',1),pg_temp.reason_id(''op'',1),0,auth.uid(),''defect'',''합성 실제 사유 정정'',''다른 협의'',true,false)','23505');
select pg_temp.reason_error('select public.admin_change_order_claim_reason(pg_temp.reason_id(''claim'',1),pg_temp.reason_id(''op'',1),0,auth.uid(),''defect'',''합성 실제 사유 정정'',''내부협의-민감근거는 고객에게 복사하지 않음'',true,true)','23505');
select set_config('request.jwt.claim.sub',pg_temp.reason_id('user',2)::text,true);
select pg_temp.reason_assert(public.admin_read_order_claim_reason_change(pg_temp.reason_id('op',1)) is null,'receipt private to original actor');
select pg_temp.reason_error('select public.admin_change_order_claim_reason(pg_temp.reason_id(''claim'',1),pg_temp.reason_id(''op'',1),0,auth.uid(),''defect'',''합성 실제 사유 정정'',''내부협의-민감근거는 고객에게 복사하지 않음'',true,false)','23505');
select set_config('request.jwt.claim.sub',pg_temp.reason_id('user',1)::text,true);
-- Original intake boundaries: years after intake, not current date; 7 days and 3 months inclusive.
select pg_temp.reason_error('select pg_temp.change_reason(2,2,''change_of_mind'')','claim_reason_original_deadline_expired');
select pg_temp.change_reason(3,3,'change_of_mind');
select pg_temp.reason_error('select pg_temp.change_reason(4,4,''change_of_mind'')','claim_reason_original_deadline_expired');
select pg_temp.change_reason(20,20,'defect');
select pg_temp.reason_error('select pg_temp.change_reason(21,21,''defect'')','claim_reason_original_deadline_expired');
select pg_temp.change_reason(24,24,'defect');
select pg_temp.change_reason(2,202,'defect','같은 분류 설명만 정정');
select pg_temp.reason_error('select pg_temp.change_reason(5,5,''change_of_mind'')','claim_reason_fee_review_required');
select pg_temp.change_reason(5,5,'change_of_mind','보류 상태에서 설명만 정정',true);
select pg_temp.reason_error('select public.admin_change_order_claim_reason(pg_temp.reason_id(''claim'',1),pg_temp.reason_id(''op'',101),0,auth.uid(),''defect'',''정정 설명'',''협의 근거'',true,false)','PT409');
do $$declare n integer;begin
 foreach n in array array[7,8,9,10,11] loop perform pg_temp.reason_error(format('select pg_temp.change_reason(%s,%s)',n,n),'claim_reason_stage_unavailable');end loop;
 foreach n in array array[12,13,14] loop perform pg_temp.reason_error(format('select pg_temp.change_reason(%s,%s)',n,n),'claim_reason_reshipped');end loop;
 foreach n in array array[15,16,17] loop perform pg_temp.reason_error(format('select pg_temp.change_reason(%s,%s)',n,n),'claim_reason_finance_started');end loop;
 foreach n in array array[18,19] loop perform pg_temp.reason_error(format('select pg_temp.change_reason(%s,%s)',n,n),'claim_reason_type_unavailable');end loop;
end $$;
-- No-op operations are input-bound receipts but do not increment version or enter history/notifications.
select pg_temp.change_reason(22,22,'change_of_mind','합성 최초 설명') as noop \gset
select pg_temp.reason_assert(:'noop'::jsonb->>'changed'='false' and :'noop'::jsonb->>'revision'='0' and :'noop'::jsonb->>'resultRevision'='0'
 and jsonb_array_length(public.admin_order_claim_reason_context(pg_temp.reason_id('claim',22))->'history')=0,'no-op has no public change history');
select pg_temp.change_reason(22,222,'defect','실제 후속 정정');
select pg_temp.reason_assert(public.admin_change_order_claim_reason(pg_temp.reason_id('claim',22),pg_temp.reason_id('op',22),0,auth.uid(),
 'change_of_mind','합성 최초 설명','내부협의-민감근거는 고객에게 복사하지 않음',true,false)=:'noop'::jsonb,'no-op receipt stable after later real change');
select pg_temp.change_reason(1,101,'change_of_mind','고객 재확인 후 분류를 다시 정정');
select pg_temp.reason_assert(public.admin_order_claim_reason_context(pg_temp.reason_id('claim',1))->>'originalReason'='합성 최초 설명'
 and public.admin_order_claim_reason_context(pg_temp.reason_id('claim',1))->>'originalReasonType'='change_of_mind'
 and public.admin_read_order_claim_reason_change(pg_temp.reason_id('op',1))=:'saved'::jsonb,'original evidence and prior receipts remain');
-- Input boundary and same operator result readbacks.
select pg_temp.reason_error('select pg_temp.change_reason(23,23,''defect'',repeat(''x'',201))','22023');
select pg_temp.reason_error('select pg_temp.change_reason(23,23,''defect'',E''line\nbreak'')','22023');
select pg_temp.reason_error('select public.admin_change_order_claim_reason(pg_temp.reason_id(''claim'',23),pg_temp.reason_id(''op'',23),0,auth.uid(),''defect'',''정정'',''x'',true,false)','22023');
select pg_temp.reason_error('select public.admin_change_order_claim_reason(pg_temp.reason_id(''claim'',23),pg_temp.reason_id(''op'',23),0,auth.uid(),''defect'',''정정'',repeat(''x'',501),true,false)','22023');
select pg_temp.reason_error('select public.admin_change_order_claim_reason(pg_temp.reason_id(''claim'',23),pg_temp.reason_id(''op'',23),0,auth.uid(),''defect'',''정정'',''협의 근거'',false,false)','22023');
select public.admin_change_order_claim_reason(pg_temp.reason_id('claim',23),pg_temp.reason_id('op',23),0,auth.uid(),'defect',repeat('x',200),repeat('x',500),true,false);
-- Interleaved hold and type conversion both invalidate an older reason form.
select public.admin_change_order_claim_hold(pg_temp.reason_id('claim',25),pg_temp.reason_id('hold',25),0,'exchange','hold','다른 업무에서 보류를 설정한 합성 이유',auth.uid());
select pg_temp.reason_error('select public.admin_change_order_claim_reason(pg_temp.reason_id(''claim'',25),pg_temp.reason_id(''op'',25),0,auth.uid(),''defect'',''정정'',''협의 근거'',true,false)','PT409');
select public.admin_convert_order_claim_type(pg_temp.reason_id('claim',26),pg_temp.reason_id('convert',26),0,'return','별도 유형 전환 합의',true,null);
select pg_temp.reason_error('select public.admin_change_order_claim_reason(pg_temp.reason_id(''claim'',26),pg_temp.reason_id(''op'',26),0,auth.uid(),''defect'',''정정'',''협의 근거'',true,false)','PT409');
select pg_temp.reason_error('select pg_temp.change_reason(26,26)','claim_reason_type_unavailable');
select set_config('request.jwt.claim.sub',pg_temp.reason_id('user',3)::text,true);
select pg_temp.reason_assert(jsonb_array_length(public.get_my_order_claim_reason_changes(pg_temp.reason_id('order',1)))=2
 and not(public.get_my_order_claim_reason_changes(pg_temp.reason_id('order',1))->0?'agreement')
 and not(public.get_my_order_claim_reason_changes(pg_temp.reason_id('order',1))->0?'actorId')
 and public.get_my_order_claim_reason_changes(pg_temp.reason_id('order',1))->0->>'fromReason'='합성 최초 설명','customer owns public before/after history without internal evidence');
select set_config('request.jwt.claim.sub',pg_temp.reason_id('user',5)::text,true);
select pg_temp.reason_error('select public.get_my_order_claim_reason_changes(pg_temp.reason_id(''order'',1))','P0002');
reset role;
select pg_temp.reason_assert(not exists(select 1 from reason_before_claims b join public.order_cancellation_requests c using(id)
 where c.id not in(pg_temp.reason_id('claim',25),pg_temp.reason_id('claim',26)) and b.stable<>to_jsonb(c)-array['reason_type','reason','updated_at','claim_revision']),
 'all intake collection hold fee handler fields unchanged');
select pg_temp.reason_assert(pg_temp.reason_financial_snapshot()=(select value from reason_before_finances),'money stock shipment and collection evidence unchanged');
select pg_temp.reason_assert((select count(*) from private.order_claim_reason_operations where claim_id in(select pg_temp.reason_id('claim',n)from generate_series(1,28)n) and changed)=9,'exactly nine actual reason changes');
select pg_temp.reason_assert((select count(*) from public.audit_log where action='admin.order.claim_reason_changed' and target in(select 'order:'||pg_temp.reason_id('order',n) from generate_series(1,28)n))=9,'exactly one audit per actual change');
select pg_temp.reason_assert((select count(*) from public.notifications where user_id=pg_temp.reason_id('user',3) and dedupe_key like 'claim:reason_changed:%')=9
 and not exists(select 1 from public.notifications where user_id=pg_temp.reason_id('user',3) and (body like '%내부협의-%' or body like '%민감근거%'))
 and not exists(select 1 from public.audit_log where action='admin.order.claim_reason_changed' and (diff?'agreement' or diff::text like '%내부협의-%')),'one customer notice per change and private evidence absent');
select pg_temp.reason_assert(not has_table_privilege('authenticated','private.order_claim_reason_operations','select,insert,update,delete')
 and not has_table_privilege('service_role','private.order_claim_reason_operations','select,insert,update,delete')
 and not has_function_privilege('anon','public.admin_change_order_claim_reason(uuid,uuid,integer,uuid,text,text,text,boolean,boolean)','execute')
 and not has_function_privilege('service_role','public.admin_change_order_claim_reason(uuid,uuid,integer,uuid,text,text,text,boolean,boolean)','execute')
 and not has_function_privilege('authenticated','private.order_claim_reason_receipt(uuid,uuid)','execute'),'sealed contracts');
update private.operator_memberships set manager_role='logistics' where profile_id=pg_temp.reason_id('user',1);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.reason_id('user',1)::text,true);
select pg_temp.reason_error('select public.admin_read_order_claim_reason_change(pg_temp.reason_id(''op'',1))','42501');
select pg_temp.reason_error('select public.admin_order_claim_reason_context(pg_temp.reason_id(''claim'',1))','42501');
rollback;
