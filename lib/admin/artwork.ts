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
 * 남용 억제 창(20261007160000)과 같은 값이다 — 굿즈 폼 11칸(대표 1 + 추가 이미지 9 + 상세 1) × 2.
 */
export const ADMIN_ARTWORK_VERIFICATIONS_PER_MINUTE = 22;
export const ADMIN_ARTWORK_ERROR =
  '이미지는 JPEG, PNG, WebP 형식의 5MB 이하, 가로·세로 8192px 이하 파일만 업로드할 수 있습니다.';
export const GOODS_ARTWORK_ERROR =
  '이미지는 JPEG, PNG, WebP 형식의 20MB 이하, 가로·세로 30,000px 이하 파일만 업로드할 수 있습니다.';

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

