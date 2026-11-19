'use client';

import { useActionState, useState, type ChangeEvent } from 'react';
import { recordOrderClaimCarrierLossAction } from '@/app/admin/claim-actions';
import {
  CLAIM_EVIDENCE_ACCEPT, CLAIM_EVIDENCE_MAX_FILES, CLAIM_WAIVER_REASON_MAX, CLAIM_WAIVER_REASON_MIN,
  claimEvidenceUrl, claimWaiverReasonValid, type ClaimEvidenceFile,
} from '@/lib/admin/claim-evidence';
import { uploadClaimEvidence } from '@/lib/admin/claim-evidence.client';
import { confirmAdminSubmit, type AdminConfirmRequest } from '@/lib/admin/confirm';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { useClaimPreviewBusy } from './ClaimPreviewDialog';

/* 반품의 배송 분실 기록(원장 #15 SHP-095, ADR-0018 보완 2026-11-19).
 *
 * 택배사가 분실을 확인한 배송 건은 돌아올 물건이 없으므로 회수 확인 대신 사고 번호·메모·근거 사진으로 회수를 끝낸다. 모든 출고지가
 * 입고되거나 분실로 기록되면 환불을 진행하고, 분실 상품은 판매 재고로 되돌리지 않는다. 반품 사유와 무관하게 받고(회사·택배 귀책이라
 * 반품배송비를 빼지 않는다), 발송 여부·리비전은 DB가 다시 검사한다. 작업 번호는 처음 그릴 때 정해 실패 뒤 재시도에도 같아 이중 기록이 생기지 않는다. */
/** 배송 분실 기록 확인창. 되돌릴 수 없는 결정이라 대상 출고지·사고 번호와 그 결과를 셸 확인창에서 다시 확인받는다. */
export function carrierLossConfirmRequest(originName: string, accidentNumber: string): AdminConfirmRequest {
  return {
    title: `${originName} 배송 분실로 기록할까요?`,
    message: `택배사 사고 번호 ${accidentNumber}로 ${originName} 배송 건의 분실을 기록합니다. 기록하면 되돌릴 수 없습니다. 이 출고지의 회수는 끝난 것으로 보고, 모든 출고지의 회수가 끝나면 환불을 진행합니다. 분실 상품은 판매 재고로 되돌리지 않고, 반품배송비도 빼지 않습니다.`,
    confirmLabel: '배송 분실 기록',
    destructive: true,
  };
}

export function ClaimCarrierLossDecision({ claimId, claimRevision, shipmentId, originName }: {
  claimId: string; claimRevision: number; shipmentId: string; originName: string;
}) {
  const [state, action, pending] = useActionState(recordOrderClaimCarrierLossAction, {});
  const [operationId] = useState(() => crypto.randomUUID());
  const [open, setOpen] = useState(false);
  const [accident, setAccident] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [evidence, setEvidence] = useState<ClaimEvidenceFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  useClaimPreviewBusy(pending || uploading); /* 목록 위 클레임 팝업(R8)에서 기다리는 동안 팝업이 닫히지 않게 알린다. */
  const accidentId = `claim-carrier-loss-accident-${shipmentId}`, reasonId = `claim-carrier-loss-reason-${shipmentId}`, photoId = `claim-carrier-loss-photo-${shipmentId}`;
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
  if (!open) {
    return <div className="flex flex-col gap-1.5" data-claim-carrier-loss-entry={shipmentId}>
      <Button className="w-fit" onClick={() => setOpen(true)} size="sm" type="button" variant="outline">{originName} 배송 분실로 기록</Button>
      <p className="text-xs text-muted-foreground">택배사가 분실을 확인해 물건이 돌아올 수 없을 때만 씁니다. 늦게라도 도착할 수 있으면 회수 확인을 기다립니다.</p>
    </div>;
  }
  const trimmedAccident = accident.trim();
  const ready = trimmedAccident.length >= 2 && trimmedAccident.length <= 60 && claimWaiverReasonValid(reason) && evidence.length > 0 && confirmed;
  return <form action={action} className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" data-claim-carrier-loss={shipmentId}
    onSubmit={event => { confirmAdminSubmit(event, carrierLossConfirmRequest(originName, trimmedAccident)); }}>
    <input type="hidden" name="claimId" value={claimId} />
    <input type="hidden" name="shipmentId" value={shipmentId} />
    <input type="hidden" name="claimRevision" value={claimRevision} />
    <input type="hidden" name="operationId" value={operationId} />
    {evidence.map(file => <input key={file.id} type="hidden" name="evidenceFileId" value={file.id} />)}
    <AdminNotice tone="warning" title={`${originName} 배송 분실 — 회수 없이 환불`}>
      택배사가 분실을 확인한 배송 건의 회수를 끝냅니다. 모든 출고지가 입고되거나 분실로 기록되면 환불을 진행하고(반품배송비를 빼지 않음),
      분실 상품은 판매 재고로 되돌리지 않습니다. 분실된 상품을 다시 보내려면 반품 대신 하자·오배송 교환으로 접수해 회수 없이 재출고합니다.
    </AdminNotice>
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={accidentId}>택배사 사고 번호</Label>
      <Input className="w-full sm:w-72" disabled={pending} id={accidentId} maxLength={60} name="accidentNumber" required value={accident}
        onChange={event => setAccident(event.target.value)} placeholder="예: 한진 고객센터 사고 접수 번호" />
    </div>
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={reasonId}>분실 확인 메모</Label>
      <Textarea id={reasonId} name="reason" required maxLength={CLAIM_WAIVER_REASON_MAX} rows={3} value={reason} disabled={pending}
        onChange={event => setReason(event.target.value)} placeholder="예: 11/19 한진 고객센터 회신 — 간선 하차 뒤 분실 확인, 배상 접수 완료" />
    </div>
    <p className="text-xs text-muted-foreground">메모 {CLAIM_WAIVER_REASON_MIN}~{CLAIM_WAIVER_REASON_MAX}자, 근거 사진 1~{CLAIM_EVIDENCE_MAX_FILES}장(택배사 회신·사고 접수 화면, JPG·PNG·WebP). 고객에게는 메모와 사진이 보이지 않습니다.</p>
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
      <span>택배사가 이 배송 건의 분실을 확인했고, 회수 없이 환불합니다(분실 상품은 재고로 되돌리지 않음).</span>
    </label>
    <div className="flex flex-wrap gap-2">
      <Button disabled={pending || uploading || !ready} size="sm" type="submit">배송 분실 기록</Button>
      <Button disabled={pending} onClick={() => setOpen(false)} size="sm" type="button" variant="ghost">닫기</Button>
    </div>
    {uploadError || state.error ? <p className="text-destructive" role="alert">{uploadError || state.error}</p> : null}
    {state.message ? <p className="text-muted-foreground" role="status">{state.message}</p> : null}
  </form>;
}
