\set ON_ERROR_STOP on
-- 목록 카드 별점(LFS 패리티 2차 L4 · CL-02) — get_goods_review_summaries 의 공개 범위·그룹 범위·입력·봉인.
-- 굿즈 상세 요약(get_good_group_reviews_v3)과 같은 숫자를 내는지, 숨김 리뷰와 비공개 굿즈가 새지
-- 않는지, 스태프 세션에서도 같은 값인지 확인한다. 데이터는 끝에서 rollback 한다.
-- run_sql_test 가 앞에 붙이는 helpers/goods_kc_fixture.sql 의 pg_temp.publish_goods_kc_fixture 를 쓴다.
begin;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
 ('00000000-0000-4000-8000-000000056901','authenticated','authenticated','l4-summary-staff@example.test','{}','{}'),
 ('00000000-0000-4000-8000-000000056902','authenticated','authenticated','l4-summary-buyer@example.test','{}','{}');
update public.profiles set role='staff',nickname='l4_summary_staff' where id='00000000-0000-4000-8000-000000056901';
update public.profiles set nickname='l4_summary_buyer' where id='00000000-0000-4000-8000-000000056902';

insert into public.ips(id,title,vertical_key,published_at) values
 ('l4-summary-ip','목록 별점 검증','character',now()),
 ('l4-summary-draft-ip','목록 별점 초안 IP','character',null);

insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at,sale_restriction) values
 ('l4-sum-solo','l4-summary-ip','별점 단독 굿즈','문구',1000,'ok',10,null,'none'),
 ('l4-sum-group-a','l4-summary-ip','별점 묶음 레드','문구',1000,'ok',10,null,'none'),
 ('l4-sum-group-b','l4-summary-ip','별점 묶음 블루','문구',1000,'ok',10,null,'none'),
 ('l4-sum-none','l4-summary-ip','리뷰 없는 굿즈','문구',1000,'ok',10,null,'none'),
 ('l4-sum-hidden','l4-summary-ip','숨김 리뷰만 있는 굿즈','문구',1000,'ok',10,null,'none'),
 ('l4-sum-draft','l4-summary-ip','초안 굿즈','문구',1000,'ok',10,null,'none'),
 ('l4-sum-archived','l4-summary-ip','보관 굿즈','문구',1000,'soldout',0,null,'none'),
 ('l4-sum-restricted','l4-summary-ip','판매 제한 굿즈','문구',1000,'ok',10,null,'adult'),
 ('l4-sum-draft-ip','l4-summary-draft-ip','초안 IP 굿즈','문구',1000,'ok',10,null,'none');

select pg_temp.publish_goods_kc_fixture(id)
from public.goods where id like 'l4-sum-%' and id<>'l4-sum-draft' order by id;

-- 그룹: 상세 요약은 같은 그룹의 공개 굿즈 리뷰를 함께 센다. 멤버 고정 규칙(기본 옵션 하나·이름 = 그룹명 + 옵션값)을
-- 지키는 fixture 라 지연 제약을 즉시 검사해도 통과해야 한다.
insert into private.goods_groups(id,name,option_names,common_good_id,created_by,updated_by) values
 ('4f000000-0000-4000-8000-000000056900','별점 묶음',array['색상'],'l4-sum-group-a',
  '00000000-0000-4000-8000-000000056901','00000000-0000-4000-8000-000000056901');
insert into private.goods_group_members(group_id,good_id,variant_id,option_values,sort_order)
select '4f000000-0000-4000-8000-000000056900',good_id,id,array[case good_id when 'l4-sum-group-a' then '레드' else '블루' end],
 case good_id when 'l4-sum-group-a' then 0 else 1 end
from public.goods_variants where good_id in ('l4-sum-group-a','l4-sum-group-b') and is_default;
set constraints all immediate;
set constraints all deferred;

create function pg_temp.l4_review(p_order integer,p_good text,p_rating integer,p_hidden boolean default false)
returns void language plpgsql as $$
declare purchase uuid:=('41000000-0000-4000-8000-'||lpad(p_order::text,12,'0'))::uuid;
begin
 insert into public.orders(id,user_id,status,total,address,payment_method)
 values(purchase,'00000000-0000-4000-8000-000000056902','done',1000,'{}','card');
 insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select purchase,p_good,v.id,1,1000,'별점 합성 상품','문구',g.ip_id
 from public.goods_variants v join public.goods g on g.id=v.good_id where v.good_id=p_good and v.is_default;
 if p_hidden then
  insert into public.reviews(user_id,good_id,order_id,rating,body,status,hidden_reason,hidden_at)
  values('00000000-0000-4000-8000-000000056902',p_good,purchase,p_rating,'숨김 처리된 합성 리뷰','hidden','합성 검수',now());
 else
  insert into public.reviews(user_id,good_id,order_id,rating,body)
  values('00000000-0000-4000-8000-000000056902',p_good,purchase,p_rating,'목록 별점 합성 리뷰');
 end if;
end $$;

select pg_temp.l4_review(56911,'l4-sum-solo',5);
select pg_temp.l4_review(56912,'l4-sum-solo',4);
select pg_temp.l4_review(56913,'l4-sum-solo',1,true);
select pg_temp.l4_review(56914,'l4-sum-group-a',3);
select pg_temp.l4_review(56915,'l4-sum-group-b',5);
select pg_temp.l4_review(56916,'l4-sum-group-b',1,true);
select pg_temp.l4_review(56917,'l4-sum-hidden',2,true);
select pg_temp.l4_review(56918,'l4-sum-draft',5);
select pg_temp.l4_review(56919,'l4-sum-archived',5);
select pg_temp.l4_review(56920,'l4-sum-restricted',5);
select pg_temp.l4_review(56921,'l4-sum-draft-ip',5);

-- 리뷰가 달린 뒤 보관된 굿즈다. 재고가 남은 굿즈는 보관할 수 없어(guard_catalog_archive_dependencies) 품절로 만든 뒤 보관한다.
update public.goods_variants set stock_qty=0 where good_id='l4-sum-archived';
update public.goods set archived_at=now() where id='l4-sum-archived';

-- 게스트 읽기
set local role anon;
select set_config('request.jwt.claim.role','anon',true);
select set_config('request.jwt.claim.sub','',true);
select public.get_goods_review_summaries(array['l4-sum-solo','l4-sum-group-a','l4-sum-group-b','l4-sum-none','l4-sum-hidden',
 'l4-sum-draft','l4-sum-archived','l4-sum-restricted','l4-sum-draft-ip','l4-sum-missing','l4-sum-solo']) as summaries \gset

select 1/case when :'summaries'::jsonb = '[
  {"goodId":"l4-sum-group-a","reviewCount":2,"ratingAverage":4.00},
  {"goodId":"l4-sum-group-b","reviewCount":2,"ratingAverage":4.00},
  {"goodId":"l4-sum-solo","reviewCount":2,"ratingAverage":4.50}
 ]'::jsonb then 1 else 0 end as assert_visible_public_summaries_in_group_scope;

-- 상세 요약과 같은 숫자다(그룹 멤버 각각의 상세 summary).
select 1/case when (public.get_good_group_reviews_v3('l4-sum-group-a')->'summary'->>'count')::integer=2
 and (public.get_good_group_reviews_v3('l4-sum-group-a')->'summary'->>'average')::numeric=4.00
 and (public.get_good_group_reviews_v3('l4-sum-solo')->'summary'->>'average')::numeric=4.50
 then 1 else 0 end as assert_matches_detail_summary;
reset role;

-- 스태프 세션은 숨김 리뷰 행을 읽을 수 있어도 요약에 섞이지 않는다.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000056901',true);
select 1/case when public.get_goods_review_summaries(array['l4-sum-solo','l4-sum-group-a','l4-sum-group-b','l4-sum-none','l4-sum-hidden',
 'l4-sum-draft','l4-sum-archived','l4-sum-restricted','l4-sum-draft-ip','l4-sum-missing','l4-sum-solo'])=:'summaries'::jsonb
 then 1 else 0 end as assert_staff_sees_same_public_summaries;
select 1/case when public.get_goods_review_summaries(array['l4-sum-none','l4-sum-hidden'])='[]'::jsonb
 then 1 else 0 end as assert_no_rows_for_goods_without_visible_reviews;
reset role;

-- 입력 경계: null·빈 배열·501개·형식 위반·null 원소는 22023.
create function pg_temp.l4_expect_invalid(p_ids text[]) returns void language plpgsql as $$
begin
 perform public.get_goods_review_summaries(p_ids);
 raise exception 'expected invalid_parameter_value for %',p_ids;
exception when invalid_parameter_value then
 if sqlerrm<>'invalid_goods_review_summary_goods' then raise; end if;
end $$;
select pg_temp.l4_expect_invalid(null);
select pg_temp.l4_expect_invalid(array[]::text[]);
select pg_temp.l4_expect_invalid(array(select 'l4-sum-pad-'||n from generate_series(1,501) n));
select pg_temp.l4_expect_invalid(array['l4-sum-solo','bad id']);
select pg_temp.l4_expect_invalid(array['l4-sum-solo',null]);
-- 경계 패딩 ID 는 fixture 접두사를 쓴다 — 'g'||n 은 migration 이 심은 기준 카탈로그 굿즈(g1~g15)와 겹쳐
-- 리뷰가 있는 DB(QA 시드·운영 복제)에서 0행 단언이 깨진다.
select 1/case when jsonb_array_length(public.get_goods_review_summaries(array(select 'l4-sum-pad-'||n from generate_series(1,500) n)))=0
 then 1 else 0 end as assert_accepts_five_hundred_ids;

-- 봉인: PUBLIC·service_role 실행 없음, 공개 브라우징 롤만 실행, 읽기 전용 definer.
select 1/case when has_function_privilege('anon','public.get_goods_review_summaries(text[])','execute')
 and has_function_privilege('authenticated','public.get_goods_review_summaries(text[])','execute')
 and not has_function_privilege('service_role','public.get_goods_review_summaries(text[])','execute')
 and not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) acl
   where p.oid='public.get_goods_review_summaries(text[])'::regprocedure and acl.grantee=0)
 then 1 else 0 end as assert_execute_sealed_to_public_browsing_roles;
select 1/case when p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""']
 then 1 else 0 end as assert_stable_definer_with_empty_search_path
from pg_proc p where p.oid='public.get_goods_review_summaries(text[])'::regprocedure;

rollback;
