import 'server-only';

import {
  ADMIN_ARTWORK_BLOCK_MESSAGES,
  normalizeAdminArtworkMetadata,
  parseAdminArtworkPath,
  type AdminArtworkKind,
} from './artwork';
import { verifyAndPromoteAdminArtwork } from './artwork.server';
import { canAccessAdminScreen, hasAdminCapability, type AdminCapability } from './access';
import { GOODS_PHOTOS_PATH, goodsPhotoNameFromFileName, validGoodsPhotoInput } from './goods-photo-library';
import { adminScreenForPath } from './navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

export const ADMIN_PERMISSION_ERROR = '관리자 권한이 필요합니다.';
export const ADMIN_ARTWORK_ACTOR_CHANGED_ERROR =
  '로그인 계정이 변경되었습니다. 현재 계정에서 다시 시도해주세요.';
export const ADMIN_ARTWORK_VERIFY_ERROR =
  '이미지 파일을 확인하지 못했습니다. 다시 업로드해주세요.';
export const GOODS_PHOTO_AUTO_REGISTER_ERROR =
  '사진 보관함에는 등록하지 못했습니다. 상품 이미지는 그대로 저장할 수 있습니다.';
/** 파일 이름 원문 상한. 보관함 이름은 goodsPhotoNameFromFileName이 100자로 자른다. */
const LIBRARY_NAME_INPUT_MAX = 1024;

export function adminArtworkCapability(kind: AdminArtworkKind): AdminCapability {
  return kind === 'good' ? 'catalog.manage' : kind === 'curation' ? 'store.manage' : 'platform.manage';
}

export interface VerifyAdminArtworkUploadRequest {
  kind: unknown;
  mimeType: unknown;
  path: unknown;
  size: unknown;
  /** Optional for existing callers; bound workflows must keep the starting actor. */
  expectedActorId?: unknown;
  /** 상품 이미지 타일 업로드만 보낸다. 확인을 마친 사진을 사진 보관함에도 등록한다(R20). */
  library?: unknown;
}

export type GoodsPhotoRegistration = { ok: true; id: string } | { ok: false; error: string };

export type VerifyAdminArtworkUploadOutcome =
  | { ok: true; imagePath: string; library?: GoodsPhotoRegistration }
  | { ok: false; error: string; status: 400 | 403 | 409 | 422 | 429 | 503 }
  | { ok: false; signedOut: true };

function parseLibraryRequest(value: unknown): { name: string } | null | 'invalid' {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid';
  const { name } = value as { name?: unknown };
  if (Object.keys(value).some(key => key !== 'name') || typeof name !== 'string' || name.length > LIBRARY_NAME_INPUT_MAX) return 'invalid';
  return { name };
}

/*
 * 사진 보관함 등록은 확인을 마친 업로드의 부가 단계다. 실패해도 업로드(상품 이미지)는 성공으로 둔다.
 * 사진 ID는 업로드 경로의 UUID라 같은 업로드를 다시 등록해도 행이 늘지 않는다(admin_save_goods_photo의
 * 같은 작성자·같은 이름 재요청은 기존 행을 돌려준다. image_path도 표에서 유일하다).
 * 권한은 사진 보관함의 저장과 같다(saveGoodsPhotoAction의 requireAdminActionAccess, DB catalog.manage).
 */
async function registerVerifiedGoodsPhoto(
  auth: Awaited<ReturnType<typeof getCurrentAdminAuthState>>,
  imagePath: string,
  fileName: string,
): Promise<GoodsPhotoRegistration> {
  const failed = { ok: false as const, error: GOODS_PHOTO_AUTO_REGISTER_ERROR };
  if (!auth.isStaff || !canAccessAdminScreen(auth, adminScreenForPath(GOODS_PHOTOS_PATH), { intent: 'write' })) return failed;
  const objectPath = imagePath.slice('public-media/'.length);
  const parsed = parseAdminArtworkPath(objectPath);
  if (!imagePath.startsWith('public-media/') || parsed?.kind !== 'good') return failed;
  const id = objectPath.slice('catalog/good/'.length, objectPath.lastIndexOf('.'));
  const photo = { id, name: goodsPhotoNameFromFileName(fileName), imagePath, revision: 0, archived: false };
  if (!validGoodsPhotoInput(photo)) return failed;
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_goods_photo', {
      p_id: photo.id,
      p_image_path: photo.imagePath,
      p_name: photo.name,
      p_expected_revision: 0,
      p_archived: false,
    });
    if (error || !data || data.id !== photo.id || !Number.isSafeInteger(data.revision) || data.revision < 1) return failed;
    return { ok: true, id: photo.id };
  } catch {
    return failed;
  }
}

/**
 * 업로드 확인(스테이징 → 공개 승격)의 서버 판정. 서버 액션과 Route Handler(/api/admin/artwork/verify)가
 * 같은 순서로 입력 검증 → 계정 고정 → 로그인 → 권한 → 승격을 한다. 로그인 이동은 호출자가 정한다.
 */
export async function verifyAdminArtworkUploadRequest(
  input: VerifyAdminArtworkUploadRequest,
): Promise<VerifyAdminArtworkUploadOutcome> {
  const metadata = normalizeAdminArtworkMetadata(input);
  const parsedPath = parseAdminArtworkPath(input.path);
  const library = parseLibraryRequest(input.library);
  if (
    !metadata.ok
    || !parsedPath
    || parsedPath.kind !== metadata.value.kind
    || parsedPath.mimeType !== metadata.value.mimeType
    || library === 'invalid'
    || (library && metadata.value.kind !== 'good')
  ) {
    return { ok: false, error: ADMIN_ARTWORK_VERIFY_ERROR, status: 400 };
  }

  let auth: Awaited<ReturnType<typeof getCurrentAdminAuthState>>;
  try {
    auth = await getCurrentAdminAuthState();
  } catch {
    return { ok: false, error: ADMIN_ARTWORK_VERIFY_ERROR, status: 503 };
  }

  if (input.expectedActorId !== undefined && input.expectedActorId !== auth.user?.id) {
    return { ok: false, error: ADMIN_ARTWORK_ACTOR_CHANGED_ERROR, status: 409 };
  }
  if (!auth.user) return { ok: false, signedOut: true };
  if (!auth.isStaff || !hasAdminCapability(auth, adminArtworkCapability(metadata.value.kind))) {
    return { ok: false, error: ADMIN_PERMISSION_ERROR, status: 403 };
  }

  let result: Awaited<ReturnType<typeof verifyAndPromoteAdminArtwork>>;
  try {
    result = await verifyAndPromoteAdminArtwork({
      actorId: auth.user.id,
      kind: metadata.value.kind,
      mimeType: metadata.value.mimeType,
      path: parsedPath.path,
      size: metadata.value.size,
    });
  } catch {
    return { ok: false, error: ADMIN_ARTWORK_VERIFY_ERROR, status: 422 };
  }
  if (!result) return { ok: false, error: ADMIN_ARTWORK_VERIFY_ERROR, status: 422 };
  if ('blockedReason' in result) {
    return { ok: false, error: ADMIN_ARTWORK_BLOCK_MESSAGES[result.blockedReason], status: 429 };
  }
  if (!library) return { ok: true, imagePath: result.imagePath };
  return { ok: true, imagePath: result.imagePath, library: await registerVerifiedGoodsPhoto(auth, result.imagePath, library.name) };
}
