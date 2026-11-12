'use server';

import { unstable_rethrow } from 'next/navigation';
import { hasAdminCapability } from '@/lib/admin/access';
import {
  CLAIM_EVIDENCE_BUCKET,
  CLAIM_EVIDENCE_EXTENSIONS,
  CLAIM_EVIDENCE_MAX_BYTES,
  isClaimEvidenceMimeType,
  type ClaimEvidenceFile,
} from '@/lib/admin/claim-evidence';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { inspectInquiryFile } from '@/lib/inquiry-file-inspection.server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { isUuid } from '@/lib/uuid';

/* 회수 생략 근거 사진 올리기(TKT-166·QNA-039, ADR-0041).
 *
 * 1) 운영자 권한(sales.manage)을 확인한다. 2) 사진을 끝까지 디코딩해 형식을 검사하고 해시를 낸다.
 * 3) service 클라이언트로 비공개 버킷의 `<claimId>/<fileId>.<ext>`에 넣는다(덮어쓰지 않는다).
 * 4) 같은 운영자 세션으로 등록 RPC를 불러 DB가 권한·클레임·저장 객체 크기·형식을 다시 대조한다.
 * 같은 fileId로 다시 보내면 이미 있는 객체를 그대로 등록해 같은 결과를 돌려준다. 실패한 등록 뒤 남은
 * 객체는 원장에 없으므로 근거로 쓰이지 않는다. */

export type ClaimEvidenceUploadResult = { ok: true; file: ClaimEvidenceFile } | { ok: false; error: string };

const UPLOAD_FAILED = '사진을 올리지 못했습니다. 다시 시도해주세요.';

function registrationError(message: string | undefined) {
  const value = (message ?? '').toLowerCase();
  if (value.includes('claim_evidence_limit')) return '이 교환에는 근거 사진을 20장까지 올릴 수 있습니다.';
  if (value.includes('claim_evidence_unavailable')) return '교환 요청에만 근거 사진을 올릴 수 있습니다.';
  if (value.includes('claim_evidence_conflict')) return '같은 사진 번호로 다른 파일이 이미 등록됐습니다. 사진을 다시 골라주세요.';
  if (value.includes('claim_evidence_unverified')) return '저장한 사진을 확인하지 못했습니다. 다시 시도해주세요.';
  if (value.includes('claim_not_found')) return '교환 요청을 찾을 수 없습니다.';
  if (value.includes('operator_capability_required') || value.includes('staff required')) return '교환 처리 권한이 필요합니다.';
  return UPLOAD_FAILED;
}

export async function uploadClaimEvidenceAction(formData: FormData): Promise<ClaimEvidenceUploadResult> {
  try {
    const auth = await getCurrentAdminAuthState();
    if (!auth.isConfigured || !auth.user || !auth.isStaff || !hasAdminCapability(auth, 'sales.manage')) {
      return { ok: false, error: '교환 처리 권한이 필요합니다.' };
    }
    const claimId = formData.get('claimId'), fileId = formData.get('fileId'), file = formData.get('file');
    if (!isUuid(claimId) || !isUuid(fileId) || !(file instanceof File) || !isClaimEvidenceMimeType(file.type)
      || file.size < 1 || file.size > CLAIM_EVIDENCE_MAX_BYTES) {
      return { ok: false, error: 'JPG·PNG·WebP 사진을 골라주세요. 큰 사진은 줄여서 올립니다.' };
    }
    const mimeType = file.type;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = await inspectInquiryFile(bytes, mimeType);
    if (!sha256) return { ok: false, error: '사진 파일을 읽지 못했습니다. 다른 사진을 골라주세요.' };
    const path = `${claimId.toLowerCase()}/${fileId.toLowerCase()}.${CLAIM_EVIDENCE_EXTENSIONS[mimeType]}`;
    const uploaded = await createServiceClient().storage.from(CLAIM_EVIDENCE_BUCKET).upload(path, bytes, { contentType: mimeType, upsert: false });
    /* 이미 있는 객체는 같은 fileId의 재시도다. 크기·형식이 같은지는 등록 RPC가 대조한다. */
    if (uploaded.error && !/exist|duplicate/i.test(uploaded.error.message)) return { ok: false, error: UPLOAD_FAILED };
    const { data, error } = await (await createClient()).rpc('admin_register_claim_evidence_file', {
      p_claim_id: claimId.toLowerCase(), p_file_id: fileId.toLowerCase(), p_mime_type: mimeType, p_size_bytes: bytes.byteLength, p_sha256: sha256,
    });
    if (error) return { ok: false, error: registrationError(error.message) };
    if (typeof data !== 'object' || data === null || (data as { id?: unknown }).id !== fileId.toLowerCase()) return { ok: false, error: UPLOAD_FAILED };
    return { ok: true, file: { id: fileId.toLowerCase(), mimeType, size: bytes.byteLength } };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '사진 업로드 결과를 확인하지 못했습니다. 같은 사진으로 다시 시도해주세요.' };
  }
}
