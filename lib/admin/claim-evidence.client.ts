'use client';

import { uploadClaimEvidenceAction, type ClaimEvidenceUploadResult } from '@/app/admin/claim-evidence-actions';
import { CLAIM_EVIDENCE_MAX_BYTES, isClaimEvidenceMimeType } from './claim-evidence';

/* 큰 사진(휴대폰 원본)은 서버 액션 본문 한도를 넘으므로 브라우저에서 긴 변 기준으로 줄여 JPEG로 보낸다.
   줄이는 동안 사진 위치 정보(EXIF)도 빠진다. 디코딩할 수 없는 형식은 올리지 않는다. */
const EDGES = [2400, 1800, 1200] as const;

async function downscale(file: File): Promise<File | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { return null; }
  try {
    for (const edge of EDGES) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (blob && blob.size > 0 && blob.size <= CLAIM_EVIDENCE_MAX_BYTES) return new File([blob], 'claim-evidence.jpg', { type: 'image/jpeg' });
    }
    return null;
  } finally {
    bitmap.close();
  }
}

/** 근거 사진 한 장을 올린다. 같은 사진을 다시 고르면 새 번호로 다시 올린다(이전 번호는 쓰이지 않는다). */
export async function uploadClaimEvidence(claimId: string, file: File): Promise<ClaimEvidenceUploadResult> {
  const prepared = isClaimEvidenceMimeType(file.type) && file.size <= CLAIM_EVIDENCE_MAX_BYTES ? file : await downscale(file);
  if (!prepared) return { ok: false, error: '사진을 읽지 못했습니다. JPG·PNG·WebP 사진을 골라주세요.' };
  const form = new FormData();
  form.set('claimId', claimId);
  form.set('fileId', crypto.randomUUID());
  form.set('file', prepared);
  try { return await uploadClaimEvidenceAction(form); }
  catch { return { ok: false, error: '사진 업로드 결과를 확인하지 못했습니다. 다시 시도해주세요.' }; }
}
