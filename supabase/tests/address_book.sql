\set ON_ERROR_STOP on
-- 주소록(LFS 패리티 2차 L7 · MY-11) — 봉인·RLS 격리·온보딩/정지 게이트·입력 검증·기본 배송지 단일성·승계 순서·
-- 개수 상한·탈퇴 삭제 범위(탈퇴 신청 봉인과 문의 탈퇴의 운영자 삭제).
-- 동시 요청의 기본 배송지 단일성과 탈퇴 경합은 address_book_concurrency.sh 가 실제 두 연결로 확인한다.
-- 데이터는 끝에서 rollback 한다. pg_cron 전역 sweep 과 겹치는 집계는 이 파일의 회원으로만 센다.
begin;

-- ── 봉인(선언) ─────────────────────────────────────────────────────────
-- CI Postgres 버전 차이로 권한 거절은 런타임 호출 대신 선언으로 단언한다.
select 1/case when bool_and(
    has_function_privilege('authenticated', signature, 'execute')
    and not has_function_privilege('anon', signature, 'execute')
    and not has_function_privilege('service_role', signature, 'execute')
    and not has_function_privilege('public', signature, 'execute'))
  then 1 else 0 end as rpcs_sealed_to_members
from unnest(array[
  'public.save_my_address_book_entry(uuid,text,jsonb,boolean)',
  'public.set_my_default_address_book_entry(uuid)',
  'public.delete_my_address_book_entry(uuid)'
]) as signature;

select 1/case when bool_and(
    not has_function_privilege('authenticated', signature, 'execute')
    and not has_function_privilege('anon', signature, 'execute')
    and not has_function_privilege('service_role', signature, 'execute')
    and not has_function_privilege('public', signature, 'execute'))
  then 1 else 0 end as private_helpers_sealed
from unnest(array['private.address_book_actor(boolean)', 'private.erase_fenced_address_book()', 'private.erase_member_address_book(uuid)']) as signature;

select 1/case when bool_and(p.prosecdef and p.proconfig @> array['search_path=""'] and p.provolatile = 'v')
  then 1 else 0 end as definers_with_empty_search_path
from pg_proc p
where p.oid in (
  'public.save_my_address_book_entry(uuid,text,jsonb,boolean)'::regprocedure,
  'public.set_my_default_address_book_entry(uuid)'::regprocedure,
  'public.delete_my_address_book_entry(uuid)'::regprocedure,
  'private.address_book_actor(boolean)'::regprocedure,
  'private.erase_fenced_address_book()'::regprocedure,
  'private.erase_member_address_book(uuid)'::regprocedure
);

-- 표: RLS 켜짐, 로그인 회원은 읽기만, 익명·service_role 은 아무것도 못 한다. 쓰기는 RPC 뿐이다.
select 1/case when (select relrowsecurity from pg_class where oid = 'public.address_book_entries'::regclass)
  and has_table_privilege('authenticated', 'public.address_book_entries', 'select')
  and not has_table_privilege('authenticated', 'public.address_book_entries', 'insert,update,delete,truncate')
  and not has_table_privilege('anon', 'public.address_book_entries', 'select,insert,update,delete,truncate')
  and not has_table_privilege('service_role', 'public.address_book_entries', 'select,insert,update,delete,truncate')
  then 1 else 0 end as table_read_only_for_members;

select 1/case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'address_book_entries') = 1
  and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'address_book_entries'
    and policyname = 'address_book_entries_select_own' and cmd = 'SELECT' and roles = '{authenticated}'
    and qual like '%auth.uid()%')
  then 1 else 0 end as single_own_select_policy;

-- 기본 배송지 부분 유니크 인덱스 + 탈퇴 봉인 삭제 트리거 + 표 수준 봉인 가드.
select 1/case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'address_book_entries_one_default'
    and indexdef like '%UNIQUE%(user_id)%WHERE is_default%')
  and exists (select 1 from pg_trigger where tgrelid = 'private.account_action_fences'::regclass and tgname = 'erase_fenced_address_book' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgrelid = 'public.address_book_entries'::regclass and tgname = 'trg_account_fence_address_book_entries' and not tgisinternal)
  then 1 else 0 end as default_index_and_fence_triggers;

-- ── 픽스처 ─────────────────────────────────────────────────────────────
insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
 ('a7572000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'l7-book-a@example.test', '{}', '{}'),
 ('a7572000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'l7-book-b@example.test', '{}', '{}'),
 ('a7572000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'l7-book-c@example.test', '{}', '{}'),
 ('a7572000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'l7-book-d@example.test', '{}', '{}'),
 ('a7572000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'l7-book-e@example.test', '{}', '{}'),
 ('a7572000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'l7-book-f@example.test', '{}', '{}');

-- 5번(미온보딩)을 뺀 회원은 온보딩을 마친 상태(처리방침 동의)다.
update public.profiles
set nickname = 'L7 주소록 ' || right(id::text, 1), birth_date = '1990-01-01', onboarded_at = now(),
    consents = '{"terms":true,"privacy":true}'::jsonb
where id in ('a7572000-0000-4000-8000-000000000001', 'a7572000-0000-4000-8000-000000000002',
             'a7572000-0000-4000-8000-000000000003', 'a7572000-0000-4000-8000-000000000004',
             'a7572000-0000-4000-8000-000000000006');

create function pg_temp.l7_expect_error(q text, expected text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm = expected then return; end if;
    raise;
  end;
  raise exception 'expected error: %', expected;
end $$;

create function pg_temp.l7_as(actor text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', actor, true);
$$;

create function pg_temp.l7_address(name text, phone text, postal text, line1 text, line2 text) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('recipientName', name, 'phone', phone, 'postalCode', postal, 'address1', line1, 'address2', line2));
$$;

-- ── 인증 없음 ───────────────────────────────────────────────────────────
select pg_temp.l7_as('');
set local role authenticated;
select pg_temp.l7_expect_error($q$select public.save_my_address_book_entry(null, '집', pg_temp.l7_address('홍길동','01012345678','04524','서울 중구 세종대로 110',null), false)$q$, 'auth_required');
select pg_temp.l7_expect_error($q$select public.set_my_default_address_book_entry('a7572000-0000-4000-8000-0000000000ff')$q$, 'auth_required');
select pg_temp.l7_expect_error($q$select public.delete_my_address_book_entry('a7572000-0000-4000-8000-0000000000ff')$q$, 'auth_required');
reset role;

-- ── 온보딩 게이트: 처리방침에 동의하지 않은 회원의 연락처·주소는 받지 않는다 ──
select pg_temp.l7_as('a7572000-0000-4000-8000-000000000005');
set local role authenticated;
select pg_temp.l7_expect_error($q$select public.save_my_address_book_entry(null, '집', pg_temp.l7_address('미가입','01012345678','04524','서울 중구 세종대로 110',null), false)$q$, 'onboarding_required');
select pg_temp.l7_expect_error($q$select public.set_my_default_address_book_entry('a7572000-0000-4000-8000-0000000000ff')$q$, 'onboarding_required');
reset role;
-- 온보딩 시각만 있고 처리방침 동의가 없어도 거절한다.
update public.profiles set nickname = 'L7 미동의', birth_date = '1990-01-01', onboarded_at = now(), consents = '{"terms":true}'::jsonb
where id = 'a7572000-0000-4000-8000-000000000005';
select pg_temp.l7_as('a7572000-0000-4000-8000-000000000005');
set local role authenticated;
select pg_temp.l7_expect_error($q$select public.save_my_address_book_entry(null, '집', pg_temp.l7_address('미가입','01012345678','04524','서울 중구 세종대로 110',null), false)$q$, 'onboarding_required');
reset role;
select 1/case when not exists (select 1 from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000005')
  then 1 else 0 end as unconsented_member_saves_nothing;

-- ── 추가: 첫 주소는 기본, 다음은 지정할 때만 기본 ───────────────────────
select pg_temp.l7_as('a7572000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_my_address_book_entry(null, '  집  ', pg_temp.l7_address(' 홍길동 ','01012345678','04524',' 서울 중구 세종대로 110 ','  101동 1203호 '), false) as home_id \gset
select public.save_my_address_book_entry(null, '회사', pg_temp.l7_address('홍길동','0212345678','06236','서울 강남구 테헤란로 152',''), false) as office_id \gset
reset role;

select 1/case when (select count(*) from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000001') = 2
  and (select is_default from public.address_book_entries where id = :'home_id')
  and not (select is_default from public.address_book_entries where id = :'office_id')
  then 1 else 0 end as first_entry_becomes_default;

-- 정규화: 앞뒤 공백을 걷고, 빈 상세 주소는 null 로 저장한다.
select 1/case when (select label = '집' and recipient_name = '홍길동' and address1 = '서울 중구 세종대로 110' and address2 = '101동 1203호'
    from public.address_book_entries where id = :'home_id')
  and (select address2 is null from public.address_book_entries where id = :'office_id')
  then 1 else 0 end as values_are_normalized;

select pg_temp.l7_as('a7572000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_my_address_book_entry(null, '부모님 댁', pg_temp.l7_address('홍부모','01098765432','48058','부산 해운대구 센텀중앙로 79',null), true) as parents_id \gset
-- 본인 읽기(RLS): 내 주소 세 개, 기본은 방금 지정한 주소 하나.
select 1/case when (select count(*) from public.address_book_entries) = 3
  and (select count(*) from public.address_book_entries where is_default) = 1
  and (select id from public.address_book_entries where is_default) = :'parents_id'
  then 1 else 0 end as make_default_moves_the_single_default;
reset role;

-- ── 입력 검증 ───────────────────────────────────────────────────────────
select pg_temp.l7_as('a7572000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.l7_expect_error($q$select public.save_my_address_book_entry(null, '   ', pg_temp.l7_address('홍길동','01012345678','04524','서울',null), false)$q$, 'address_book_invalid');
select pg_temp.l7_expect_error($q$select public.save_my_address_book_entry(null, repeat('가', 21), pg_temp.l7_address('홍길동','01012345678','04524','서울',null), false)$q$, 'address_book_invalid');
select pg_temp.l7_expect_error($q$select public.save_my_address_book_entry(null, E'집\n', pg_temp.l7_address('홍길동','01012345678','04524','서울',null), false)$q$, 'address_book_invalid');
select pg_temp.l7_expect_error($q$select public.save_my_address_book_entry(null, '집', pg_temp.l7_address('홍길동','010-1234-5678','04524','서울',null), false)$q$, 'address_book_invalid');
select pg_temp.l7_expect_error($q$select public.save_my_address_book_entry(null, '집', pg_temp.l7_address('홍길동','01012345678','4524','서울',null), false)$q$, 'address_book_invalid');
select pg_temp.l7_expect_error($q$select public.save_my_address_book_entry(null, '집', pg_temp.l7_address('','01012345678','04524','서울',null), false)$q$, 'address_book_invalid');
select pg_temp.l7_expect_error($q$select public.save_my_address_book_entry(null, '집', pg_temp.l7_address('홍길동','01012345678','04524',repeat('가', 201),null), false)$q$, 'address_book_invalid');
select pg_temp.l7_expect_error($q$select public.save_my_address_book_entry(null, '집', pg_temp.l7_address('홍길동','01012345678','04524','서울',null) || '{"deliveryNote":"문 앞"}', false)$q$, 'address_book_invalid');
select pg_temp.l7_expect_error($q$select public.save_my_address_book_entry(null, '집', pg_temp.l7_address('홍길동','01012345678','04524','서울',null) || '{"giftId":"x"}', false)$q$, 'address_book_invalid');
select pg_temp.l7_expect_error($q$select public.save_my_address_book_entry(null, '집', '[]'::jsonb, false)$q$, 'address_book_invalid');
reset role;
select 1/case when (select count(*) from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000001') = 3
  then 1 else 0 end as invalid_input_writes_nothing;

-- ── RLS 격리: 다른 회원은 보지도, 고치지도, 지우지도, 기본으로 지정하지도 못한다 ──
select pg_temp.l7_as('a7572000-0000-4000-8000-000000000002');
set local role authenticated;
select 1/case when (select count(*) from public.address_book_entries) = 0 then 1 else 0 end as other_member_sees_nothing;
select pg_temp.l7_expect_error(format($q$select public.save_my_address_book_entry(%L, '탈취', pg_temp.l7_address('누군가','01000000000','04524','서울',null), true)$q$, :'home_id'), 'address_book_entry_missing');
select pg_temp.l7_expect_error(format($q$select public.set_my_default_address_book_entry(%L)$q$, :'office_id'), 'address_book_entry_missing');
select pg_temp.l7_expect_error(format($q$select public.delete_my_address_book_entry(%L)$q$, :'office_id'), 'address_book_entry_missing');
reset role;
select 1/case when (select count(*) from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000001') = 3
  and (select label from public.address_book_entries where id = :'home_id') = '집'
  and (select id from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000001' and is_default) = :'parents_id'
  then 1 else 0 end as other_member_changed_nothing;

-- ── 수정: 필드를 바꿔도 기본 여부는 지정할 때만 바뀐다 ──────────────────
select pg_temp.l7_as('a7572000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_my_address_book_entry(:'office_id', '새 회사', pg_temp.l7_address('홍길동','01011112222','06164','서울 강남구 영동대로 513','5층'), false) as edited_id \gset
-- 기본 배송지를 수정하면서 기본을 끄려 해도 기본은 남는다(주소가 있으면 기본은 늘 1개).
select public.save_my_address_book_entry(:'parents_id', '부모님 댁', pg_temp.l7_address('홍부모','01098765432','48058','부산 해운대구 센텀중앙로 79','A동'), false) as kept_id \gset
reset role;
select 1/case when :'edited_id' = :'office_id'
  and (select label = '새 회사' and phone = '01011112222' and postal_code = '06164' and address2 = '5층' and not is_default
    from public.address_book_entries where id = :'office_id')
  and (select is_default and address2 = 'A동' from public.address_book_entries where id = :'parents_id')
  and (select count(*) from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000001' and is_default) = 1
  then 1 else 0 end as edit_keeps_single_default;

-- ── 기본 지정 ───────────────────────────────────────────────────────────
select pg_temp.l7_as('a7572000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_my_default_address_book_entry(:'home_id');
-- 이미 기본인 주소를 다시 지정해도 그대로다.
select public.set_my_default_address_book_entry(:'home_id');
reset role;
select 1/case when (select array_agg(id) from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000001' and is_default)
  = array[:'home_id'::uuid]
  then 1 else 0 end as set_default_switches_atomically;

-- ── 삭제: 기본을 지우면 회원이 가장 최근에 저장(추가·수정)한 주소가 기본이 된다 ──
select pg_temp.l7_as('a7572000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_sleep(0.01);
select public.save_my_address_book_entry(:'parents_id', '부모님 댁', pg_temp.l7_address('홍부모','01098765432','48058','부산 해운대구 센텀중앙로 79','B동'), false);
select public.delete_my_address_book_entry(:'home_id');
reset role;
select 1/case when not exists (select 1 from public.address_book_entries where id = :'home_id')
  and (select array_agg(id) from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000001' and is_default)
    = array[:'parents_id'::uuid]
  then 1 else 0 end as deleting_default_promotes_latest_edit;

-- 기본 지정·해제는 '고친 시각'이 아니다: 집(기본)·회사·본가를 차례로 추가하고 본가를 고친 뒤 회사를 기본으로
-- 지정하면(집이 기본에서 내려간다) 회사를 지웠을 때 기본은 회원이 마지막으로 고친 본가다 — 내려간 집이 아니다.
select pg_temp.l7_as('a7572000-0000-4000-8000-000000000004');
set local role authenticated;
select public.save_my_address_book_entry(null, '집', pg_temp.l7_address('최승계','01012345678','04524','서울 중구 세종대로 110',null), false) as d_home \gset
select pg_sleep(0.01);
select public.save_my_address_book_entry(null, '회사', pg_temp.l7_address('최승계','01012345678','06236','서울 강남구 테헤란로 152',null), false) as d_office \gset
select pg_sleep(0.01);
select public.save_my_address_book_entry(null, '본가', pg_temp.l7_address('최승계','01012345678','48058','부산 해운대구 센텀중앙로 79',null), false) as d_parents \gset
select pg_sleep(0.01);
select public.save_my_address_book_entry(:'d_parents', '본가', pg_temp.l7_address('최승계','01012345678','48058','부산 해운대구 센텀중앙로 79','3층'), false);
reset role;
select updated_at as d_home_edited, (select updated_at from public.address_book_entries where id = :'d_office') as d_office_edited
from public.address_book_entries where id = :'d_home' \gset
select pg_temp.l7_as('a7572000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_sleep(0.01);
select public.set_my_default_address_book_entry(:'d_office');
reset role;
-- 지정·해제는 updated_at 을 바꾸지 않는다.
select 1/case when (select updated_at = :'d_home_edited'::timestamptz and not is_default from public.address_book_entries where id = :'d_home')
  and (select updated_at = :'d_office_edited'::timestamptz and is_default from public.address_book_entries where id = :'d_office')
  then 1 else 0 end as default_switch_keeps_edit_time;
select pg_temp.l7_as('a7572000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_sleep(0.01);
select public.delete_my_address_book_entry(:'d_office');
reset role;
select 1/case when (select array_agg(id) from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000004' and is_default)
    = array[:'d_parents'::uuid]
  and (select updated_at = :'d_home_edited'::timestamptz from public.address_book_entries where id = :'d_home')
  then 1 else 0 end as promotion_follows_member_edits_not_default_switches;

select pg_temp.l7_as('a7572000-0000-4000-8000-000000000001');
set local role authenticated;
select public.delete_my_address_book_entry(:'office_id');
select pg_temp.l7_expect_error(format($q$select public.delete_my_address_book_entry(%L)$q$, :'office_id'), 'address_book_entry_missing');
select public.delete_my_address_book_entry(:'parents_id');
reset role;
select 1/case when not exists (select 1 from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000001')
  then 1 else 0 end as deleting_last_entry_leaves_empty_book;

-- ── 개수 상한 10 ────────────────────────────────────────────────────────
select pg_temp.l7_as('a7572000-0000-4000-8000-000000000002');
set local role authenticated;
select public.save_my_address_book_entry(null, '주소 ' || n, pg_temp.l7_address('김회원','0101234' || lpad(n::text, 4, '0'),'04524','서울 중구 세종대로 ' || n, null), false)
from generate_series(1, 10) as n;
select pg_temp.l7_expect_error($q$select public.save_my_address_book_entry(null, '열한 번째', pg_temp.l7_address('김회원','01099990000','04524','서울',null), true)$q$, 'address_book_full');
reset role;
select 1/case when (select count(*) from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000002') = 10
  and (select count(*) from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000002' and is_default) = 1
  and (select label from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000002' and is_default) = '주소 1'
  then 1 else 0 end as limit_of_ten_is_enforced;

-- 상한에 닿아도 수정은 된다.
select pg_temp.l7_as('a7572000-0000-4000-8000-000000000002');
set local role authenticated;
select public.save_my_address_book_entry(
  (select id from public.address_book_entries where label = '주소 10'), '주소 열', pg_temp.l7_address('김회원','01012340010','04524','서울 중구 세종대로 10',null), true);
reset role;
select 1/case when (select is_default from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000002' and label = '주소 열')
  and (select count(*) from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000002' and is_default) = 1
  then 1 else 0 end as edit_allowed_at_limit;

-- ── 문의로 받은 탈퇴(탈퇴 신청 기능 OFF): 운영자가 정지 → 삭제 ──────────────
-- 주문이 있는 회원은 Auth 사용자 삭제가 orders.user_id(on delete restrict)로 막혀 FK cascade 로 지워지지 않는다.
select pg_temp.l7_as('a7572000-0000-4000-8000-000000000006');
set local role authenticated;
select public.save_my_address_book_entry(null, '집', pg_temp.l7_address('정문의','01077778888','04524','서울 중구 세종대로 110',null), false) as f_home \gset
select public.save_my_address_book_entry(null, '회사', pg_temp.l7_address('정문의','01077778888','06236','서울 강남구 테헤란로 152',null), false);
reset role;
set local session_replication_role = replica;
insert into public.orders(user_id, total, order_number, status)
values ('a7572000-0000-4000-8000-000000000006', 10000, '2026102719990601', 'delivered');
set local session_replication_role = origin;
select 1/case when (select confdeltype from pg_constraint where conname = 'orders_user_id_fkey') = 'r'
  and not exists (select 1 from private.account_action_fences where subject_user_id = 'a7572000-0000-4000-8000-000000000006')
  then 1 else 0 end as manual_withdrawal_has_no_fence_or_cascade;

-- 정지된 계정은 새로 저장하거나 기본을 바꾸지 못한다. 자기 배송지 삭제는 막지 않는다.
update public.profiles set suspended_at = now(), suspension_reason = 'L7 문의 탈퇴 처리'
where id = 'a7572000-0000-4000-8000-000000000006';
select pg_temp.l7_as('a7572000-0000-4000-8000-000000000006');
set local role authenticated;
select pg_temp.l7_expect_error($q$select public.save_my_address_book_entry(null, '본가', pg_temp.l7_address('정문의','01077778888','48058','부산',null), false)$q$, 'account_suspended');
select pg_temp.l7_expect_error(format($q$select public.set_my_default_address_book_entry(%L)$q$, :'f_home'), 'account_suspended');
select public.delete_my_address_book_entry(:'f_home');
reset role;
select 1/case when (select count(*) from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000006' and is_default) = 1
  and not exists (select 1 from public.address_book_entries where id = :'f_home')
  then 1 else 0 end as suspended_member_can_still_delete;

select private.erase_member_address_book('a7572000-0000-4000-8000-000000000006') as manual_erased \gset
select 1/case when :manual_erased = 1
  and not exists (select 1 from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000006')
  and (select count(*) from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000002') = 10
  and exists (select 1 from public.orders where user_id = 'a7572000-0000-4000-8000-000000000006')
  then 1 else 0 end as operator_erase_removes_only_that_book;
select 1/case when private.erase_member_address_book('a7572000-0000-4000-8000-000000000006') = 0
  then 1 else 0 end as operator_erase_is_idempotent;
select pg_temp.l7_expect_error($q$select private.erase_member_address_book(null)$q$, 'address_book_member_required');

-- ── 탈퇴 신청 경로: 봉인이 생기는 그 트랜잭션에서 주소록이 지워지고, 이후 쓰기는 거절된다 ──
select pg_temp.l7_as('a7572000-0000-4000-8000-000000000003');
set local role authenticated;
select public.save_my_address_book_entry(null, '집', pg_temp.l7_address('박탈퇴','01055556666','04524','서울 중구 세종대로 110',null), false) as fenced_home_id \gset
select public.save_my_address_book_entry(null, '회사', pg_temp.l7_address('박탈퇴','01055556666','06236','서울 강남구 테헤란로 152',null), false);
reset role;

update private.account_deletion_control
set transaction_lookup_hmac_ready = true, legacy_transaction_evidence_ready = true,
    immutable_ticket_contract_ready = true, community_legal_records_ready = true, phase_one_enabled = true;
insert into auth.sessions(id, user_id, created_at, updated_at)
values ('a7572000-0000-4000-8000-000000000090', 'a7572000-0000-4000-8000-000000000003', clock_timestamp(), clock_timestamp());
select set_config('request.jwt.claims',
  '{"sub":"a7572000-0000-4000-8000-000000000003","role":"authenticated","session_id":"a7572000-0000-4000-8000-000000000090"}', true);
select pg_temp.l7_as('a7572000-0000-4000-8000-000000000003');
set local role authenticated;
select public.request_my_account_deletion('회원 탈퇴를 신청합니다', 'a7572000-0000-4000-8000-000000000091') as deletion_status \gset
reset role;

-- 삭제 범위: 탈퇴를 신청한 회원의 주소록 전부. 다른 회원의 주소록은 그대로다.
select 1/case when exists (select 1 from private.account_action_fences where subject_user_id = 'a7572000-0000-4000-8000-000000000003')
  and not exists (select 1 from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000003')
  and (select count(*) from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000002') = 10
  then 1 else 0 end as withdrawal_request_erases_only_own_book;

select pg_temp.l7_as('a7572000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.l7_expect_error($q$select public.save_my_address_book_entry(null, '집', pg_temp.l7_address('박탈퇴','01055556666','04524','서울',null), false)$q$, 'account_deletion_write_fenced');
select pg_temp.l7_expect_error(format($q$select public.set_my_default_address_book_entry(%L)$q$, :'fenced_home_id'), 'account_deletion_write_fenced');
select pg_temp.l7_expect_error(format($q$select public.delete_my_address_book_entry(%L)$q$, :'fenced_home_id'), 'account_deletion_write_fenced');
reset role;

-- 봉인을 다른 경로로 넣어도(서비스 직접 기록) 같은 트리거가 지운다 — 표 수준 가드는 봉인 뒤 직접 쓰기도 막는다.
insert into private.account_deletion_requests(deletion_event_id, subject_user_id, idempotency_key, status)
values ('a7572000-0000-4000-8000-000000000201', 'a7572000-0000-4000-8000-000000000002', 'a7572000-0000-4000-8000-000000000202', 'awaiting_email_intent');
insert into private.account_action_fences(subject_user_id, deletion_event_id)
values ('a7572000-0000-4000-8000-000000000002', 'a7572000-0000-4000-8000-000000000201');
select 1/case when not exists (select 1 from public.address_book_entries where user_id = 'a7572000-0000-4000-8000-000000000002')
  then 1 else 0 end as direct_fence_also_erases_book;
select pg_temp.l7_expect_error($q$insert into public.address_book_entries(user_id,label,recipient_name,phone,postal_code,address1)
  values ('a7572000-0000-4000-8000-000000000002','집','김회원','01012345678','04524','서울')$q$, 'account_deletion_write_fenced');

rollback;
