'use client';

import {
  cancelAdminArtworkUploadAction,
  prepareAdminArtworkUploadAction,
  verifyAdminArtworkUploadAction,
} from '@/app/admin/artwork-actions';
import type { AdminArtworkKind } from './artwork';
import { createClient } from '@/lib/supabase/client';

export type AdminArtworkUploadResult =
  | { ok: true; imagePath: string }
  | { ok: false; error: string };

const STAGING_BUCKET = 'admin-artwork-staging';
const ADMIN_ARTWORK_UPLOAD_ERROR =
  '이미지를 업로드하지 못했습니다. 다시 시도해주세요.';

async function cancelPreparedUpload(path: string) {
  try {
    await cancelAdminArtworkUploadAction({ path });
  } catch {
    // Cleanup is best-effort; the scheduled cleanup will retry durable claims.
  }
}

export async function uploadAdminArtwork(input: {
  kind: AdminArtworkKind;
  file: File;
}): Promise<AdminArtworkUploadResult> {
  let preparedPath: string | null = null;
  try {
    const grant = await prepareAdminArtworkUploadAction({
      kind: input.kind,
      mimeType: input.file.type,
      size: input.file.size,
    });
    if (!grant.ok) return grant;
    preparedPath = grant.path;

    const supabase = createClient();
    const { error } = await supabase.storage
      .from(STAGING_BUCKET)
      .upload(grant.path, input.file, {
        contentType: input.file.type,
        upsert: false,
      });

    if (error) {
      await cancelPreparedUpload(grant.path);
      return { ok: false, error: ADMIN_ARTWORK_UPLOAD_ERROR };
    }

    const result = await verifyAdminArtworkUploadAction({
      kind: input.kind,
      mimeType: input.file.type,
      path: grant.path,
      size: input.file.size,
    });
    if (!result.ok) await cancelPreparedUpload(grant.path);
    return result;
  } catch {
    if (preparedPath) await cancelPreparedUpload(preparedPath);
    return { ok: false, error: ADMIN_ARTWORK_UPLOAD_ERROR };
  }
}
