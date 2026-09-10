\set ON_ERROR_STOP on

-- #465 쿠폰 관리자 검색·상태 필터·페이지·선택 상세 조회 경계.
-- 목록은 서버 RPC가 현재 페이지와 쿠폰별 사용 건수만 반환하고,
-- 비스태프·익명·service_role에는 RPC 실행 권한을 열지 않는다.

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000991',
    'authenticated', 'authenticated', 'coupon-search-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000992',
    'authenticated', 'authenticated', 'coupon-search-fan@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000991',
    'coupon-search-staff@example.test', 'coupon_search_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  ),
  (
    '00000000-0000-4000-8000-000000000992',
    'coupon-search-fan@example.test', 'coupon_search_fan', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

-- 정렬 경계를 재현할 수 있도록 생성 시각을 고정된 순서로 넣는다.
insert into public.coupons (
  code, name, discount_type, discount_value, min_subtotal,
  starts_at, status, created_at
)
select
  'PG-COUPON-' || lpad(index::text, 2, '0'),
  '페이지 쿠폰 ' || lpad(index::text, 2, '0'),
  'fixed', 3000, 20000,
  now() - interval '1 day',
  case when index > 20 then 'archived' else 'active' end,
  now() - (index * interval '1 minute')
from generate_series(1, 25) as numbers(index)
on conflict (code) do nothing;

insert into public.orders (id, user_id, status, total, address, created_at, updated_at)
values (
  '00000000-0000-4000-8000-000000000993',
  '00000000-0000-4000-8000-000000000991',
  'paid', 30000, '{}'::jsonb, now(), now()
)
on conflict (id) do nothing;

insert into public.user_coupons (
  id, coupon_code, user_id, status, issued_source, issued_at, used_at, used_order_id
)
values (
  '00000000-0000-4000-8000-000000000994',
  'PG-COUPON-25',
  '00000000-0000-4000-8000-000000000991',
  'used', 'admin_grant', now(), now(),
  '00000000-0000-4000-8000-000000000993'
)
on conflict (id) do nothing;

insert into public.coupon_redemptions (
  id, user_coupon_id, coupon_code, user_id, order_id, discount_amount, status
)
values (
  '00000000-0000-4000-8000-000000000995',
  '00000000-0000-4000-8000-000000000994',
  'PG-COUPON-25',
  '00000000-0000-4000-8000-000000000991',
  '00000000-0000-4000-8000-000000000993',
  3000, 'applied'
)
on conflict (id) do nothing;

-- 실행 권한은 인증된 운영자만 가진다. 함수 내부에서도 is_staff()를 확인한다.
select 1 / case when not has_function_privilege(
  'anon',
  'public.admin_search_coupons(text,text,integer,integer)',
  'execute'
) and has_function_privilege(
  'authenticated',
  'public.admin_search_coupons(text,text,integer,integer)',
  'execute'
) and not has_function_privilege(
  'service_role',
  'public.admin_search_coupons(text,text,integer,integer)',
  'execute'
) then 1 else 0 end as assert_coupon_search_rpc_acl;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000991', true);

-- 최신순 20건 + 다음 5건의 경계와 상태 필터를 확인한다.
select 1 / case when
  (select count(*) from public.admin_search_coupons('PG-COUPON-', 'all', 20, 0)) = 20
  and (select count(*) from public.admin_search_coupons('PG-COUPON-', 'all', 20, 20)) = 5
  and (select min(total_count) from public.admin_search_coupons('PG-COUPON-', 'all', 20, 0)) = 25
  and (select min(total_count) from public.admin_search_coupons('PG-COUPON-', 'all', 20, 20)) = 25
  and (select count(*) from public.admin_search_coupons('PG-COUPON-', 'active', 20, 0)) = 20
  and (select count(*) from public.admin_search_coupons('PG-COUPON-', 'archived', 20, 0)) = 5
  and (select code from public.admin_search_coupons('PG-COUPON-', 'all', 20, 0)
       order by code limit 1) = 'PG-COUPON-01'
  and (select code from public.admin_search_coupons('PG-COUPON-', 'all', 20, 20)
       order by code limit 1) = 'PG-COUPON-21'
then 1 else 0 end as assert_coupon_search_pagination_and_status;

-- 검색은 이름·코드 모두에 걸리고, 선택된 페이지 밖 쿠폰도 정확히 한 건으로 찾는다.
select 1 / case when
  (select count(*) from public.admin_search_coupons('COUPON-25', 'all', 20, 0)) = 1
  and (select count(*) from public.admin_search_coupons('페이지 쿠폰 25', 'all', 20, 0)) = 1
  and (select used_count from public.admin_search_coupons('PG-COUPON-25', 'all', 20, 0)) = 1
then 1 else 0 end as assert_coupon_search_and_selected_usage;

-- 와일드카드는 검색어의 일부로 취급한다.
select 1 / case when
  (select count(*) from public.admin_search_coupons('%', 'all', 20, 0)) = 0
then 1 else 0 end as assert_coupon_search_escapes_wildcards;

do $$
begin
  begin
    perform public.admin_search_coupons(null, 'all', 101, 0);
  exception when invalid_parameter_value then
    return;
  end;
  raise exception 'invalid coupon search limit should be rejected';
end;
$$;

-- 비스태프는 ACL과 함수 내부 이중 경계에서 모두 차단된다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000992', true);
do $$
begin
  begin
    perform public.admin_search_coupons('PG-COUPON-', 'all', 20, 0);
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'non-staff coupon search should be rejected';
end;
$$;

rollback;
