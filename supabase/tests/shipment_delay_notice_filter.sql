\set ON_ERROR_STOP on
begin;
load 'safeupdate';
create function pg_temp.notice_filter_id(kind text,n integer) returns uuid language sql immutable as $$
 select md5('shipment-notice-filter:'||kind||':'||n)::uuid$$;
create function pg_temp.notice_filter_expect(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected error: %',expected;end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.notice_filter_id('actor',n),'authenticated','authenticated','notice-filter-'||n||'@example.test','{}','{}' from generate_series(1,3)n;
update public.profiles set role='staff' where id=pg_temp.notice_filter_id('actor',1);
update public.profiles set nickname='notice_filter_buyer' where id=pg_temp.notice_filter_id('actor',2);
insert into private.operator_memberships(profile_id,manager_role)values(pg_temp.notice_filter_id('actor',1),'primary');
insert into public.fulfillment_origins(id,code,name,base_fee,return_address)
 values(pg_temp.notice_filter_id('origin',1),'notice-filter-origin','안내 필터 검증 출고지',0,'합성 반송 주소'),
 (pg_temp.notice_filter_id('origin',2),'notice-filter-origin-2','안내 필터 다른 출고지',0,'합성 반송 주소');
insert into public.orders(id,user_id,status,total,address,created_at,confirmed_at,payment_method)
 select pg_temp.notice_filter_id('order',n),pg_temp.notice_filter_id('actor',2),case when n=9 then 'paid'::public.order_status else 'confirmed'::public.order_status end,
 n*100,'{"recipientName":"안내 필터 합성 수취인"}',now()-interval '10 days',case when n<9 then now()-interval '5 days' end,'card'
 from generate_series(1,9)n;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status)
 select pg_temp.notice_filter_id('shipment',n),pg_temp.notice_filter_id('order',case when n=8 then 3 else n end),
 pg_temp.notice_filter_id('origin',case when n=8 then 2 else 1 end),'안내 필터 검증 출고지',0,'{}','ready' from generate_series(1,9)n;
insert into private.email_intents(id,source,source_reference_digest,recipient_digest,message_kind,content_revision,state)
 select pg_temp.notice_filter_id('intent',n),'order_delay_notice',extensions.digest('notice-filter-'||n,'sha256'),extensions.digest('notice-filter-recipient-'||n,'sha256'),
 'order_delay_notice','v1',case n when 3 then 'accepted' when 4 then 'bounced' when 5 then 'dispatching' when 6 then 'unknown' else 'suppressed' end
 from generate_series(3,7)n;
insert into private.order_delay_notices(id,actor_id,shipment_ids,title,customer_body,requested_at)
 select pg_temp.notice_filter_id('notice',n),pg_temp.notice_filter_id('actor',1),array[pg_temp.notice_filter_id('shipment',n)],
 '합성 지연 안내','필터 조회를 위한 합성 문구',case when n>2 then now()-interval '1 hour' end from generate_series(2,7)n;
insert into private.order_delay_notice_targets(id,notice_id,order_id,buyer_id,recipient_email,buyer_name,shipment_ids,shipment_labels,snapshot,message_body,in_app_status,email_status,email_intent_id)
 select pg_temp.notice_filter_id('target',n),pg_temp.notice_filter_id('notice',n),pg_temp.notice_filter_id('order',n),pg_temp.notice_filter_id('actor',2),
 'notice-filter-2@example.test','합성 구매자',array[pg_temp.notice_filter_id('shipment',n)],array['합성 배송건'],'{}','외부에 노출할 필요 없는 고객 문구',
 case when n=2 then 'prepared' else 'sent' end,case when n=2 then 'prepared' when n=6 then 'processing' else 'sent' end,
 case when n>=3 then pg_temp.notice_filter_id('intent',n) end from generate_series(2,7)n;
-- A newer preview must not hide an earlier requested/sent result.
insert into private.order_delay_notices(id,actor_id,shipment_ids,title,customer_body,created_at)
 values(pg_temp.notice_filter_id('notice',30),pg_temp.notice_filter_id('actor',1),array[pg_temp.notice_filter_id('shipment',3)],'새 미리보기','아직 전송하지 않음',now()+interval '1 second');
insert into private.order_delay_notice_targets(id,notice_id,order_id,buyer_id,buyer_name,shipment_ids,shipment_labels,snapshot,message_body)
 values(pg_temp.notice_filter_id('target',30),pg_temp.notice_filter_id('notice',30),pg_temp.notice_filter_id('order',3),pg_temp.notice_filter_id('actor',2),
 '합성 구매자',array[pg_temp.notice_filter_id('shipment',3)],array['합성 배송건'],'{}','아직 전송하지 않음');
create temp table notice_filter_money as select o.id,to_jsonb(o) original from public.orders o where o.user_id=pg_temp.notice_filter_id('actor',2);
create temp table notice_filter_targets as select to_jsonb(t) original from private.order_delay_notice_targets t where t.buyer_id=pg_temp.notice_filter_id('actor',2);
create function pg_temp.notice_filter_search(state text default null,tab text default 'delayed',lim integer default 100,off integer default 0)
 returns jsonb language sql stable as $$select public.admin_search_shipments_notice_console(tab,p_query:='notice_filter_buyer',p_field:='buyer',p_limit:=lim,p_offset:=off,p_delay_notice_status:=state)$$;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.notice_filter_id('actor',1)::text,true);
select 1/case when pg_temp.notice_filter_search()->>'total'='8'
 and pg_temp.notice_filter_search('not_sent')->>'total'='3'
 and pg_temp.notice_filter_search('sent')->>'total'='1'
 and pg_temp.notice_filter_search('partial_failed')->>'total'='2'
 and pg_temp.notice_filter_search('pending')->>'total'='1'
 and pg_temp.notice_filter_search('unknown')->>'total'='1' then 1 else 0 end as exact_channel_status_counts;
select 1/case when pg_temp.notice_filter_search('sent')#>>'{rows,0,id}'=pg_temp.notice_filter_id('shipment',3)::text
 and pg_temp.notice_filter_search('sent')#>>'{rows,0,delayNotice,noticeId}'=pg_temp.notice_filter_id('notice',3)::text
 and pg_temp.notice_filter_search('sent')#>>'{rows,0,delayNotice,emailProviderState}'='accepted'
 and pg_temp.notice_filter_search('unknown')#>>'{rows,0,delayNotice,emailStatus}'='unknown'
 and pg_temp.notice_filter_search('pending')#>>'{rows,0,delayNotice,emailStatus}'='processing'
 then 1 else 0 end as preview_does_not_mask_sent_and_provider_state_wins;
select 1/case when pg_temp.notice_filter_search('not_sent')#>>'{counts,new}'='1'
 and pg_temp.notice_filter_search('not_sent')#>>'{counts,ready}'='3'
 and pg_temp.notice_filter_search('not_sent','new')->>'total'='1'
 and public.admin_search_shipments_notice_console('delayed',p_query:='notice_filter_buyer',p_field:='buyer',p_method:='parcel',p_payment_method:='card',p_delay_notice_status:='sent')->>'total'='1'
 and public.admin_search_shipments_notice_console('delayed',p_query:='no-result',p_delay_notice_status:='sent')->>'total'='0'
 then 1 else 0 end as summary_and_search_use_same_notice_filter;
select 1/case when jsonb_array_length(pg_temp.notice_filter_search('partial_failed','delayed',1,1)->'rows')=1
 and pg_temp.notice_filter_search('partial_failed','delayed',1,1)->>'total'='2'
 and pg_temp.notice_filter_search('partial_failed','delayed',1,0)#>>'{rows,0,id}'<>pg_temp.notice_filter_search('partial_failed','delayed',1,1)#>>'{rows,0,id}'
 and pg_temp.notice_filter_search('partial_failed','delayed',1,0)->>'delayNoticeFingerprint'=pg_temp.notice_filter_search('partial_failed','delayed',1,1)->>'delayNoticeFingerprint'
 and pg_temp.notice_filter_search('partial_failed','delayed',1,99)->>'total'='2' then 1 else 0 end as paging_happens_after_filter_and_fingerprint_covers_all_rows;
select 1/case when pg_temp.notice_filter_search()::text not like '%recipientEmail%'
 and pg_temp.notice_filter_search()::text not like '%email_intent%'
 and pg_temp.notice_filter_search()::text not like '%외부에 노출할 필요 없는%'
 then 1 else 0 end as notice_projection_has_no_recipient_or_message_or_provider_id;
select pg_temp.notice_filter_expect($q$select public.admin_search_shipments_notice_console('ready',p_delay_notice_status:='made_up')$q$,'22023');
select pg_temp.notice_filter_search(null,'delayed',1,0)->>'delayNoticeFingerprint' as before_fingerprint \gset
select 1/case when pg_temp.notice_filter_search(null,'delayed',1,0)#>>'{rows,0,id}'<>pg_temp.notice_filter_id('shipment',7)::text
 then 1 else 0 end as changed_callback_is_actually_outside_first_page;
reset role;
select 1/case when not exists((select original from notice_filter_targets) except (select to_jsonb(t) from private.order_delay_notice_targets t where t.buyer_id=pg_temp.notice_filter_id('actor',2)))
 then 1 else 0 end as reading_results_does_not_send_or_retry;
-- Later callbacks change the fingerprint even if this row is not on the first page
-- and the total/IDs remain identical.
update private.email_intents set state='needs_review' where id=pg_temp.notice_filter_id('intent',7);
set local role authenticated;
select 1/case when pg_temp.notice_filter_search(null,'delayed',1,0)->>'delayNoticeFingerprint'<>:'before_fingerprint'
 and pg_temp.notice_filter_search()->>'total'='8'
 and pg_temp.notice_filter_search('unknown')->>'total'='2' then 1 else 0 end as outside_page_callback_is_detected;
reset role;
-- New requested notice replaces an old success; prepared app status cannot pass as sent.
update private.order_delay_notices set requested_at=now() where id=pg_temp.notice_filter_id('notice',30);
update private.order_delay_notice_targets set in_app_status='sent',email_status='failed' where id=pg_temp.notice_filter_id('target',30);
select 1/case when private.shipment_delay_notice_summary(pg_temp.notice_filter_id('shipment',3))->>'status'='partial_failed'
 and private.shipment_delay_notice_summary(pg_temp.notice_filter_id('shipment',8))->>'status'='not_sent'
 then 1 else 0 end as newest_requested_and_exact_shipment_binding;
update private.order_delay_notice_targets set in_app_status='prepared',email_status='sent' where id=pg_temp.notice_filter_id('target',30);
select 1/case when private.shipment_delay_notice_summary(pg_temp.notice_filter_id('shipment',3))->>'status'='unknown'
 then 1 else 0 end as impossible_partial_receipt_never_claims_success;
select 1/case when not has_function_privilege('anon','public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text)','execute')
 and not has_function_privilege('service_role','public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text)','execute')
 and not has_function_privilege('authenticated','private.shipment_delay_notice_summary(uuid)','execute')
 and not has_table_privilege('authenticated','private.order_delay_notice_targets','select') then 1 else 0 end as sealed_projection;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.notice_filter_id('actor',3)::text,true);
select pg_temp.notice_filter_expect($q$select pg_temp.notice_filter_search()$q$,'42501');
reset role;
delete from private.operator_memberships where profile_id=pg_temp.notice_filter_id('actor',1);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.notice_filter_id('actor',1)::text,true);
select pg_temp.notice_filter_expect($q$select pg_temp.notice_filter_search()$q$,'42501');
reset role;
select 1/case when not exists(select 1 from notice_filter_money b join public.orders o on o.id=b.id where to_jsonb(o)<>b.original)
 then 1 else 0 end as order_money_and_shipping_untouched;
-- Check that the containment predicate can use the new GIN index, even on a
-- tiny synthetic table where the normal planner correctly prefers a seq scan.
set local enable_seqscan=off;
explain (costs off) select id from private.order_delay_notice_targets where shipment_ids @> array[pg_temp.notice_filter_id('shipment',3)];
rollback;
