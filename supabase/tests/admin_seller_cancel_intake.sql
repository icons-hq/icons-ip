\set ON_ERROR_STOP on
begin;
create function pg_temp.cancel_id(kind text,n integer) returns uuid language sql immutable as $$select md5('seller-cancel:'||kind||':'||n)::uuid$$;
create function pg_temp.expect_cancel_error(q text,expected text) returns void language plpgsql as $$
begin begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;raise exception 'Expected cancel error: %',expected;end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.cancel_id('user',n),'authenticated','authenticated','seller-cancel-'||n||'@example.test','{}','{}',now(),now() from generate_series(1,4)n;
update public.profiles set role='staff' where id in(pg_temp.cancel_id('user',1),pg_temp.cancel_id('user',3),pg_temp.cancel_id('user',4));
insert into private.operator_memberships(profile_id,manager_role) values
 (pg_temp.cancel_id('user',1),'primary'),(pg_temp.cancel_id('user',3),'primary'),(pg_temp.cancel_id('user',4),'logistics');
insert into public.ips(id,title,vertical_key)select 'seller-cancel-ip','취소 접수 합성 IP',key from public.verticals limit 1;
insert into public.fulfillment_origins(id,code,name,base_fee,return_address,is_active)
values(pg_temp.cancel_id('origin',1),'seller-cancel-origin','합성 출고지',0,'합성 반송지',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
values('seller-cancel-good','seller-cancel-ip','취소 접수 합성 상품','문구',1000,'ok',20,pg_temp.cancel_id('origin',1));
insert into public.orders(id,user_id,status,total,address,created_at)
select pg_temp.cancel_id('order',n),pg_temp.cancel_id('user',2),case when n=2 then 'pending'::public.order_status else 'paid'::public.order_status end,1000,
 '{"recipientName":"합성 구매자","phone":"01000000000","postalCode":"00000","address1":"합성 배송지","address2":"검수 전용"}',now()-interval '1 hour' from generate_series(1,6)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select pg_temp.cancel_id('item',n),pg_temp.cancel_id('order',n),'seller-cancel-good',(select id from public.goods_variants where good_id='seller-cancel-good' and is_default),1,1000,'합성 상품','문구','seller-cancel-ip' from generate_series(1,6)n;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
select pg_temp.cancel_id('shipment',n),pg_temp.cancel_id('order',n),pg_temp.cancel_id('origin',1),'합성 출고지',0,'{}' from generate_series(1,6)n;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id)
select pg_temp.cancel_id('order',n),pg_temp.cancel_id('shipment',n),pg_temp.cancel_id('item',n) from generate_series(1,6)n;
update public.orders set status='confirmed' where id=pg_temp.cancel_id('order',3);
update public.order_shipments set exported_at=now() where order_id=pg_temp.cancel_id('order',4);
insert into public.payments(user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,raw,provider)
values(pg_temp.cancel_id('user',2),'order',pg_temp.cancel_id('order',1),1000,'paid','seller-cancel-paid','seller-cancel-paid','{"synthetic":true}','toss');
insert into public.inquiries(id,user_id,order_id,category,title)
values(pg_temp.cancel_id('inquiry',1),pg_temp.cancel_id('user',2),pg_temp.cancel_id('order',1),'claim','합성 전체 취소 문의');
create function pg_temp.cancel_values(n integer) returns jsonb language sql as $$
select jsonb_build_object('orderId',pg_temp.cancel_id('order',n),'claimType','cancel','reasonType','change_of_mind','reason','고객 전체 주문 취소 요청',
 'source','phone','inquiryId',null,'customerRequestedAt',to_char(now()-interval '5 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'agreementEvidence','합성 상담 기록: 주문 전체 취소 동의','agreementConfirmed',true,'collectionAddress',null,'collections','[]'::jsonb)
$$;
create temp table cancel_before on commit drop as select
 (select jsonb_agg(to_jsonb(o) order by id) from public.orders o where id in(pg_temp.cancel_id('order',1),pg_temp.cancel_id('order',2))) orders,
 (select jsonb_agg(to_jsonb(s) order by id) from public.order_shipments s where order_id in(pg_temp.cancel_id('order',1),pg_temp.cancel_id('order',2))) shipments,
 (select jsonb_agg(to_jsonb(p) order by id) from public.payments p where ref_id=pg_temp.cancel_id('order',1)) payments,
 (select jsonb_agg(to_jsonb(v) order by id) from public.goods_variants v where good_id='seller-cancel-good') variants;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.cancel_id('user',1)::text,true);
select 1/case when public.admin_seller_claim_intake_context(pg_temp.cancel_id('order',1))->'cancelBlockedReason'='null'::jsonb
 and public.admin_seller_claim_intake_context(pg_temp.cancel_id('order',3))->>'cancelBlockedReason'='not_cancelable'
 and public.admin_seller_claim_intake_context(pg_temp.cancel_id('order',4))->>'cancelBlockedReason'='not_cancelable' then 1 else 0 end as context_eligibility;
select public.admin_submit_seller_claim_intake(pg_temp.cancel_id('request',1),pg_temp.cancel_values(1)||jsonb_build_object('source','inquiry','inquiryId',pg_temp.cancel_id('inquiry',1)),
 '{"bankName":"합성은행","accountNumber":"000000001234","accountHolder":"합성고객"}') as saved \gset
select 1/case when :'saved'::jsonb->>'claimType'='cancel' and :'saved'::jsonb->>'stage'='requested'
 and :'saved'::jsonb->'collectionAddress'='null'::jsonb and :'saved'::jsonb->'collections'='[]'::jsonb
 and public.admin_order_claim_detail(pg_temp.cancel_id('request',1))->'sellerIntake'=:'saved'::jsonb
 and public.admin_get_seller_claim_intake(pg_temp.cancel_id('request',1))=:'saved'::jsonb then 1 else 0 end as recorded_request_and_provenance;
select 1/case when public.admin_submit_seller_claim_intake(pg_temp.cancel_id('request',1),pg_temp.cancel_values(1)||jsonb_build_object('source','inquiry','inquiryId',pg_temp.cancel_id('inquiry',1)),
 '{"bankName":"합성은행","accountNumber":"000000001234","accountHolder":"합성고객"}')=:'saved'::jsonb then 1 else 0 end as exact_retry;
select 1/case when public.admin_read_seller_claim_intake(pg_temp.cancel_id('request',1),pg_temp.cancel_values(1)||jsonb_build_object('source','inquiry','inquiryId',pg_temp.cancel_id('inquiry',1)),
 '{"bankName":"합성은행","accountNumber":"000000001234","accountHolder":"합성고객"}')=:'saved'::jsonb
 and public.admin_read_seller_claim_intake(pg_temp.cancel_id('request',99),pg_temp.cancel_values(5)) is null then 1 else 0 end as exact_readback_or_unconfirmed_absence;
select pg_temp.expect_cancel_error($q$select public.admin_read_seller_claim_intake(pg_temp.cancel_id('request',1),pg_temp.cancel_values(1)||jsonb_build_object('source','inquiry','inquiryId',pg_temp.cancel_id('inquiry',1),'reason','다른 접수 사유'),
 '{"bankName":"합성은행","accountNumber":"000000001234","accountHolder":"합성고객"}')$q$,'PT409');
select pg_temp.expect_cancel_error($q$select public.admin_read_seller_claim_intake(pg_temp.cancel_id('request',1),pg_temp.cancel_values(1)||jsonb_build_object('source','inquiry','inquiryId',pg_temp.cancel_id('inquiry',1)),
 '{"bankName":"합성은행","accountNumber":"000000009999","accountHolder":"합성고객"}')$q$,'PT409');
select public.admin_submit_seller_claim_intake(pg_temp.cancel_id('request',2),pg_temp.cancel_values(2));
select pg_temp.expect_cancel_error($q$select public.admin_submit_seller_claim_intake(pg_temp.cancel_id('request',9),pg_temp.cancel_values(1))$q$,'already_requested');
select pg_temp.expect_cancel_error($q$select public.admin_submit_seller_claim_intake(pg_temp.cancel_id('request',3),pg_temp.cancel_values(3))$q$,'not_cancelable');
select pg_temp.expect_cancel_error($q$select public.admin_submit_seller_claim_intake(pg_temp.cancel_id('request',4),pg_temp.cancel_values(4))$q$,'not_cancelable');
select pg_temp.expect_cancel_error($q$select public.admin_submit_seller_claim_intake(pg_temp.cancel_id('request',5),pg_temp.cancel_values(5)||'{"amount":100}')$q$,'invalid_seller_claim_request');
select pg_temp.expect_cancel_error($q$select public.admin_submit_seller_claim_intake(pg_temp.cancel_id('request',5),pg_temp.cancel_values(5)||'{"agreementConfirmed":false}')$q$,'invalid_seller_claim_request');
select pg_temp.expect_cancel_error($q$select public.admin_submit_seller_claim_intake(pg_temp.cancel_id('request',5),pg_temp.cancel_values(5)||'{"collectionAddress":{}}')$q$,'invalid_seller_cancel_collection');
-- R7: 하자·오배송은 받은 뒤의 일이라 취소가 아니라 반품·교환으로 접수한다. 같은 주문은 단순 변심으로 그대로 접수된다.
select pg_temp.expect_cancel_error($q$select public.admin_submit_seller_claim_intake(pg_temp.cancel_id('request',5),pg_temp.cancel_values(5)||'{"reasonType":"defect"}')$q$,'invalid_seller_cancel_reason');
select 1/case when not exists(select 1 from public.order_cancellation_requests where id=pg_temp.cancel_id('request',5)) then 1 else 0 end as defect_cancel_not_recorded;
select pg_temp.expect_cancel_error($q$select public.admin_submit_seller_claim_intake(pg_temp.cancel_id('request',5),pg_temp.cancel_values(5)||'{"customerRequestedAt":"2099-01-01T00:00:00Z"}')$q$,'invalid_seller_claim_customer_time');
select pg_temp.expect_cancel_error($q$select public.admin_submit_seller_claim_intake(pg_temp.cancel_id('request',5),pg_temp.cancel_values(5)||jsonb_build_object('source','inquiry','inquiryId',pg_temp.cancel_id('inquiry',1)))$q$,'seller_claim_inquiry_mismatch');
select set_config('request.jwt.claim.sub',pg_temp.cancel_id('user',3)::text,true);
select pg_temp.expect_cancel_error($q$select public.admin_read_seller_claim_intake(pg_temp.cancel_id('request',1),pg_temp.cancel_values(1)||jsonb_build_object('source','inquiry','inquiryId',pg_temp.cancel_id('inquiry',1)),
 '{"bankName":"합성은행","accountNumber":"000000001234","accountHolder":"합성고객"}')$q$,'PT409');
select pg_temp.expect_cancel_error($q$select public.admin_submit_seller_claim_intake(pg_temp.cancel_id('request',1),pg_temp.cancel_values(1))$q$,'PT409');
select set_config('request.jwt.claim.sub',pg_temp.cancel_id('user',2)::text,true);
select pg_temp.expect_cancel_error($q$select public.admin_submit_seller_claim_intake(pg_temp.cancel_id('request',5),pg_temp.cancel_values(5))$q$,'operator_capability_required');
select set_config('request.jwt.claim.sub',pg_temp.cancel_id('user',4)::text,true);
select pg_temp.expect_cancel_error($q$select public.admin_seller_claim_intake_context(pg_temp.cancel_id('order',5))$q$,'operator_capability_required');
reset role;
select 1/case when (select orders from cancel_before)=(select jsonb_agg(to_jsonb(o) order by id) from public.orders o where id in(pg_temp.cancel_id('order',1),pg_temp.cancel_id('order',2)))
 and (select shipments from cancel_before)=(select jsonb_agg(to_jsonb(s) order by id) from public.order_shipments s where order_id in(pg_temp.cancel_id('order',1),pg_temp.cancel_id('order',2)))
 and (select payments from cancel_before)=(select jsonb_agg(to_jsonb(p) order by id) from public.payments p where ref_id=pg_temp.cancel_id('order',1))
 and (select variants from cancel_before)=(select jsonb_agg(to_jsonb(v) order by id) from public.goods_variants v where good_id='seller-cancel-good')
 and not exists(select 1 from public.order_cancellation_claims where order_id in(pg_temp.cancel_id('order',1),pg_temp.cancel_id('order',2)))
 and not exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.ref_id=pg_temp.cancel_id('order',1))
 and not exists(select 1 from public.order_claim_collections where claim_id in(pg_temp.cancel_id('request',1),pg_temp.cancel_id('request',2)))
 then 1 else 0 end as no_financial_stock_or_fulfillment_effect;
select 1/case when (select count(*) from public.audit_log where action='admin.order.claim_intake_created' and target='order:'||pg_temp.cancel_id('order',1))=1
 and (select actor_id from private.seller_order_claim_intakes where claim_id=pg_temp.cancel_id('request',1))=pg_temp.cancel_id('user',1)
 and (select requested_by from public.order_cancellation_requests where id=pg_temp.cancel_id('request',1))=pg_temp.cancel_id('user',2)
 and (select payload::text not like '%000000001234%' from private.seller_order_claim_intakes where claim_id=pg_temp.cancel_id('request',1))
 and (select count(*) from public.notifications where source_type='order_claim' and source_id=pg_temp.cancel_id('request',1)::text)=1 then 1 else 0 end as one_audit_notification_and_private_account;
-- Existing rejection remains a separate step and seals the optional raw account.
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.cancel_id('user',1)::text,true);
select public.admin_decide_order_claim(pg_temp.cancel_id('request',1),'reject','합성 고객과 재확인 후 요청 종료');
reset role;
select 1/case when (select stage='rejected' from public.order_cancellation_requests where id=pg_temp.cancel_id('request',1))
 and (select purge_after is not null from private.claim_refund_accounts where claim_id=pg_temp.cancel_id('request',1)) then 1 else 0 end as existing_followup_and_retention;
select 1/case when not has_function_privilege('anon','public.admin_read_seller_claim_intake(uuid,jsonb,jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_read_seller_claim_intake(uuid,jsonb,jsonb)','execute')
 and has_function_privilege('authenticated','public.admin_read_seller_claim_intake(uuid,jsonb,jsonb)','execute') then 1 else 0 end as readback_acl;
update public.profiles set suspended_at=now(),suspension_reason='합성 검수' where id=pg_temp.cancel_id('user',1);
set local role authenticated;
select pg_temp.expect_cancel_error($q$select public.admin_submit_seller_claim_intake(pg_temp.cancel_id('request',5),pg_temp.cancel_values(5))$q$,'operator_capability_required');
rollback;
