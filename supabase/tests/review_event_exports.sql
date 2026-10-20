\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql. Every row is synthetic and rolled back.
begin;
load 'safeupdate';
create function pg_temp.export_id(n integer) returns uuid language sql immutable as $$select ('bfc03000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.export_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;raise exception 'Expected %',expected;end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.export_id(n),'authenticated','authenticated','review-export-'||n||'@example.test','{}','{}' from generate_series(1,4)n;
update public.profiles set role=case when id=pg_temp.export_id(4) then 'user'::public.user_role else 'staff'::public.user_role end,nickname='내보내기 합성 '||right(id::text,2) where id in(select pg_temp.export_id(n) from generate_series(1,4)n);
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.export_id(1),'primary'),(pg_temp.export_id(2),'deputy'),(pg_temp.export_id(3),'logistics');
insert into public.ips(id,title,vertical_key,published_at) select 'review-export-ip','내보내기 합성 IP',key,now() from public.verticals limit 1;
insert into public.goods(id,ip_id,name,type,price) values('review-export-good','review-export-ip','001 내보내기 합성 상품','문구',1000);
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
 values(('47c47700'||left(md5('review-export-good'),24))::uuid,'authenticated','authenticated','export-kc@example.test','{"testFixture":"goods-kc"}','{}');
insert into private.operator_memberships(profile_id,manager_role) values(('47c47700'||left(md5('review-export-good'),24))::uuid,'primary');
select pg_temp.publish_goods_kc_fixture('review-export-good');
insert into public.orders(id,user_id,status,total,address,delivered_at) values(pg_temp.export_id(20),pg_temp.export_id(4),'delivered',1000,'{}',clock_timestamp()-interval '2 days');
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.export_id(20),g.id,v.id,1,1000,g.name,g.type,g.ip_id from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id='review-export-good';
insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key) values(pg_temp.export_id(21),pg_temp.export_id(4),'order',pg_temp.export_id(20),'korpay',1000,'paid','review-export-payment');
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 values(pg_temp.export_id(22),'korpay',pg_temp.export_id(4),'order',pg_temp.export_id(20),1000,'approved','review-export-attempt','review-export-order','review-export-product',pg_temp.export_id(21),now()+interval '1 hour');
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at) values(pg_temp.export_id(22),'confirm_approved',now()-interval '3 days');
insert into public.reviews(id,user_id,order_id,good_id,rating,body) values(pg_temp.export_id(23),pg_temp.export_id(4),pg_temp.export_id(20),'review-export-good',1,'상담 원문 01000000000은 파일과 감사에 복제하지 않습니다');
insert into private.review_events(id,title,description,target_type,starts_on,ends_on,announces_on,planned_winners,credit_amount,credit_validity_days,banner_style,created_by,created_at)
 select pg_temp.export_id(100+n),'파일 합성 이벤트 '||n,'필터와 상태를 보존하는 합성 자료','all',(now() at time zone 'Asia/Seoul')::date+1,(now() at time zone 'Asia/Seoul')::date+3,
 (now() at time zone 'Asia/Seoul')::date+6,3,1000,10,'basic',pg_temp.export_id(1),now()+make_interval(secs=>n) from generate_series(1,3)n;
update private.review_events set archived_at=now() where id=pg_temp.export_id(103);
insert into private.review_event_entries(id,event_id,source_review_id,review_id,user_id,order_id,good_id,entered_at,event_revision,credit_amount,credit_validity_days,target_snapshot)
 select pg_temp.export_id(200+n),pg_temp.export_id(101),pg_temp.export_id(300+n),pg_temp.export_id(23),pg_temp.export_id(4),pg_temp.export_id(20),'review-export-good',now()+make_interval(secs=>n),1,1000,10,'{}' from generate_series(1,3)n;
update private.review_event_entries set selected=true,selected_review_updated_at=(select updated_at from public.reviews where id=pg_temp.export_id(23)),
 selected_review_fingerprint=(select private.review_event_review_fingerprint(r) from public.reviews r where id=pg_temp.export_id(23)),selected_by=pg_temp.export_id(2),selected_at=now(),selection_reason='합성 선정 사유' where id=pg_temp.export_id(201);
create function pg_temp.export_filters(mode text default 'entries',q text default '') returns jsonb language sql stable as $$
 select case when mode='entries' then jsonb_build_object('mode','entries','eventId',pg_temp.export_id(101),'query',q,'filter','all')
 else jsonb_build_object('mode','events','query',q,'state','all','dateField','created','from',null,'to',null) end $$;
select set_config('request.jwt.claim.sub',pg_temp.export_id(2)::text,true);
set local role authenticated;
select public.admin_export_review_events(pg_temp.export_filters('events','파일 합성')) as event_snapshot \gset
select 1/case when :'event_snapshot'::jsonb->>'total'='2' and :'event_snapshot'::jsonb#>>'{rows,0,id}'=pg_temp.export_id(102)::text
 and not(:'event_snapshot'::jsonb#>'{rows,0}' ? 'goodIds') then 1 else 0 end as list_filter_order_minimized_targets;
select public.admin_export_review_events(pg_temp.export_filters('entries','01000000000')) as snapshot \gset
select 1/case when :'snapshot'::jsonb->>'total'='3' and :'snapshot'::jsonb#>>'{rows,0,id}'=pg_temp.export_id(203)::text
 and :'snapshot'::jsonb#>>'{rows,2,selected}'='true' and :'snapshot'::jsonb#>>'{rows,2,rating}'='1'
 and :'snapshot'::jsonb#>'{rows,2,problem}'='null'::jsonb and not (:'snapshot'::jsonb->'rows')::text~'01000000000|userId|orderId|body|imagePaths|selectionReason|revokeReason'
 then 1 else 0 end as source_text_and_private_ids_excluded;
select public.admin_record_review_event_export(pg_temp.export_filters('entries','01000000000'),:'snapshot'::jsonb->>'fingerprint',3) as audit_id \gset
reset role;
select 1/case when (select not diff::text like '%01000000000%' and not(diff->'filters' ? 'query') and diff->>'queryPresent'='true' and diff->>'queryLength'='11' from public.audit_log where id=:'audit_id') then 1 else 0 end as audit_query_is_redacted;
-- A same-transaction body edit changes the source fingerprint even if updated_at is unchanged.
update public.reviews set body=body||' 수정' where id=pg_temp.export_id(23);
set local role authenticated;
select pg_temp.export_error(format('select public.admin_record_review_event_export(%L::jsonb,%L,3)',pg_temp.export_filters('entries','01000000000'),:'snapshot'::jsonb->>'fingerprint'),'review_event_export_changed');
select public.admin_export_review_events(pg_temp.export_filters()) as selected_before \gset
reset role;
update private.review_event_entries set selected=false where id=pg_temp.export_id(201);
set local role authenticated;
select pg_temp.export_error(format('select public.admin_record_review_event_export(%L::jsonb,%L,3)',pg_temp.export_filters(),:'selected_before'::jsonb->>'fingerprint'),'review_event_export_changed');
select public.admin_export_review_events(pg_temp.export_filters()) as before_award \gset
reset role;
-- Export-only synthetic award state; does not issue credit or call a payment provider.
insert into private.review_event_awards(entry_id,event_id,user_id,source_review_id,order_id,lot_id,amount,expires_at,granted_by,grant_operation_id)
 values(pg_temp.export_id(201),pg_temp.export_id(101),pg_temp.export_id(4),pg_temp.export_id(301),pg_temp.export_id(20),pg_temp.export_id(401),1000,now()+interval '10 days',pg_temp.export_id(1),pg_temp.export_id(402));
set local role authenticated;
select pg_temp.export_error(format('select public.admin_record_review_event_export(%L::jsonb,%L,3)',pg_temp.export_filters(),:'before_award'::jsonb->>'fingerprint'),'review_event_export_changed');
select public.admin_export_review_events(pg_temp.export_filters()||'{"filter":"awarded"}') as paid \gset
select 1/case when :'paid'::jsonb->>'total'='1' and :'paid'::jsonb#>>'{rows,0,creditAmount}'='1000' then 1 else 0 end as paid_filter;
reset role;
update private.review_event_awards set revoked_at=now(),revoke_reason='합성 회수' where entry_id=pg_temp.export_id(201);
set local role authenticated;
select pg_temp.export_error(format('select public.admin_record_review_event_export(%L::jsonb,%L,1)',pg_temp.export_filters()||'{"filter":"awarded"}',:'paid'::jsonb->>'fingerprint'),'review_event_export_changed');
select 1/case when public.admin_export_review_events(pg_temp.export_filters()||'{"filter":"revoked"}')->>'total'='1' then 1 else 0 end as revoked_filter;
select pg_temp.export_error($q$select public.admin_export_review_events('{"mode":"entries","eventId":"not-uuid","query":"","filter":"all"}')$q$,'invalid_review_event_export');
select pg_temp.export_error($q$select public.admin_export_review_events(pg_temp.export_filters()||'{"private":"extra"}')$q$,'invalid_review_event_export');
select public.admin_export_review_events(pg_temp.export_filters()) as before_role \gset
reset role;
update private.operator_memberships set manager_role='logistics' where profile_id=pg_temp.export_id(2);
set local role authenticated;
select pg_temp.export_error(format('select public.admin_record_review_event_export(%L::jsonb,%L,3)',pg_temp.export_filters(),:'before_role'::jsonb->>'fingerprint'),'operator_capability_required');
select set_config('request.jwt.claim.sub',pg_temp.export_id(4)::text,true);
select pg_temp.export_error($q$select public.admin_export_review_events(pg_temp.export_filters())$q$,'operator_capability_required');
reset role;
select 1/case when not has_function_privilege('anon','public.admin_export_review_events(jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_export_review_events(jsonb)','execute')
 and not has_function_privilege('authenticated','private.review_event_export_snapshot(jsonb)','execute') then 1 else 0 end as export_acl_sealed;
-- 10,001 matching rows are rejected instead of silently truncating a successful file.
insert into private.review_event_entries(id,event_id,source_review_id,user_id,order_id,good_id,entered_at,event_revision,credit_amount,credit_validity_days,target_snapshot)
 select pg_temp.export_id(10000+n),pg_temp.export_id(102),pg_temp.export_id(30000+n),pg_temp.export_id(4),pg_temp.export_id(20),'review-export-good',now(),1,1000,10,'{}' from generate_series(1,10001)n;
select set_config('request.jwt.claim.sub',pg_temp.export_id(1)::text,true);
set local role authenticated;
select pg_temp.export_error(format('select public.admin_export_review_events(%L::jsonb)',pg_temp.export_filters()||jsonb_build_object('eventId',pg_temp.export_id(102))),'review_event_export_limit');
rollback;
