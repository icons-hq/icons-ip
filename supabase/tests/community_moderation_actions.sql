\set ON_ERROR_STOP on

begin;

update private.community_write_control
set
  post_create_enabled = true,
  comment_create_enabled = true;

create temporary table moderation_smoke_reports (
  name text primary key,
  id uuid not null
) on commit drop;
grant all on moderation_smoke_reports to authenticated;

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
  (
    '00000000-0000-4000-8000-000000000201',
    'authenticated',
    'authenticated',
    'moderation-author@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000202',
    'authenticated',
    'authenticated',
    'moderation-fan@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000203',
    'authenticated',
    'authenticated',
    'moderation-staff@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000201',
    'moderation-author@example.test',
    'moderation_author',
    '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb,
    now(),
    'user'
  ),
  (
    '00000000-0000-4000-8000-000000000202',
    'moderation-fan@example.test',
    'moderation_fan',
    '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb,
    now(),
    'user'
  ),
  (
    '00000000-0000-4000-8000-000000000203',
    'moderation-staff@example.test',
    'moderation_staff',
    '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb,
    now(),
    'staff'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.ips (
  id,
  title,
  sub,
  vertical_key,
  tagline,
  synopsis,
  glyph,
  bg,
  featured
)
values (
  'moderation-smoke-ip',
  '모더레이션스모크IP',
  'moderation smoke vertical',
  'character',
  'moderation smoke tagline',
  'moderation smoke synopsis',
  '모더',
  'linear-gradient(#111, #222)',
  false
)
on conflict (id) do update set
  title = excluded.title,
  sub = excluded.sub,
  vertical_key = excluded.vertical_key,
  tagline = excluded.tagline,
  synopsis = excluded.synopsis,
  glyph = excluded.glyph,
  bg = excluded.bg,
  featured = excluded.featured;

insert into public.posts (id, user_id, ip_id, text, tag, status)
values (
  '00000000-0000-4000-8000-000000000204',
  '00000000-0000-4000-8000-000000000201',
  'moderation-smoke-ip',
  'community moderation smoke post',
  'moderation',
  'visible'
)
on conflict (id) do update set
  user_id = excluded.user_id,
  ip_id = excluded.ip_id,
  text = excluded.text,
  tag = excluded.tag,
  status = excluded.status;

insert into public.comments (id, post_id, user_id, text)
values (
  '00000000-0000-4000-8000-000000000205',
  '00000000-0000-4000-8000-000000000204',
  '00000000-0000-4000-8000-000000000201',
  'community moderation smoke comment'
)
on conflict (id) do update set
  post_id = excluded.post_id,
  user_id = excluded.user_id,
  text = excluded.text;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000202', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into moderation_smoke_reports (name, id)
select
  'post',
  (public.submit_community_report(
    'post',
    '00000000-0000-4000-8000-000000000204',
    '  smoke report reason  '
  )->>'reportId')::uuid;

insert into moderation_smoke_reports (name, id)
select
  'comment',
  (public.submit_community_report(
    'comment',
    '00000000-0000-4000-8000-000000000205',
    null
  )->>'reportId')::uuid;

insert into moderation_smoke_reports (name, id)
select
  'user',
  (public.submit_community_report(
    'user',
    '00000000-0000-4000-8000-000000000201',
    'user report'
  )->>'reportId')::uuid;

select 1 / case when (
  select count(*)
  from public.reports
  where reporter_id = '00000000-0000-4000-8000-000000000202'
    and target_id in (
      '00000000-0000-4000-8000-000000000204',
      '00000000-0000-4000-8000-000000000205',
      '00000000-0000-4000-8000-000000000201'
    )
) = 3 then 1 else 0 end as assert_reports_created;

select 1 / case when (
  select reason
  from public.reports
  where id = (select id from moderation_smoke_reports where name = 'post')
) = 'smoke report reason' then 1 else 0 end as assert_report_reason_trimmed;

select public.block_community_user('00000000-0000-4000-8000-000000000201');
select public.block_community_user('00000000-0000-4000-8000-000000000201');
select public.set_post_like('00000000-0000-4000-8000-000000000204', true);

select 1 / case when (
  select count(*)
  from public.blocks
  where user_id = '00000000-0000-4000-8000-000000000202'
    and blocked_user_id = '00000000-0000-4000-8000-000000000201'
) = 1 then 1 else 0 end as assert_block_idempotent;

do $$
declare
  self_block_succeeded boolean := false;
begin
  begin
    perform public.block_community_user('00000000-0000-4000-8000-000000000202');
    self_block_succeeded := true;
  exception
    when invalid_parameter_value then
      self_block_succeeded := false;
  end;

  if self_block_succeeded then
    raise exception 'self block should be rejected';
  end if;
end;
$$;

do $$
declare
  direct_report_succeeded boolean := false;
begin
  begin
    insert into public.reports (target_type, target_id, reporter_id, reason)
    values (
      'post',
      '00000000-0000-4000-8000-000000000204',
      '00000000-0000-4000-8000-000000000202',
      'direct report'
    );
    direct_report_succeeded := true;
  exception
    when insufficient_privilege or check_violation then
      direct_report_succeeded := false;
  end;

  if direct_report_succeeded then
    raise exception 'direct report insert should be blocked';
  end if;
end;
$$;

do $$
declare
  direct_block_succeeded boolean := false;
begin
  begin
    insert into public.blocks (user_id, blocked_user_id)
    values (
      '00000000-0000-4000-8000-000000000202',
      '00000000-0000-4000-8000-000000000203'
    );
    direct_block_succeeded := true;
  exception
    when insufficient_privilege or check_violation then
      direct_block_succeeded := false;
  end;

  if direct_block_succeeded then
    raise exception 'direct block insert should be blocked';
  end if;
end;
$$;

do $$
declare
  user_admin_update_succeeded boolean := false;
begin
  begin
    perform public.admin_update_report_status(
      (select id from moderation_smoke_reports where name = 'post'),
      'reviewing'
    );
    user_admin_update_succeeded := true;
  exception
    when insufficient_privilege then
      user_admin_update_succeeded := false;
  end;

  if user_admin_update_succeeded then
    raise exception 'non-staff report status update should be blocked';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000203', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select 1 / case when exists (
  select 1
  from public.blocks
  where user_id = '00000000-0000-4000-8000-000000000202'
    and blocked_user_id = '00000000-0000-4000-8000-000000000201'
) then 1 else 0 end as assert_staff_can_read_blocks;

select public.admin_update_report_status(
  (select id from moderation_smoke_reports where name = 'post'),
  'reviewing'
);

select 1 / case when (
  select status
  from public.reports
  where id = (select id from moderation_smoke_reports where name = 'post')
) = 'reviewing' then 1 else 0 end as assert_staff_can_update_status;

do $$
declare
  mismatched_hide_succeeded boolean := false;
begin
  begin
    perform public.admin_hide_community_post(
      '00000000-0000-4000-8000-000000000204',
      (select id from moderation_smoke_reports where name = 'user')
    );
    mismatched_hide_succeeded := true;
  exception
    when invalid_parameter_value then
      mismatched_hide_succeeded := false;
  end;

  if mismatched_hide_succeeded then
    raise exception 'hide should reject reports unrelated to the post';
  end if;
end;
$$;

select public.admin_hide_community_post(
  '00000000-0000-4000-8000-000000000204',
  (select id from moderation_smoke_reports where name = 'post')
);

select 1 / case when (
  select status
  from public.posts
  where id = '00000000-0000-4000-8000-000000000204'
) = 'hidden' then 1 else 0 end as assert_staff_can_hide_post;

select 1 / case when (
  select status
  from public.reports
  where id = (select id from moderation_smoke_reports where name = 'post')
) = 'resolved' then 1 else 0 end as assert_hide_resolves_report;

select 1 / case when (
  select likes_count
  from public.community_post_reaction_counts(array['00000000-0000-4000-8000-000000000204'::uuid])
  where post_id = '00000000-0000-4000-8000-000000000204'
) = 1 then 1 else 0 end as assert_staff_can_count_hidden_post_likes;

select 1 / case when (
  select comments_count
  from public.community_post_reaction_counts(array['00000000-0000-4000-8000-000000000204'::uuid])
  where post_id = '00000000-0000-4000-8000-000000000204'
) = 1 then 1 else 0 end as assert_staff_can_count_hidden_post_comments;

select 1 / case when exists (
  select 1
  from public.audit_log
  where actor_id = '00000000-0000-4000-8000-000000000203'
    and action in ('community_report_status_update', 'community_post_hide')
) then 1 else 0 end as assert_moderation_audit_log;

rollback;
