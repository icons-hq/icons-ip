\set ON_ERROR_STOP on
begin;

-- Test-only access to the preserved physical engine. New dispatch through the
-- old public RPC is sealed; contact-v2 and public denial are covered separately
-- by order_claim_contact.sql. Keep the original JWT actor/capability checks.
create function pg_temp.record_order_claim_reshipment_physical(p_claim uuid,p_carrier text,p_tracking text,p_items jsonb) returns text
language sql security definer set search_path='' as $$
 select private.record_order_claim_reshipment_physical(p_claim,p_carrier,p_tracking,p_items);
$$;
create function pg_temp.record_order_claim_reshipment_physical(p_claim uuid,p_carrier text,p_tracking text) returns text
language sql security definer set search_path='' as $$
 select private.record_order_claim_reshipment_physical(p_claim,p_carrier,p_tracking,'[]'::jsonb);
$$;
revoke all on function pg_temp.record_order_claim_reshipment_physical(uuid,text,text,jsonb),pg_temp.record_order_claim_reshipment_physical(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function pg_temp.record_order_claim_reshipment_physical(uuid,text,text,jsonb),pg_temp.record_order_claim_reshipment_physical(uuid,text,text) to authenticated;

-- Dedicated synthetic identities and catalogs, always rolled back.
create function pg_temp.seller_claim_id(kind text, n integer) returns uuid language sql immutable as $$ select md5('seller-claim-test:' || kind || ':' || n)::uuid $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.seller_claim_id('user',n),'authenticated','authenticated','seller-claim-'||n||'@example.test','{}','{}',now(),now() from generate_series(1,4)n;
update public.profiles set role = 'staff' where id in (pg_temp.seller_claim_id('user',1),pg_temp.seller_claim_id('user',4));
insert into public.ips(id,title,vertical_key) values('seller-claim-test','대리 접수 합성 IP','character');
insert into public.fulfillment_origins(id,code,name,base_fee,return_address,is_active)
select pg_temp.seller_claim_id('origin',n),'seller-claim-'||n,'합성 출고지 '||n,0,'실제 주소가 아닌 검수 반송지 '||n,true from generate_series(1,2)n;
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
select 'seller-claim-good-'||n,'seller-claim-test','대리 접수 합성 상품 '||n,'문구',1000,'ok',20,pg_temp.seller_claim_id('origin',n) from generate_series(1,2)n;
create function pg_temp.seed_seller_claim_order(n integer, age_days integer default 1) returns uuid language plpgsql as $$
declare target uuid := pg_temp.seller_claim_id('order',n); item uuid; shipment uuid; variant uuid; i integer;
begin
  insert into public.orders(id,user_id,status,total,address,created_at) values(target,pg_temp.seller_claim_id('user',2),'paid',2000,
    '{"recipientName":"합성 구매자","phone":"01000000000","postalCode":"00000","address1":"합성 수거 주소","address2":"검수 전용"}',now()-interval '200 days');
  for i in 1..2 loop
    item:=pg_temp.seller_claim_id('item-'||n,i); shipment:=pg_temp.seller_claim_id('shipment-'||n,i);
    select id into variant from public.goods_variants where good_id='seller-claim-good-'||i and is_default;
    insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
      values(item,target,'seller-claim-good-'||i,variant,1,1000,'대리 접수 합성 상품 '||i,'문구','seller-claim-test');
    insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
      values(shipment,target,pg_temp.seller_claim_id('origin',i),'합성 출고지 '||i,0,'{}');
    insert into public.order_shipment_items(order_id,shipment_id,order_item_id) values(target,shipment,item);
  end loop;
  update public.order_shipments set status='delivered',shipped_at=now()-(age_days+1)*interval '1 day',delivered_at=now()-age_days*interval '1 day'
    where order_id=target;
  insert into public.payments(user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,raw,provider)
    values(pg_temp.seller_claim_id('user',2),'order',target,2000,'paid','seller-claim-test-'||n,'seller-claim-test-'||n,'{"synthetic":true}','toss');
  return target;
end $$;
select pg_temp.seed_seller_claim_order(n,case when n=5 then 10 when n=6 then 100 else 1 end) from generate_series(1,9)n;
insert into public.inquiries(id,user_id,order_id,category,title)
values(pg_temp.seller_claim_id('inquiry',1),pg_temp.seller_claim_id('user',2),pg_temp.seller_claim_id('order',1),'claim','전체 반품 요청 합성 문의'),
  (pg_temp.seller_claim_id('inquiry',2),pg_temp.seller_claim_id('user',3),pg_temp.seller_claim_id('order',2),'claim','다른 고객의 합성 문의');
create function pg_temp.seller_claim_payload(n integer, kind text default 'return') returns jsonb language sql as $$
  select jsonb_build_object('orderId',o.id,'claimType',kind,'reasonType','defect','reason','전체 주문 하자 요청 합성 근거',
    'source','phone','inquiryId',null,'customerRequestedAt',to_char(now()-interval '5 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'agreementEvidence','구매자 전체 주문 접수 동의 확인. 합성 테스트 기록.','agreementConfirmed',true,
    'collectionAddress',o.address,'collections',(select jsonb_agg(jsonb_build_object('shipmentId',s.id,'method','not_requested','carrier',null,'trackingNumber',null,'note','승인 후 수거 협의') order by s.id)
      from public.order_shipments s where s.order_id=o.id)) from public.orders o where o.id=pg_temp.seller_claim_id('order',n);
$$;
create temp table seller_claim_before on commit drop as select
  (select jsonb_agg(to_jsonb(o) order by id) from public.orders o where id=pg_temp.seller_claim_id('order',1)) orders,
  (select jsonb_agg(to_jsonb(i) order by id) from public.order_items i where order_id=pg_temp.seller_claim_id('order',1)) items,
  (select jsonb_agg(to_jsonb(s) order by id) from public.order_shipments s where order_id=pg_temp.seller_claim_id('order',1)) shipments,
  (select jsonb_agg(to_jsonb(p) order by id) from public.payments p where ref_id=pg_temp.seller_claim_id('order',1)) payments,
  (select jsonb_agg(to_jsonb(v) order by id) from public.goods_variants v where good_id like 'seller-claim-good-%') variants;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.seller_claim_id('user',1)::text,true);
select 1/case when public.admin_seller_claim_intake_context(pg_temp.seller_claim_id('order',1))#>'{blockedReasons}'='{"change_of_mind":null,"defect":null}'
  and jsonb_array_length(public.admin_seller_claim_intake_context(pg_temp.seller_claim_id('order',1))->'collections')=2 then 1 else 0 end as context_reports_whole_delivery_and_two_origins;
select public.admin_submit_seller_claim_intake(pg_temp.seller_claim_id('request',1),
  pg_temp.seller_claim_payload(1)||jsonb_build_object('source','inquiry','inquiryId',pg_temp.seller_claim_id('inquiry',1)),
  '{"bankName":"합성은행","accountNumber":"000000001234","accountHolder":"합성 구매자"}') as saved \gset
select 1/case when :'saved'::jsonb->>'stage'='requested' and :'saved'::jsonb->>'actorId'=pg_temp.seller_claim_id('user',1)::text
  and jsonb_array_length(:'saved'::jsonb->'collections')=2
  and :'saved'::jsonb->'collections'->0 ? 'originName'
  and (:'saved'::jsonb->>'requestedAt')::timestamptz>(:'saved'::jsonb->>'customerRequestedAt')::timestamptz
  then 1 else 0 end as requested_only_with_real_actor_and_unsuperseded_request_time;
select 1/case when public.admin_submit_seller_claim_intake(pg_temp.seller_claim_id('request',1),
  pg_temp.seller_claim_payload(1)||jsonb_build_object('source','inquiry','inquiryId',pg_temp.seller_claim_id('inquiry',1)),
  '{"bankName":"합성은행","accountNumber":"000000001234","accountHolder":"합성 구매자"}')=:'saved'::jsonb
  and public.admin_get_seller_claim_intake(pg_temp.seller_claim_id('request',1))=:'saved'::jsonb
  then 1 else 0 end as retry_and_committed_readback;
select 1/case when public.admin_order_claim_detail(pg_temp.seller_claim_id('request',1))->'sellerIntake'=:'saved'::jsonb
  and public.admin_order_claim_detail(pg_temp.seller_claim_id('request',1))#>>'{claim,stage}'='requested'
  and public.admin_order_claim_detail(pg_temp.seller_claim_id('request',1))#>>'{refundAccount,maskedAccount}' not like '%000000001234%'
  then 1 else 0 end as detail_keeps_existing_projection_and_masks_account;
reset role;
select 1/case when (select requested_by from public.order_cancellation_requests where id=pg_temp.seller_claim_id('request',1))=pg_temp.seller_claim_id('user',2)
  and (select account_number from private.claim_refund_accounts where claim_id=pg_temp.seller_claim_id('request',1))='000000001234'
  and (select payload::text not like '%000000001234%' from private.seller_order_claim_intakes where claim_id=pg_temp.seller_claim_id('request',1))
  and (select count(*) from public.audit_log where action='admin.order.claim_intake_created' and target='order:'||pg_temp.seller_claim_id('order',1))=1
  and (select count(*) from public.notifications where source_type='order_claim' and source_id=pg_temp.seller_claim_id('request',1)::text)=1
  then 1 else 0 end as customer_identity_separate_from_operator_and_sensitive_raw_single_store;
select 1/case when
  (select orders from seller_claim_before)=(select jsonb_agg(to_jsonb(o) order by id) from public.orders o where id=pg_temp.seller_claim_id('order',1))
  and (select items from seller_claim_before)=(select jsonb_agg(to_jsonb(i) order by id) from public.order_items i where order_id=pg_temp.seller_claim_id('order',1))
  and (select shipments from seller_claim_before)=(select jsonb_agg(to_jsonb(s) order by id) from public.order_shipments s where order_id=pg_temp.seller_claim_id('order',1))
  and (select payments from seller_claim_before)=(select jsonb_agg(to_jsonb(p) order by id) from public.payments p where ref_id=pg_temp.seller_claim_id('order',1))
  and (select variants from seller_claim_before)=(select jsonb_agg(to_jsonb(v) order by id) from public.goods_variants v where good_id like 'seller-claim-good-%')
  and not exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.ref_id=pg_temp.seller_claim_id('order',1))
  and not exists(select 1 from public.order_cancellation_claims where order_id=pg_temp.seller_claim_id('order',1))
  and not exists(select 1 from public.order_claim_collections where claim_id=pg_temp.seller_claim_id('request',1))
  then 1 else 0 end as intake_does_not_change_money_inventory_fulfillment_or_approval;
set local role authenticated;
do $$begin
  begin perform public.admin_submit_seller_claim_intake(pg_temp.seller_claim_id('request',1),pg_temp.seller_claim_payload(1),null);raise exception 'changed payload replay accepted';
    exception when sqlstate 'PT409' then null;end;
  begin perform public.admin_submit_seller_claim_intake(pg_temp.seller_claim_id('request',10),pg_temp.seller_claim_payload(1),null);raise exception 'second active intake accepted';
    exception when check_violation then if sqlerrm<>'already_requested' then raise;end if;end;
  begin perform public.admin_submit_seller_claim_intake(pg_temp.seller_claim_id('request',2),pg_temp.seller_claim_payload(2)||jsonb_build_object('source','inquiry','inquiryId',pg_temp.seller_claim_id('inquiry',2)),null);raise exception 'foreign inquiry accepted';
    exception when check_violation then if sqlerrm<>'seller_claim_inquiry_mismatch' then raise;end if;end;
  begin perform public.admin_submit_seller_claim_intake(pg_temp.seller_claim_id('request',2),pg_temp.seller_claim_payload(2)||'{"agreementConfirmed":false}',null);raise exception 'missing customer agreement accepted';
    exception when invalid_parameter_value then null;end;
  begin perform public.admin_submit_seller_claim_intake(pg_temp.seller_claim_id('request',2),pg_temp.seller_claim_payload(2)||'{"amount":100}',null);raise exception 'partial amount accepted';
    exception when invalid_parameter_value then null;end;
  begin perform public.admin_submit_seller_claim_intake(pg_temp.seller_claim_id('request',2),pg_temp.seller_claim_payload(2)||'{"claimType":"cancel"}',null);raise exception 'cancel intake accepted';
    exception when invalid_parameter_value then null;end;
  begin perform public.admin_submit_seller_claim_intake(pg_temp.seller_claim_id('request',2),pg_temp.seller_claim_payload(2)||jsonb_build_object('customerRequestedAt','2099-01-01T00:00:00Z'),null);raise exception 'future customer time accepted';
    exception when invalid_parameter_value then null;end;
  begin perform public.admin_submit_seller_claim_intake(pg_temp.seller_claim_id('request',2),jsonb_set(pg_temp.seller_claim_payload(2),'{collections}',jsonb_build_array(pg_temp.seller_claim_payload(2)->'collections'->0)),null);raise exception 'partial origin collection accepted';
    exception when check_violation then if sqlerrm<>'seller_claim_collections_changed' then raise;end if;end;
  begin perform public.admin_submit_seller_claim_intake(pg_temp.seller_claim_id('request',2),jsonb_set(pg_temp.seller_claim_payload(2),'{collections}',jsonb_build_array(pg_temp.seller_claim_payload(2)->'collections'->0,pg_temp.seller_claim_payload(2)->'collections'->0)),null);raise exception 'duplicate origin accepted';
    exception when check_violation then if sqlerrm<>'seller_claim_collections_changed' then raise;end if;end;
end $$;
-- Request-only exchange can continue through the existing approval and receipt gate.
select public.admin_submit_seller_claim_intake(pg_temp.seller_claim_id('request',2),pg_temp.seller_claim_payload(2,'exchange'),null);
select public.admin_decide_order_claim(pg_temp.seller_claim_id('request',2),'approve',null);
select 1/case when public.admin_order_claim_detail(pg_temp.seller_claim_id('request',2))#>>'{claim,stage}'='collecting'
  and jsonb_array_length(public.admin_order_claim_detail(pg_temp.seller_claim_id('request',2))#>'{claim,collections}')=2 then 1 else 0 end as existing_approval_creates_physical_collections_separately;
do $$begin
  begin perform pg_temp.record_order_claim_reshipment_physical(pg_temp.seller_claim_id('request',2),'hanjin','SELLERCLAIM123','[]');raise exception 'reshipment before actual receipt accepted';
    exception when check_violation then if sqlerrm not in ('claim_collections_incomplete','claim_not_reshippable') then raise;end if;end;
end $$;
select public.admin_decide_order_claim(pg_temp.seller_claim_id('request',1),'reject','합성 검수 종료를 위한 거부 사유');
reset role;
select 1/case when (select purge_after is not null from private.claim_refund_accounts where claim_id=pg_temp.seller_claim_id('request',1)) then 1 else 0 end as existing_private_account_retention_seals_on_rejection;
-- Physical quantities, replacement receipts and actual submission time stay authoritative.
update public.order_shipment_items set qty=2 where order_id=pg_temp.seller_claim_id('order',3);
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reship_carrier,reship_tracking_number,reshipped_at,completed_at)
values(pg_temp.seller_claim_id('history',4),pg_temp.seller_claim_id('order',4),pg_temp.seller_claim_id('user',2),'미수령 교환품 합성 이력','exchange','completed','hanjin','SELLERCLAIMH4',now()-interval '1 day',now()-interval '1 day');
update public.order_shipments set status='ready',delivered_at=null,shipped_at=null where order_id=pg_temp.seller_claim_id('order',7);
set local role authenticated;
select 1/case when public.admin_seller_claim_intake_context(pg_temp.seller_claim_id('order',3))#>>'{blockedReasons,defect}'='not_claimable'
  and public.admin_seller_claim_intake_context(pg_temp.seller_claim_id('order',4))#>>'{blockedReasons,defect}'='not_claimable'
  and public.admin_seller_claim_intake_context(pg_temp.seller_claim_id('order',5))#>>'{blockedReasons,change_of_mind}'='deadline_expired'
  and public.admin_seller_claim_intake_context(pg_temp.seller_claim_id('order',5))#>'{blockedReasons,defect}'='null'::jsonb
  and public.admin_seller_claim_intake_context(pg_temp.seller_claim_id('order',6))#>>'{blockedReasons,defect}'='deadline_expired'
  and public.admin_seller_claim_intake_context(pg_temp.seller_claim_id('order',7))#>>'{blockedReasons,defect}'='not_claimable'
  then 1 else 0 end as real_delivery_replacement_and_deadline_blocks;
do $$begin
  begin perform public.admin_submit_seller_claim_intake(pg_temp.seller_claim_id('request',3),pg_temp.seller_claim_payload(3),null);raise exception 'partial delivery intake accepted';
    exception when check_violation then if sqlerrm<>'not_claimable' then raise;end if;end;
  begin perform public.admin_submit_seller_claim_intake(pg_temp.seller_claim_id('request',4),pg_temp.seller_claim_payload(4),null);raise exception 'unreceived replacement intake accepted';
    exception when check_violation then if sqlerrm<>'not_claimable' then raise;end if;end;
  begin perform public.admin_submit_seller_claim_intake(pg_temp.seller_claim_id('request',5),pg_temp.seller_claim_payload(5)||'{"reasonType":"change_of_mind","customerRequestedAt":"2026-01-01T00:00:00Z"}',null);raise exception 'backdated evidence extended deadline';
    exception when check_violation then if sqlerrm<>'deadline_expired' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',pg_temp.seller_claim_id('user',4)::text,true);
do $$begin
  begin perform public.admin_submit_seller_claim_intake(pg_temp.seller_claim_id('request',2),pg_temp.seller_claim_payload(2,'exchange'),null);raise exception 'other operator replay accepted';
    exception when sqlstate 'PT409' then null;end;
end $$;
select 1/case when public.admin_get_seller_claim_intake(pg_temp.seller_claim_id('request',2))->>'stage'='collecting' then 1 else 0 end as another_staff_can_read_provenance_without_replaying;
reset role;
update public.profiles set suspended_at=now(),suspension_reason='합성 권한 검수' where id=pg_temp.seller_claim_id('user',4);
set local role authenticated;
do $$begin
  begin perform public.admin_seller_claim_intake_context(pg_temp.seller_claim_id('order',8));raise exception 'suspended operator read accepted';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub',pg_temp.seller_claim_id('user',2)::text,true);
do $$begin
  begin perform public.admin_seller_claim_intake_context(pg_temp.seller_claim_id('order',8));raise exception 'customer context accepted';exception when insufficient_privilege then null;end;
  begin perform public.admin_get_seller_claim_intake(pg_temp.seller_claim_id('request',2));raise exception 'customer staff receipt accepted';exception when insufficient_privilege then null;end;
  begin perform public.admin_submit_seller_claim_intake(pg_temp.seller_claim_id('request',8),pg_temp.seller_claim_payload(8),null);raise exception 'customer assisted intake accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 1/case when not has_table_privilege('authenticated','private.seller_order_claim_intakes','select')
  and not has_table_privilege('service_role','private.seller_order_claim_intakes','insert')
  and not has_function_privilege('anon','public.admin_submit_seller_claim_intake(uuid,jsonb,jsonb)','execute')
  and not has_function_privilege('service_role','public.admin_submit_seller_claim_intake(uuid,jsonb,jsonb)','execute')
  and has_function_privilege('authenticated','public.admin_submit_seller_claim_intake(uuid,jsonb,jsonb)','execute')
  and (select relrowsecurity from pg_class where oid='private.seller_order_claim_intakes'::regclass)
  then 1 else 0 end as private_storage_and_public_rpc_acl;
rollback;
