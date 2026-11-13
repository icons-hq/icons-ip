'use client';

import { useActionState, useState, type ChangeEvent } from 'react';
import { waiveOrderClaimCollectionAction } from '@/app/admin/claim-actions';
import {
  CLAIM_EVIDENCE_ACCEPT, CLAIM_EVIDENCE_MAX_FILES, CLAIM_WAIVER_REASON_MAX, CLAIM_WAIVER_REASON_MIN,
  claimEvidenceUrl, claimWaiverReasonValid, type ClaimEvidenceFile,
} from '@/lib/admin/claim-evidence';
import { uploadClaimEvidence } from '@/lib/admin/claim-evidence.client';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { useClaimPreviewBusy } from './ClaimPreviewDialog';

/* 주문제작 상품이 있는 출고지의 회수 생략 결정(QNA-039·ADR-0041).
 *
 * 주문제작 상품은 교환품을 새로 만들어야 해서 재출고와 같은 요청으로 회수를 생략할 수 없다(제작이 끝나야 재출고한다).
 * 여기서 사유와 근거 사진으로 회수 생략을 먼저 기록하면 그 출고지의 교환품 제작이 열리고, 주문 상세의 주문제작 처리에서
 * 제작을 마친 뒤 회수·재배송 연락처 처리에서 회수 확인 없이 재출고한다. 사유·사진·하자 교환 여부는 DB가 다시 검사한다.
 * 사유와 확인은 제어 입력이라 실패한 제출 뒤에도 그대로 남고, 올린 사진은 숨은 id로만 보낸다(사진 본문은 다시 보내지 않는다). */
export function ClaimCollectionWaiverDecision({ claimId, shipmentId, originName }: { claimId: string; shipmentId: string; originName: string }) {
  const [state, action, pending] = useActionState(waiveOrderClaimCollectionAction, {});
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [evidence, setEvidence] = useState<ClaimEvidenceFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  useClaimPreviewBusy(pending || uploading); /* 목록 위 클레임 팝업(R8)에서 기다리는 동안 팝업이 닫히지 않게 알린다. */
  const reasonId = `claim-waiver-reason-${shipmentId}`, photoId = `claim-waiver-photo-${shipmentId}`;
  async function addEvidence(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []); event.target.value = '';
    if (!files.length || uploading) return;
    const room = CLAIM_EVIDENCE_MAX_FILES - evidence.length;
    if (room < 1) { setUploadError(`근거 사진은 ${CLAIM_EVIDENCE_MAX_FILES}장까지 올릴 수 있습니다.`); return; }
    setUploading(true); setUploadError('');
    try {
      for (const file of files.slice(0, room)) {
        const result = await uploadClaimEvidence(claimId, file);
        if (!result.ok) { setUploadError(result.error); break; }
        setEvidence(previous => previous.length >= CLAIM_EVIDENCE_MAX_FILES ? previous : [...previous, result.file]);
      }
      if (files.length > room) setUploadError(`근거 사진은 ${CLAIM_EVIDENCE_MAX_FILES}장까지 올릴 수 있어 앞의 ${room}장만 올렸습니다.`);
    } finally { setUploading(false); }
  }
  const ready = claimWaiverReasonValid(reason) && evidence.length > 0 && confirmed;
  return <form action={action} className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" data-claim-waiver-decision={shipmentId}>
    <input type="hidden" name="claimId" value={claimId} />
    <input type="hidden" name="shipmentId" value={shipmentId} />
    {evidence.map(file => <input key={file.id} type="hidden" name="evidenceFileId" value={file.id} />)}
    <AdminNotice tone="warning" title={`${originName} 회수 없이 교환품 제작 시작`}>
      주문제작 상품은 교환품을 새로 만들어 보냅니다. 회수 생략을 기록하면 이 출고지의 교환품 제작이 열리고, 제작이 끝나면 회수 확인 없이
      재출고합니다. 회수 상품 재고는 복원하지 않습니다.
    </AdminNotice>
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={reasonId}>회수 생략 사유</Label>
      <Textarea id={reasonId} name="reason" required maxLength={CLAIM_WAIVER_REASON_MAX} rows={3} value={reason} disabled={pending}
        onChange={event => setReason(event.target.value)} placeholder="예: 고객 사진으로 인쇄 불량 확인, 회수 없이 같은 디자인으로 다시 제작" />
    </div>
    <p className="text-xs text-muted-foreground">사유 {CLAIM_WAIVER_REASON_MIN}~{CLAIM_WAIVER_REASON_MAX}자, 근거 사진 1~{CLAIM_EVIDENCE_MAX_FILES}장(JPG·PNG·WebP). 고객에게는 사유와 사진이 보이지 않습니다.</p>
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={photoId}>근거 사진</Label>
      <input accept={CLAIM_EVIDENCE_ACCEPT} className="w-full" disabled={pending || uploading || evidence.length >= CLAIM_EVIDENCE_MAX_FILES} id={photoId} multiple type="file"
        onChange={event => { void addEvidence(event); }} />
    </div>
    {uploading ? <p className="text-muted-foreground" role="status">근거 사진을 올리고 있습니다.</p> : null}
    {evidence.length ? <ul className="flex flex-wrap gap-2" aria-label="올린 근거 사진">{evidence.map((file, index) => <li className="flex items-center gap-1.5" key={file.id}>
      <a className="underline underline-offset-4" href={claimEvidenceUrl(file.id)} rel="noreferrer" target="_blank">사진 {index + 1}</a>
      <Button disabled={pending} size="sm" type="button" variant="outline" onClick={() => setEvidence(previous => previous.filter(item => item.id !== file.id))}>빼기</Button>
    </li>)}</ul> : null}
    <label className="flex items-start gap-2 leading-relaxed">
      <input checked={confirmed} className="mt-1" disabled={pending} name="confirmed" type="checkbox" onChange={event => setConfirmed(event.target.checked)} />
      <span>하자·오배송이라 회수 확인 없이 교환품을 새로 만들어 보냅니다.</span>
    </label>
    <Button className="w-fit" disabled={pending || uploading || !ready} size="sm" type="submit">회수 없이 제작 시작</Button>
    {uploadError || state.error ? <p className="text-destructive" role="alert">{uploadError || state.error}</p> : null}
    {state.message ? <p className="text-muted-foreground" role="status">{state.message}</p> : null}
  </form>;
}
