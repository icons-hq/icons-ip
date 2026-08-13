\set ON_ERROR_STOP on

begin;

update private.community_write_control
set post_create_enabled = true;

insert into auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000000106',
  'authenticated',
  'authenticated',
  'trending-author@example.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
)
on conflict (id) do nothing;

insert into public.posts (id, user_id, text, tag, status, created_at)
values
  ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000106', 'alpha 1', ' alpha ', 'visible', now() - interval '3 hours'),
  ('00000000-0000-4000-8000-000000001002', '00000000-0000-4000-8000-000000000106', 'alpha 2', '#alpha', 'visible', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-000000001003', '00000000-0000-4000-8000-000000000106', 'alpha 3', '##alpha', 'visible', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-000000001004', '00000000-0000-4000-8000-000000000106', 'beta 1', 'beta', 'visible', now() - interval '4 hours'),
  ('00000000-0000-4000-8000-000000001005', '00000000-0000-4000-8000-000000000106', 'beta 2', 'beta', 'visible', now() - interval '3 hours'),
  ('00000000-0000-4000-8000-000000001006', '00000000-0000-4000-8000-000000000106', 'beta 3', 'beta', 'visible', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-000000001007', '00000000-0000-4000-8000-000000000106', 'case 1', 'Alpha', 'visible', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-000000001008', '00000000-0000-4000-8000-000000000106', 'case 2', 'Alpha', 'visible', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-000000001009', '00000000-0000-4000-8000-000000000106', 'percent 1', '%', 'visible', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-000000001010', '00000000-0000-4000-8000-000000000106', 'percent 2', '%', 'visible', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-000000001011', '00000000-0000-4000-8000-000000000106', 'underscore 1', '_', 'visible', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-000000001012', '00000000-0000-4000-8000-000000000106', 'underscore 2', '_', 'visible', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-000000001013', '00000000-0000-4000-8000-000000000106', 'hidden', 'alpha', 'hidden', now() - interval '30 minutes'),
  ('00000000-0000-4000-8000-000000001014', '00000000-0000-4000-8000-000000000106', 'future', 'alpha', 'visible', now() + interval '1 hour'),
  ('00000000-0000-4000-8000-000000001015', '00000000-0000-4000-8000-000000000106', 'null', null, 'visible', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-000000001016', '00000000-0000-4000-8000-000000000106', 'blank', '  ', 'visible', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-000000001017', '00000000-0000-4000-8000-000000000106', 'hashes', '###', 'visible', now() - interval '1 hour');

insert into public.posts (user_id, text, tag, status, created_at)
select
  '00000000-0000-4000-8000-000000000106',
  'top ' || series,
  'top' || lpad(series::text, 2, '0'),
  'visible',
  now() - interval '90 minutes'
from generate_series(1, 12) as series;

insert into public.posts (user_id, text, tag, status, created_at)
select
  '00000000-0000-4000-8000-000000000106',
  'two days ' || series,
  'two-days',
  'visible',
  now() - interval '2 days'
from generate_series(1, 20) as series;

insert into public.posts (user_id, text, tag, status, created_at)
select
  '00000000-0000-4000-8000-000000000106',
  'old 29 ' || series,
  'old29',
  'visible',
  now() - interval '29 days'
from generate_series(1, 20) as series;

select 1 / case when has_function_privilege(
  'anon',
  'public.community_trending_tags(integer, integer)',
  'EXECUTE'
) then 1 else 0 end as assert_anon_execute;

select 1 / case when has_function_privilege(
  'authenticated',
  'public.community_trending_tags(integer, integer)',
  'EXECUTE'
) then 1 else 0 end as assert_authenticated_execute;

select 1 / case when not has_function_privilege(
  'service_role',
  'public.community_trending_tags(integer, integer)',
  'EXECUTE'
) then 1 else 0 end as assert_service_role_rejected;

set local role anon;

select 1 / case when (
  select array_agg(tag order by usage_count desc, latest_post_at desc, tag asc)
  from public.community_trending_tags(1, 2)
) = array['alpha', 'beta']::text[] then 1 else 0 end as assert_count_latest_tag_order;

select 1 / case when (
  select usage_count
  from public.community_trending_tags(1, 10)
  where tag = 'alpha'
) = 3 then 1 else 0 end as assert_visible_recent_only;

select 1 / case when exists (
  select 1
  from public.community_trending_tags(1, 10)
  where tag = 'Alpha'
    and usage_count = 2
) then 1 else 0 end as assert_case_sensitive_grouping;

select 1 / case when (
  select count(*)
  from public.community_trending_tags(1, 10)
  where tag in ('%', '_')
    and usage_count = 2
) = 2 then 1 else 0 end as assert_percent_underscore_literal_tags;

select 1 / case when not exists (
  select 1
  from public.community_trending_tags(1, 10)
  where tag is null or tag = '' or tag like '#%'
) then 1 else 0 end as assert_null_blank_and_leading_hash_removed;

select 1 / case when (
  select count(*)
  from public.community_trending_tags(1, 0)
) = 1 then 1 else 0 end as assert_result_limit_min_clamp;

select 1 / case when (
  select count(*)
  from public.community_trending_tags(1, 999)
) = 10 then 1 else 0 end as assert_result_limit_max_clamp;

select 1 / case when not exists (
  select 1
  from public.community_trending_tags(0, 10)
  where tag = 'two-days'
) then 1 else 0 end as assert_window_min_clamp;

select 1 / case when exists (
  select 1
  from public.community_trending_tags(999, 10)
  where tag = 'old29'
    and usage_count = 20
) then 1 else 0 end as assert_window_max_clamp;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000106', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select 1 / case when (
  select count(*)
  from public.community_trending_tags(null, null)
) = 10 then 1 else 0 end as assert_authenticated_default_clamps;

rollback;
