\set ON_ERROR_STOP on

begin;

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
values
  ('00000000-0000-4000-8000-000000000107', 'authenticated', 'authenticated', 'feed-follower@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000108', 'authenticated', 'authenticated', 'feed-author@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000109', 'authenticated', 'authenticated', 'feed-staff@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-000000000107', 'feed-follower@example.test', 'feed_follower', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-000000000108', 'feed-author@example.test', 'feed_author', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-000000000109', 'feed-staff@example.test', 'feed_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff')
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.verticals (key, label, color)
values ('community-feed-smoke', '커뮤니티 피드 스모크', '#FF4D9D')
on conflict (key) do update set label = excluded.label, color = excluded.color;

insert into public.ips (id, title, vertical_key, featured)
values
  ('community-feed-followed', '팔로우 IP', 'community-feed-smoke', false),
  ('community-feed-other', '다른 IP', 'community-feed-smoke', false)
on conflict (id) do update set
  title = excluded.title,
  vertical_key = excluded.vertical_key,
  featured = excluded.featured;

insert into public.ip_follows (user_id, ip_id, notify_drops, notify_events)
values
  ('00000000-0000-4000-8000-000000000107', 'community-feed-followed', false, false),
  ('00000000-0000-4000-8000-000000000108', 'community-feed-other', true, true)
on conflict (user_id, ip_id) do update set
  notify_drops = excluded.notify_drops,
  notify_events = excluded.notify_events;

insert into public.posts (id, user_id, ip_id, text, status)
values
  ('00000000-0000-4000-8000-000000001071', '00000000-0000-4000-8000-000000000108', 'community-feed-followed', 'followed visible', 'visible'),
  ('00000000-0000-4000-8000-000000001072', '00000000-0000-4000-8000-000000000108', 'community-feed-followed', 'followed hidden', 'hidden'),
  ('00000000-0000-4000-8000-000000001073', '00000000-0000-4000-8000-000000000108', 'community-feed-other', 'other visible', 'visible'),
  ('00000000-0000-4000-8000-000000001074', '00000000-0000-4000-8000-000000000108', null, 'global visible', 'visible'),
  ('00000000-0000-4000-8000-000000001075', '00000000-0000-4000-8000-000000000107', 'community-feed-other', 'follower hidden', 'hidden')
on conflict (id) do update set
  user_id = excluded.user_id,
  ip_id = excluded.ip_id,
  text = excluded.text,
  status = excluded.status;

select 1 / case when not has_table_privilege('anon', 'public.ip_follows', 'SELECT') then 1 else 0 end
  as assert_anon_cannot_read_follows;
select 1 / case when has_table_privilege('authenticated', 'public.ip_follows', 'SELECT') then 1 else 0 end
  as assert_authenticated_can_read_own_follows;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000107', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select 1 / case when (
  select count(*)
  from public.ip_follows
) = 1 then 1 else 0 end as assert_follower_sees_only_own_follow;

select 1 / case when exists (
  select 1
  from public.ip_follows
  where ip_id = 'community-feed-followed'
    and notify_drops = false
    and notify_events = false
) then 1 else 0 end as assert_notification_preferences_do_not_hide_follow;

select 1 / case when (
  select count(*)
  from public.posts
  where ip_id in (select ip_id from public.ip_follows)
) = 1 then 1 else 0 end as assert_fandom_query_is_followed_visible_only;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000108', true);

select 1 / case when (
  select count(*)
  from public.posts
  where id in (
    '00000000-0000-4000-8000-000000001071',
    '00000000-0000-4000-8000-000000001072',
    '00000000-0000-4000-8000-000000001073',
    '00000000-0000-4000-8000-000000001074',
    '00000000-0000-4000-8000-000000001075'
  )
) = 4 then 1 else 0 end as assert_author_sees_visible_and_own_hidden;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000109', true);

select 1 / case when (
  select count(*)
  from public.ip_follows
) = 2 then 1 else 0 end as assert_staff_sees_all_follows;

select 1 / case when (
  select count(*)
  from public.posts
  where id in (
    '00000000-0000-4000-8000-000000001071',
    '00000000-0000-4000-8000-000000001072',
    '00000000-0000-4000-8000-000000001073',
    '00000000-0000-4000-8000-000000001074',
    '00000000-0000-4000-8000-000000001075'
  )
) = 5 then 1 else 0 end as assert_staff_sees_hidden_posts;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);

select 1 / case when (
  select count(*)
  from public.posts
  where id in (
    '00000000-0000-4000-8000-000000001071',
    '00000000-0000-4000-8000-000000001072',
    '00000000-0000-4000-8000-000000001073',
    '00000000-0000-4000-8000-000000001074',
    '00000000-0000-4000-8000-000000001075'
  )
) = 3 then 1 else 0 end as assert_anon_sees_visible_posts_only;

rollback;
