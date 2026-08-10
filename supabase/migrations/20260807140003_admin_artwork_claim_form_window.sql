-- 아트워크 업로드 클레임의 수명을 "업로드 창"과 "폼 작성 창"으로 나눈다.
--
-- 20260717110001 은 클레임 하나에 만료 시각 하나만 뒀다. 업로드 칸이 1개였을
-- 때는 업로드와 저장 사이가 몇 초라 문제가 없었지만, 굿즈 폼이 6칸(대표·갤러리
-- 4칸·상세)으로 늘고 고시정보 7개 필드와 설명까지 붙으면서 첫 업로드와 저장
-- 사이가 10분을 쉽게 넘긴다. 그러면 enforce_admin_catalog_artwork_claim 의
-- expires_at 검사가 먼저 올린 이미지에서 터지고, admin_upsert_good 트랜잭션
-- 전체(고시정보·설명·갤러리 경로 포함)가 롤백된다.
--
-- 두 창의 성격이 다르다:
--   - 업로드 창(pending): staging 버킷 쓰기 권한이 열려 있는 구간이라 짧아야
--     한다. 앱이 prepare 직후 곧바로 업로드하므로 기존 10분(상한 15분)을 둔다.
--   - 폼 작성 창(verified): 이미지는 이미 검증돼 public-media 로 승격됐고,
--     남은 일은 운영자가 나머지 필드를 채우고 저장하는 것뿐이다. 사람의 작업
--     시간이므로 넉넉해야 한다.
--
-- 그래서 검증이 성공할 때 만료를 폼 작성 창까지 연장한다. 클레임의 단일 사용
-- 계약(status='verified' + attached_at is null 로만 attach)과 actor·kind·path
-- 격리는 그대로다 — 바뀌는 것은 "언제까지"뿐이다.

create or replace function public.service_verify_admin_artwork_upload(
  p_actor_id uuid,
  p_path text,
  p_final_size integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_final_size is null or p_final_size < 1 or p_final_size > 5 * 1024 * 1024 then
    return false;
  end if;

  update public.admin_artwork_upload_claims as claim
  set
    status = 'verified',
    final_size = p_final_size,
    verified_at = pg_catalog.clock_timestamp(),
    -- 폼 작성 창. 이미 더 먼 만료가 잡혀 있으면 당기지 않는다.
    -- greatest 는 파서 구문이라 search_path 와 무관하게 스키마 수식이 없다.
    expires_at = greatest(
      claim.expires_at,
      pg_catalog.clock_timestamp() + interval '2 hours'
    )
  where claim.actor_id = p_actor_id
    and claim.path = p_path
    and claim.status = 'processing'
    and claim.expires_at > pg_catalog.clock_timestamp()
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = claim.actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    );

  return found;
end;
$$;

-- 동시 활성 클레임 예산을 폼 한 장 기준으로 다시 잡는다.
--
-- 4는 업로드 칸이 1개일 때의 숫자다. 6칸 폼에서는 다섯 번째 업로드의 prepare 가
-- 곧바로 false 를 반환해 운영자가 갤러리를 채우지 못한다. 가장 큰 폼(굿즈 6칸)을
-- 한 번 채우고 한 번 갈아끼울 수 있는 12로 올린다. 저장에 성공한 클레임은
-- 'attached' 가 되어 예산에서 빠지므로, 예산을 붙잡는 것은 아직 저장하지 않은
-- 업로드뿐이다. 실제 속도 제한은 service_begin_admin_artwork_verification 의
-- 분당 4회 검증 제한이 그대로 맡는다.
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

  if (
    select count(*)
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.status in ('pending', 'processing', 'verified')
      and claim.expires_at > pg_catalog.clock_timestamp()
  ) >= 12 then
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

revoke all on function public.service_verify_admin_artwork_upload(uuid, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.service_prepare_admin_artwork_upload(
  uuid, text, text, text, integer, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.service_verify_admin_artwork_upload(uuid, text, integer)
  to service_role;
grant execute on function public.service_prepare_admin_artwork_upload(
  uuid, text, text, text, integer, timestamptz
) to service_role;
