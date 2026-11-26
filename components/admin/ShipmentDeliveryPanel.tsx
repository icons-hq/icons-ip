'use client';

import { useEffect, useId, useMemo, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { GoodChoiceCard, GoodChoiceCards } from '@/components/admin/GoodEditorParts';
import { ShipmentConsoleDeliveryDialog, type DispatchTargetSummary } from '@/components/admin/screens/ShipmentConsoleDeliveryDialog';
import { readShipmentDeliveryAction, recordShipmentDeliveryAction, selectShipmentDeliveryMethodAction } from '@/app/admin/shipment-delivery-actions';
import { adminConfirm } from '@/lib/admin/confirm';
import {
  DELIVERY_RECORD_LABELS, activeDeliveryPolicy, deliveryChangeBlockReason, deliveryExcludedNote, deliveryHistoryRows, deliveryMethodChangeSummary, deliveryMethodChoices,
  deliveryNowLocal, deliveryPanelIsCompact, deliveryRecordBlockReason, deliveryRecordConfirmRequest,
} from '@/lib/admin/shipment-delivery-panel';
import { adminDeliveryStatusLabel } from '@/lib/admin/shipment-status-labels';
import { statusTone } from '@/lib/admin/status-tone';
import { DELIVERY_METHOD_LABELS, deliveryIsHandoff, type AdminShipmentDelivery, type DeliveryMethod, type DeliveryOperation } from '@/lib/shipment-delivery';
import { formatOrderDateTime } from '@/lib/orders';
import { krw, krwAmountWords } from '@/lib/format';
import { commerceReferenceLabel } from '@/lib/commerce-number';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { useClaimPreviewBusy } from '@/components/orders/claim-preview-busy';

/*
 * 주문 상세의 배송 방식·인계 확인(템플릿 룩, ADR-0028). 택배이고 바꾼 이력도 기록할 일도 없으면 접힌 한 줄이고(D-01),
 * 퀵·방문수령·직접배송·화물배송이거나 이력·기록할 일이 있으면 펼친 카드다. 방식을 바꾸는 길은 둘이다 —
 *  · 고객이 요청했습니다: 이 화면의 양식. 서버(admin_select_shipment_delivery_method)가 고객이 요청한 내용과 배송비 유지 동의 내용을 글로 요구하고,
 *    그 글이 있으면 고객 주문 화면에 '고객 요청으로 배송 방식을 변경했으며…'라고 보인다. 배송비 유지 확인 체크는 화면이 대신 보낸다.
 *  · 판매자가 정했습니다: 발송관리의 [방식 바꾸기]와 같은 창(ShipmentConsoleDeliveryDialog). 고객 화면에는 '판매자가 배송 방식을 변경했으며…'라고 보인다.
 */
const FORM_CLASS = 'flex w-full flex-col items-start gap-2.5';
const FIELDSET_CLASS = 'm-0 flex w-full min-w-0 flex-col gap-2.5 border-0 p-0';
const FIELD_CLASS = 'flex w-full min-w-0 flex-col gap-1.5';
const LABEL_TEXT = 'text-sm font-medium';
const NOTE_CLASS = 'text-xs text-muted-foreground';
const SUMMARY_CLASS = 'cursor-pointer text-sm font-medium';
const DETAILS_CLASS = 'w-full rounded-lg border px-3 py-2.5';
const HISTORY_ROW_CLASS = 'grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]';

/** 고객이 요청해서 바꾸는 양식. 고를 수 있는 방식만 보이고, 켜진 운영 조건은 방식에 맞게 자동으로 정해진다. */
export function MethodSelection({ shipment, onSaved }: { shipment: AdminShipmentDelivery; onSaved: (message: string) => void }) {
  const { methods, excluded } = deliveryMethodChoices(shipment);
  const others = methods.filter((candidate) => candidate !== shipment.summary.method);
  const [method, setMethod] = useState<DeliveryMethod>(others[0] ?? 'parcel');
  const [requestText, setRequestText] = useState(''); const [consentText, setConsentText] = useState('');
  const [pending, startTransition] = useTransition(); const [error, setError] = useState<string | null>(null); const [uncertain, setUncertain] = useState(false);
  useClaimPreviewBusy(pending); /* 목록 위 주문 상세 팝업(S36-075)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  const operation = useRef<string | null>(null); const sent = useRef<FormData | null>(null); const busy = useRef(false); const fieldId = useId();
  const policy = method === 'parcel' ? null : activeDeliveryPolicy(shipment, method);
  const ready = Boolean(requestText.trim() && consentText.trim()) && (method === 'parcel' || Boolean(policy));
  const note = deliveryExcludedNote(excluded);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current) return;
    /* 결과를 모르는 채 다시 누르면 처음 보낸 내용 그대로 같은 처리 번호로 보내, 이미 저장됐어도 두 번 저장되지 않는다. */
    if (!uncertain) {
      if (!ready) return;
      operation.current ??= crypto.randomUUID();
      const form = new FormData();
      for (const [key, value] of Object.entries({ orderId: shipment.orderId, shipmentId: shipment.shipmentId, updatedAt: shipment.updatedAt, method, policyId: policy?.id ?? '',
        customerRequestReference: requestText.trim(), feeConsentReference: consentText.trim(), feeUnchanged: 'on', operationId: operation.current })) form.set(key, value);
      sent.current = form;
    }
    const form = sent.current; if (!form) return;
    busy.current = true; setError(null);
    startTransition(async () => {
      try { const result = await selectShipmentDeliveryMethodAction(form); if (result.ok) onSaved(result.message); else { setUncertain(false); setError(result.error); } }
      catch { setUncertain(true); setError('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.'); }
      finally { busy.current = false; }
    });
  }
  return <form onSubmit={submit} className={FORM_CLASS}>
    <fieldset disabled={pending || uncertain} className={FIELDSET_CLASS}>
      <legend className="sr-only">고객 요청에 따른 배송 방식 변경</legend>
      <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-method`}>바꿀 배송 방식</Label>
        <NativeSelect className="w-full max-w-xs" id={`${fieldId}-method`} value={method} onChange={(event) => setMethod(event.target.value as DeliveryMethod)}>
          {others.map((candidate) => <option key={candidate} value={candidate}>{DELIVERY_METHOD_LABELS[candidate]}</option>)}
        </NativeSelect>
        {policy ? <span className={NOTE_CLASS}>담당 {policy.contactName} · 인계 장소 {policy.handoffLocation}</span> : null}
        <span className={NOTE_CLASS}>배송비·결제 금액은 바뀌지 않습니다.</span>
        {note ? <span className={NOTE_CLASS}>{note}</span> : null}
      </div>
      <label className={FIELD_CLASS}><span className={LABEL_TEXT}>고객이 요청한 내용 (필수)</span>
        <Textarea rows={2} maxLength={2000} placeholder="예: 11/26 고객이 전화로 퀵 배송을 요청함" value={requestText} onChange={(event) => setRequestText(event.target.value)} required />
        <span className={NOTE_CLASS}>이 주문의 방식 변경 이력에 남습니다.</span></label>
      <label className={FIELD_CLASS}><span className={LABEL_TEXT}>배송비 유지 동의 내용 (필수)</span>
        <Textarea rows={2} maxLength={2000} placeholder={`예: 배송비 ${krwAmountWords(shipment.shippingFee)}은 그대로라고 안내하고 동의받음`} value={consentText} onChange={(event) => setConsentText(event.target.value)} required /></label>
    </fieldset>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <Button variant="outline" type="submit" disabled={pending || (!uncertain && !ready)}>{pending ? '바꾸는 중…' : uncertain ? '저장됐는지 확인' : '배송 방식 바꾸기'}</Button>
  </form>;
}

/** [배송 방식 바꾸기]의 안쪽. 누가 바꾸자고 했는지에 따라 고객 주문 화면의 안내가 달라서 먼저 고른다. */
function MethodChangeBody({ shipment, onSaved, onOpenStoreDialog }: { shipment: AdminShipmentDelivery; onSaved: (message: string) => void; onOpenStoreDialog: () => void }) {
  const [who, setWho] = useState<'customer' | 'store'>('customer'); const name = useId();
  return <div className="mt-2.5 flex flex-col gap-3">
    <GoodChoiceCards legend="누가 바꾸자고 했나요?">
      <GoodChoiceCard name={name} value="customer" checked={who === 'customer'} onChange={() => setWho('customer')} title="고객이 요청했습니다"
        description="택배 외 방식이면 고객 화면에 ‘고객 요청으로 배송 방식을 변경했으며…’라고 보입니다." />
      <GoodChoiceCard name={name} value="store" checked={who === 'store'} onChange={() => setWho('store')} title="판매자가 정했습니다"
        description="발송관리의 [방식 바꾸기]와 같은 창입니다. 택배 외 방식이면 고객 화면에 ‘판매자가 배송 방식을 변경했으며…’라고 보입니다." />
    </GoodChoiceCards>
    {who === 'customer' ? <MethodSelection key={`select-${shipment.updatedAt}`} shipment={shipment} onSaved={onSaved} />
      : <div><Button variant="outline" type="button" onClick={onOpenStoreDialog}>배송 방식 바꾸기 창 열기</Button></div>}
  </div>;
}

/**
 * 배송 방식을 바꾸는 자리. 못 바꾸면 이유를, 바꿀 다른 방식이 없으면 그 사실을 한 줄로 말하고, 바꿀 수 있으면 접힌 [배송 방식 바꾸기]를 둔다.
 * 한 줄로 접힌 모습에는 카드 제목이 없어 `context`로 어느 배송 건인지 앞에 적는다.
 */
function MethodChange({ shipment, title, context = '', onSaved, onOpenStoreDialog }: {
  shipment: AdminShipmentDelivery; title: string; context?: string; onSaved: (message: string) => void; onOpenStoreDialog: () => void;
}) {
  if (!shipment.canSelect) return <small className={NOTE_CLASS}>{context}{deliveryChangeBlockReason(shipment)}</small>;
  if (!deliveryMethodChoices(shipment).methods.some((candidate) => candidate !== shipment.summary.method)) {
    return <small className={NOTE_CLASS}>{context}이 출고지에서 켜진 다른 배송 방식이 없습니다. 배송정보 관리에서 켤 수 있습니다.</small>;
  }
  return <details className={DETAILS_CLASS}><summary className={SUMMARY_CLASS}>{title}</summary>
    <MethodChangeBody shipment={shipment} onSaved={onSaved} onOpenStoreDialog={onOpenStoreDialog} />
  </details>;
}

/** 퀵·직접배송·화물배송의 인계, 이 방식들과 방문수령·직접전달의 수령을 기록한다. 기록하면 배송 건 상태가 바뀌어 확인창을 거친다. */
export function HandoffForm({ shipment, reference, originName, onSaved }: { shipment: AdminShipmentDelivery; reference: string; originName?: string; onSaved: (message: string) => void }) {
  const method = shipment.summary.method;
  const kind = (method === 'pickup' || method === 'none' ? `${method}_receive` : `${method}_${shipment.status === 'ready' ? 'handoff' : 'receive'}`) as DeliveryOperation;
  const handoff = deliveryIsHandoff(kind);
  const [occurredAt, setOccurredAt] = useState(() => deliveryNowLocal()); const [error, setError] = useState<string | null>(null); const [pending, startTransition] = useTransition();
  useClaimPreviewBusy(pending); /* 목록 위 주문 상세 팝업(S36-075)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  const requestId = useRef<string | null>(null); const busy = useRef(false); const fieldId = useId();
  const delegateAllowed = Boolean(shipment.summary.policy?.allowDelegate);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current) return;
    const form = new FormData(event.currentTarget);
    busy.current = true; setError(null);
    const confirmed = await adminConfirm(deliveryRecordConfirmRequest({ kind, reference, originName, providerName: String(form.get('providerName') ?? '').trim() || undefined }));
    if (!confirmed) { busy.current = false; return; }
    requestId.current ??= crypto.randomUUID(); form.set('operationId', requestId.current);
    startTransition(async () => {
      try { const result = await recordShipmentDeliveryAction(form); if (result.ok) onSaved(result.message); else setError(result.error); }
      catch { setError('저장됐는지 확인하지 못했습니다. 같은 내용으로 다시 누르면 두 번 저장되지 않습니다.'); }
      finally { busy.current = false; }
    });
  }
  return <form onSubmit={submit} className={`${FORM_CLASS} border-t pt-3`}>
    <h4 className="text-sm font-medium text-foreground">{DELIVERY_RECORD_LABELS[kind]} 기록</h4>
    <input type="hidden" name="orderId" value={shipment.orderId} /><input type="hidden" name="shipmentId" value={shipment.shipmentId} /><input type="hidden" name="updatedAt" value={shipment.updatedAt} /><input type="hidden" name="kind" value={kind} />
    <fieldset disabled={pending || !shipment.preorderReady} className={FIELDSET_CLASS}>
      <legend className="sr-only">{handoff ? '인계 기록' : '수령 기록'}</legend>
      <div className="grid min-w-0 gap-2.5 sm:grid-cols-2">
        <label className={FIELD_CLASS}><span className={LABEL_TEXT}>{handoff ? '인계한 담당자' : '수령을 확인한 담당자'}</span><Input name="operatorName" maxLength={100} placeholder={handoff ? '물건을 넘긴 우리 담당자' : '수령을 확인한 우리 담당자'} required /></label>
        <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-occurred`}>{handoff ? '인계' : '수령'} 시각 (KST)</Label>
          <Input className="w-auto self-start" id={`${fieldId}-occurred`} type="datetime-local" name="occurredAt" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></div>
        {handoff ? <>
          <label className={FIELD_CLASS}><span className={LABEL_TEXT}>배송 업체·기사</span><Input name="providerName" maxLength={100} placeholder="고객 주문 화면에 보입니다" required /></label>
          <label className={FIELD_CLASS}><span className={LABEL_TEXT}>업체 연락처</span><Input name="providerPhone" type="tel" maxLength={40} required /></label>
        </> : <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-recipient`}>수령인 구분</Label>
          <NativeSelect className="w-full" id={`${fieldId}-recipient`} name="recipientKind" defaultValue={delegateAllowed ? '' : 'self'} required>
            {delegateAllowed ? <option value="" disabled>수령인을 확인해주세요</option> : null}
            <option value="self">주문자 본인</option>{delegateAllowed ? <option value="delegate">허용된 대리수령인</option> : null}
          </NativeSelect></div>}
      </div>
      {handoff
        ? <label className={FIELD_CLASS}><span className={LABEL_TEXT}>인계 확인 내용</span><Textarea name="handoffReference" rows={2} maxLength={2000} placeholder="예: 퀵 접수번호 12345, 기사에게 직접 전달" required /></label>
        : <>
          <label className={FIELD_CLASS}><span className={LABEL_TEXT}>수령 확인 내용</span><Textarea name="receiptReference" rows={2} maxLength={2000} placeholder="예: 방문한 고객 본인에게 현장에서 전달" required /></label>
          <label className={FIELD_CLASS}><span className={LABEL_TEXT}>고객이 보여 준 확인값</span><Input name="receiptCode" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} required />
            <span className={NOTE_CLASS}>고객이 주문 화면에서 발급한 값입니다(10분 동안 유효). 5번 틀리거나 다시 발급하면 이전 값은 쓸 수 없습니다.</span></label>
        </>}
    </fieldset>
    {!shipment.preorderReady ? <AdminNotice role="status" tone="warning">예약 품목의 입고 확인이 아직 끝나지 않았습니다. 상품 편집의 예약판매에서 이 주문을 골라 [선택한 예약 주문 입고 확인]을 먼저 눌러주세요.</AdminNotice> : null}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <Button type="submit" disabled={pending || !shipment.preorderReady}>{pending ? '기록 중…' : handoff ? '인계 기록 · 발송처리' : '수령 기록 · 배송완료'}</Button>
  </form>;
}

/**
 * 읽어 온 배송 건 한 건의 화면. 상태(읽기·알림·창)는 ShipmentDeliveryPanel이 들고 이 부품은 그리기만 한다.
 * 택배이고 바꾼 이력도 기록할 일도 없으면 접힌 한 줄(이미 발송했거나 끝난 건은 아무것도 그리지 않는다), 아니면 펼친 카드다.
 */
export function ShipmentDeliveryView({ shipment, shipmentId, reference, originName, notice, onSaved, onReload, onOpenStoreDialog }: {
  shipment: AdminShipmentDelivery; shipmentId: string; reference: string; originName?: string;
  notice: { text: string; tone: 'success' | 'warning' | 'danger' } | null;
  onSaved: (message: string) => void; onReload: () => void; onOpenStoreDialog: () => void;
}) {
  const where = originName ? `${originName} · ` : '';
  const noticeView = notice ? <AdminNotice role="status" tone={notice.tone}>{notice.text}</AdminNotice> : null;
  if (deliveryPanelIsCompact(shipment)) {
    const quiet = !shipment.canSelect && shipment.status !== 'ready';
    if (quiet && !noticeView) return null;
    return <section className="flex min-w-0 flex-col gap-2 text-sm" aria-label={`${where}배송 건 ${reference} 배송 방식`}>
      {noticeView}
      {quiet ? null : <MethodChange shipment={shipment} title={`${where}배송 건 ${reference} · 배송 방식 바꾸기`} context={`${where}배송 건 ${reference} · `} onSaved={onSaved} onOpenStoreDialog={onOpenStoreDialog} />}
    </section>;
  }
  const method = shipment.summary.method;
  const recordBlock = shipment.canTransition ? null : deliveryRecordBlockReason(shipment);
  return <section className="flex min-w-0 flex-col items-start gap-3 rounded-xl border bg-card p-4 text-sm leading-relaxed text-card-foreground" aria-labelledby={`shipment-delivery-${shipmentId}`}>
    <div className="flex flex-col gap-0.5">
      <h3 className="text-base font-medium text-foreground" id={`shipment-delivery-${shipmentId}`}>{where}배송 방식·인계 확인</h3>
      <small className={`${NOTE_CLASS} tabular-nums`}>배송 건 {reference}</small>
    </div>
    {noticeView}
    <p className="flex flex-wrap items-center gap-2">{method === 'quick' || method === 'direct' || method === 'freight' ? null : <>{DELIVERY_METHOD_LABELS[method]} </>}
      <AdminStatusBadge tone={statusTone('shipment', shipment.status)}>{adminDeliveryStatusLabel(method, shipment.status)}</AdminStatusBadge> 배송비 {krw(shipment.shippingFee)}</p>
    {shipment.summary.policy ? <p className="whitespace-pre-wrap text-muted-foreground">저장된 인계 조건: {shipment.summary.policy.handoffLocation}<br />
      {shipment.summary.policy.handoffInstructions}<br />{shipment.summary.policy.completionInstructions}</p> : null}
    <MethodChange shipment={shipment} title="배송 방식 바꾸기" onSaved={onSaved} onOpenStoreDialog={onOpenStoreDialog} />
    {shipment.canTransition ? <HandoffForm key={`handoff-${shipment.updatedAt}`} shipment={shipment} reference={reference} originName={originName} onSaved={onSaved} />
      : recordBlock ? <small className={NOTE_CLASS}>{recordBlock}</small> : null}
    {shipment.history.length ? <details className={DETAILS_CLASS}><summary className={SUMMARY_CLASS}>방식·인계 변경 이력 {shipment.history.length}건</summary>
      <ol className="mt-3 flex list-decimal flex-col gap-3 pl-5">{shipment.history.map((row) => { const change = row.kind === 'method_selected' ? deliveryMethodChangeSummary(row.evidence) : null; return <li key={row.id}>
        <strong className="font-medium">{DELIVERY_RECORD_LABELS[row.kind]}</strong>{change ? ` · ${change}` : ''} · {formatOrderDateTime(row.recordedAt)} · {row.actorName ?? '운영자'}
        <dl className="mt-2 grid gap-2">
          {deliveryHistoryRows(row.kind, row.evidence).map((item) => <div className={HISTORY_ROW_CLASS} key={item.label}><dt className="text-muted-foreground">{item.label}</dt>
            <dd className="min-w-0 whitespace-pre-wrap wrap-anywhere">{item.time ? formatOrderDateTime(item.value) : item.value}</dd></div>)}
        </dl>
      </li>; })}</ol>
    </details> : <p className="text-muted-foreground">기록된 방식 변경·인계 이력이 없습니다.</p>}
    <Button variant="outline" size="sm" type="button" onClick={onReload}>새로고침</Button>
  </section>;
}

/** Own read/CAS baselines keep receipt forms independent of the parent order form. */
export function ShipmentDeliveryPanel({ shipmentId, shipmentNumber, orderId, originName, summary }: {
  shipmentId: string; shipmentNumber?: string; orderId: string; originName?: string;
  /** 발송관리 창의 '수령인 · 상품' 칸에 보일 이 배송 건의 수령인·상품. 주문 상세가 알려 준다. 없으면 창이 '목록 밖 배송 건'이라고 적는다. */
  summary?: DispatchTargetSummary;
}) {
  const [refresh, setRefresh] = useState(0); const key = `${shipmentId}:${refresh}`;
  const [notice, setNotice] = useState<{ shipmentId: string; text: string; tone: 'success' | 'warning' | 'danger' } | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; shipment?: AdminShipmentDelivery; error?: string } | null>(null);
  const [storeDialog, setStoreDialog] = useState(false);
  /* 창은 배송 건 번호 목록이 바뀔 때마다 다시 읽으므로 렌더마다 새 배열을 주지 않는다. */
  const shipmentIds = useMemo(() => [shipmentId], [shipmentId]);
  const summaries = useMemo(() => summary ? { [shipmentId]: summary } : undefined, [shipmentId, summary]);
  useEffect(() => {
    let canceled = false;
    void readShipmentDeliveryAction(shipmentId, orderId).then((result) => { if (!canceled) setLoaded(result.ok ? { key, shipment: result.shipment } : { key, error: result.error }); })
      .catch(() => { if (!canceled) setLoaded({ key, error: '배송 방식·인계 정보를 불러오지 못했습니다.' }); });
    return () => { canceled = true; };
  }, [key, shipmentId, orderId]);
  const visible = loaded?.key === key ? loaded : null; const shipment = visible?.shipment;
  const reference = commerceReferenceLabel(shipmentId, shipmentNumber);
  const reload = () => setRefresh((value) => value + 1); const saved = (text: string) => { setNotice({ shipmentId, text, tone: 'success' }); reload(); };
  /* 발송관리와 같은 창. 결과 문구를 이 패널이 받아 보이고, 창이 끝나면 이 배송 건을 다시 읽는다. 읽는 동안에도 창이 사라지지 않게 맨 바깥에 둔다. */
  const dialog = storeDialog ? <ShipmentConsoleDeliveryDialog mode="method" shipmentIds={shipmentIds} summaries={summaries} onClose={() => setStoreDialog(false)}
    onDone={(result) => { setNotice({ shipmentId, text: result.message, tone: result.tone }); reload(); }} /> : null;
  let body: ReactNode;
  if (!visible) body = <p className="text-sm text-muted-foreground" role="status">{originName ? `${originName} · ` : ''}배송 방식·인계 확인을 불러오는 중입니다…</p>;
  else if (visible.error || !shipment) body = <div className="flex flex-col items-start gap-2"><AdminNotice role="alert" tone="danger">{visible.error ?? '배송 방식·인계 정보를 불러오지 못했습니다.'}</AdminNotice>
    <Button variant="outline" size="sm" type="button" onClick={reload}>다시 불러오기</Button></div>;
  else body = <ShipmentDeliveryView shipment={shipment} shipmentId={shipmentId} reference={reference} originName={originName} notice={notice?.shipmentId === shipmentId ? notice : null}
    onSaved={saved} onReload={reload} onOpenStoreDialog={() => setStoreDialog(true)} />;
  return <>{body}{dialog}</>;
}
