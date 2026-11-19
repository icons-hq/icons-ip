'use client';

import {
  cancelAdminArtworkUploadAction,
  prepareAdminArtworkUploadAction,
} from '@/app/admin/artwork-actions';
import {
  ADMIN_ARTWORK_NOT_IMAGE_ERROR,
  ADMIN_ARTWORK_SIGNATURE_BYTES,
  detectAdminArtworkMimeType,
  type AdminArtworkKind,
  type AdminArtworkMimeType,
} from './artwork';
import { createClient } from '@/lib/supabase/client';

/** 사진 보관함 자동 등록 결과. 실패해도 업로드(상품 이미지)는 성공이다. */
export type AdminArtworkLibraryResult = { ok: true; id: string } | { ok: false; error: string };
export type AdminArtworkUploadResult =
  | { ok: true; imagePath: string; library?: AdminArtworkLibraryResult }
  | { ok: false; error: string };

const STAGING_BUCKET = 'admin-artwork-staging';
export const ADMIN_ARTWORK_VERIFY_ENDPOINT = '/api/admin/artwork/verify';
const ADMIN_ARTWORK_UPLOAD_ERROR =
  '이미지를 업로드하지 못했습니다. 다시 시도해주세요.';
/** 응답 없는 확인 하나가 이 탭의 다음 확인을 영원히 막지 않게 한다. */
const VERIFY_TIMEOUT_MS = 120_000;

/*
 * DB는 운영자별로 한 번에 한 장만 확인한다(service_begin_admin_artwork_verification). 확인은 서버 액션 대기열
 * 밖(Route Handler)으로 보내므로, 여러 업로드 칸(상품 이미지·상세 이미지·사진 보관함)이 동시에 확인을 보내도
 * 서로 막지 않도록 이 탭의 확인 요청을 차례로 보낸다. 준비·스테이징 업로드는 기다리지 않는다.
 */
let verificationQueue: Promise<unknown> = Promise.resolve();
function enqueueVerification<T>(task: () => Promise<T>): Promise<T> {
  const run = verificationQueue.then(task, task);
  verificationQueue = run.catch(() => undefined);
  return run;
}

async function cancelPreparedUpload(path: string) {
  try {
    await cancelAdminArtworkUploadAction({ path });
  } catch {
    // Cleanup is best-effort; the scheduled cleanup will retry durable claims.
  }
}

function parseLibraryResult(value: unknown): AdminArtworkLibraryResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result = value as { ok?: unknown; id?: unknown; error?: unknown };
  if (result.ok === true && typeof result.id === 'string') return { ok: true, id: result.id };
  if (result.ok === false && typeof result.error === 'string') return { ok: false, error: result.error };
  return undefined;
}

async function requestVerification(body: Record<string, unknown>, expectedImagePath: string): Promise<AdminArtworkUploadResult> {
  const response = await fetch(ADMIN_ARTWORK_VERIFY_ENDPOINT, {
    body: JSON.stringify(body),
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    ...(typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? { signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) }
      : {}),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!result || typeof result !== 'object') return { ok: false, error: ADMIN_ARTWORK_UPLOAD_ERROR };
  const { ok, imagePath, error, library } = result as { ok?: unknown; imagePath?: unknown; error?: unknown; library?: unknown };
  // 서버가 돌려준 공개 경로는 이 업로드가 준비한 경로여야 한다.
  if (ok === true && response.ok && imagePath === expectedImagePath) {
    const registration = parseLibraryResult(library);
    return registration ? { ok: true, imagePath, library: registration } : { ok: true, imagePath };
  }
  return { ok: false, error: ok === false && typeof error === 'string' ? error : ADMIN_ARTWORK_UPLOAD_ERROR };
}

/**
 * 파일 내용(매직 바이트)으로 정한 형식. 확장자가 형식과 다른 파일(PNG를 .jpg로 저장한 상세 이미지)을 브라우저가
 * File.type으로 잘못 신고하면 서버 검증이 형식 불일치로 거절한다(2026-11-19). 읽지 못하면 null이다.
 */
export async function resolveAdminArtworkMimeType(file: Blob): Promise<AdminArtworkMimeType | null> {
  try {
    const head = new Uint8Array(await file.slice(0, ADMIN_ARTWORK_SIGNATURE_BYTES).arrayBuffer());
    return detectAdminArtworkMimeType(head);
  } catch {
    return null;
  }
}

export async function uploadAdminArtwork(input: {
  kind: AdminArtworkKind;
  file: File;
  expectedActorId?: string;
  /** 상품 이미지 타일 업로드. 확인을 마치면 사진 보관함에도 이 이름으로 등록한다. */
  library?: { name: string };
}): Promise<AdminArtworkUploadResult> {
  const { kind, file, expectedActorId, library } = input;
  const actorBinding = expectedActorId === undefined ? {} : { expectedActorId };
  let preparedPath: string | null = null;
  try {
    const mimeType = await resolveAdminArtworkMimeType(file);
    if (!mimeType) return { ok: false, error: ADMIN_ARTWORK_NOT_IMAGE_ERROR };
    const grant = await prepareAdminArtworkUploadAction({
      kind,
      mimeType,
      size: file.size,
      ...actorBinding,
    });
    if (!grant.ok) return grant;
    preparedPath = grant.path;

    const supabase = createClient();
    // supabase-js는 Blob 본문의 저장 형식을 contentType 옵션이 아니라 Blob 자체의 type으로 정한다. 확장자에서 온 File.type이
    // 판별한 형식과 다르면 같은 바이트를 판별한 형식으로 다시 지정해 올린다(복사하지 않는다). 아니면 확인 단계가 저장소 형식
    // 불일치(staging_metadata_mismatch)로 거절한다.
    const body = file.type === mimeType ? file : new File([file], file.name, { type: mimeType });
    const { error } = await supabase.storage
      .from(STAGING_BUCKET)
      .upload(grant.path, body, {
        contentType: mimeType,
        upsert: false,
      });

    if (error) {
      await cancelPreparedUpload(grant.path);
      return { ok: false, error: ADMIN_ARTWORK_UPLOAD_ERROR };
    }

    const result = await enqueueVerification(() => requestVerification({
      kind,
      mimeType,
      path: grant.path,
      size: file.size,
      ...actorBinding,
      ...(library ? { library: { name: library.name } } : {}),
    }, `public-media/${grant.path}`));
    if (!result.ok) await cancelPreparedUpload(grant.path);
    return result;
  } catch {
    if (preparedPath) await cancelPreparedUpload(preparedPath);
    return { ok: false, error: ADMIN_ARTWORK_UPLOAD_ERROR };
  }
}
