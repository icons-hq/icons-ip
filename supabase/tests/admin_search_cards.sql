\set ON_ERROR_STOP on

-- 규모 후속 — 어드민 카드 목록 페이징. 목록과 탭 집계가 같은 조건을 본다는 것이 계약이다.

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000b01', 'authenticated', 'authenticated', 'cards-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000b02', 'authenticated', 'authenticated', 'cards-user@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-000000000b01', 'cards-staff@example.test', 'cards_staff', '1990-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'),
  ('00000000-0000-4000-8000-000000000b02', 'cards-user@example.test', 'cards_user', '1990-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user')
on conflict (id) do update set role = excluded.role;

insert into public.verticals (key, label, color) values ('asc', '카드 목록', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('asc-ip-a', '카드 목록 IP 에이', 'asc'), ('asc-ip-b', '카드 목록 IP 비', 'asc') on conflict (id) do nothing;
insert into public.card_pools (id, ip_id, name, active_from) values ('00000000-0000-4000-8000-000000000b10', 'asc-ip-a', '목록 풀', now()) on conflict (id) do nothing;
insert into public.cards (id, ip_id, pool_id, name, no, rarity)
values
  ('asc-c1', 'asc-ip-a', '00000000-0000-4000-8000-000000000b10', '풀 카드 하나', '001', 'HOLO'),
  ('asc-c2', 'asc-ip-a', null, '홀로 둘', '002', 'N'),
  ('asc-c3', 'asc-ip-b', null, '비 셋', '003', 'SSR'),
  ('asc-c4', 'asc-ip-b', null, '보관 넷', '004', 'N')
on conflict (id) do nothing;
update public.cards set archived_at = now() where id = 'asc-c4';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000b01', true);

-- 탭·검색·IP·풀·등급 필터. 목록과 탭 집계가 같은 조건을 본다.
select 1 / case when (
  (select count(*) from public.admin_search_cards(p_ip_id => 'asc-ip-b')) = 2
  and (select count(*) from public.admin_search_cards(p_ip_id => 'asc-ip-b', p_tab => 'active')) = 1
  and (select id from public.admin_search_cards(p_pool_id => '00000000-0000-4000-8000-000000000b10')) = 'asc-c1'
  and (select pool_name from public.admin_search_cards(p_pool_id => '00000000-0000-4000-8000-000000000b10')) = '목록 풀'
  and (select count(*) from public.admin_search_cards(p_query => '홀로')) = 1
  and (select count(*) from public.admin_search_cards(p_query => '003', p_ip_id => 'asc-ip-b')) = 1
  and (select count(*) from public.admin_search_cards(p_rarity => 'N', p_ip_id => 'asc-ip-b')) = 1
  and (select all_count || '/' || active_count || '/' || archived_count from public.admin_cards_tab_counts(p_ip_id => 'asc-ip-b')) = '2/1/1'
) then 1 else 0 end as assert_card_list_filters_and_counts_agree;

-- 정렬 화이트리스트 밖은 거절, 페이지 + 윈도 count.
do $$
begin
  perform public.admin_search_cards(p_sort => 'price');
  raise exception 'expected an unknown sort key to be rejected';
exception when check_violation then null;
end;
$$;
select 1 / case when (
  (select total_count from public.admin_search_cards(p_ip_id => 'asc-ip-a', p_limit => 1) limit 1) = 2
  and (select id from public.admin_search_cards(p_ip_id => 'asc-ip-a', p_sort => 'no', p_dir => 'desc', p_limit => 1)) = 'asc-c2'
) then 1 else 0 end as assert_card_list_paging_and_sort;
reset role;

-- 비스태프는 막힌다.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000b02', true);
do $$
begin
  perform public.admin_search_cards();
  raise exception 'expected a non-staff caller to be blocked';
exception when insufficient_privilege then null;
end;
$$;
reset role;

select 1 / case when (
  has_function_privilege('authenticated', 'public.admin_search_cards(text,text,text,uuid,text,text,text,integer,integer)', 'execute')
  and not has_function_privilege('anon', 'public.admin_search_cards(text,text,text,uuid,text,text,text,integer,integer)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_cards_tab_counts(text,text,uuid,text)', 'execute')
) then 1 else 0 end as assert_card_list_acl;

rollback;
