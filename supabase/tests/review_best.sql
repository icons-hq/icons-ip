\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql; use only the isolated synthetic DB.
begin;
load 'safeupdate';
create function pg_temp.best_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected BEST error: %',expected;end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('93500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','review-best-'||n||'@example.test',now(),'{}','{}' from generate_series(1,8)n;
update public.profiles set role=case when id='93500000-0000-4000-8000-000000000001' then 'admin'::public.user_role when right(id::text,12)::integer<=3 then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='선정 합성 '||right(id::text,2),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id::text like '93500000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role)
 select ('93500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,role from unnest(array['primary','deputy','logistics']) with ordinality r(role,n);
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key,published_at) select 'review-best-ip','선정 리뷰 합성 IP',key,now() from public.verticals limit 1;
insert into public.goods(id,ip_id,name,type,price) values('review-best-good','review-best-ip','선정 리뷰 합성 상품','문구',10000);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}' from public.goods where id='review-best-good';
update public.profiles set role='staff' where id=(select ('47c47700'||left(md5(id),24))::uuid from public.goods where id='review-best-good');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id='review-best-good';
select pg_temp.publish_goods_kc_fixture('review-best-good');
create function pg_temp.best_order(n integer,stars integer,with_evidence boolean default true) returns uuid language plpgsql as $$
declare purchase uuid:=('93500000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid;payment uuid:=('93500000-0000-4000-8002-'||lpad(n::text,12,'0'))::uuid;
 attempt uuid:=('93500000-0000-4000-8003-'||lpad(n::text,12,'0'))::uuid;buyer uuid:=('93500000-0000-4000-8000-'||lpad((n%5+4)::text,12,'0'))::uuid;review uuid;
begin
 insert into public.orders(id,user_id,status,total,address,delivered_at) values(purchase,buyer,'delivered',10000,'{}',clock_timestamp()-interval '2 days');
 insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select purchase,g.id,v.id,1,10000,g.name,g.type,g.ip_id from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id='review-best-good';
 insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key) values(payment,buyer,'order',purchase,'korpay',10000,'paid','review-best-payment-'||n);
 insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 values(attempt,'korpay',buyer,'order',purchase,10000,'approved','review-best-attempt-'||n,'review-best-order-'||n,'review-best-product-'||n,payment,now()+interval '1 hour');
 if with_evidence then insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at) values(attempt,'confirm',now()-interval '3 days');end if;
 perform set_config('request.jwt.claim.sub',buyer::text,true);
 review:=public.create_good_review(purchase,'review-best-good',stars,'별점과 무관한 선정 리뷰 합성 본문 '||n);
 return review;
end $$;
select pg_temp.best_order(1,1) as review_a \gset
select pg_temp.best_order(2,2) as review_b \gset
select pg_temp.best_order(3,5) as review_c \gset
select pg_temp.best_order(4,4) as review_d \gset
select pg_temp.best_order(5,5,false) as review_unpaid \gset
select private.review_event_review_fingerprint(r) as fp_a from public.reviews r where id=:'review_a' \gset
select private.review_event_review_fingerprint(r) as fp_b from public.reviews r where id=:'review_b' \gset
select private.review_event_review_fingerprint(r) as fp_c from public.reviews r where id=:'review_c' \gset
select private.review_event_review_fingerprint(r) as fp_d from public.reviews r where id=:'review_d' \gset
select private.review_event_review_fingerprint(r) as fp_unpaid from public.reviews r where id=:'review_unpaid' \gset
select 1/case when not has_table_privilege('authenticated','private.review_best_selections','select')
 and not has_table_privilege('anon','private.review_best_settings','select')
 and not has_function_privilege('service_role','public.admin_set_review_best(uuid,boolean,text,integer,text,uuid)','execute')
 and not has_function_privilege('anon','public.admin_get_review_best_states(uuid[])','execute')
 and not has_function_privilege('authenticated','private.invalidate_review_best(uuid[],text)','execute') then 1 else 0 end as sealed_acl;
select set_config('request.jwt.claim.sub','93500000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.admin_set_review_best(:'review_a',true,'사용 경험과 한계를 구체적으로 설명',0,:'fp_a','93500000-0000-4000-8000-000000001001') as first_selected \gset
select 1/case when public.admin_set_review_best(:'review_a',true,'사용 경험과 한계를 구체적으로 설명',0,:'fp_a','93500000-0000-4000-8000-000000001001')=:'first_selected'::jsonb then 1 else 0 end as exact_selection_replay;
select public.admin_set_review_best(:'review_b',true,'사진 없이도 구체적인 사용 경험',0,:'fp_b',gen_random_uuid());
select pg_temp.best_error(format($q$select public.admin_set_review_best(%L,true,'달라진 요청 사유',0,%L,'93500000-0000-4000-8000-000000001001')$q$,:'review_a',:'fp_a'),'operation_conflict');
select pg_temp.best_error(format($q$select public.admin_set_review_best(%L,true,'이전 버전 요청',0,%L,gen_random_uuid())$q$,:'review_a',:'fp_a'),'best_review_revision_conflict');
select pg_temp.best_error(format($q$select public.admin_set_review_best(%L,true,'검증되지 않은 결제',0,%L,gen_random_uuid())$q$,:'review_unpaid',:'fp_unpaid'),'purchase_ineligible');
select set_config('request.jwt.claim.sub','93500000-0000-4000-8000-000000000003',true);
select pg_temp.best_error($q$select public.admin_save_review_best_settings(true,0,gen_random_uuid())$q$,'operator_capability_required');
reset role;
select set_config('request.jwt.claim.sub','93500000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.admin_save_review_best_settings(true,0,'93500000-0000-4000-8000-000000002001') as settings_saved \gset
select 1/case when public.admin_save_review_best_settings(true,0,'93500000-0000-4000-8000-000000002001')=:'settings_saved'::jsonb then 1 else 0 end as settings_replay;
select pg_temp.best_error($q$select public.admin_save_review_best_settings(false,0,gen_random_uuid())$q$,'best_review_settings_conflict');
reset role;
set local role anon;
select 1/case when public.get_good_selected_reviews('review-best-good')='[]'::jsonb then 1 else 0 end as less_than_three_hidden;
reset role;
set local role authenticated;
select public.admin_set_review_best(:'review_c',true,'비교할 수 있는 사용 경험',0,:'fp_c',gen_random_uuid());
reset role;
set local role anon;
select public.get_good_selected_reviews('review-best-good') as public_cards \gset
select 1/case when jsonb_array_length(:'public_cards')=3 and (select count(distinct value->>'id') from jsonb_array_elements(:'public_cards'))=3
 and exists(select 1 from jsonb_array_elements(:'public_cards')e where e->>'rating'='1')
 and not exists(select 1 from jsonb_array_elements(:'public_cards')e where e ?| array['reason','revision','reviewFingerprint','userId','orderId','selectedAt','updatedBy']) then 1 else 0 end as three_unique_including_one_star_without_private_fields;
reset role;
set local role authenticated;
select public.admin_set_review_best(:'review_d',true,'네 번째 구체적인 사용 후기',0,:'fp_d',gen_random_uuid());
select 1/case when (select count(*) from public.admin_search_reviews_best(p_query=>'선정 리뷰 합성 상품',p_best=>'selected'))=4
 and (select min(total_count) from public.admin_search_reviews_best(p_query=>'선정 리뷰 합성 상품',p_best=>'selected',p_limit=>1))=4
 and (select count(*) from public.admin_search_reviews_best(p_query=>'선정 리뷰 합성 상품',p_best=>'not_selected'))=1 then 1 else 0 end as best_filters_before_count_and_pagination;
select pg_temp.best_error($q$select * from public.admin_search_reviews_best(p_best=>'bad')$q$,'invalid_best_review_filter');
reset role;
set local role anon;
select 1/case when jsonb_array_length(public.get_good_selected_reviews('review-best-good'))=3 then 1 else 0 end as more_than_three_samples_three;
reset role;
update public.reviews set admin_reply='운영자 답글은 선정 원문을 바꾸지 않습니다.',admin_reply_at=now() where id=:'review_d';
select 1/case when (select revision=1 and invalidated_at is null from private.review_best_selections where review_id=:'review_d') then 1 else 0 end as reply_does_not_invalidate;
update public.reviews set body='작성자가 내용을 변경했습니다.' where id=:'review_a';
update public.reviews set body='별점과 무관한 선정 리뷰 합성 본문 1' where id=:'review_a';
select 1/case when (select revision=2 and invalidated_at is not null from private.review_best_selections where review_id=:'review_a') then 1 else 0 end as edit_then_restore_still_needs_reselection;
set local role authenticated;
select 1/case when (select count(*) from public.admin_search_reviews_best(p_query=>'선정 리뷰 합성 상품',p_best=>'needs_review'))=1
 and public.admin_get_review_best_states(array[:'review_a'::uuid])#>>'{0,state}'='needs_review' then 1 else 0 end as changed_selection_visible_to_admin;
select public.admin_set_review_best(:'review_a',true,'수정된 원문을 다시 확인했습니다.',2,:'fp_a',gen_random_uuid());
reset role;
update public.reviews set status='hidden',hidden_at=now(),hidden_reason='합성 블라인드 검증' where id=:'review_b';
update public.reviews set status='visible',hidden_at=null,hidden_reason=null where id=:'review_b';
select 1/case when (select revision=2 and invalidated_at is not null from private.review_best_selections where review_id=:'review_b') then 1 else 0 end as unhide_needs_reselection;
set local role authenticated;
select public.admin_set_review_best(:'review_b',true,'공개된 리뷰를 다시 확인했습니다.',2,:'fp_b',gen_random_uuid());
reset role;
update public.payments set status='refunded' where id='93500000-0000-4000-8002-000000000001';
select 1/case when (select invalidation_reason='purchase_changed' and revision=4 from private.review_best_selections where review_id=:'review_a') then 1 else 0 end as refund_invalidates_selection;
set local role authenticated;
select pg_temp.best_error(format($q$select public.admin_set_review_best(%L,true,'환불 후에는 선정할 수 없음',4,%L,gen_random_uuid())$q$,:'review_a',:'fp_a'),'purchase_ineligible');
reset role;
update public.payments set status='paid' where id='93500000-0000-4000-8002-000000000001';
select 1/case when (select invalidated_at is not null from private.review_best_selections where review_id=:'review_a') then 1 else 0 end as restoring_purchase_does_not_reselect;
delete from public.reviews where id=:'review_c';
select 1/case when not exists(select 1 from private.review_best_selections where review_id=:'review_c') and public.get_good_selected_reviews('review-best-good')='[]'::jsonb then 1 else 0 end as deleted_review_and_minimum_hide;
set local role authenticated;
select public.admin_set_review_best(:'review_a',true,'구매 내역과 내용을 다시 확인했습니다.',4,:'fp_a',gen_random_uuid());
reset role;
update public.goods set published_at=null where id='review-best-good';
select 1/case when public.get_good_selected_reviews('review-best-good')='[]'::jsonb then 1 else 0 end as unpublished_good_hidden;
select pg_temp.publish_goods_kc_fixture('review-best-good');
update public.ips set published_at=null where id='review-best-ip';
select 1/case when public.get_good_selected_reviews('review-best-good')='[]'::jsonb then 1 else 0 end as unpublished_ip_hidden;
update public.ips set published_at=now() where id='review-best-ip';
select set_config('request.jwt.claim.sub','93500000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.admin_save_review_best_settings(false,1,gen_random_uuid());
reset role;
select 1/case when public.get_good_selected_reviews('review-best-good')='[]'::jsonb
 and (select count(*) from public.audit_log where id='93500000-0000-4000-8000-000000001001')=1
 and not exists(select 1 from private.review_event_awards where source_review_id=any(array[:'review_a'::uuid,:'review_b'::uuid,:'review_d'::uuid])) then 1 else 0 end as disabled_and_no_duplicate_audit_or_reward;
select set_config('request.jwt.claim.sub','93500000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.best_error(format($q$select public.admin_get_review_best_states(array[%L::uuid])$q$,:'review_a'),'operator_capability_required');
select pg_temp.best_error(format($q$select public.admin_set_review_best(%L,false,'권한 없는 해제 요청',5,%L,gen_random_uuid())$q$,:'review_a',:'fp_a'),'operator_capability_required');
reset role;
rollback;
