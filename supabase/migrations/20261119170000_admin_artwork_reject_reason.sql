-- 업로드 확인 거절 사유 기록(2026-11-19 긴 상세 이미지 거절).
--
-- 디자인팀이 PNG로 내보낸 상세 이미지 파일 이름이 `.jpg`였다. 브라우저는 확장자로 image/jpeg를 신고했고, 확인 단계(sharp)는
-- 내용을 PNG로 읽어 형식 불일치로 거절했다. 확인 함수는 단계와 무관하게 service_reject_admin_artwork_upload(actor, path)로
-- 상태만 rejected로 바꿔, 운영 기록(admin_artwork_upload_claims)으로는 7건 거절의 원인을 알 수 없었다.
--
-- 앱(lib/admin/artwork.server.ts)은 이제 거절할 때 이유(reject_reason)와 짧은 진단 값(reject_detail: 신고·실제 형식, 가로·세로,
-- 저장소 오류 첫 줄)을 함께 남긴다. 이유 값은 앱의 AdminArtworkRejectReason(lib/admin/artwork.ts)이다. 새 이유를 더할 때
-- 이 migration을 고치지 않도록 형식(소문자·밑줄)만 검사한다. 기존 2인자 거절 함수는 배포 순서(옛 앱)와 다른 호출자(엑셀 반입
-- 취소 등)를 위해 그대로 둔다.
begin;

alter table public.admin_artwork_upload_claims
  add column reject_reason text,
  add column reject_detail jsonb,
  add constraint admin_artwork_claim_reject_reason_format
    check (reject_reason is null or reject_reason ~ '^[a-z][a-z_]{2,39}$'),
  add constraint admin_artwork_claim_reject_detail_shape
    check (reject_detail is null or (jsonb_typeof(reject_detail) = 'object' and octet_length(reject_detail::text) <= 2048));

comment on column public.admin_artwork_upload_claims.reject_reason is
  '업로드 확인을 거절한 이유(lib/admin/artwork.ts AdminArtworkRejectReason). 이유 없이 거절한 옛 기록·취소는 null';
comment on column public.admin_artwork_upload_claims.reject_detail is
  '거절 진단 값(신고·실제 형식, 가로·세로, 저장소 오류 첫 줄 등). 2KB 이하 객체';

create function public.service_reject_admin_artwork_upload(
  p_actor_id uuid,
  p_path text,
  p_reason text,
  p_detail jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_reason is null or p_reason !~ '^[a-z][a-z_]{2,39}$'
    or (p_detail is not null and (pg_catalog.jsonb_typeof(p_detail) <> 'object' or pg_catalog.octet_length(p_detail::text) > 2048))
  then
    raise exception 'invalid_artwork_reject_reason' using errcode = '22023';
  end if;

  -- 이미 거절·만료된 claim을 다시 거절하는 정리 재시도는 처음 남긴 이유를 덮지 않는다.
  update public.admin_artwork_upload_claims as claim
  set
    status = 'rejected',
    resolved_at = coalesce(claim.resolved_at, pg_catalog.clock_timestamp()),
    cleanup_completed_at = null,
    reject_reason = coalesce(claim.reject_reason, p_reason),
    reject_detail = case when claim.reject_reason is null then p_detail else claim.reject_detail end
  where claim.actor_id = p_actor_id
    and claim.path = p_path
    and claim.status in ('pending', 'processing', 'verified', 'rejected', 'expired');

  return found;
end;
$$;

alter function public.service_reject_admin_artwork_upload(uuid, text, text, jsonb) owner to postgres;
revoke all on function public.service_reject_admin_artwork_upload(uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.service_reject_admin_artwork_upload(uuid, text, text, jsonb) to service_role;

commit;
