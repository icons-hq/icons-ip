\set ON_ERROR_STOP on

-- 캠페인 도메인 스모크: 공개 브라우징 RLS, admin_upsert_* 카탈로그 계약,
-- 본문 블록 검증, 슬러그 섀도잉 차단.
-- 쓰기는 admin_upsert_campaign 한 곳만 지난다 — 테이블 직접 쓰기 경로가 없다.

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000801',
    'authenticated', 'authenticated', 'campaign-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000802',
    'authenticated', 'authenticated', 'campaign-fan@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000801',
    'campaign-staff@example.test', 'campaign_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  ),
  (
    '00000000-0000-4000-8000-000000000802',
    'campaign-fan@example.test', 'campaign_fan', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.ips (id, title, vertical_key)
values ('cmp-ip', '캠페인 스모크 IP', 'character')
on conflict (id) do nothing;

-- 슬러그 섀도잉 차단의 대상. 레거시 /events/[id] 리다이렉트가 가리키는 레코드다.
insert into public.events (id, ip_id, title, mode, status, starts_at, ends_at)
values (
  'cmp-legacy-event', 'cmp-ip', '레거시 오프라인 이벤트', '오프라인', '예정',
  now() + interval '1 day', now() + interval '2 days'
)
on conflict (id) do nothing;

-- ── 스키마·ACL 계약 ─────────────────────────────────────────────────────────

select 1 / case when (
  select rowsecurity from pg_tables
  where schemaname = 'public' and tablename = 'campaigns'
) then 1 else 0 end as assert_campaigns_have_rls;

select 1 / case when has_table_privilege('anon', 'public.campaigns', 'select')
  and has_table_privilege('authenticated', 'public.campaigns', 'select')
  and not has_table_privilege('authenticated', 'public.campaigns', 'insert')
  and not has_table_privilege('authenticated', 'public.campaigns', 'update')
  and not has_table_privilege('authenticated', 'public.campaigns', 'delete')
  and not has_table_privilege('anon', 'public.campaigns', 'insert')
  and not has_table_privilege('service_role', 'public.campaigns', 'insert')
then 1 else 0 end as assert_campaign_writes_sealed;

select 1 / case when not has_function_privilege(
    'anon',
    'public.admin_upsert_campaign(text, text, text, text, text, timestamptz, timestamptz, text, text, text, integer, jsonb, text)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.admin_upsert_campaign(text, text, text, text, text, timestamptz, timestamptz, text, text, text, integer, jsonb, text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.admin_upsert_campaign(text, text, text, text, text, timestamptz, timestamptz, text, text, text, integer, jsonb, text)',
    'execute'
  )
then 1 else 0 end as assert_campaign_admin_rpc_acl;

-- private 헬퍼는 앱 롤에 열리지 않는다.
select 1 / case when not exists (
  select 1
  from unnest(array['anon', 'authenticated', 'service_role']) as app_role(name)
  where has_function_privilege(
    app_role.name, 'private.validate_campaign_sections(jsonb)', 'execute'
  )
) then 1 else 0 end as assert_section_validator_sealed;

-- 허브 배너 슬라이더 부분 인덱스.
select 1 / case when exists (
  select 1 from pg_indexes
  where schemaname = 'public'
    and tablename = 'campaigns'
    and indexdef like '%featured_order%'
    and indexdef like '%WHERE%'
) then 1 else 0 end as assert_featured_order_partial_index;

select 1 / case when exists (
  select 1 from pg_indexes
  where schemaname = 'public'
    and tablename = 'campaigns'
    and indexdef like '%status%'
    and indexdef like '%starts_at%'
) then 1 else 0 end as assert_campaign_status_index;

-- ── 어드민 upsert 해피패스 ──────────────────────────────────────────────────

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000801', true);
set local role authenticated;

select public.admin_upsert_campaign(
  target_id => 'cmp-published',
  target_kind => 'event',
  target_title => '여름 캠페인',
  target_subtitle => '출석하고 카드팩 받기',
  target_status => 'published',
  target_starts_at => now() - interval '1 day',
  target_ends_at => now() + interval '10 days',
  target_hero_image_path => 'public-media/campaign/hero.webp',
  target_card_image_path => null,
  target_banner_image_path => 'public-media/campaign/banner.webp',
  target_featured_order => 1,
  target_sections => '[
    {"type":"intro","copy":"여름 한정 편성입니다.","anchor":"intro"},
    {"type":"attendance"},
    {"type":"notice","items":["기간 내에만 참여할 수 있어요.","경품은 소진 시 마감됩니다."]}
  ]'::jsonb,
  target_previous_id => null
);

select public.admin_upsert_campaign(
  target_id => 'cmp-draft',
  target_kind => 'drop',
  target_title => '준비 중 캠페인',
  target_subtitle => null,
  target_status => 'draft',
  target_starts_at => now() + interval '5 days',
  target_ends_at => now() + interval '15 days',
  target_hero_image_path => null,
  target_card_image_path => null,
  target_banner_image_path => null,
  target_featured_order => null,
  target_sections => '[]'::jsonb,
  target_previous_id => null
);

select public.admin_upsert_campaign(
  target_id => 'cmp-ended',
  target_kind => 'event',
  target_title => '종료된 캠페인',
  target_subtitle => null,
  target_status => 'ended',
  target_starts_at => now() - interval '20 days',
  target_ends_at => now() - interval '1 day',
  target_hero_image_path => null,
  target_card_image_path => null,
  target_banner_image_path => null,
  target_featured_order => null,
  target_sections => '[]'::jsonb,
  target_previous_id => null
);

select 1 / case when (
  select count(*) from public.campaigns
  where id in ('cmp-published', 'cmp-draft', 'cmp-ended')
) = 3 then 1 else 0 end as assert_admin_created_campaigns;

select 1 / case when (
  select kind = 'event' and status = 'published' and featured_order = 1
    and jsonb_array_length(sections) = 3
    and subtitle = '출석하고 카드팩 받기'
  from public.campaigns where id = 'cmp-published'
) then 1 else 0 end as assert_campaign_snapshot;

select 1 / case when exists (
  select 1 from public.audit_log
  where action = 'campaign.upsert'
    and actor_id = '00000000-0000-4000-8000-000000000801'
    and target = 'campaigns:cmp-published'
    and diff -> 'after' ->> 'sectionCount' = '3'
) then 1 else 0 end as assert_campaign_upsert_audited;

-- previous_id를 준 수정은 기존 레코드를 갱신한다(id는 불변).
select public.admin_upsert_campaign(
  target_id => 'cmp-published',
  target_kind => 'event',
  target_title => '여름 캠페인 (수정)',
  target_subtitle => null,
  target_status => 'published',
  target_starts_at => now() - interval '1 day',
  target_ends_at => now() + interval '20 days',
  target_hero_image_path => null,
  target_card_image_path => null,
  target_banner_image_path => null,
  target_featured_order => 2,
  target_sections => '[{"type":"text","heading":"안내","body":"기간이 연장됐습니다."}]'::jsonb,
  target_previous_id => 'cmp-published'
);

select 1 / case when (
  select title = '여름 캠페인 (수정)' and featured_order = 2
    and subtitle is null
    and jsonb_array_length(sections) = 1
  from public.campaigns where id = 'cmp-published'
) then 1 else 0 end as assert_campaign_update_applied;

select 1 / case when (
  select count(*) from public.campaigns
) = 3 then 1 else 0 end as assert_update_does_not_create_row;

-- ── 카탈로그 계약 위반 ──────────────────────────────────────────────────────

-- 같은 id 신규 등록은 거부된다.
do $$
begin
  begin
    perform public.admin_upsert_campaign(
      target_id => 'cmp-published',
      target_kind => 'event',
      target_title => '중복 캠페인',
      target_subtitle => null,
      target_status => 'draft',
      target_starts_at => now(),
      target_ends_at => now() + interval '1 day',
      target_hero_image_path => null,
      target_card_image_path => null,
      target_banner_image_path => null,
      target_featured_order => null,
      target_sections => '[]'::jsonb,
      target_previous_id => null
    );
    raise exception 'duplicate campaign id should be rejected';
  exception
    when unique_violation then
      if sqlerrm <> 'catalog_id_taken' then raise; end if;
  end;
end;
$$;

-- 기존 events 슬러그를 가져가는 신규 등록도 거부된다(레거시 리다이렉트 보호).
do $$
begin
  begin
    perform public.admin_upsert_campaign(
      target_id => 'cmp-legacy-event',
      target_kind => 'event',
      target_title => '슬러그 섀도잉',
      target_subtitle => null,
      target_status => 'draft',
      target_starts_at => now(),
      target_ends_at => now() + interval '1 day',
      target_hero_image_path => null,
      target_card_image_path => null,
      target_banner_image_path => null,
      target_featured_order => null,
      target_sections => '[]'::jsonb,
      target_previous_id => null
    );
    raise exception 'event slug shadowing should be rejected';
  exception
    when unique_violation then
      if sqlerrm <> 'catalog_id_taken' then raise; end if;
  end;
end;
$$;

-- id 변경 시도는 거부된다.
do $$
begin
  begin
    perform public.admin_upsert_campaign(
      target_id => 'cmp-renamed',
      target_kind => 'event',
      target_title => '개명 시도',
      target_subtitle => null,
      target_status => 'draft',
      target_starts_at => now(),
      target_ends_at => now() + interval '1 day',
      target_hero_image_path => null,
      target_card_image_path => null,
      target_banner_image_path => null,
      target_featured_order => null,
      target_sections => '[]'::jsonb,
      target_previous_id => 'cmp-published'
    );
    raise exception 'campaign id change should be rejected';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'catalog_id_immutable' then raise; end if;
  end;
end;
$$;

-- 없는 레코드 수정은 거부된다.
do $$
begin
  begin
    perform public.admin_upsert_campaign(
      target_id => 'cmp-missing',
      target_kind => 'event',
      target_title => '없는 캠페인',
      target_subtitle => null,
      target_status => 'draft',
      target_starts_at => now(),
      target_ends_at => now() + interval '1 day',
      target_hero_image_path => null,
      target_card_image_path => null,
      target_banner_image_path => null,
      target_featured_order => null,
      target_sections => '[]'::jsonb,
      target_previous_id => 'cmp-missing'
    );
    raise exception 'missing campaign update should be rejected';
  exception
    when no_data_found then
      if sqlerrm <> 'catalog_record_missing' then raise; end if;
  end;
end;
$$;

-- 기간·종류·상태 검증.
do $$
begin
  begin
    perform public.admin_upsert_campaign(
      target_id => 'cmp-badperiod',
      target_kind => 'event',
      target_title => '역전 기간',
      target_subtitle => null,
      target_status => 'draft',
      target_starts_at => now() + interval '2 days',
      target_ends_at => now() + interval '1 day',
      target_hero_image_path => null,
      target_card_image_path => null,
      target_banner_image_path => null,
      target_featured_order => null,
      target_sections => '[]'::jsonb,
      target_previous_id => null
    );
    raise exception 'reversed period should be rejected';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'invalid_campaign_period' then raise; end if;
  end;

  begin
    perform public.admin_upsert_campaign(
      target_id => 'cmp-badkind',
      target_kind => 'popup',
      target_title => '없는 종류',
      target_subtitle => null,
      target_status => 'draft',
      target_starts_at => now(),
      target_ends_at => now() + interval '1 day',
      target_hero_image_path => null,
      target_card_image_path => null,
      target_banner_image_path => null,
      target_featured_order => null,
      target_sections => '[]'::jsonb,
      target_previous_id => null
    );
    raise exception 'unknown campaign kind should be rejected';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'invalid_campaign_kind' then raise; end if;
  end;

  begin
    perform public.admin_upsert_campaign(
      target_id => 'CMP-UPPER',
      target_kind => 'event',
      target_title => '대문자 슬러그',
      target_subtitle => null,
      target_status => 'draft',
      target_starts_at => now(),
      target_ends_at => now() + interval '1 day',
      target_hero_image_path => null,
      target_card_image_path => null,
      target_banner_image_path => null,
      target_featured_order => null,
      target_sections => '[]'::jsonb,
      target_previous_id => null
    );
    raise exception 'uppercase slug should be rejected';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'invalid_campaign_id' then raise; end if;
  end;
end;
$$;

-- ── 본문 블록 검증 ──────────────────────────────────────────────────────────

do $$
declare
  v_bad jsonb;
begin
  foreach v_bad in array array[
    -- 모르는 블록 타입
    '[{"type":"video","url":"x"}]'::jsonb,
    -- 배열이 아닌 본문
    '{"type":"intro","copy":"x"}'::jsonb,
    -- 블록이 객체가 아님
    '["intro"]'::jsonb,
    -- 필수 키 누락
    '[{"type":"intro"}]'::jsonb,
    '[{"type":"exchange"}]'::jsonb,
    '[{"type":"goods"}]'::jsonb,
    -- 모르는 키
    '[{"type":"attendance","reward":3}]'::jsonb,
    -- 값 타입 오류
    '[{"type":"text","body":42}]'::jsonb,
    '[{"type":"notice","items":"안내"}]'::jsonb,
    '[{"type":"goods","good_ids":[1,2]}]'::jsonb,
    -- 길이 초과
    ('[{"type":"intro","copy":"' || repeat('가', 501) || '"}]')::jsonb,
    ('[{"type":"coupon","coupon_code":"' || repeat('A', 25) || '"}]')::jsonb,
    ('[{"type":"notice","items":["' || repeat('나', 301) || '"]}]')::jsonb,
    -- 개수 초과
    '[{"type":"goods","good_ids":["a","b","c","d","e","f","g","h","i"]}]'::jsonb,
    -- uuid 형식 아님
    '[{"type":"exchange","offer_id":"not-a-uuid"}]'::jsonb,
    -- anchor 길이 초과
    ('[{"type":"attendance","anchor":"' || repeat('x', 21) || '"}]')::jsonb
  ]
  loop
    begin
      perform public.admin_upsert_campaign(
        target_id => 'cmp-sections-probe',
        target_kind => 'event',
        target_title => '본문 검증',
        target_subtitle => null,
        target_status => 'draft',
        target_starts_at => now(),
        target_ends_at => now() + interval '1 day',
        target_hero_image_path => null,
        target_card_image_path => null,
        target_banner_image_path => null,
        target_featured_order => null,
        target_sections => v_bad,
        target_previous_id => null
      );
      raise exception 'invalid sections should be rejected: %', v_bad;
    exception
      when invalid_parameter_value then
        if sqlerrm <> 'invalid_sections' then raise; end if;
    end;
  end loop;
end;
$$;

-- 거부된 본문은 행을 남기지 않는다.
select 1 / case when not exists (
  select 1 from public.campaigns where id = 'cmp-sections-probe'
) then 1 else 0 end as assert_invalid_sections_left_no_row;

-- 8종 블록이 모두 통과한다.
select public.admin_upsert_campaign(
  target_id => 'cmp-allblocks',
  target_kind => 'drop',
  target_title => '전체 블록',
  target_subtitle => null,
  target_status => 'published',
  target_starts_at => now() - interval '1 hour',
  target_ends_at => now() + interval '1 day',
  target_hero_image_path => null,
  target_card_image_path => null,
  target_banner_image_path => null,
  target_featured_order => null,
  target_sections => '[
    {"type":"intro","copy":"소개"},
    {"type":"image","image_path":"public-media/campaign/a.webp","alt":"대체 텍스트"},
    {"type":"text","body":"본문"},
    {"type":"attendance"},
    {"type":"exchange","offer_id":"00000000-0000-4000-8000-0000000008aa"},
    {"type":"coupon","coupon_code":"CMPWELCOME","description":"첫 구매 할인"},
    {"type":"goods","good_ids":["cmp-g1"]},
    {"type":"notice","items":["안내 1"]}
  ]'::jsonb,
  target_previous_id => null
);

select 1 / case when (
  select jsonb_array_length(sections) = 8 from public.campaigns where id = 'cmp-allblocks'
) then 1 else 0 end as assert_all_block_types_accepted;

-- ── 비스태프 차단 ───────────────────────────────────────────────────────────

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000802', true);
do $$
begin
  begin
    perform public.admin_upsert_campaign(
      target_id => 'cmp-hack',
      target_kind => 'event',
      target_title => '탈취 시도',
      target_subtitle => null,
      target_status => 'published',
      target_starts_at => now(),
      target_ends_at => now() + interval '1 day',
      target_hero_image_path => null,
      target_card_image_path => null,
      target_banner_image_path => null,
      target_featured_order => null,
      target_sections => '[]'::jsonb,
      target_previous_id => null
    );
    raise exception 'non-staff campaign upsert should be rejected';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- 테이블 직접 쓰기 경로도 없다.
do $$
begin
  begin
    insert into public.campaigns (id, kind, title, status, starts_at, ends_at)
    values ('cmp-direct', 'event', '직접 삽입', 'published', now(), now() + interval '1 day');
    raise exception 'direct campaign insert should be rejected';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- ── RLS: draft는 운영자만 본다 ──────────────────────────────────────────────

select 1 / case when (
  select count(*) from public.campaigns
) = 3 then 1 else 0 end as assert_regular_user_sees_only_non_draft;

select 1 / case when not exists (
  select 1 from public.campaigns where id = 'cmp-draft'
) then 1 else 0 end as assert_draft_hidden_from_regular_user;

select 1 / case when exists (
  select 1 from public.campaigns where id = 'cmp-ended'
) then 1 else 0 end as assert_ended_visible_to_regular_user;

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select 1 / case when (
  select count(*) from public.campaigns
) = 3 then 1 else 0 end as assert_anon_sees_only_non_draft;

select 1 / case when exists (
  select 1 from public.campaigns where id = 'cmp-published'
) then 1 else 0 end as assert_anon_sees_published;

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000801', true);
set local role authenticated;

select 1 / case when (
  select count(*) from public.campaigns
) = 4 then 1 else 0 end as assert_staff_sees_draft;

reset role;

rollback;
