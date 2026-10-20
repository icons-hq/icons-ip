\set ON_ERROR_STOP on
begin;
create function pg_temp.sort_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected review sort error: %',expected;
end$$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
 select ('93600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','review-sort-'||n||'@example.test','{}','{}' from generate_series(1,3)n;
update public.profiles set role='staff' where id in('93600000-0000-4000-8000-000000000001','93600000-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id,manager_role) values
 ('93600000-0000-4000-8000-000000000001','deputy'),('93600000-0000-4000-8000-000000000003','logistics');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key) values('review-sort-tests','정렬 합성 IP','character');
insert into public.goods(id,ip_id,name,type,price) values
 ('review-sort-a','review-sort-tests','합성 정렬 가 상품','문구',1000),
 ('review-sort-b','review-sort-tests','합성 정렬 나 상품','문구',1000),
 ('review-sort-c','review-sort-tests','합성 정렬 다 상품','문구',1000);
insert into public.orders(id,user_id,status,total,address,delivered_at)
 select ('93600000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,'93600000-0000-4000-8000-000000000002','delivered',1000,'{}',now() from generate_series(1,26)n;
-- Simulate a legacy nullable row only inside this rolled-back test transaction.
-- Production keeps its NOT NULL constraint; the read contract still treats NULL as zero.
alter table public.reviews alter column image_paths drop not null;
insert into public.reviews(id,user_id,good_id,order_id,rating,body,image_paths,created_at,status,hidden_at,hidden_reason)
 select ('93600000-0000-4000-8002-'||lpad(n::text,12,'0'))::uuid,'93600000-0000-4000-8000-000000000002',
 'review-sort-'||case when n<=9 then 'a' when n<=18 then 'b' else 'c' end,
 ('93600000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,n%5+1,'합성 정렬 검증 리뷰 '||lpad(n::text,2,'0'),
 case when n=26 then null else array(select '93600000-0000-4000-8000-000000000002/review/93600000-0000-4000-8003-'||lpad((n*10+i)::text,12,'0')||'.webp'
  from generate_series(1,case when n=25 then 0 when n%3=0 then 3 when n%3=1 then 1 else 0 end)i) end,
 case when n=1 then '2026-10-01T03:00:00Z'::timestamptz when n=2 then '2026-10-01T04:00:00Z'::timestamptz else '2026-10-02T03:00:00Z'::timestamptz end,
 case when n=23 then 'hidden' else 'visible' end,case when n=23 then now() end,case when n=23 then '합성 비공개' end
 from generate_series(1,26)n;
-- These synthetic selections intentionally need review (no valid payment).
-- Verify BEST filtering independently of the new ordering and before LIMIT.
insert into private.review_best_selections(review_id,selected,review_fingerprint,selected_at,reason)
 select r.id,true,private.review_event_review_fingerprint(r),now(),'합성 재확인 대상' from public.reviews r
 where r.good_id like 'review-sort-%' and right(r.id::text,12)::integer%2=1;
set local role authenticated;
select set_config('request.jwt.claim.sub','93600000-0000-4000-8000-000000000001',true);
select 1/case when (select array_agg(right(id::text,12)::integer order by ordinality) from public.admin_search_reviews(p_query=>'합성 정렬 검증',p_field=>'body',p_sort=>'good_name_asc',p_limit=>100) with ordinality)
 =array[9,8,7,6,5,4,3,2,1,18,17,16,15,14,13,12,11,10,26,25,24,23,22,21,20,19]
 then 1 else 0 end as name_ascending_then_created_and_id_descending;
select 1/case when (select array_agg(right(id::text,12)::integer order by ordinality) from public.admin_search_reviews(p_query=>'합성 정렬 검증',p_field=>'body',p_sort=>'photo_count_desc',p_limit=>100) with ordinality)
 =array[24,21,18,15,12,9,6,3,22,19,16,13,10,7,4,1,26,25,23,20,17,14,11,8,5,2]
 then 1 else 0 end as photos_descending_null_and_empty_equal_zero;
select 1/case when (select array_agg(right(id::text,12)::integer order by ordinality) from public.admin_search_reviews_best(p_query=>'합성 정렬 검증',p_field=>'body',p_sort=>'photo_count_desc',p_limit=>20,p_offset=>20) with ordinality)
 =array[17,14,11,8,5,2]
 and (select min(total_count) from public.admin_search_reviews_best(p_query=>'합성 정렬 검증',p_field=>'body',p_sort=>'photo_count_desc',p_limit=>20,p_offset=>20))=26
 then 1 else 0 end as second_page_retains_global_order_and_total;
select 1/case when (select array_agg(right(id::text,12)::integer order by ordinality) from public.admin_search_reviews_best(p_query=>'합성 정렬 검증',p_field=>'body',p_sort=>'good_name_asc',p_best=>'not_selected',p_limit=>100) with ordinality)
 =array[8,6,4,2,18,16,14,12,10,26,24,22,20]
 and (select min(total_count) from public.admin_search_reviews_best(p_query=>'합성 정렬 검증',p_field=>'body',p_sort=>'good_name_asc',p_best=>'not_selected',p_limit=>1))=13
 then 1 else 0 end as best_filter_precedes_name_sort_count_and_page;
select 1/case when (select array_agg(right(id::text,12)::integer order by ordinality) from public.admin_search_reviews_best(p_query=>'합성 정렬 검증',p_field=>'body',p_sort=>'photo_count_desc',p_best=>'needs_review',p_limit=>100) with ordinality)
 =array[21,15,9,3,19,13,7,1,25,23,17,11,5]
 and (select min(total_count) from public.admin_search_reviews_best(p_query=>'합성 정렬 검증',p_field=>'body',p_sort=>'photo_count_desc',p_best=>'needs_review',p_limit=>1))=13
 then 1 else 0 end as best_filter_precedes_photo_sort_count_and_page;
select 1/case when (select array_agg(right(id::text,12)::integer order by ordinality) from public.admin_search_reviews_best(p_query=>'합성 정렬 검증',p_field=>'body',p_sort=>'photo_count_desc',p_has_photo=>false,p_limit=>100) with ordinality)
 =array[26,25,23,20,17,14,11,8,5,2]
 then 1 else 0 end as null_photo_is_in_without_photo_filter;
select 1/case when (select array_agg(right(id::text,12)::integer order by ordinality) from public.admin_search_reviews_best(p_query=>'합성 정렬 검증',p_field=>'body',p_sort=>'photo_count_desc',p_has_photo=>true,p_has_reply=>false,p_low_rating=>true,p_status=>'visible',p_from=>'2026-10-01',p_to=>'2026-10-02',p_limit=>100) with ordinality)
 =array[21,15,6,16,10,1]
 then 1 else 0 end as combined_filters_keep_server_order;
do $$declare sort text;legacy uuid[];best uuid[];begin
 foreach sort in array array['recent','oldest','rating_desc','rating_asc','good_name_asc','photo_count_desc'] loop
  select array_agg(id order by ordinality) into legacy from public.admin_search_reviews(p_query=>'합성 정렬 검증',p_field=>'body',p_sort=>sort,p_limit=>100) with ordinality;
  select array_agg(id order by ordinality) into best from public.admin_search_reviews_best(p_query=>'합성 정렬 검증',p_field=>'body',p_sort=>sort,p_limit=>100) with ordinality;
  if legacy is distinct from best or cardinality(best)<>26 then raise exception 'Search entry points differ for %',sort;end if;
 end loop;
end$$;
select 1/case when (select bool_and(best_selection->>'reviewId'=id::text) from public.admin_search_reviews_best(p_query=>'합성 정렬 검증',p_field=>'body',p_sort=>'good_name_asc',p_limit=>100))
 and (select count(*) from public.admin_search_reviews_best(p_query=>'합성 정렬 검증',p_field=>'body',p_sort=>'photo_count_desc',p_offset=>26))=0
 then 1 else 0 end as best_snapshot_identity_and_end_page_preserved;
select pg_temp.sort_error($q$select * from public.admin_search_reviews(p_sort=>'photo_count_asc')$q$,'invalid_review_sort');
select pg_temp.sort_error($q$select * from public.admin_search_reviews_best(p_sort=>'good_name_desc')$q$,'invalid_review_sort');
select set_config('request.jwt.claim.sub','93600000-0000-4000-8000-000000000002',true);
select pg_temp.sort_error($q$select * from public.admin_search_reviews(p_sort=>'good_name_asc')$q$,'operator_capability_required');
select pg_temp.sort_error($q$select * from public.admin_search_reviews_best(p_sort=>'photo_count_desc')$q$,'operator_capability_required');
select set_config('request.jwt.claim.sub','93600000-0000-4000-8000-000000000003',true);
select pg_temp.sort_error($q$select * from public.admin_search_reviews_best(p_sort=>'good_name_asc')$q$,'operator_capability_required');
reset role;
select 1/case when not has_function_privilege('anon','public.admin_search_reviews(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer)','execute')
 and not has_function_privilege('service_role','public.admin_search_reviews_best(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)','execute')
 and has_function_privilege('authenticated','public.admin_search_reviews_best(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)','execute')
 then 1 else 0 end as capability_scoped_acl_preserved;
rollback;
