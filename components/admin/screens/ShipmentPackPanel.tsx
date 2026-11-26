'use client';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClaimContactSession, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { changeShipmentPackAction, readShipmentPacksAction } from '@/app/admin/shipment-pack-actions';
import type { ShipmentPackDocument, ShipmentPackRow } from '@/lib/admin/shipment-packs';
import { SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import { commerceReferenceLabel } from '@/lib/commerce-number';
import { orderReferenceLabel } from '@/lib/orders';
import { krw } from '@/lib/format';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
/*
 * 합포장 관리 카드(템플릿 룩, ADR-0028).
 * 열면 바로 고른 배송 건의 조건을 읽는다 — [조건 확인]을 먼저 눌러야 하던 단계를 없앴다(화면 규칙 '글보다 화면' 2).
 * 묶거나 풀 수 없으면 어느 배송 건이 왜 안 되는지 그 줄에 적는다(규칙 5). 합포장은 내부 번호 대신 '합포장 N건'으로 부른다(규칙 8).
 * "확인했습니다" 체크는 서버로 가지 않던 화면 전용 브레이크라 없앴다. 이유 글은 저장 함수(admin_change_shipment_pack)가 2자 이상을 요구해 남긴다.
 */
type Props = { actorId: string; ids: string[]; onClose: () => void };
type Request = { kind: 'create' | 'release'; version: string; reason: string; operationId: string };
/** 조건을 읽은 결과. 읽지 못했으면 이유를 담는다. */
type Loaded = { document: ShipmentPackDocument } | { error: string };
const READ_FAILED = '합포장 정보를 불러오지 못했습니다. [다시 불러오기]를 눌러주세요.';

/**
 * 새로 묶을 수 없는 이유를 배송 건마다 찾는다(조회가 돌려준 값으로만 — 서버 판정과 같은 조건이다).
 * 줄마다 걸리는 것이 없는데도 묶을 수 없으면 구매자·수령인·주소·출고지나 선물 포장·착불 조건이 서로 다른 것이다.
 */
export function shipmentPackCreateBlockers(document: ShipmentPackDocument): { rows: Record<string, string>; general: string | null } {
  const rows: Record<string, string> = {};
  for (const row of document.rows) {
    const reason = row.pack ? '이미 합포장에 묶여 있습니다.'
      : row.status !== 'ready' ? '이미 발송한 배송 건입니다.'
      : row.exportedAt ? '출고지시를 이미 보냈습니다.'
      : !row.ready ? '지금은 묶을 수 없습니다. 발주확인 전이거나 취소 요청·출고 보류·예약 입고 확인 전·택배 외 배송 건인지 확인해주세요.'
      : null;
    if (reason) rows[row.id] = reason;
  }
  if (Object.keys(rows).length) return { rows, general: null };
  if (document.rows.length < 2) return { rows, general: '합포장은 배송 건을 2건 이상 골라야 만들 수 있습니다.' };
  const differs = (pick: (row: ShipmentPackRow) => string | null) => new Set(document.rows.map(pick)).size > 1;
  const different = [differs(row => row.buyerName) ? '구매자' : '', differs(row => row.recipientName) ? '수령인' : '', differs(row => row.originName) ? '출고지' : ''].filter(Boolean);
  return { rows, general: different.length ? `${different.join('·')} 정보가 서로 달라 함께 포장할 수 없습니다.` : '주소나 선물 포장·착불 조건이 서로 달라 함께 포장할 수 없습니다.' };
}

export function ShipmentPackPanel(props: Props) {
 return <ClaimContactSession actorId={props.actorId}>{(identity, scope) => <Panel {...props} key={identity.sessionId} identity={identity} scope={scope} />}</ClaimContactSession>;
}
function Panel({ ids, onClose, identity, scope }: Props & { identity: ClaimContactIdentity; scope: ClaimContactScope }) {
 const router = useRouter(); const [document, setDocument] = useState<ShipmentPackDocument | null>(null);
 /* 열자마자 읽으므로 처음부터 처리 중이다. */
 const [reason, setReason] = useState(''), [pending, setPending] = useState(true), [uncertain, setUncertain] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
 const alive = useRef(true), busy = useRef(false), dispatched = useRef<Request | null>(null);
 useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
 /* 고른 배송 건의 합포장 조건을 읽는다. 읽는 동안 로그인이 바뀌었으면 결과를 쓰지 않는다. */
 function load(): Promise<Loaded | null> {
  const ticket = scope.capture(); if (!ticket) return Promise.resolve({ error: READ_FAILED });
  return readShipmentPacksAction(ids, identity).then(
   (result): Loaded | null => !scope.canApply(ticket) ? null : 'error' in result ? { error: result.error ?? READ_FAILED } : { document: result.document },
   (): Loaded | null => scope.canApply(ticket) ? { error: READ_FAILED } : null);
 }
 function apply(loaded: Loaded | null) {
  if (!loaded) return;
  if ('error' in loaded) setError(loaded.error); else { setError(''); setDocument(loaded.document); }
 }
 useEffect(() => {
  let live = true; busy.current = true;
  void load().then(loaded => { if (live) apply(loaded); }).finally(() => { busy.current = false; if (live) setPending(false); });
  return () => { live = false; };
  // 창을 열 때 한 번 읽는다. 고른 배송 건이 바뀌면 표가 key로 이 창을 새로 연다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);
 const packs = new Map(document?.rows.flatMap(row => row.pack ? [[row.pack.id, row.pack] as const] : []) ?? []);
 const releasable = packs.size === 1 && document?.rows.every(row => row.pack?.canRelease);
 const blockers = document && !document.canCreate && !releasable ? shipmentPackCreateBlockers(document) : null;
 /* 이미 묶인 건만 골랐는데 풀 수 없는 경우: 묶음이 둘 이상이거나 출고지시를 보냈거나 발송했다. */
 const onlyPacked = Boolean(document?.rows.length) && document!.rows.every(row => row.pack);
 const releaseBlocked = blockers && onlyPacked ? (packs.size > 1 ? '서로 다른 합포장이 섞여 있습니다. 합포장 하나의 배송 건만 골라 해제해주세요.' : '출고지시를 보냈거나 발송한 합포장은 해제할 수 없습니다.') : null;
 /* 합포장이 여러 개 섞여 보일 때만 묶음을 순서로 구분한다(내부 번호를 보이지 않는다). */
 const packOrder = [...packs.keys()];
 const packName = (id: string) => packs.size > 1 ? `합포장 ${packOrder.indexOf(id) + 1}` : '합포장';
 async function read() {
  if (busy.current) return;
  busy.current = true; setPending(true); setError('');
  try { const loaded = await load(); if (alive.current) apply(loaded); }
  finally { busy.current = false; if (alive.current) setPending(false); }
 }
 async function save(kind: Request['kind']) {
  if (busy.current || !document || reason.trim().length < 2) return;
  const ticket = scope.capture(); if (!ticket) return;
  const request = dispatched.current ?? { kind, version: document.version, reason: reason.trim(), operationId: crypto.randomUUID() };
  dispatched.current = request; busy.current = true; setPending(true); setError(''); setMessage('');
  try { const result = await changeShipmentPackAction(ids, request.kind, request.version, request.reason, request.operationId, identity);
   if (!alive.current || !scope.canApply(ticket)) return;
   if ('error' in result) { setError(result.uncertain ? SAVE_UNKNOWN_MESSAGE : result.error ?? SAVE_UNKNOWN_MESSAGE); setUncertain(uncertain || Boolean(result.uncertain)); if (!uncertain && !result.uncertain) dispatched.current = null; }
   else { setDocument(result.document); setUncertain(false); dispatched.current = null; setReason(''); setMessage(request.kind === 'create' ? '합포장했습니다. 출고지시를 내려받을 때는 묶인 배송 건을 모두 골라주세요.' : '합포장을 해제했습니다.'); router.refresh(); }
  } catch { if (alive.current && scope.canApply(ticket)) { setUncertain(true); setError(SAVE_UNKNOWN_MESSAGE); } }
  finally { busy.current = false; if (alive.current) setPending(false); }
 }
 /* 결과를 모르는 동안에는 조회한 내용이 그대로라, 묶기인지 풀기인지는 조회 결과로 안다. */
 const creating = Boolean(document?.canCreate);
 return <section className="flex min-w-0 flex-col items-start gap-3 rounded-xl border bg-card p-4 text-sm leading-relaxed text-card-foreground sm:p-5" aria-label="합포장 관리">
  <div className="flex w-full items-center justify-between gap-3"><h3 className="text-base font-medium text-foreground">합포장 관리</h3><Button type="button" size="sm" variant="outline" disabled={pending || uncertain} onClick={onClose}>닫기</Button></div>
  <p className="text-muted-foreground">구매자·수령인·주소·출고지가 같은 발송 대기 건을 한 상자로 포장합니다. 주문 금액·배송비·착불 금액은 바뀌지 않습니다.</p>
  {document ? <>
   <ul className="grid w-full gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))]">{document.rows.map(row => <li className="rounded-lg border p-3 wrap-anywhere" key={row.id}><strong className="font-medium">주문 {orderReferenceLabel(row.orderId, row.orderNumber)}</strong> · 배송 건 {commerceReferenceLabel(row.id, row.shipmentNumber)}<br />
    {row.buyerName} → {row.recipientName ?? '수령인 없음'} · {row.originName}<br /><span className="tabular-nums">선결제 배송비 {krw(row.shippingFee)} · 착불 {krw(row.collectFee)}</span>
    {row.pack ? <p className="mt-1 text-muted-foreground">{packName(row.pack.id)} {row.pack.count}건 · 묶음 착불 합계 {(row.pack.collectFee === null ? '-' : krw(row.pack.collectFee))}</p> : null}
    {blockers?.rows[row.id] && !releaseBlocked ? <p className="mt-1 text-warning" data-pack-blocker="">{blockers.rows[row.id]}</p> : null}</li>)}</ul>
   {blockers ? <AdminNotice tone="warning">{releaseBlocked ?? blockers.general ?? '위에 이유가 적힌 배송 건을 빼고 다시 골라주세요. 이미 묶인 합포장을 풀려면 그 합포장의 배송 건만 골라주세요.'}</AdminNotice> : null}
   {document.canCreate || releasable || uncertain ? <form className="flex w-full flex-col items-start gap-3" onSubmit={event => { event.preventDefault(); void save(dispatched.current?.kind ?? (document.canCreate ? 'create' : 'release')); }}>
    <fieldset className="m-0 flex w-full min-w-0 flex-col gap-3 rounded-lg border p-3.5" disabled={pending || uncertain}><legend className="float-left w-full p-0 font-medium">{creating ? `배송 건 ${document.rows.length}건 합포장하기` : '합포장 해제하기'}</legend>
     <label className="flex min-w-0 flex-col gap-1.5"><span className="font-medium">{creating ? '합포장하는 이유 (필수)' : '해제하는 이유 (필수)'}</span><Input value={reason} onChange={event => setReason(event.target.value)} required minLength={2} maxLength={500} placeholder={creating ? '예: 같은 날 주문 2건, 고객이 함께 받기를 요청' : '예: 한 건만 먼저 보내기로 함'} /></label>
     <span className="text-xs text-muted-foreground">감사 기록에 남습니다. 고객 이름·연락처는 적지 마세요.</span>
    </fieldset>
    <div className="flex flex-wrap items-center gap-2">
     <Button type="submit" disabled={pending || reason.trim().length < 2}>{uncertain ? SAVE_CHECK_LABEL : creating ? '합포장하기' : '합포장 해제'}</Button>
     {!uncertain && !pending && reason.trim().length < 2 ? <span className="text-xs text-muted-foreground">이유를 2자 이상 적으면 누를 수 있습니다.</span> : null}
    </div>
    {creating && !uncertain ? <p className="text-muted-foreground">창고에는 출고지시 파일과 함께 합포장 건을 알려주세요. 운송장은 한 건만 등록해도 묶인 배송 건 모두에 들어갑니다.</p> : null}
   </form> : null}
  </> : null}
  <div className="flex flex-wrap items-center gap-2">
   {document || error ? <Button type="button" size="sm" variant="outline" disabled={pending || uncertain} onClick={() => { void read(); }}>다시 불러오기</Button> : null}
   {pending ? <p className="text-muted-foreground" role="status">{document ? '처리하는 중입니다…' : '고른 배송 건의 합포장 조건을 불러오는 중입니다…'}</p> : null}
  </div>
  {error ? <p className="text-destructive" role="alert">{error}</p> : null}{message ? <p className="text-success" role="status">{message}</p> : null}
 </section>;
}
