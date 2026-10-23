\set ON_ERROR_STOP on
-- 회원 등급 혜택 안내(LFS 패리티 2차 L6 · MY-05) — get_loyalty_grade_benefits 의 공개 범위·봉인·읽기 전용.
-- 승급 지급(private.grant_grade_benefit_coupons)과 같은 정의만 싣는지, 쿠폰 코드·운영 값이 새지 않는지,
-- 적립률이 두 정책(기본 적립금·등급 적립)이 모두 켜졌을 때만 나오는지 확인한다. 데이터는 끝에서 rollback 한다.
-- 다른 스모크·시드가 남긴 등급 쿠폰이 있어도 흔들리지 않도록 이 파일의 정의(이름 'L6 등급 ')만 골라 단언한다.
begin;

-- 봉인: 로그인 회원만 실행한다. CI Postgres 버전 차이로 권한 거절은 런타임 호출 대신 선언으로 단언한다.
select 1/case when has_function_privilege('authenticated','public.get_loyalty_grade_benefits()','execute')
  and not has_function_privilege('anon','public.get_loyalty_grade_benefits()','execute')
  and not has_function_privilege('service_role','public.get_loyalty_grade_benefits()','execute')
  and not has_function_privilege('public','public.get_loyalty_grade_benefits()','execute')
  then 1 else 0 end as sealed_to_members;

select 1/case when (select provolatile='s' and prosecdef and proconfig @> array['search_path=""']
  from pg_proc where oid='public.get_loyalty_grade_benefits()'::regprocedure) then 1 else 0 end as stable_definer_with_empty_search_path;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
 ('00000000-0000-4000-8000-000000058901','authenticated','authenticated','l6-grade-benefit-member@example.test','{}','{}');

insert into public.coupons(code,name,discount_type,discount_value,max_discount_amount,min_subtotal,starts_at,ends_at,
  issue_starts_at,issue_ends_at,valid_days,issue_limit,issued_count,status,grade_benefit,recipient_segment,benefit_kind) values
 -- 실린다: 기존 사용 기간형(발급 기간 없음), 지급일 기준 일수형, 배송비 쿠폰, 첫 구매 조건
 ('L6GB-SILVER-A','L6 등급 실버 3천원','fixed',3000,null,30000,now()-interval '5 days',null,null,null,null,null,0,'active','silver','all','goods'),
 ('L6GB-GOLD-DAYS','L6 등급 골드 10%','percent',10,5000,50000,now()-interval '5 days',null,now()-interval '5 days',now()+interval '30 days',30,100,3,'active','gold','all','goods'),
 ('L6GB-GOLD-SHIP','L6 등급 골드 배송비','fixed',3000,null,0,now()-interval '5 days',null,null,null,null,null,0,'active','gold','all','shipping'),
 ('L6GB-PLAT-OK','L6 등급 플래티넘 첫 구매','fixed',10000,null,70000,now()-interval '5 days',now()+interval '60 days',null,null,null,null,0,'active','platinum','first_purchase','goods'),
 -- 빠진다: 보관, 사용 기간 종료, 발급 시작 전, 발급 기간 종료, 발급 한도 소진, WELCOME(승급 지급 없음), 등급 없음
 ('L6GB-PLAT-ARCH','L6 등급 보관','fixed',1000,null,0,now()-interval '5 days',null,null,null,null,null,0,'archived','platinum','all','goods'),
 ('L6GB-PLAT-ENDED','L6 등급 사용 종료','fixed',1000,null,0,now()-interval '10 days',now()-interval '1 day',null,null,null,null,0,'active','platinum','all','goods'),
 ('L6GB-PLAT-LATER','L6 등급 발급 전','fixed',1000,null,0,now()-interval '5 days',null,now()+interval '2 days',null,7,null,0,'active','platinum','all','goods'),
 ('L6GB-PLAT-CLOSED','L6 등급 발급 종료','fixed',1000,null,0,now()-interval '9 days',null,now()-interval '8 days',now()-interval '1 day',7,null,0,'active','platinum','all','goods'),
 ('L6GB-PLAT-FULL','L6 등급 한도 소진','fixed',1000,null,0,now()-interval '5 days',null,null,null,null,1,1,'active','platinum','all','goods'),
 ('L6GB-WELCOME','L6 등급 웰컴','fixed',1000,null,0,now()-interval '5 days',null,null,null,null,null,0,'active','welcome','all','goods'),
 ('L6GB-PLAIN','L6 등급 일반 쿠폰','fixed',1000,null,0,now()-interval '5 days',null,null,null,null,null,0,'active',null,'all','goods');

create function pg_temp.l6_expect_error(q text, expected text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm = expected then return; end if;
    raise;
  end;
  raise exception 'expected error: %', expected;
end $$;

create function pg_temp.l6_coupons(doc jsonb, target text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(coupon order by position), '[]'::jsonb)
  from jsonb_array_elements(doc->'grades') as grade(value)
  cross join lateral jsonb_array_elements(grade.value->'coupons') with ordinality as entry(coupon, position)
  where grade.value->>'grade' = target and entry.coupon->>'name' like 'L6 등급 %';
$$;

-- 비로그인 세션(sub 없음)은 실행 권한이 있어도 auth_required 로 거절한다.
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.l6_expect_error('select public.get_loyalty_grade_benefits()','auth_required');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000058901',true);
set local role authenticated;
select public.get_loyalty_grade_benefits() as doc \gset
reset role;

select 1/case when (select array_agg(value->>'grade' order by position) from jsonb_array_elements(:'doc'::jsonb->'grades') with ordinality as g(value,position))
  = array['welcome','silver','gold','platinum'] then 1 else 0 end as four_grades_in_ladder_order;

select 1/case when jsonb_array_length(pg_temp.l6_coupons(:'doc','welcome'))=0
  and (select array_agg(value->>'name' order by position) from jsonb_array_elements(pg_temp.l6_coupons(:'doc','silver')) with ordinality as c(value,position)) = array['L6 등급 실버 3천원']
  and (select array_agg(value->>'name' order by position) from jsonb_array_elements(pg_temp.l6_coupons(:'doc','gold')) with ordinality as c(value,position)) = array['L6 등급 골드 배송비','L6 등급 골드 10%']
  and (select array_agg(value->>'name' order by position) from jsonb_array_elements(pg_temp.l6_coupons(:'doc','platinum')) with ordinality as c(value,position)) = array['L6 등급 플래티넘 첫 구매']
  then 1 else 0 end as only_grantable_definitions_by_grade;

select 1/case when (select value from jsonb_array_elements(pg_temp.l6_coupons(:'doc','gold')) where value->>'name'='L6 등급 골드 10%')
  - 'startsAt' = jsonb_build_object('name','L6 등급 골드 10%','benefitKind','goods','discountType','percent','discountValue',10,
    'maxDiscountAmount',5000,'minSubtotal',50000,'goodsScope','all','recipientSegment','all','endsAt',null,'validDays',30)
  and (select value->>'benefitKind'='shipping' and value->'maxDiscountAmount'='null'::jsonb from jsonb_array_elements(pg_temp.l6_coupons(:'doc','gold')) where value->>'name'='L6 등급 골드 배송비')
  and (select value->>'recipientSegment'='first_purchase' and value->>'endsAt' is not null and value->'validDays'='null'::jsonb
    from jsonb_array_elements(pg_temp.l6_coupons(:'doc','platinum')))
  then 1 else 0 end as coupon_fields_are_benefit_terms_only;

-- 코드·발급 수량·대상 ID 같은 운영 값은 어디에도 없다.
select 1/case when position('L6GB-' in :'doc') = 0
  and not exists (
    select 1 from jsonb_array_elements(:'doc'::jsonb->'grades') as grade(value)
    cross join lateral jsonb_array_elements(grade.value->'coupons') as coupon(value)
    where coupon.value ?| array['code','issueLimit','issuedCount','targetGoodIds','targetCategoryIds','issuanceMode']
  ) then 1 else 0 end as no_codes_or_operator_values;

-- 기본: 등급 적립이 꺼져 있으면 적립률을 말하지 않는다.
select 1/case when :'doc'::jsonb->'creditRatesEnabled'='false'::jsonb
  and not exists (select 1 from jsonb_array_elements(:'doc'::jsonb->'grades') as grade(value) where grade.value->'creditRateBps'<>'null'::jsonb)
  then 1 else 0 end as rates_hidden_while_policy_off;

-- 등급 적립만 켜고 기본 적립금 정책이 꺼져 있으면 주문 스냅샷도 기본 정책을 따른다 — 여전히 숨긴다.
update private.customer_reward_policy set grade_enabled=true,grade_rates='{"welcome":100,"silver":150,"gold":300,"platinum":500}' where singleton;
update private.store_credit_policy set enabled=false where singleton;
set local role authenticated;
select 1/case when public.get_loyalty_grade_benefits()->'creditRatesEnabled'='false'::jsonb then 1 else 0 end as rates_require_base_credit_policy;
reset role;

update private.store_credit_policy set enabled=true,earn_kind='fixed',earn_value=0,earn_max_per_order=0,max_balance=100000,validity_days=30,
  min_use=1,max_use=100000,restore_grace_days=3,refund_earned_credit_mode='offset_future_credits',evidence='L6 등급 혜택 합성 정책' where singleton;
set local role authenticated;
select public.get_loyalty_grade_benefits() as rated \gset
reset role;
select 1/case when :'rated'::jsonb->'creditRatesEnabled'='true'::jsonb
  and (select jsonb_object_agg(value->>'grade', value->'creditRateBps') from jsonb_array_elements(:'rated'::jsonb->'grades') as grade(value))
    = '{"welcome":100,"silver":150,"gold":300,"platinum":500}'::jsonb
  then 1 else 0 end as grade_rates_in_bps_when_both_policies_on;

-- 읽기 전용: 발급 원장·발급 수량을 건드리지 않는다.
select 1/case when not exists (select 1 from public.user_coupons where coupon_code like 'L6GB-%')
  and (select sum(issued_count) from public.coupons where code like 'L6GB-%') = 4
  then 1 else 0 end as read_does_not_issue;

rollback;
