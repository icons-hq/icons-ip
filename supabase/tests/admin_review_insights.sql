\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
 ('71000000-0000-4000-8000-000000000001','authenticated','authenticated','review-insights-staff@example.test','{}','{}'),
 ('71000000-0000-4000-8000-000000000002','authenticated','authenticated','review-insights-customer@example.test','{}','{}');
update public.profiles set role='staff' where id='71000000-0000-4000-8000-000000000001';
insert into public.ips(id,title,vertical_key,published_at) values
 ('review-insights-qa-ip','리뷰 통계 검증','character',now()),('review-insights-qa-private','비공개 통계 제외','character',null);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at)
select 'review-insights-qa-'||key,case when key='private' then 'review-insights-qa-private' else 'review-insights-qa-ip' end,
  case when key='a' then '사진 100% 아닌 상품' else '검수 상품 '||key end,'문구',1000,'ok',100,null
from unnest(array['a','b','empty','draft','private','adult']||array(select 'page-'||i from generate_series(1,21) i)) key;
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id like 'review-insights-qa-%' and id<>'review-insights-qa-draft';
update public.goods set sale_restriction='adult' where id='review-insights-qa-adult';
select date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as day_start \gset
insert into public.orders(id,user_id,status,total,address,created_at,delivered_at)
select ('72000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'71000000-0000-4000-8000-000000000002','delivered',1000,'{}',
  :'day_start'::timestamptz-interval '150 days',case when n in (1,1002,1003,1006) then :'day_start'::timestamptz-interval '2 days' else :'day_start'::timestamptz-interval '91 days' end
from generate_series(1,1006) n;
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select '72000000-0000-4000-8000-000000000001','review-insights-qa-a',v.id,1,1000,'합성 A','문구','review-insights-qa-ip'
from public.goods_variants v cross join unnest(array['ALPHA','BETA']) value where v.good_id='review-insights-qa-a' and v.is_default;
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select ('72000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'review-insights-qa-b',v.id,1,1000,'합성 B','문구','review-insights-qa-ip'
from public.goods_variants v cross join generate_series(1002,1003) n where v.good_id='review-insights-qa-b' and v.is_default;
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select '72000000-0000-4000-8000-000000001006','review-insights-qa-adult',v.id,1,1000,'합성 비노출 상품','문구','review-insights-qa-ip'
from public.goods_variants v where v.good_id='review-insights-qa-adult' and v.is_default;
insert into public.reviews(user_id,good_id,order_id,rating,body,created_at,image_paths)
select '71000000-0000-4000-8000-000000000002','review-insights-qa-a',('72000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,5,'행수 제한 없는 합성 리뷰',:'day_start'::timestamptz-interval '1 second',
  case when n=1 then array['71000000-0000-4000-8000-000000000002/review/71000000-0000-4000-8000-000000000020.png'] else '{}'::text[] end
from generate_series(1,1001) n;
insert into public.reviews(user_id,good_id,order_id,rating,body,created_at,image_paths) values
 ('71000000-0000-4000-8000-000000000002','review-insights-qa-b','72000000-0000-4000-8000-000000001004',1,'오래된 낮은 평점 합성 리뷰',:'day_start'::timestamptz-interval '7 months',array['71000000-0000-4000-8000-000000000002/review/71000000-0000-4000-8000-000000000021.png']),
 ('71000000-0000-4000-8000-000000000002','review-insights-qa-a','72000000-0000-4000-8000-000000001003',2,'오늘 등록되어 누적 진단에는 제외',:'day_start','{}'),
 ('71000000-0000-4000-8000-000000000002','review-insights-qa-a','72000000-0000-4000-8000-000000001005',1,'미래 리뷰는 신규 수에서도 제외',now()+interval '1 day','{}'),
 ('71000000-0000-4000-8000-000000000002','review-insights-qa-private','72000000-0000-4000-8000-000000001005',1,'비공개 IP에 속한 합성 리뷰',now()-interval '2 days','{}');
insert into public.reviews(user_id,good_id,order_id,rating,body,status,hidden_reason,hidden_at,created_at) values
 ('71000000-0000-4000-8000-000000000002','review-insights-qa-b','72000000-0000-4000-8000-000000001002',5,'블라인드도 작성 여부에는 포함','hidden','검증용',now(),:'day_start'::timestamptz-interval '1 day');

-- A published adult product is still absent from the public storefront. Its
-- reviews must not change any global benchmark, including recent counts.
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.admin_review_insights()->'summary' as public_summary \gset
reset role;
insert into public.reviews(user_id,good_id,order_id,rating,body,created_at,image_paths) values
 ('71000000-0000-4000-8000-000000000002','review-insights-qa-adult','72000000-0000-4000-8000-000000001006',1,'판매 제한 비노출 상품의 합성 리뷰',:'day_start'::timestamptz-interval '1 second',array['71000000-0000-4000-8000-000000000002/review/71000000-0000-4000-8000-000000000022.png']);
set local role authenticated;
select 1/case when public.admin_review_insights()->'summary'=:'public_summary'::jsonb then 1 else 0 end as assert_restricted_product_does_not_change_summary;
reset role;

select 1/case when not has_function_privilege('anon','public.admin_review_insights(text,text,text,integer,integer)','execute')
 and not has_function_privilege('service_role','public.admin_review_insights(text,text,text,integer,integer)','execute')
 and has_function_privilege('authenticated','public.admin_review_insights(text,text,text,integer,integer)','execute') then 1 else 0 end as assert_acl;
set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
do $$ begin perform public.admin_review_insights(); raise exception 'customer access allowed'; exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
do $$ declare report jsonb; a jsonb; b jsonb; begin
 report:=public.admin_review_insights('all','review-insights-qa-','reviews',1,50);
 if (report->>'total')::integer<>24 then raise exception 'published count mismatch %',report->>'total'; end if;
 select row into a from jsonb_array_elements(report->'rows') row where row->>'id'='review-insights-qa-a';
 select row into b from jsonb_array_elements(report->'rows') row where row->>'id'='review-insights-qa-b';
 if (a->>'reviewCount')::integer<>1001 or (a->>'photoCount')::integer<>1 or (a->>'averageRating')::numeric<>5
  or (a->>'deliveredCount')::integer<>1 or (a->>'reviewedCount')::integer<>1 or (a->>'coverageRate')::numeric<>100 then raise exception 'A aggregation failed %',a; end if;
 if (b->>'reviewCount')::integer<>1 or (b->>'averageRating')::numeric<>1 or (b->>'deliveredCount')::integer<>2
  or (b->>'reviewedCount')::integer<>1 or (b->>'coverageRate')::numeric<>50 then raise exception 'B cohort/hidden review failed %',b; end if;
 if report->'summary' is distinct from public.admin_review_insights('all','no-match')->'summary' then raise exception 'global benchmark changed with search'; end if;
 if public.admin_review_insights('rating','review-insights-qa-')->>'total'<>'1' then raise exception 'rating filter failed'; end if;
 if public.admin_review_insights('all','100%')->>'total'<>'1' then raise exception 'literal search failed'; end if;
 report:=public.admin_review_insights('all','review-insights-qa-','reviews',2,20);
 if jsonb_array_length(report->'rows')<>4 or report->>'total'<>'24' then raise exception 'pagination failed %',report; end if;
 if exists(select 1 from jsonb_array_elements(report->'rows') row where row->>'id' in ('review-insights-qa-private','review-insights-qa-draft','review-insights-qa-adult')) then raise exception 'nonpublic product in report'; end if;
 if public.admin_review_insights('all','review-insights-qa-adult')->>'total'<>'0' then raise exception 'restricted product can be searched'; end if;
 begin perform public.admin_review_insights('invalid'); raise exception 'bad focus allowed'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
update public.profiles set suspended_at=now(),suspension_reason='검수용' where id='71000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin perform public.admin_review_insights(); raise exception 'suspended staff allowed'; exception when insufficient_privilege then null; end $$;
rollback;
