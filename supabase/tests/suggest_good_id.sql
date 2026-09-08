\set ON_ERROR_STOP on

-- 현업 요청 슬라이스 5 — 굿즈 id 다음 순번 제안

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000009f1', 'authenticated', 'authenticated', 'sgid-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000009f2', 'authenticated', 'authenticated', 'sgid-user@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-0000000009f1', 'sgid-staff@example.test', 'sgid_staff', '1990-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'),
  ('00000000-0000-4000-8000-0000000009f2', 'sgid-user@example.test', 'sgid_user', '1990-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user')
on conflict (id) do update set role = excluded.role;

-- 이 테스트는 카탈로그 전체를 보므로 판을 깨끗이 만든다.
delete from public.goods;
insert into public.verticals (key, label, color) values ('sgid', '순번 테스트', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('sgid-ip', '순번 테스트 IP', 'sgid') on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009f1', true);

-- 숫자로 끝나는 id 가 없으면 제안하지 않는다 — 없는 규칙을 지어내지 않는다.
select 1 / case when public.admin_suggest_good_id() is null then 1 else 0 end
  as assert_no_suggestion_without_numbered_ids;

reset role;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('g1', 'sgid-ip', '하나', '문구', 1000, 'ok', 1),
  ('g9', 'sgid-ip', '아홉', '문구', 1000, 'ok', 1)
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009f1', true);
select 1 / case when public.admin_suggest_good_id() = 'g10' then 1 else 0 end
  as assert_next_number_after_the_largest;

-- 자리수를 지킨다. g0001 을 쓰는 곳에 g2 를 제안하면 정렬이 깨진 채로 쌓인다.
reset role;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('g0025', 'sgid-ip', '스물다섯', '문구', 1000, 'ok', 1) on conflict (id) do nothing;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009f1', true);
select 1 / case when public.admin_suggest_good_id() = 'g0026' then 1 else 0 end
  as assert_zero_padding_is_kept;

-- 접두어는 **가장 많이 쓰는 것**을 고른다. 이관 데이터가 섞여도 실제로 쓰는 모양을 따라간다.
reset role;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('ERP-100', 'sgid-ip', '이관1', '문구', 1000, 'ok', 1),
  ('ERP-101', 'sgid-ip', '이관2', '문구', 1000, 'ok', 1),
  ('ERP-102', 'sgid-ip', '이관3', '문구', 1000, 'ok', 1),
  ('ERP-103', 'sgid-ip', '이관4', '문구', 1000, 'ok', 1)
on conflict (id) do nothing;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009f1', true);
select 1 / case when public.admin_suggest_good_id() = 'ERP-104' then 1 else 0 end
  as assert_most_used_prefix_wins;
reset role;

-- 권한 — 스태프만
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009f2', true);
do $$
begin
  perform public.admin_suggest_good_id();
  raise exception 'expected a non-staff caller to be blocked';
exception when insufficient_privilege then null;
end;
$$;
reset role;

select 1 / case when (
  has_function_privilege('authenticated', 'public.admin_suggest_good_id()', 'execute')
  and not has_function_privilege('anon', 'public.admin_suggest_good_id()', 'execute')
  and not has_function_privilege('service_role', 'public.admin_suggest_good_id()', 'execute')
) then 1 else 0 end as assert_suggest_good_id_acl;

rollback;
