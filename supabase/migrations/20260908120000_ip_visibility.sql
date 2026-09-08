-- 현업 요청 슬라이스 5 — IP 노출/숨김 (`ips.hidden_at`)
--
-- 요청: 「IP 노출/미노출 설정 화면이 없다」. 굿즈에는 `hidden_at` 이 있고 IP 에는 없었다.
--
-- **보관과 다르다.** 보관(`archived_at`)은 하위 굿즈가 살아 있으면 막힌다 — 그래서
-- 「굿즈는 그대로 두고 공개 목록에서만 잠시 내린다」를 할 방법이 없었다. 이 열이 그 자리다.
--
-- **직접 링크는 살린다.** 숨김은 목록에서 빼는 것이지 없애는 것이 아니다. 이미 공유된
-- 링크가 404 가 되면 그게 더 큰 사고다(굿즈 `hidden_at` 도 같은 규율 — 보안 경계가 아니다).
--
-- 함정 메모(재발):
-- * `coalesce`/`least`/`greatest` 는 SQL 문법이라 `pg_catalog.` 을 붙일 수 없다.
-- * 부분 인덱스의 조건을 바꾸려면 drop 후 create — `create index if not exists` 는 조건이
--   달라도 이미 있는 인덱스를 그대로 둔다(조용히 옛 조건이 남는다).

alter table public.ips
  add column if not exists hidden_at timestamptz;

comment on column public.ips.hidden_at is
  '숨김 — 목록·검색에서 빠진다. 직접 링크와 하위 굿즈는 살아 있다. 보안 경계가 아니다.';

drop index if exists public.ips_storefront_order_idx;
create index ips_storefront_order_idx
  on public.ips (fans_count desc, id)
  where archived_at is null and hidden_at is null;

-- ---------------------------------------------------------------------------
-- 1. 목록에서 뺀다
-- ---------------------------------------------------------------------------
create or replace function public.storefront_ips_page(
  p_limit integer default 60,
  p_offset integer default 0
)
returns table (
  id text,
  title text,
  sub text,
  vertical_key text,
  tagline text,
  synopsis text,
  glyph text,
  bg text,
  image_path text,
  featured boolean,
  fans_count integer,
  goods_count integer,
  cards_count integer,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 60), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return query
  select
    ip.id, ip.title, ip.sub, ip.vertical_key, ip.tagline, ip.synopsis, ip.glyph,
    ip.bg, ip.image_path, ip.featured, ip.fans_count, ip.goods_count, ip.cards_count,
    pg_catalog.count(*) over () as total_count
  from public.ips as ip
  where ip.archived_at is null
    and ip.hidden_at is null
  order by ip.fans_count desc, ip.id asc
  limit v_limit offset v_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. 어드민 토글
-- ---------------------------------------------------------------------------
-- 굿즈의 `admin_set_good_switch` 와 같은 규율이다: **끄는 쪽에만 사유를 요구한다.**
-- 되돌릴 때 왜 내렸는지가 남아 있어야 한다.
create or replace function public.admin_set_ip_visibility(
  target_ip_id text,
  target_visible boolean,
  target_reason text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_reason text := nullif(btrim(coalesce(target_reason, '')), '');
  v_hidden_at timestamptz;
begin
  if not target_visible and v_reason is null then
    raise exception 'reason_required' using errcode = '23514';
  end if;

  update public.ips
  set hidden_at = case when target_visible then null else coalesce(hidden_at, now()) end
  where id = target_ip_id
  returning hidden_at into v_hidden_at;

  if not found then
    raise exception 'ip_not_found' using errcode = 'P0002';
  end if;

  perform private.record_admin_action(
    null, v_actor, 'catalog.ip.visible', 'ips:' || target_ip_id,
    jsonb_build_object('enabled', target_visible, 'reason', v_reason)
  );
  return v_hidden_at;
end;
$$;

revoke all on function public.admin_set_ip_visibility(text, boolean, text) from public, anon, service_role;
grant execute on function public.admin_set_ip_visibility(text, boolean, text) to authenticated;

analyze public.ips;
