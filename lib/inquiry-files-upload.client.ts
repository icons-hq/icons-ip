'use client';
import { prepareInquiryFileAction, verifyInquiryFileAction } from '@/app/admin/inquiry-file-actions';
import { createClient } from '@/lib/supabase/client';
import { INQUIRY_FILES_BUCKET, inquiryFileFromUpload } from './inquiry-files';
import type { InquiryFileResult } from './inquiry-files.server';
export async function uploadInquiryFile(file: File, id: string, library: boolean): Promise<InquiryFileResult> {
  const value = inquiryFileFromUpload(file, id);
  if (!value) return { ok: false, error: '지원하는 형식의 20MB 이하 파일을 선택해주세요.' };
  try {
    const grant = await prepareInquiryFileAction(value, library);
    if (!grant.ok) return grant;
    if (!grant.verified) {
      // Immutable upload; retry verification even after an unknown upload receipt.
      await createClient().storage.from(INQUIRY_FILES_BUCKET).upload(grant.path, file, { contentType: value.mimeType, upsert: false });
    }
    return await verifyInquiryFileAction(id);
  } catch { return { ok: false, uncertain: true, error: '파일 업로드 결과를 확인하지 못했습니다. 같은 파일로 다시 시도해주세요.' }; }
}
