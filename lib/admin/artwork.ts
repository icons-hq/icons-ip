export type AdminArtworkKind = 'ip' | 'good' | 'card' | 'event' | 'curation';
export type AdminArtworkMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export const ADMIN_ARTWORK_ACCEPT = 'image/jpeg,image/png,image/webp';
export const ADMIN_ARTWORK_MAX_BYTES = 5 * 1024 * 1024;
export const ADMIN_ARTWORK_MAX_DIMENSION = 8192;
export const ADMIN_ARTWORK_ERROR =
  '이미지는 JPEG, PNG, WebP 형식의 5MB 이하, 가로·세로 8192px 이하 파일만 업로드할 수 있습니다.';

const ADMIN_ARTWORK_KINDS = new Set<AdminArtworkKind>(['ip', 'good', 'card', 'event', 'curation']);
const ADMIN_ARTWORK_EXTENSIONS: Record<AdminArtworkMimeType, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
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

function isAdminArtworkKind(value: unknown): value is AdminArtworkKind {
  return typeof value === 'string' && ADMIN_ARTWORK_KINDS.has(value as AdminArtworkKind);
}

function isAdminArtworkMimeType(value: unknown): value is AdminArtworkMimeType {
  return typeof value === 'string' && value in ADMIN_ARTWORK_EXTENSIONS;
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
    || input.size > ADMIN_ARTWORK_MAX_BYTES
  ) {
    return { ok: false, error: ADMIN_ARTWORK_ERROR };
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

