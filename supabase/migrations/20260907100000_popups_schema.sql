-- 팝업 ① — 온라인 팝업을 1급 객체로 (설계서 v2 §1-8)
--
-- 지금 「온라인 팝업」은 캠페인·이벤트·게임·티켓이 각자 흩어져 있고, 그것들을 하나로 묶어
-- 부르는 이름이 코드에 없다. 그래서 「9월 지우학 팝업에 뭐가 걸려 있나」를 물으면
-- 사람이 기억으로 답한다.
--
-- 팝업을 객체로 세우되 **원본을 옮기지 않는다** — 캠페인은 캠페인 표에 그대로 있고 팝업은
-- 참조만 한다. 팝업 규칙은 원본 조건과 **AND** 로 겹치므로 팝업이 원본을 열 수는 없고
-- 닫을 수만 있다. 원장이 둘로 갈라지지 않게 하는 규칙이다.
--
-- **시간대(페이즈)는 상태를 바꾸지 않는다.** 정각에 행을 갈아치우는 배치를 두면 그 배치가
-- 늦은 만큼 화면이 틀리고, 늦었는지조차 알기 어렵다. 조회 시 파생하면 초 단위로 정확하다
-- (D-9 판매 상태와 같은 규율).

create extension if not exists btree_gist;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'popup_sale_mode') then
    create domain public.popup_sale_mode as text
      check (value in ('hidden', 'teaser', 'preorder', 'on_sale', 'sellout', 'closed'));
  end if;
end;
$$;

comment on domain public.popup_sale_mode is
  'hidden 미공개 · teaser 노출만 · preorder 사전예약 · on_sale 판매 · sellout 잔여 소진 · closed 종료';

-- ---------------------------------------------------------------------------
-- 팝업
-- ---------------------------------------------------------------------------
create table if not exists public.popups (
  -- 슬러그 규칙은 캠페인과 같다. 주소에 그대로 나가는 값이라 사람이 정한다.
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  ip_id text not null references public.ips (id),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  subtitle text check (subtitle is null or char_length(subtitle) <= 200),
  -- 운영자의 의사. 시각보다 이 값이 세다(조기 종료한 팝업을 「진행중」으로 그리면 안 된다).
  status text not null default 'draft' check (status in ('draft', 'published', 'paused', 'ended')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  hero_image_path text,
  card_image_path text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint popups_period_check check (ends_at > starts_at)
);
create index if not exists popups_ip_idx on public.popups (ip_id);
create index if not exists popups_status_starts_idx on public.popups (status, starts_at desc);
-- 진행·예정 목록이 보는 부분 인덱스.
create index if not exists popups_live_window_idx on public.popups (starts_at, ends_at)
  where status = 'published' and archived_at is null;

-- ---------------------------------------------------------------------------
-- 페이즈 — 반열림 시간 창 `[시작, 종료)`
--
-- 「10/5 23:59까지」는 `10/6 00:00` 으로 저장한다. 닫힌 끝으로 두면 23:59:59.999 와
-- 24:00:00 사이 1밀리초가 어느 페이즈에도 속하지 않는다.
-- ---------------------------------------------------------------------------
create table if not exists public.popup_phases (
  id uuid primary key default gen_random_uuid(),
  popup_id text not null references public.popups (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,31}$'),
  label text not null check (char_length(btrim(label)) between 1 and 40),
  during tstzrange not null check (
    not isempty(during) and lower_inc(during) and not upper_inc(during)
    and lower(during) is not null and upper(during) is not null
  ),
  sort integer not null default 0,
  default_sale_mode public.popup_sale_mode not null default 'on_sale',
  unique (popup_id, key),
  -- 같은 팝업 안에서 두 페이즈가 겹치면 「지금 어느 페이즈인가」에 답이 둘이다.
  exclude using gist (popup_id with =, during with &&)
);

create or replace function private.assert_phase_inside_popup()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_popup public.popups;
begin
  select * into v_popup from public.popups as popup where popup.id = new.popup_id;
  -- 팝업 기간 밖의 페이즈는 영원히 오지 않거나 팝업이 끝난 뒤에 온다. 둘 다 편성 실수다.
  if pg_catalog.lower(new.during) < v_popup.starts_at or pg_catalog.upper(new.during) > v_popup.ends_at then
    raise exception 'phase_outside_popup' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists popup_phases_inside_popup on public.popup_phases;
create trigger popup_phases_inside_popup before insert or update on public.popup_phases
  for each row execute function private.assert_phase_inside_popup();

-- ---------------------------------------------------------------------------
-- 존 — 모듈 유형 6종(정보성·기록·체험·커머스·이벤트·커뮤니티)
-- 한 존은 한 유형만 갖는다(모듈 순수성 — 2026-08-25 PM 확정).
-- ---------------------------------------------------------------------------
create table if not exists public.popup_zones (
  id uuid primary key default gen_random_uuid(),
  popup_id text not null references public.popups (id) on delete cascade,
  code text not null check (code ~ '^[A-Z][A-Z0-9]{0,7}$'),
  kind text not null check (kind in ('info', 'record', 'experience', 'commerce', 'event', 'community')),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  -- 허브의 문 묶음(수색·기억·만약·합류). 배치가 아니라 묶음이라 존 정의에 둔다.
  door text check (door is null or char_length(door) <= 20),
  sort integer not null default 0,
  config jsonb not null default '{}'::jsonb,
  unique (popup_id, code)
);

-- ---------------------------------------------------------------------------
-- 연결 — 팝업 ↔ 원본. 다형이라 FK 대신 RPC 가 존재를 검사한다.
-- ---------------------------------------------------------------------------
create table if not exists public.popup_links (
  id uuid primary key default gen_random_uuid(),
  popup_id text not null references public.popups (id) on delete cascade,
  zone_id uuid references public.popup_zones (id) on delete set null,
  target_type text not null check (
    target_type in ('good', 'campaign', 'event', 'game', 'ticket_type', 'card_pool', 'curation')
  ),
  target_id text not null check (char_length(btrim(target_id)) between 1 and 120),
  sort integer not null default 0,
  -- null 이면 페이즈 기본값을 따른다.
  default_sale_mode public.popup_sale_mode,
  unique (popup_id, target_type, target_id)
);
create index if not exists popup_links_zone_idx on public.popup_links (popup_id, zone_id, sort);
-- 역조회 — 「이 상품이 걸린 팝업」과 원본이 바뀔 때의 정밀 무효화가 이 인덱스를 쓴다.
create index if not exists popup_links_target_idx on public.popup_links (target_type, target_id);

create table if not exists public.popup_link_phase_rules (
  link_id uuid not null references public.popup_links (id) on delete cascade,
  phase_id uuid not null references public.popup_phases (id) on delete cascade,
  sale_mode public.popup_sale_mode not null,
  primary key (link_id, phase_id)
);
create index if not exists popup_link_phase_rules_phase_idx on public.popup_link_phase_rules (phase_id);

create or replace function private.assert_rule_same_popup()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 다른 팝업의 페이즈에 규칙을 걸면 그 규칙은 영원히 안 맞는다.
  if (select link.popup_id from public.popup_links as link where link.id = new.link_id)
     is distinct from
     (select phase.popup_id from public.popup_phases as phase where phase.id = new.phase_id)
  then
    raise exception 'rule_popup_mismatch' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists popup_link_phase_rules_same_popup on public.popup_link_phase_rules;
create trigger popup_link_phase_rules_same_popup before insert or update on public.popup_link_phase_rules
  for each row execute function private.assert_rule_same_popup();

drop trigger if exists trg_popups_updated on public.popups;
create trigger trg_popups_updated before update on public.popups
  for each row execute function public.set_updated_at();
