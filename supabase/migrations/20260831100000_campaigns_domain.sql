-- S8 캠페인 도메인 (#330): 허브 배너·상세 페이지가 읽는 운영 캠페인 레코드.
--
-- 캠페인은 기존 `events`(오프라인 팝업·행사)와 별개 표면이다. events는 장소와
-- 회차가 있는 실물 일정이고, 캠페인은 스토어프론트에서 굿즈·쿠폰·출석·교환을
-- 한 페이지로 묶어 보여 주는 편성 단위다. 두 도메인을 한 테이블에 겹치면
-- "장소 없는 이벤트"와 "일정 없는 캠페인"이 같은 목록에 섞인다.
--
-- ## 본문은 sections jsonb 하나다
--
-- 블록 종류가 8가지이고 각 블록이 서로 다른 키를 갖는다. 블록마다 테이블을
-- 파면 캠페인 한 건을 그리는 데 조인이 여덟 번 필요하고, 순서 컬럼을 여덟 곳에
-- 유지해야 한다. 대신 스키마가 못 보는 만큼 어드민 RPC가 구조를 강제한다 —
-- private.validate_campaign_sections가 통과시키지 않은 본문은 저장되지 않는다.
--
-- ## 슬러그는 events와 겹칠 수 없다
--
-- S8은 레거시 `/events/[id]`를 새 표면으로 리다이렉트한다. 캠페인이 기존 이벤트
-- 슬러그를 가져가면 그 리다이렉트가 자기 자신을 가리키거나 엉뚱한 문서를 연다.
-- 신규 등록에서 events 충돌을 catalog_id_taken으로 막는다.

-- ── 테이블 ──────────────────────────────────────────────────────────────────

create table public.campaigns (
  -- 카탈로그 슬러그. URL에 그대로 실리므로 소문자·숫자·하이픈만 받는다.
  id text primary key
    check (id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  kind text not null
    check (kind in ('event', 'drop')),
  title text not null
    check (char_length(title) between 1 and 120),
  subtitle text
    check (subtitle is null or char_length(subtitle) <= 200),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'ended')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  hero_image_path text
    check (hero_image_path is null or char_length(hero_image_path) <= 300),
  card_image_path text
    check (card_image_path is null or char_length(card_image_path) <= 300),
  banner_image_path text
    check (banner_image_path is null or char_length(banner_image_path) <= 300),
  -- not null이면 허브 배너 슬라이더에 실리고 이 값으로 정렬된다. null이 "배너
  -- 아님"이라 별도 boolean을 두지 않는다 — 두 컬럼이면 "노출인데 순서 없음"이
  -- 표현 가능해지고, 그 상태의 정렬은 아무도 정의하지 못한다.
  featured_order integer
    check (featured_order > 0),
  sections jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create trigger campaigns_set_updated_at
before update on public.campaigns
for each row execute function public.set_updated_at();

-- 공개 목록(진행중·종료)과 어드민 목록이 같은 정렬을 쓴다.
create index campaigns_status_starts_idx
  on public.campaigns (status, starts_at desc);

-- 허브 배너 슬라이더. 부분 인덱스라 배너로 지정된 소수만 담긴다.
create index campaigns_featured_order_idx
  on public.campaigns (featured_order)
  where featured_order is not null;

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.campaigns enable row level security;

-- 공개 브라우징 원칙: 게시된 캠페인은 비로그인도 읽는다. draft는 운영자만 본다 —
-- 준비 중인 편성이 새면 공개 전 라인업이 그대로 노출된다.
create policy campaigns_public_read on public.campaigns
  for select
  to anon, authenticated
  using (status <> 'draft' or (select public.is_staff()));

-- 쓰기 정책은 두지 않는다. 등록·수정은 admin_upsert_campaign만 지난다.
revoke all on table public.campaigns from public, anon, authenticated, service_role;
grant select on table public.campaigns to anon, authenticated;

-- ── 본문 블록 검증 ──────────────────────────────────────────────────────────

-- 블록 계약을 한 곳에 못 박는다. 어드민 화면이 스스로 판정하면 새 화면 하나가
-- 검증을 빠뜨리는 순간 상세 페이지가 렌더 중에 터진다.
--
-- 위반은 전부 invalid_sections 한 가지로 답하고, 어느 블록의 어느 키인지는
-- DETAIL에 싣는다 — 운영자에게는 사유 하나면 되고, 개발자에게는 위치가 필요하다.
create function private.validate_campaign_sections(p_sections jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  c_types constant text[] := array[
    'intro', 'image', 'text', 'attendance', 'exchange', 'coupon', 'goods', 'notice'
  ];
  v_index integer := -1;
  v_section jsonb;
  v_type text;
  v_allowed text[];
  v_required text[];
  v_text_keys text[];
  v_text_limits integer[];
  v_key text;
begin
  if p_sections is null or jsonb_typeof(p_sections) <> 'array' then
    raise exception 'invalid_sections'
      using errcode = '22023', detail = 'sections: not a json array';
  end if;

  if jsonb_array_length(p_sections) > 20 then
    raise exception 'invalid_sections'
      using errcode = '22023',
        detail = format('sections: at most 20 blocks (got %s)', jsonb_array_length(p_sections));
  end if;

  for v_section in select entry from jsonb_array_elements(p_sections) as element(entry)
  loop
    v_index := v_index + 1;

    if jsonb_typeof(v_section) <> 'object' then
      raise exception 'invalid_sections'
        using errcode = '22023', detail = format('sections[%s]: not an object', v_index);
    end if;

    if jsonb_typeof(v_section -> 'type') is distinct from 'string'
       or not ((v_section ->> 'type') = any (c_types)) then
      raise exception 'invalid_sections'
        using errcode = '22023', detail = format('sections[%s].type: unknown block type', v_index);
    end if;

    v_type := v_section ->> 'type';

    -- anchor는 모든 블록의 선택 키다(상세 페이지 목차 링크).
    if v_section ? 'anchor'
       and (
         jsonb_typeof(v_section -> 'anchor') <> 'string'
         or char_length(v_section ->> 'anchor') not between 1 and 20
       ) then
      raise exception 'invalid_sections'
        using errcode = '22023', detail = format('sections[%s].anchor: invalid', v_index);
    end if;

    v_text_keys := null;
    v_text_limits := null;

    case v_type
      when 'intro' then
        v_required := array['copy'];
        v_allowed := array['copy'];
        v_text_keys := array['copy'];
        v_text_limits := array[500];
      when 'image' then
        v_required := array['image_path', 'alt'];
        v_allowed := array['image_path', 'alt'];
        v_text_keys := array['image_path', 'alt'];
        v_text_limits := array[300, 200];
      when 'text' then
        v_required := array['body'];
        v_allowed := array['heading', 'body'];
        v_text_keys := array['heading', 'body'];
        v_text_limits := array[120, 2000];
      when 'attendance' then
        v_required := array[]::text[];
        v_allowed := array[]::text[];
      when 'exchange' then
        v_required := array['offer_id'];
        v_allowed := array['offer_id'];
        v_text_keys := array['offer_id'];
        v_text_limits := array[36];
      when 'coupon' then
        v_required := array['coupon_code'];
        v_allowed := array['coupon_code', 'description'];
        v_text_keys := array['coupon_code', 'description'];
        v_text_limits := array[24, 200];
      when 'goods' then
        v_required := array['good_ids'];
        v_allowed := array['good_ids'];
      else
        -- 'notice'
        v_required := array['items'];
        v_allowed := array['items'];
    end case;

    -- 모르는 키는 통과시키지 않는다. 오타 하나가 조용히 저장되면 화면에서만
    -- 빈 블록으로 보이고, 원인을 데이터에서 찾아야 한다.
    for v_key in select object_key from jsonb_object_keys(v_section) as keys(object_key)
    loop
      if v_key not in ('type', 'anchor') and not (v_key = any (v_allowed)) then
        raise exception 'invalid_sections'
          using errcode = '22023',
            detail = format('sections[%s].%s: unexpected key for type %s', v_index, v_key, v_type);
      end if;
    end loop;

    foreach v_key in array v_required
    loop
      if not (v_section ? v_key) then
        raise exception 'invalid_sections'
          using errcode = '22023',
            detail = format('sections[%s].%s: required for type %s', v_index, v_key, v_type);
      end if;
    end loop;

    for v_cursor in 1 .. coalesce(array_length(v_text_keys, 1), 0)
    loop
      if v_section ? v_text_keys[v_cursor]
         and (
           jsonb_typeof(v_section -> v_text_keys[v_cursor]) <> 'string'
           or char_length(v_section ->> v_text_keys[v_cursor]) not between 1 and v_text_limits[v_cursor]
         ) then
        raise exception 'invalid_sections'
          using errcode = '22023',
            detail = format(
              'sections[%s].%s: expected a string of 1..%s characters',
              v_index, v_text_keys[v_cursor], v_text_limits[v_cursor]
            );
      end if;
    end loop;

    -- 교환 블록은 coin_exchange_offers 행을 가리킨다. FK를 걸 수 없는 자리라
    -- 최소한 형식은 확인한다 — 상세 페이지가 uuid 캐스팅에서 터지지 않게.
    if v_type = 'exchange'
       and (v_section ->> 'offer_id')
         !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_sections'
        using errcode = '22023',
          detail = format('sections[%s].offer_id: not a uuid', v_index);
    end if;

    if v_type = 'goods'
       and (
         jsonb_typeof(v_section -> 'good_ids') <> 'array'
         or jsonb_array_length(v_section -> 'good_ids') not between 1 and 8
         or exists (
           select 1
           from jsonb_array_elements(v_section -> 'good_ids') as entries(entry)
           where jsonb_typeof(entries.entry) <> 'string'
             or char_length(entries.entry #>> '{}') not between 1 and 120
         )
       ) then
      raise exception 'invalid_sections'
        using errcode = '22023',
          detail = format('sections[%s].good_ids: expected 1..8 non-empty strings', v_index);
    end if;

    if v_type = 'notice'
       and (
         jsonb_typeof(v_section -> 'items') <> 'array'
         or jsonb_array_length(v_section -> 'items') not between 1 and 20
         or exists (
           select 1
           from jsonb_array_elements(v_section -> 'items') as entries(entry)
           where jsonb_typeof(entries.entry) <> 'string'
             or char_length(entries.entry #>> '{}') not between 1 and 300
         )
       ) then
      raise exception 'invalid_sections'
        using errcode = '22023',
          detail = format('sections[%s].items: expected 1..20 strings of 1..300 characters', v_index);
    end if;
  end loop;
end;
$$;

revoke all on function private.validate_campaign_sections(jsonb)
  from public, anon, authenticated, service_role;

-- ── 어드민: 캠페인 upsert ───────────────────────────────────────────────────

-- admin_upsert_* 카탈로그 계약과 동형(20260807090001):
--   target_previous_id is null     → 신규. id가 이미 있으면 catalog_id_taken.
--   target_previous_id is not null → 선택한 레코드 수정. 없으면
--                                    catalog_record_missing, id 변경 시도는
--                                    catalog_id_immutable.
create function public.admin_upsert_campaign(
  target_id text,
  target_kind text,
  target_title text,
  target_subtitle text,
  target_status text,
  target_starts_at timestamptz,
  target_ends_at timestamptz,
  target_hero_image_path text,
  target_card_image_path text,
  target_banner_image_path text,
  target_featured_order integer,
  target_sections jsonb,
  target_previous_id text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_id text := btrim(coalesce(target_id, ''), E' \t\n\r\f\v');
  normalized_previous_id text := nullif(btrim(coalesce(target_previous_id, ''), E' \t\n\r\f\v'), '');
  normalized_title text := btrim(coalesce(target_title, ''), E' \t\n\r\f\v');
  normalized_subtitle text := nullif(btrim(coalesce(target_subtitle, ''), E' \t\n\r\f\v'), '');
  normalized_status text := coalesce(nullif(btrim(coalesce(target_status, '')), ''), 'draft');
  normalized_sections jsonb := coalesce(target_sections, '[]'::jsonb);
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_id !~ '^[a-z0-9][a-z0-9-]{1,63}$' then
    raise exception 'invalid_campaign_id' using errcode = '22023';
  end if;

  if target_kind is null or target_kind not in ('event', 'drop') then
    raise exception 'invalid_campaign_kind' using errcode = '22023';
  end if;

  if char_length(normalized_title) not between 1 and 120 then
    raise exception 'invalid_campaign_title' using errcode = '22023';
  end if;

  if normalized_status not in ('draft', 'published', 'ended') then
    raise exception 'invalid_campaign_status' using errcode = '22023';
  end if;

  if target_starts_at is null or target_ends_at is null or target_ends_at <= target_starts_at then
    raise exception 'invalid_campaign_period' using errcode = '22023';
  end if;

  if target_featured_order is not null and target_featured_order <= 0 then
    raise exception 'invalid_campaign_featured_order' using errcode = '22023';
  end if;

  perform private.validate_campaign_sections(normalized_sections);

  if normalized_previous_id is not null then
    if normalized_previous_id is distinct from normalized_id then
      raise exception 'catalog_id_immutable' using errcode = '22023';
    end if;

    perform 1 from public.campaigns where id = normalized_id for update;

    if not found then
      raise exception 'catalog_record_missing' using errcode = 'P0002';
    end if;
  else
    -- 슬러그 섀도잉 차단. 레거시 /events/[id] 리다이렉트가 살아 있는 동안
    -- 같은 id의 캠페인이 생기면 그 리다이렉트가 무엇을 가리키는지 알 수 없다.
    -- (반대 방향 — 캠페인이 선점한 슬러그로 이벤트를 만드는 경로 — 은
    --  admin_upsert_event 소관이라 여기서 다루지 않는다.)
    if exists (select 1 from public.events where id = normalized_id) then
      raise exception 'catalog_id_taken' using errcode = '23505';
    end if;
  end if;

  insert into public.campaigns (
    id, kind, title, subtitle, status, starts_at, ends_at,
    hero_image_path, card_image_path, banner_image_path, featured_order, sections
  )
  values (
    normalized_id,
    target_kind,
    normalized_title,
    normalized_subtitle,
    normalized_status,
    target_starts_at,
    target_ends_at,
    nullif(btrim(coalesce(target_hero_image_path, '')), ''),
    nullif(btrim(coalesce(target_card_image_path, '')), ''),
    nullif(btrim(coalesce(target_banner_image_path, '')), ''),
    target_featured_order,
    normalized_sections
  )
  on conflict (id) do update set
    kind = excluded.kind,
    title = excluded.title,
    subtitle = excluded.subtitle,
    status = excluded.status,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    hero_image_path = excluded.hero_image_path,
    card_image_path = excluded.card_image_path,
    banner_image_path = excluded.banner_image_path,
    featured_order = excluded.featured_order,
    sections = excluded.sections
  where normalized_previous_id is not null;

  if not found then
    raise exception 'catalog_id_taken' using errcode = '23505';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'campaign.upsert',
    'campaigns:' || normalized_id,
    jsonb_build_object(
      'mode', case when normalized_previous_id is null then 'create' else 'update' end,
      'after', jsonb_build_object(
        'id', normalized_id,
        'kind', target_kind,
        'title', normalized_title,
        'status', normalized_status,
        'startsAt', target_starts_at,
        'endsAt', target_ends_at,
        'featuredOrder', target_featured_order,
        'sectionCount', jsonb_array_length(normalized_sections)
      )
    )
  );
end;
$$;

-- ⚠️ Supabase default privileges가 public 스키마 신규 함수에 anon/authenticated/
--    service_role execute를 자동 부여한다. `from public`만으로는 봉인되지 않는다.
revoke all on function public.admin_upsert_campaign(
  text, text, text, text, text, timestamptz, timestamptz, text, text, text, integer, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_campaign(
  text, text, text, text, text, timestamptz, timestamptz, text, text, text, integer, jsonb, text
) to authenticated;
