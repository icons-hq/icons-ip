-- 검증 시작 속도 제한을 굿즈 폼 한 장 기준으로 다시 잡는다.
--
-- 20260807140003·140005 가 동시 클레임 예산을 4에서 12(pending·processing)로
-- 올렸지만 service_begin_admin_artwork_verification 의 "1분당 4회" 는 그대로
-- 남았다. 예산은 통과하고 검증 시작에서 막히므로 실패 지점만 옮겨졌다.
--
-- 재현: 굿즈 갤러리에 60초 안에 이미지 5장을 연속 업로드한다. 다섯 번째의
-- admission 이 비어 돌아오고 uploadAdminArtwork 가 클레임을 취소한 뒤
-- "이미지 파일을 확인하지 못했습니다. 다시 업로드해주세요." 를 띄운다.
-- 파일에는 문제가 없고, 안내대로 즉시 다시 올려도 1분 창이 밀릴 때까지
-- 같은 오류가 반복된다.
--
-- 두 가드가 지키는 것이 다르다.
--   동시 processing 1개 = 실제 자원 보호. 한 운영자가 Sharp decode 를 병렬로
--     돌리지 못하게 하는 직렬화다. 그대로 둔다.
--   1분당 시작 횟수     = 남용 억제. 폼을 정상 속도로 채우는 사람은 걸리면
--     안 된다. 굿즈 폼은 대표 1 + 갤러리 4 + 상세 1 = 6칸이므로 한 장을
--     채우면 6회다. 잘못 고른 이미지를 전부 갈아끼우는 경우까지 감안해
--     6 × 2 = 12 로 잡는다. 20260807140005 의 pending·processing 예산 12 와
--     같은 근거(폼 한 장 + 한 번 갈아끼우기)라 두 숫자가 같이 움직인다.
--
-- 제거하지 않는 이유: 이 창이 없으면 staff 계정 하나가 Sharp decode 를 무제한
-- 으로 큐잉할 수 있다. 직렬화는 동시성만 막고 총량은 막지 못한다.

create or replace function public.service_begin_admin_artwork_verification(
  p_actor_id uuid,
  p_path text
)
returns table (
  kind text,
  mime_type text,
  source_size integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null
    or p_path is null
    or not exists (
      select 1
      from public.profiles as profile
      where profile.id = p_actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    )
  then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin-artwork-upload:' || p_actor_id::text, 0)
  );

  -- actor 별 동시 processing 은 1개다. 이 직렬화는 그대로 유지한다.
  if exists (
    select 1
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.status = 'processing'
      and claim.expires_at > pg_catalog.clock_timestamp()
  ) or (
    -- 남용 억제 창. 굿즈 폼 6칸을 채우고 한 번 갈아끼울 수 있어야 한다.
    select count(*)
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.processing_started_at >= pg_catalog.clock_timestamp() - interval '1 minute'
  ) >= 12 then
    return;
  end if;

  return query
  update public.admin_artwork_upload_claims as claim
  set
    status = 'processing',
    processing_started_at = pg_catalog.clock_timestamp()
  where claim.actor_id = p_actor_id
    and claim.path = p_path
    and claim.status = 'pending'
    and claim.expires_at > pg_catalog.clock_timestamp()
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = claim.actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    )
  returning claim.kind, claim.mime_type, claim.source_size;
end;
$$;

revoke all on function public.service_begin_admin_artwork_verification(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_begin_admin_artwork_verification(uuid, text)
  to service_role;
