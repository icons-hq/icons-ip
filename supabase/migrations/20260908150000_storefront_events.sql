-- 규모 후속 — 이벤트 축 공개 페이징
--
-- 고치는 결함: 오프라인 팝업 목록·상세가 `getCatalogSnapshot()` 으로 **카탈로그 전량**
-- (IP·굿즈·카드·이벤트)을 읽는다. 굿즈 축은 이미 옮겼고(규모 ⑤), 이벤트가 남아 있었다.
-- 이벤트 하나를 열자고 굿즈 1,000개를 함께 읽을 이유가 없고, 어느 축이든 1,000행에 닿으면
-- 절단 감지가 던져 화면이 통째로 멈춘다.
--
-- **정렬을 서버가 한다.** 화면이 「진행중 → 예매중 → 예정」으로 다시 세우는데, 페이지를
-- 자르는 쪽과 순서를 정하는 쪽이 다르면 1페이지에 예정만 담기는 일이 생긴다.
--
-- `coalesce`/`least`/`greatest` 는 SQL 문법이라 `pg_catalog.` 을 붙일 수 없다.

-- 상태 우선순위 — `lib/events-catalog.ts` 의 STATUS_PRIORITY 와 같은 순서다.
create or replace function public.storefront_event_status_rank(p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when '진행중' then 0
    when '예매중' then 1
    when '예정' then 2
    else 3
  end
$$;

create index if not exists events_storefront_order_idx
  on public.events (public.storefront_event_status_rank(status), id)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- ① 이벤트 한 페이지
-- ---------------------------------------------------------------------------
-- `p_mode` 는 **제외할 모드**가 아니라 담을 모드다. 오프라인 표면은 '온라인' 을 빼야 하는데,
-- 그걸 화면에서 거르면 페이지를 자른 뒤에 거르게 돼 한 페이지가 통째로 비어 보인다.
create or replace function public.storefront_events_page(
  p_exclude_mode text default null,
  p_limit integer default 200,
  p_offset integer default 0
)
returns table (
  id text,
  ip_id text,
  title text,
  mode text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  accent text,
  bg text,
  image_path text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return query
  select
    event.id, event.ip_id, event.title, event.mode, event.status,
    event.starts_at, event.ends_at, event.location, event.accent,
    event.bg, event.image_path,
    pg_catalog.count(*) over () as total_count
  from public.events as event
  where event.archived_at is null
    and (p_exclude_mode is null or event.mode is distinct from p_exclude_mode)
  order by
    public.storefront_event_status_rank(event.status),
    public.storefront_natural_prefix(event.id),
    public.storefront_natural_number(event.id),
    event.id
  limit v_limit offset v_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- ② id 로 이벤트
-- ---------------------------------------------------------------------------
-- 상세와 옛 링크 브리지가 쓴다. 「하나를 열자고 전부 읽는」 자리를 없앤다.
create or replace function public.storefront_events_by_ids(p_ids text[])
returns table (
  id text,
  ip_id text,
  title text,
  mode text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  accent text,
  bg text,
  image_path text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select
    event.id, event.ip_id, event.title, event.mode, event.status,
    event.starts_at, event.ends_at, event.location, event.accent,
    event.bg, event.image_path
  from public.events as event
  where event.archived_at is null
    and event.id = any(coalesce(p_ids, '{}'::text[]))
  order by event.id;
end;
$$;

-- 공개 표면이다 — 로그인하지 않은 방문자도 팝업 일정을 본다.
-- security definer 는 권한 상승이 아니라 계획 안정성 때문이다(규모 ⑤ 와 같은 규율).
revoke all on function public.storefront_events_page(text, integer, integer) from public, service_role;
revoke all on function public.storefront_events_by_ids(text[]) from public, service_role;
grant execute on function public.storefront_events_page(text, integer, integer) to anon, authenticated;
grant execute on function public.storefront_events_by_ids(text[]) to anon, authenticated;

analyze public.events;
