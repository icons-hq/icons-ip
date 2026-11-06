'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClaimContactSession, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { changeShipmentPackAction, readShipmentPacksAction } from '@/app/admin/shipment-pack-actions';
import type { ShipmentPackDocument } from '@/lib/admin/shipment-packs';
import { orderReferenceLabel } from '@/lib/orders';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
/* 합포장 관리 카드(템플릿 룩, ADR-0028). */
type Props = { actorId: string; ids: string[]; onClose: () => void };
type Request = { kind: 'create' | 'release'; version: string; reason: string; operationId: string };
export function ShipmentPackPanel(props: Props) {
 return <ClaimContactSession actorId={props.actorId}>{(identity, scope) => <Panel {...props} key={identity.sessionId} identity={identity} scope={scope} />}</ClaimContactSession>;
}
function Panel({ ids, onClose, identity, scope }: Props & { identity: ClaimContactIdentity; scope: ClaimContactScope }) {
 const router = useRouter(); const [document, setDocument] = useState<ShipmentPackDocument | null>(null);
 const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
 const alive = useRef(true), busy = useRef(false), dispatched = useRef<Request | null>(null);
 useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
 const packs = new Map(document?.rows.flatMap(row => row.pack ? [[row.pack.id, row.pack] as const] : []) ?? []);
 const releasable = packs.size === 1 && document?.rows.every(row => row.pack?.canRelease);
 async function read() {
  if (busy.current) return; const ticket = scope.capture(); if (!ticket) return;
  busy.current = true; setPending(true); setError('');
  try { const result = await readShipmentPacksAction(ids, identity); if (!alive.current || !scope.canApply(ticket)) return;
   if ('error' in result) setError(result.error ?? '합포장 정보를 읽지 못했습니다.'); else setDocument(result.document);
  } catch { if (alive.current && scope.canApply(ticket)) setError('합포장 정보를 읽지 못했습니다. 다시 확인해주세요.'); }
  finally { busy.current = false; if (alive.current) setPending(false); }
 }
 async function save(kind: Request['kind']) {
  if (busy.current || !document || !confirmed || reason.trim().length < 2) return;
  const ticket = scope.capture(); if (!ticket) return;
  const request = dispatched.current ?? { kind, version: document.version, reason: reason.trim(), operationId: crypto.randomUUID() };
  dispatched.current = request; busy.current = true; setPending(true); setError(''); setMessage('');
  try { const result = await changeShipmentPackAction(ids, request.kind, request.version, request.reason, request.operationId, identity);
   if (!alive.current || !scope.canApply(ticket)) return;
   if ('error' in result) { setError(result.error ?? '저장 결과를 확인하지 못했습니다.'); setUncertain(uncertain || Boolean(result.uncertain)); if (!uncertain && !result.uncertain) dispatched.current = null; }
   else { setDocument(result.document); setUncertain(false); dispatched.current = null; setReason(''); setConfirmed(false); setMessage(request.kind === 'create' ? '합포장을 저장했습니다. 출고지시에는 묶음의 모든 배송 건을 선택해주세요.' : '출고 전 합포장을 해제했습니다.'); router.refresh(); }
  } catch { if (alive.current && scope.canApply(ticket)) { setUncertain(true); setError('저장 결과를 확인하지 못했습니다. 같은 요청으로 결과를 확인해주세요.'); } }
  finally { busy.current = false; if (alive.current) setPending(false); }
 }
 return <section className="flex min-w-0 flex-col items-start gap-3 rounded-xl border bg-card p-4 text-sm leading-relaxed text-card-foreground sm:p-5" aria-label="합포장 관리">
  <div className="flex w-full items-center justify-between gap-3"><h3 className="text-base font-medium text-foreground">합포장 관리</h3><Button type="button" size="sm" variant="outline" disabled={pending || uncertain} onClick={onClose}>닫기</Button></div>
  <p className="text-muted-foreground">동일 구매자·수취인·전체 주소·출고지의 발송 대기 건을 함께 포장합니다. 선물 포장과 착불 수금 조건도 같아야 합니다. 기존 주문 금액·배송비·착불 금액은 유지합니다.</p>
  <p className="text-muted-foreground">창고에는 원본 출고 파일과 합포장 안내를 함께 전달해주세요. 택배사와 송장을 등록하면 묶음 전체에 적용됩니다.</p>
  <Button type="button" variant="outline" disabled={pending || uncertain} onClick={() => { void read(); }}>{document ? '최신 합포장 정보 확인' : '선택 건 합포장 조건 확인'}</Button>
  {document ? <>
   <ul className="grid w-full gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))]">{document.rows.map(row => <li className="rounded-lg border p-3 wrap-anywhere" key={row.id}><strong className="font-medium">주문 {orderReferenceLabel(row.orderId, row.orderNumber)}</strong> · 배송 {row.shipmentNumber ?? row.id.slice(-8).toUpperCase()}<br />
    {row.buyerName} → {row.recipientName ?? '수취인 미기록'} · {row.originName}<br /><span className="tabular-nums">선결제 배송비 {row.shippingFee.toLocaleString('ko-KR')}원 · 착불 {row.collectFee.toLocaleString('ko-KR')}원</span>
    {row.pack ? <p className="mt-1 text-muted-foreground">합포장 {row.pack.id.slice(-8).toUpperCase()} · {row.pack.count}건 · 묶음 착불 합계 {row.pack.collectFee.toLocaleString('ko-KR')}원</p> : null}</li>)}</ul>
   {!document.canCreate && !releasable ? <p className="rounded-lg border bg-muted/40 px-3 py-2.5">현재 선택은 새 합포장 또는 해제가 불가능합니다. 출고지시 전달 전인지, 같은 배송 조건인지 확인해주세요.</p> : null}
   {document.canCreate || releasable || uncertain ? <form className="flex w-full flex-col items-start gap-3" onSubmit={event => { event.preventDefault(); void save(dispatched.current?.kind ?? (document.canCreate ? 'create' : 'release')); }}>
    <fieldset className="m-0 flex w-full min-w-0 flex-col gap-3 rounded-lg border p-3.5" disabled={pending || uncertain}><legend className="float-left w-full p-0 font-medium">{document.canCreate ? '합포장 생성' : '합포장 해제'}</legend>
     <label className="flex min-w-0 flex-col gap-1.5"><span className="font-medium">처리 사유</span><Input value={reason} onChange={event => setReason(event.target.value)} required minLength={2} maxLength={500} placeholder="포장 확인 또는 해제 사유. 개인정보는 입력하지 마세요." /></label>
     <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required /><span>출고 전 포장 조건과 기존 배송비 유지를 확인했습니다.</span></label>
    </fieldset>
    <Button type="submit" disabled={pending || !confirmed || reason.trim().length < 2}>{uncertain ? '같은 요청으로 저장 결과 확인' : document.canCreate ? '합포장 저장' : '합포장 해제'}</Button>
   </form> : null}
  </> : null}
  {pending ? <p className="text-muted-foreground" role="status">합포장 정보를 처리하고 있습니다.</p> : null}{error ? <p className="text-destructive" role="alert">{error}</p> : null}{message ? <p className="text-[var(--wc-success)]" role="status">{message}</p> : null}
 </section>;
}
