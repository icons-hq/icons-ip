export type AdminArtworkKind = 'ip' | 'good' | 'card' | 'event' | 'curation';
export type AdminArtworkMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export const ADMIN_ARTWORK_ACCEPT = 'image/jpeg,image/png,image/webp';
export const ADMIN_ARTWORK_MAX_BYTES = 5 * 1024 * 1024;
export const ADMIN_ARTWORK_MAX_DIMENSION = 8192;
/**
 * 상품 이미지는 세로로 긴 통이미지 상세페이지를 받아야 해서 한도가 따로 크다(MD-0002).
 * DB·스토리지 한도(20261110110000)와 같은 값이다. 총 픽셀 상한은 모든 종류에 공통이다.
 */
export const GOODS_ARTWORK_MAX_BYTES = 20 * 1024 * 1024;
export const GOODS_ARTWORK_MAX_DIMENSION = 30_000;
/** 공개 원본의 사진형 긴 변·띠형 짧은 변 상한(artwork-image.server.ts의 adminArtworkOutputBox). */
export const ADMIN_ARTWORK_OUTPUT_MAX_EDGE = 2560;
/**
 * 운영자별 1분 동안 시작할 수 있는 아트워크 검증 수. DB service_begin_admin_artwork_verification의
 * 남용 억제 창(20261119170100)과 같은 값이다 — 굿즈 폼 20칸(대표 1 + 추가 이미지 9 + 긴 상세 이미지 10) × 2.
 */
export const ADMIN_ARTWORK_VERIFICATIONS_PER_MINUTE = 40;
export const ADMIN_ARTWORK_ERROR =
  '이미지는 JPEG, PNG, WebP 형식의 5MB 이하, 가로·세로 8192px 이하 파일만 업로드할 수 있습니다.';
export const GOODS_ARTWORK_ERROR =
  '이미지는 JPEG, PNG, WebP 형식의 20MB 이하, 가로·세로 30,000px 이하 파일만 업로드할 수 있습니다.';

/** 사람이 읽는 형식 이름. 거절 안내에서 실제 형식과 확장자를 견줄 때 쓴다. */
export const ADMIN_ARTWORK_FORMAT_LABELS: Record<AdminArtworkMimeType, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
};
export const ADMIN_ARTWORK_NOT_IMAGE_ERROR =
  'JPEG, PNG, WebP 이미지 파일이 아닙니다. 파일 확장자와 관계없이 실제 내용으로 형식을 확인합니다. 이미지 편집 프로그램에서 JPEG·PNG로 다시 저장해 올려주세요.';
/** 파일 앞부분(매직 바이트)을 읽을 길이. WebP는 RIFF 머리(12바이트)로 판별한다. */
export const ADMIN_ARTWORK_SIGNATURE_BYTES = 12;

/*
 * 2026-11-19 긴 상세 이미지 거절 원인: 디자인팀이 PNG로 내보낸 파일의 이름이 `.jpg`였다. 브라우저는 File.type을
 * 확장자로 정해 image/jpeg로 신고했고, 서버(sharp)는 내용을 PNG로 읽어 형식 불일치로 사유 없이 거절했다.
 * 업로드는 확장자가 아니라 파일 내용으로 형식을 정한다. 세 형식 밖이면 null이다.
 */
export function detectAdminArtworkMimeType(bytes: Uint8Array): AdminArtworkMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) return 'image/webp';
  return null;
}

export function adminArtworkLimits(kind: AdminArtworkKind): { maxBytes: number; maxDimension: number } {
  return kind === 'good'
    ? { maxBytes: GOODS_ARTWORK_MAX_BYTES, maxDimension: GOODS_ARTWORK_MAX_DIMENSION }
    : { maxBytes: ADMIN_ARTWORK_MAX_BYTES, maxDimension: ADMIN_ARTWORK_MAX_DIMENSION };
}

/**
 * 운영자별 업로드 한도에 걸린 이유(DB service_admin_artwork_upload_block_reason, 20261103120000).
 * 예전에는 모두 "이미지 파일을 확인하지 못했습니다"로 보여 사진이 조용히 사라진 것처럼 보였다(R20).
 */
export type AdminArtworkUploadBlockReason =
  | 'verification_in_progress'
  | 'verification_rate_limited'
  | 'staging_full'
  | 'unsaved_full';
export const ADMIN_ARTWORK_BLOCK_MESSAGES: Record<AdminArtworkUploadBlockReason, string> = {
  verification_in_progress: '다른 사진을 올리는 중입니다. 끝난 뒤 다시 시도해주세요.',
  verification_rate_limited: '1분에 올릴 수 있는 사진 수를 넘었습니다. 잠시 뒤 다시 시도해주세요.',
  staging_full: '확인을 기다리는 사진이 너무 많습니다. 올리는 중인 사진이 끝난 뒤 다시 시도해주세요.',
  unsaved_full: '저장하지 않고 올려 둔 사진이 너무 많습니다. 작성 중인 화면을 먼저 저장한 뒤 다시 시도해주세요.',
};
export function parseAdminArtworkUploadBlockReason(value: unknown): AdminArtworkUploadBlockReason | null {
  return typeof value === 'string' && Object.hasOwn(ADMIN_ARTWORK_BLOCK_MESSAGES, value)
    ? value as AdminArtworkUploadBlockReason
    : null;
}

/**
 * 업로드 확인을 거절한 이유(admin_artwork_upload_claims.reject_reason). 앞의 일곱 개는 이미지 자체의 이유이고,
 * 나머지는 저장소·DB 단계의 실패다. 운영자 안내(adminArtworkRejectMessage)와 운영 기록이 같은 값을 쓴다.
 */
export type AdminArtworkImageRejectReason =
  | 'size_exceeded'
  | 'format_mismatch'
  | 'dimension_exceeded'
  | 'pixel_limit_exceeded'
  | 'animated'
  | 'decode_failed'
  | 'output_too_large';
export type AdminArtworkRejectReason =
  | AdminArtworkImageRejectReason
  | 'claim_mismatch'
  | 'staging_missing'
  | 'staging_metadata_mismatch'
  | 'staging_download_failed'
  | 'public_upload_failed'
  | 'verify_rejected'
  | 'staging_upload_failed'
  | 'unexpected_error';
export type AdminArtworkRejectDetail = Record<string, string | number | null>;
export interface AdminArtworkRejection {
  reason: AdminArtworkRejectReason;
  detail: AdminArtworkRejectDetail;
}

const SHARP_FORMAT_LABELS: Record<string, string> = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP', gif: 'GIF', heif: 'HEIC/HEIF', avif: 'AVIF', tiff: 'TIFF', svg: 'SVG' };
const numberText = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ko-KR') : null;

/**
 * 브라우저 → 스테이징(admin-artwork-staging) 업로드 실패. 서버 확인 전 단계라 예전에는 취소만 하고 이유가 남지 않았다.
 * 저장소가 크기로 거절하면(413·"maximum allowed size") 저장소 한도 문제로 알린다 — 버킷 한도(20MB)보다 낮은 프로젝트 한도 등.
 */
export function adminArtworkStagingFailure(error: unknown): { message: string; detail: AdminArtworkRejectDetail } {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const rawStatus = value.statusCode ?? value.status;
  const status = typeof rawStatus === 'number' ? rawStatus : typeof rawStatus === 'string' && /^\d{3}$/.test(rawStatus) ? Number(rawStatus) : null;
  const message = typeof value.message === 'string' ? value.message.split('\n')[0].slice(0, 160) : null;
  const tooLarge = status === 413 || /maximum allowed size|payload too large|too large/i.test(message ?? '');
  return {
    message: tooLarge
      ? '저장소가 파일 크기로 업로드를 거절했습니다. 운영 담당자에게 알려주세요(원인 코드 staging_upload_too_large).'
      : '이미지를 업로드하지 못했습니다. 다시 시도해주세요. 계속되면 운영 담당자에게 알려주세요(원인 코드 staging_upload_failed).',
    detail: { status, message, tooLarge: tooLarge ? 1 : 0 },
  };
}

/** 취소 요청에 실려 오는 업로드 실패 진단 값. 숫자 상태와 160자 이하 문구만 받는다. */
export function parseAdminArtworkStagingFailure(value: unknown): AdminArtworkRejectDetail | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { status, message, tooLarge } = value as Record<string, unknown>;
  if (Object.keys(value).some((key) => !['status', 'message', 'tooLarge'].includes(key))) return null;
  if (status !== null && !(typeof status === 'number' && Number.isInteger(status) && status >= 0 && status < 1000)) return null;
  if (message !== null && !(typeof message === 'string' && message.length <= 160)) return null;
  if (tooLarge !== 0 && tooLarge !== 1) return null;
  return { status: status as number | null, message: message as string | null, tooLarge };
}

/** 업로드 확인 거절 안내. 이미지 자체의 이유는 무엇을 고치면 되는지, 저장소 단계 실패는 다시 시도와 원인 코드를 알린다. */
export function adminArtworkRejectMessage(kind: AdminArtworkKind, rejection: AdminArtworkRejection): string {
  const { maxBytes, maxDimension } = adminArtworkLimits(kind);
  const { detail } = rejection;
  const size = numberText(detail.width) && numberText(detail.height) ? `${numberText(detail.width)}×${numberText(detail.height)}px` : null;
  const split = kind === 'good' ? ' 긴 상세 이미지는 잘라서 여러 장으로 올려주세요.' : '';
  switch (rejection.reason) {
    case 'size_exceeded':
      return kind === 'good' ? GOODS_ARTWORK_ERROR : ADMIN_ARTWORK_ERROR;
    case 'format_mismatch': {
      const declared = typeof detail.declared === 'string' && Object.hasOwn(ADMIN_ARTWORK_FORMAT_LABELS, detail.declared)
        ? ADMIN_ARTWORK_FORMAT_LABELS[detail.declared as AdminArtworkMimeType] : null;
      const detected = typeof detail.detected === 'string' ? SHARP_FORMAT_LABELS[detail.detected] ?? detail.detected.toUpperCase() : null;
      return `파일 이름의 형식${declared ? `(${declared})` : ''}과 실제 내용의 형식${detected ? `(${detected})` : ''}이 다릅니다. 이미지 편집 프로그램에서 JPEG·PNG로 다시 저장해 올려주세요.`;
    }
    case 'dimension_exceeded':
      return `가로·세로 ${maxDimension.toLocaleString('ko-KR')}px 이하 이미지만 올릴 수 있습니다${size ? `(올린 파일 ${size})` : ''}.${split}`;
    case 'pixel_limit_exceeded':
      return `이미지가 너무 큽니다${size ? `(${size})` : ''}. 가로×세로가 4,000만 픽셀 이하가 되게 줄여 주세요.${split}`;
    case 'animated':
      return '움직이는 이미지나 여러 장이 든 파일은 올릴 수 없습니다. 한 장짜리 JPEG·PNG·WebP로 저장해 올려주세요.';
    case 'decode_failed':
      return '이미지 파일을 읽지 못했습니다. 파일이 손상됐을 수 있으니 이미지 편집 프로그램에서 다시 저장해 올려주세요.';
    case 'output_too_large':
      return `변환한 이미지가 ${Math.round(maxBytes / (1024 * 1024))}MB를 넘습니다. 해상도를 줄이거나 JPEG로 저장해 올려주세요.${split}`;
    default:
      return `이미지를 저장소로 옮기지 못했습니다. 잠시 뒤 다시 시도해주세요. 계속되면 운영 담당자에게 알려주세요(원인 코드 ${rejection.reason}).`;
  }
}

const ADMIN_ARTWORK_KINDS = new Set<AdminArtworkKind>(['ip', 'good', 'card', 'event', 'curation']);
const ADMIN_ARTWORK_EXTENSIONS: Record<AdminArtworkMimeType, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const ADMIN_ARTWORK_MIME_TYPES: readonly string[] = Object.keys(ADMIN_ARTWORK_EXTENSIONS);
const ADMIN_ARTWORK_MIME_BY_EXTENSION: Record<'jpg' | 'png' | 'webp', AdminArtworkMimeType> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V4_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ADMIN_ARTWORK_PATH_REGEX = new RegExp(
  `^catalog/(ip|good|card|event|curation)/(${UUID_V4_PATTERN})\\.(jpg|png|webp)$`,
);
export type AdminArtworkMetadataResult =
  | {
      ok: true;
      value: {
        kind: AdminArtworkKind;
        mimeType: AdminArtworkMimeType;
        size: number;
      };
    }
  | { ok: false; error: string };

/*
 * 아트워크 업로드 미리보기 영역의 비율. 이벤트 포스터는 이 영역 안에
 * 원본 전체를 표시하고, 나머지 아트워크는 영역을 채워 잘림을 미리 확인한다.
 */
export function adminArtworkAspectRatio(kind: AdminArtworkKind) {
  return kind === 'ip' || kind === 'curation' ? '16 / 9' : '4 / 3';
}

function isAdminArtworkKind(value: unknown): value is AdminArtworkKind {
  return typeof value === 'string' && ADMIN_ARTWORK_KINDS.has(value as AdminArtworkKind);
}

// `value in EXTENSIONS`는 프로토타입 체인까지 훑어 'toString' 같은 입력을 MIME으로
// 인정한다. 그러면 확장자 조회가 함수를 돌려주고 경로 템플릿이 그것을 문자열화한다.
function isAdminArtworkMimeType(value: unknown): value is AdminArtworkMimeType {
  return typeof value === 'string' && ADMIN_ARTWORK_MIME_TYPES.includes(value);
}

export function normalizeAdminArtworkMetadata(input: {
  kind: unknown;
  mimeType: unknown;
  size: unknown;
}): AdminArtworkMetadataResult {
  if (
    !isAdminArtworkKind(input.kind)
    || !isAdminArtworkMimeType(input.mimeType)
    || typeof input.size !== 'number'
    || !Number.isInteger(input.size)
    || input.size < 1
    || input.size > adminArtworkLimits(input.kind).maxBytes
  ) {
    return { ok: false, error: input.kind === 'good' ? GOODS_ARTWORK_ERROR : ADMIN_ARTWORK_ERROR };
  }

  return {
    ok: true,
    value: {
      kind: input.kind,
      mimeType: input.mimeType,
      size: input.size,
    },
  };
}

export function buildAdminArtworkPath(input: {
  kind: AdminArtworkKind;
  mimeType: AdminArtworkMimeType;
  nonce: string;
}): string {
  const nonce = input.nonce.toLowerCase();
  if (!UUID_V4_REGEX.test(nonce)) throw new Error('Invalid admin artwork nonce');

  return `catalog/${input.kind}/${nonce}.${ADMIN_ARTWORK_EXTENSIONS[input.mimeType]}`;
}

export function parseAdminArtworkPath(raw: unknown): {
  path: string;
  kind: AdminArtworkKind;
  mimeType: AdminArtworkMimeType;
} | null {
  if (typeof raw !== 'string') return null;

  const match = ADMIN_ARTWORK_PATH_REGEX.exec(raw);
  if (!match) return null;

  const kind = match[1] as AdminArtworkKind;
  const extension = match[3] as 'jpg' | 'png' | 'webp';
  return {
    path: raw,
    kind,
    mimeType: ADMIN_ARTWORK_MIME_BY_EXTENSION[extension],
  };
}

