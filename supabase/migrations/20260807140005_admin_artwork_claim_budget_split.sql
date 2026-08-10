-- 검증된 클레임이 업로드 예산을 2시간 붙잡아 운영자가 스스로를 잠그는 문제를 막는다.
--
-- 20260807140003 이 폼 작성 창을 열려고 verified 만료를 2시간으로 늘렸는데,
-- 예산(12)이 pending·processing·verified 를 한 통에 세고 있어서 저장하지 않고
-- 떠난 폼 두 장(6칸 × 2)이면 그 운영자의 아트워크 업로드가 2시간 동안 전부 막힌다.
-- verified 클레임을 앞당겨 회수하는 UI 경로도 없다.
--
-- 두 숫자는 서로 다른 것을 지킨다.
--   pending·processing = staging 버킷에 지금 쓰고 있는 업로드. 남용을 막는 창이다.
--   verified           = 이미 public-media 로 승격돼 저장을 기다리는 이미지.
--                        staging 용량을 더 쓰지 않으므로 같은 통에 셀 이유가 없다.
--                        다만 저장되지 않은 승격본이 무한히 쌓이면 안 되므로
--                        따로 상한을 둔다. 만료된 건은 기존 정리 작업이 걷어간다.
--
-- 단일 사용 계약(status='verified' + attached_at is null 로만 attach)과
-- actor·kind·path 검증은 그대로다.

create or replace function public.service_prepare_admin_artwork_upload(
  p_actor_id uuid,
  p_path text,
  p_kind text,
  p_mime_type text,
  p_source_size integer,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null
    or p_path is null
    or p_kind is null
    or p_kind not in ('ip', 'good', 'card', 'event', 'curation')
    or p_mime_type is null
    or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_source_size is null
    or p_source_size < 1
    or p_source_size > 5 * 1024 * 1024
    or p_expires_at is null
    or p_expires_at <= pg_catalog.clock_timestamp()
    or p_expires_at > pg_catalog.clock_timestamp() + interval '15 minutes'
    or p_path !~ '^catalog/(ip|good|card|event|curation)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
    or p_path not like 'catalog/' || p_kind || '/%'
    or not (
      (p_mime_type = 'image/jpeg' and p_path like '%.jpg')
      or (p_mime_type = 'image/png' and p_path like '%.png')
      or (p_mime_type = 'image/webp' and p_path like '%.webp')
    )
    or not exists (
      select 1
      from public.profiles as profile
      where profile.id = p_actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    )
  then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin-artwork-upload:' || p_actor_id::text, 0)
  );

  -- staging 에 동시에 쓰고 있는 업로드. 가장 큰 폼(굿즈 6칸)을 한 번에 채울 수 있어야 한다.
  if (
    select count(*)
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.status in ('pending', 'processing')
      and claim.expires_at > pg_catalog.clock_timestamp()
  ) >= 12 then
    return false;
  end if;

  -- 저장을 기다리는 승격본. 폼을 몇 장 열어둬도 걸리지 않되 무한히 쌓이지는 않는다.
  if (
    select count(*)
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.status = 'verified'
      and claim.expires_at > pg_catalog.clock_timestamp()
  ) >= 60 then
    return false;
  end if;

  insert into public.admin_artwork_upload_claims (
    path, actor_id, kind, mime_type, source_size, expires_at
  )
  values (
    p_path, p_actor_id, p_kind, p_mime_type, p_source_size, p_expires_at
  )
  on conflict (path) do nothing;

  return found;
end;
$$;

revoke all on function public.service_prepare_admin_artwork_upload(
  uuid, text, text, text, integer, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.service_prepare_admin_artwork_upload(
  uuid, text, text, text, integer, timestamptz
) to service_role;
