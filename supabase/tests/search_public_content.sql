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
values
  (
    '00000000-0000-4000-8000-000000000115',
    'authenticated',
    'authenticated',
    'search-author@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000116',
    'authenticated',
    'authenticated',
    'search-viewer@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  )
on conflict (id) do nothing;

update public.profiles
set
  nickname = case id
    when '00000000-0000-4000-8000-000000000115' then 'search_author'
    else 'search_viewer'
  end,
  birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true}'::jsonb,
  onboarded_at = now()
where id in (
  '00000000-0000-4000-8000-000000000115',
  '00000000-0000-4000-8000-000000000116'
);

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
  'search-smoke-ip',
  '검색스모크IP',
  '검색 smoke vertical',
  'character',
  '검색 smoke tagline',
  '검색 smoke synopsis',
  '검색',
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

insert into public.goods (id, ip_id, name, type, price, stock, bg)
values (
  'search-smoke-good',
  'search-smoke-ip',
  '검색스모크굿즈',
  '검색타입',
  1000,
  'ok',
  'linear-gradient(#111, #333)'
)
on conflict (id) do update set
  ip_id = excluded.ip_id,
  name = excluded.name,
  type = excluded.type,
  price = excluded.price,
  stock = excluded.stock,
  bg = excluded.bg;

insert into public.cards (id, ip_id, name, no, rarity, bg)
values (
  'search-smoke-card',
  'search-smoke-ip',
  '검색스모크카드',
  '999/999',
  'SSR',
  'linear-gradient(#111, #444)'
)
on conflict (id) do update set
  ip_id = excluded.ip_id,
  name = excluded.name,
  no = excluded.no,
  rarity = excluded.rarity,
  bg = excluded.bg;

insert into public.posts (id, user_id, ip_id, text, tag, status)
values
  (
    '00000000-0000-4000-8000-000000000117',
    '00000000-0000-4000-8000-000000000115',
    'search-smoke-ip',
    '검색스모크 visible post',
    '검색스모크태그',
    'visible'
  ),
  (
    '00000000-0000-4000-8000-000000000118',
    '00000000-0000-4000-8000-000000000115',
    'search-smoke-ip',
    '검색스모크 hidden post',
    '숨김검색태그',
    'hidden'
  )
on conflict (id) do update set
  user_id = excluded.user_id,
  ip_id = excluded.ip_id,
  text = excluded.text,
  tag = excluded.tag,
  status = excluded.status;

insert into public.blocks (user_id, blocked_user_id)
values (
  '00000000-0000-4000-8000-000000000116',
  '00000000-0000-4000-8000-000000000115'
)
on conflict (user_id, blocked_user_id) do nothing;

set local role anon;

select 1 / case when exists (
  select 1
  from public.search_public_content('검색스모크', 6)
  where kind = 'ip'
    and id = 'search-smoke-ip'
) then 1 else 0 end as assert_ip_result;

select 1 / case when exists (
  select 1
  from public.search_public_content('검색스모크', 6)
  where kind = 'good'
    and id = 'search-smoke-good'
) then 1 else 0 end as assert_good_result;

select 1 / case when exists (
  select 1
  from public.search_public_content('검색스모크', 6)
  where kind = 'card'
    and id = 'search-smoke-card'
) then 1 else 0 end as assert_card_result;

select 1 / case when exists (
  select 1
  from public.search_public_content('검색스모크', 6)
  where kind = 'post'
    and id = '00000000-0000-4000-8000-000000000117'
) then 1 else 0 end as assert_visible_post_result;

select 1 / case when exists (
  select 1
  from public.search_public_content('검색스모크태그', 6)
  where kind = 'tag'
    and id = '검색스모크태그'
) then 1 else 0 end as assert_visible_tag_result;

select 1 / case when not exists (
  select 1
  from public.search_public_content('hidden', 6)
  where kind = 'post'
    and id = '00000000-0000-4000-8000-000000000118'
) then 1 else 0 end as assert_hidden_post_excluded;

select 1 / case when not exists (
  select 1
  from public.search_public_content('%', 6)
  where id in (
    'search-smoke-ip',
    'search-smoke-good',
    'search-smoke-card',
    '00000000-0000-4000-8000-000000000117',
    '검색스모크태그'
  )
) then 1 else 0 end as assert_percent_literal_not_wildcard;

select 1 / case when not exists (
  select 1
  from public.search_public_content('_', 6)
  where id in (
    'search-smoke-ip',
    'search-smoke-good',
    'search-smoke-card',
    '00000000-0000-4000-8000-000000000117',
    '검색스모크태그'
  )
) then 1 else 0 end as assert_underscore_literal_not_wildcard;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000116', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select 1 / case when not exists (
  select 1
  from public.search_public_content('검색스모크 visible', 6)
  where kind = 'post'
    and id = '00000000-0000-4000-8000-000000000117'
) then 1 else 0 end as assert_blocked_post_excluded;

select 1 / case when not exists (
  select 1
  from public.search_public_content('검색스모크태그', 6)
  where kind = 'tag'
    and id = '검색스모크태그'
) then 1 else 0 end as assert_blocked_tag_excluded;

rollback;
