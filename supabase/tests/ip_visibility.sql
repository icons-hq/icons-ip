\set ON_ERROR_STOP on

-- 현업 요청 슬라이스 5 — IP 노출/숨김

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000009e1', 'authenticated', 'authenticated', 'ipvis-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000009e2', 'authenticated', 'authenticated', 'ipvis-user@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-0000000009e1', 'ipvis-staff@example.test', 'ipvis_staff', '1990-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'),
  ('00000000-0000-4000-8000-0000000009e2', 'ipvis-user@example.test', 'ipvis_user', '1990-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user')
on conflict (id) do update set role = excluded.role;

insert into public.verticals (key, label, color) values ('ipvis', 'IP 노출 테스트', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('ipvis-ip', '노출 테스트 IP', 'ipvis') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('ipvis-g1', 'ipvis-ip', '노출 테스트 굿즈', '문구', 10000, 'ok', 50)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- A. 숨기면 목록에서 빠진다
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009e1', true);

select 1 / case when (
  (select count(*) from public.storefront_ips_page(p_limit => 200) where id = 'ipvis-ip') = 1
) then 1 else 0 end as assert_ip_is_listed_before_hiding;

select public.admin_set_ip_visibility('ipvis-ip', false, '라이선스 확인 중') as hidden_at \gset

select 1 / case when (
  (select count(*) from public.storefront_ips_page(p_limit => 200) where id = 'ipvis-ip') = 0
  and (select hidden_at is not null from public.ips where id = 'ipvis-ip')
) then 1 else 0 end as assert_hidden_ip_leaves_the_list;

-- **직접 링크는 살린다.** 이미 공유된 링크가 죽으면 그게 더 큰 사고다.
select 1 / case when (
  (select count(*) from public.ips where id = 'ipvis-ip' and archived_at is null) = 1
  -- 하위 굿즈도 그대로다 — IP 를 내리는 것은 굿즈를 내리는 것이 아니다.
  and (select count(*) from public.storefront_goods_page(p_ip_ids => array['ipvis-ip'])) = 1
) then 1 else 0 end as assert_hidden_ip_keeps_direct_link_and_goods;

-- 두 번 숨겨도 처음 시각을 유지한다 — 「언제부터 내렸나」가 눌릴 때마다 리셋되면 안 된다.
select public.admin_set_ip_visibility('ipvis-ip', false, '라이선스 확인 중') as hidden_again \gset
select 1 / case when (
  (select hidden_at from public.ips where id = 'ipvis-ip') = :'hidden_at'::timestamptz
) then 1 else 0 end as assert_hiding_twice_keeps_the_first_time;

select public.admin_set_ip_visibility('ipvis-ip', true);
select 1 / case when (
  (select count(*) from public.storefront_ips_page(p_limit => 200) where id = 'ipvis-ip') = 1
  and (select hidden_at is null from public.ips where id = 'ipvis-ip')
) then 1 else 0 end as assert_unhiding_brings_it_back;

-- ---------------------------------------------------------------------------
-- B. 끄는 쪽에만 사유를 요구한다
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    perform public.admin_set_ip_visibility('ipvis-ip', false, '   ');
    raise exception 'expected hiding without a reason to be rejected';
  exception when check_violation then null;
  end;

  begin
    perform public.admin_set_ip_visibility('no-such-ip', true);
    raise exception 'expected a missing ip to be rejected';
  exception when no_data_found then null;
  end;
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- C. 권한 — 스태프만
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009e2', true);
do $$
begin
  perform public.admin_set_ip_visibility('ipvis-ip', false, '몰래');
  raise exception 'expected a non-staff caller to be blocked';
exception when insufficient_privilege then null;
end;
$$;
reset role;

select 1 / case when (
  has_function_privilege('authenticated', 'public.admin_set_ip_visibility(text,boolean,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_set_ip_visibility(text,boolean,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_set_ip_visibility(text,boolean,text)', 'execute')
) then 1 else 0 end as assert_ip_visibility_acl;

rollback;
