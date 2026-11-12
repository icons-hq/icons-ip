/**
 * 클레임 처리 근거 사진(TKT-166·QNA-039, ADR-0041).
 *
 * 하자·오배송 교환을 '회수 없이 재출고'할 때 사유와 함께 남기는 사진이다. 사진은 운영자만 보는
 * 비공개 버킷(claim-evidence-private)에 두고, 고객 화면에는 내보내지 않는다. 올리기는 서버 액션이
 * 이미지를 디코딩해 검사한 뒤 저장소에 넣고 DB가 같은 크기·형식으로 원장에 등록한다.
 */
export const CLAIM_EVIDENCE_BUCKET = 'claim-evidence-private';
/** 서버 액션 본문 한도(3MB) 안에서 다른 필드를 실을 여유를 남긴다. 큰 사진은 브라우저가 먼저 줄인다. */
export const CLAIM_EVIDENCE_MAX_BYTES = 3 * 1024 * 1024 - 64 * 1024;
export const CLAIM_EVIDENCE_MAX_FILES = 5;
export const CLAIM_EVIDENCE_ACCEPT = 'image/jpeg,image/png,image/webp';
export const CLAIM_EVIDENCE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
export type ClaimEvidenceMimeType = keyof typeof CLAIM_EVIDENCE_EXTENSIONS;
/** DB 제약(order_claim_reshipments_waiver_check)과 같은 길이다. */
export const CLAIM_WAIVER_REASON_MIN = 10;
export const CLAIM_WAIVER_REASON_MAX = 500;

export interface ClaimEvidenceFile {
  id: string;
  mimeType: ClaimEvidenceMimeType;
  size: number;
}

export function isClaimEvidenceMimeType(value: unknown): value is ClaimEvidenceMimeType {
  return typeof value === 'string' && Object.hasOwn(CLAIM_EVIDENCE_EXTENSIONS, value);
}

/** 운영자 화면에서 근거 사진을 여는 주소. 경로는 권한을 다시 확인하고 비공개 사진을 직접 보낸다. */
export function claimEvidenceUrl(fileId: string) {
  return `/api/admin/claim-evidence/${fileId}`;
}

/** 회수 생략 사유는 한 줄로 저장한다. 줄바꿈은 공백으로 접고 앞뒤 공백을 지운다. */
export function normalizeClaimWaiverReason(value: string) {
  return value.replace(/\s*[\r\n]+\s*/gu, ' ').trim();
}

export function claimWaiverReasonValid(value: string) {
  const length = Array.from(normalizeClaimWaiverReason(value)).length;
  return length >= CLAIM_WAIVER_REASON_MIN && length <= CLAIM_WAIVER_REASON_MAX;
}
