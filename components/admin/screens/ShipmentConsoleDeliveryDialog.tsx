'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { applyDispatchDeliveryAction, readDispatchDeliveryOptionsAction } from '@/app/admin/shipment-actions';
import {
  DISPATCH_HANDOFF_METHODS, DISPATCH_REASON_MAX_LENGTH, availableDispatchMethods, dispatchDeliveryError, dispatchDeliveryPlan, dispatchHandoffFromForm,
  dispatchMethodLabel, type DispatchDeliveryOptions, type DispatchDeliveryReceipt, type DispatchMethod,
} from '@/lib/admin/dispatch-delivery';
import { commerceReferenceLabel } from '@/lib/commerce-number';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import type { ShipmentConsoleNotice, ShipmentDeliveryDialogMode } from './ShipmentConsoleContext';

/*
 * 발송처리 화면의 배송 방식 팝업(S36-072·S36-X04, ADR-0028 kit). 줄의 [방식 바꾸기]는 한 건의 방식을 바꾸고,
 * 처리 막대의 [택배 외 발송처리]는 고른 건에 택배 외 방식을 한 번에 적용해 실제 인계(발송)까지 기록한다.
 * 고를 수 있는 방식은 고른 건 전부의 출고지에서 운영 조건이 켜진 방식뿐이고, 고객이 주문서에서 고른 방식과
 * 다르게 바꾸는 건이 있으면 이유가 필수다(같으면 이유 칸을 두지 않는다). 배송비·결제 금액은 바꾸지 않는다.
 * 할 수 없는 건은 건너뛰고 표의 '이번 처리' 칸에 이유를 보이며(일괄 변경 GoodsBulkToolbar와 같은 말), 서버는 잠근 뒤 같은 조건을 다시 본다(줄별 결과).
 * 설명 문단 대신 표가 줄마다 무엇을 할지 보여 준다 — 화면에 보이지 않는 결과(배송비 그대로, 고객 화면에 업체가 보임)만 한 줄로 둔다.
 */
const FIELD = 'flex min-w-0 flex-col gap-1.5';
/** 목록에서 넘겨받는 배송 건 요약(수령인·상품). 고른 건이 맞는지 팝업 안에서 확인하는 용도다(QA 라운드 1 m5). */
export interface DispatchTargetSummary { recipient: string | null; items: string[] }
const NOTE = 'text-xs text-muted-foreground';
/** 지금 시각의 KST datetime-local 값(분 단위). 인계 시각 칸의 처음 값이다 — 대부분 넘긴 자리에서 바로 기록한다. */
const kstNow = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);

export function ShipmentConsoleDeliveryDialog({ shipmentIds, mode, onClose, onDone, summaries = {}, canReadOrders = true }: {
  /** 주문 조회 권한. 없으면 주문 상세를 열 수 없어 방문수령 안내가 목록 행의 인계·수령 확인을 가리킨다. */
  canReadOrders?: boolean;
  shipmentIds: string[];
  mode: ShipmentDeliveryDialogMode;
  /** 배송 건 id별 수령인·상품. 목록 밖(다른 페이지) 건은 없을 수 있다. */
  summaries?: Readonly<Record<string, DispatchTargetSummary>>;
  onClose: () => void;
  /** 처리 결과(일부 실패 포함)를 표 위 알림으로 보존한다. */
  onDone: (notice: ShipmentConsoleNotice) => void;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [loaded, setLoaded] = useState<{ options?: DispatchDeliveryOptions; error?: string } | null>(null);
  const [method, setMethod] = useState<DispatchMethod | ''>('');
  const [handoff, setHandoff] = useState(mode === 'dispatch');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState(() => ({ operatorName: '', providerName: '', providerPhone: '', handoffReference: '', occurredAt: kstNow() }));
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<DispatchDeliveryReceipt | null>(null);
  const [pending, startTransition] = useTransition();
  /* 결과를 모르는 채 끊긴 요청만 같은 요청 번호로 다시 보낸다. 결과를 받았으면 다음 요청은 새 번호다. */
  const attempt = useRef<{ fingerprint: string; id: string } | null>(null);

  useEffect(() => {
    let live = true;
    readDispatchDeliveryOptionsAction(shipmentIds).then((result) => {
      if (!live) return;
      if (!result.ok) { setLoaded({ error: result.error }); return; }
      setLoaded({ options: result.options });
      const methods = availableDispatchMethods(result.options).filter((candidate) => mode === 'method' || candidate !== 'parcel');
      const current = result.options.shipments[0]?.method;
      setMethod(mode === 'method' && methods.includes(current as DispatchMethod) ? current as DispatchMethod : methods[0] ?? '');
    }, () => { if (live) setLoaded({ error: '배송 방식 정보를 불러오지 못했습니다. 잠시 후 다시 열어주세요.' }); });
    return () => { live = false; };
  }, [shipmentIds, mode]);

  const options = loaded?.options;
  const methods = options ? availableDispatchMethods(options).filter((candidate) => mode === 'method' || candidate !== 'parcel') : [];
  const handoffMethod = method !== '' && DISPATCH_HANDOFF_METHODS.includes(method);
  const withHandoff = handoffMethod && handoff;
  const plan = options && method ? dispatchDeliveryPlan(options, method, withHandoff) : [];
  const applying = plan.filter((step) => step.kind === 'apply');
  const needsReason = applying.some((step) => step.kind === 'apply' && step.needsReason);
  const reference = (shipment: DispatchDeliveryOptions['shipments'][number]) => commerceReferenceLabel(shipment.id, shipment.shipmentNumber);
  const policiesFor = options && method && method !== 'parcel' ? options.policies.filter((policy) => policy.method === method) : [];
  const title = mode === 'dispatch' ? '택배 외 발송처리' : '배송 방식 바꾸기';

  /* 누를 수 없는 버튼이 고장처럼 보이지 않게 이유를 말한다. */
  const lockNote = !options || !method || pending ? null
    : !applying.length ? (plan.length ? "처리할 수 있는 배송 건이 없습니다. 표의 '이번 처리' 칸에서 건너뛴 이유를 확인해주세요." : null)
    : needsReason && !reason.trim() ? '바꾸는 이유를 적으면 누를 수 있습니다.' : null;

  function submit() {
    if (pending || !options || !method || !applying.length) return;
    /* 이유 칸은 고객이 고른 방식과 다르게 바꿀 때만 보인다. 보이지 않을 때 앞서 적어 둔 글을 보내지 않는다. */
    const trimmedReason = needsReason ? reason.trim() : '';
    if (needsReason && !trimmedReason) { setError('고객이 고른 방식과 다르게 바꾸는 이유를 적어주세요.'); return; }
    if (trimmedReason.length > DISPATCH_REASON_MAX_LENGTH) { setError(`이유는 ${DISPATCH_REASON_MAX_LENGTH.toLocaleString('ko-KR')}자까지 적을 수 있습니다.`); return; }
    const handoffInput = withHandoff ? dispatchHandoffFromForm(evidence) : null;
    if (withHandoff && !handoffInput) { setError('인계한 담당자·배송 업체·업체 연락처·인계 확인 내용을 모두 적고 인계 시각을 넣어주세요.'); return; }
    const targets = applying.map((step) => ({ shipmentId: step.shipment.id, updatedAt: step.shipment.updatedAt }));
    const fingerprint = JSON.stringify({ targets, method, reason: trimmedReason, handoff: handoffInput });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, id: crypto.randomUUID() };
    const operationId = attempt.current.id;
    setError('');
    startTransition(async () => {
      try {
        const result = await applyDispatchDeliveryAction({ targets, method, reason: trimmedReason, handoff: handoffInput, operationId });
        attempt.current = null;
        if (!result.ok) { setError(result.error); return; }
        const done = result.receipt;
        const parts = [done.changed ? `방식 변경 ${done.changed}건` : '', done.handedOff ? `인계 기록 ${done.handedOff}건` : '', done.failed ? `실패 ${done.failed}건` : ''].filter(Boolean);
        const skipped = plan.length - applying.length;
        const message = `${title}: ${parts.join(' · ') || '처리한 건 없음'}${skipped ? ` · 건너뜀 ${skipped}건` : ''}. 배송비·결제 금액은 바뀌지 않았습니다.`;
        onDone({ tone: done.failed ? 'warning' : 'success', message });
        if (done.changed || done.handedOff) router.refresh();
        if (done.failed) setReceipt(done); else onClose();
      } catch {
        setError('처리됐는지 확인하지 못했습니다. 같은 내용으로 다시 누르면 두 번 처리되지 않습니다.');
      }
    });
  }

  return <CustomerServiceDialog busy={pending} onClose={onClose} title={title} wide>
    <div className="flex min-w-0 flex-col gap-4 text-sm leading-relaxed" data-dispatch-delivery-dialog="">
      {!loaded ? <p className="text-muted-foreground" role="status">배송 방식 정보를 불러오는 중입니다…</p>
        : loaded.error ? <AdminNotice role="alert" tone="danger">{loaded.error}</AdminNotice>
        : receipt ? <DispatchReceipt options={options!} receipt={receipt} /> : options ? <>
          {methods.length ? <div className={FIELD}>
            <Label htmlFor={`${fieldId}-method`}>배송 방식</Label>
            <NativeSelect className="w-full max-w-xs" disabled={pending} id={`${fieldId}-method`} onChange={(event) => { setMethod(event.target.value as DispatchMethod); setError(''); }} value={method}>
              {methods.map((candidate) => <option key={candidate} value={candidate}>{dispatchMethodLabel(candidate)}</option>)}
            </NativeSelect>
            <span className={NOTE}>배송비·결제 금액은 바뀌지 않습니다.</span>
            {policiesFor.length ? <ul className={`${NOTE} flex list-disc flex-col gap-0.5 pl-5`}>{policiesFor.map((policy) => <li key={policy.id}>
              {options.shipments.find((shipment) => shipment.originId === policy.originId)?.originName ?? '출고지'} · 담당 {policy.contactName} · 인계 장소 {policy.handoffLocation}
            </li>)}</ul> : null}
            {/* 방문수령은 인계 기록이 없다 — 고를 때만 어디서 끝내는지 말한다. */}
            {method === 'pickup' ? <span className={NOTE}>방문수령은 방식만 바꿉니다. 고객이 와서 수령 확인값을 보여 주면 {canReadOrders ? '주문 상세에서' : "발송관리 줄의 '인계·수령 확인'에서"} 완료합니다.</span> : null}
          </div> : <AdminNotice role="status" tone="warning">고른 배송 건의 출고지에는 사용 중인 택배 외 배송 방식이 없습니다. 배송정보 관리에서 그 출고지의 택배 외 배송 방식을 먼저 켜주세요.</AdminNotice>}
          {handoffMethod ? <label className="flex items-start gap-2"><input checked={handoff} className="mt-1" disabled={pending} onChange={(event) => setHandoff(event.target.checked)} type="checkbox" />
            <span>업체에 넘긴 것까지 지금 기록합니다. 배송중으로 바뀌고 고객 주문 화면에 배송 업체가 보입니다.</span></label> : null}
          {plan.length ? <div className="min-w-0 overflow-x-auto rounded-lg border">
            <Table>
              <caption className="sr-only">처리할 배송 건</caption>
              <TableHeader><TableRow className="bg-muted/50">
                <TableHead scope="col">배송건번호</TableHead><TableHead scope="col">수령인 · 상품</TableHead><TableHead scope="col">고객이 고른 방식</TableHead><TableHead scope="col">지금</TableHead><TableHead scope="col">이번 처리</TableHead>
              </TableRow></TableHeader>
              <TableBody>{plan.map((step) => <TableRow key={step.shipment.id}>
                <TableCell className="tabular-nums">{reference(step.shipment)}<small className="block text-xs text-muted-foreground">{step.shipment.originName}</small></TableCell>
                <TableCell className="min-w-40 whitespace-normal">{summaries[step.shipment.id] ? <>
                  <span className="block">{summaries[step.shipment.id].recipient || '수령인 없음'}</span>
                  {summaries[step.shipment.id].items.map((item, index) => <small className="block text-xs text-muted-foreground" key={`${step.shipment.id}:${index}`}>{item}</small>)}
                </> : <span className="text-xs text-muted-foreground">목록 밖 배송 건</span>}</TableCell>
                <TableCell>{dispatchMethodLabel(step.shipment.customerMethod)}</TableCell>
                <TableCell>{dispatchMethodLabel(step.shipment.method)}</TableCell>
                <TableCell className="whitespace-normal">{step.kind === 'apply'
                  ? <span className="flex flex-wrap items-center gap-1">{step.changeMethod ? <AdminStatusBadge>방식 변경</AdminStatusBadge> : null}{step.handoff ? <AdminStatusBadge>인계 기록</AdminStatusBadge> : null}{step.needsReason ? <AdminStatusBadge tone="warning">이유 필요</AdminStatusBadge> : null}</span>
                  : <span className="text-muted-foreground"><AdminStatusBadge tone="neutral">건너뜀</AdminStatusBadge> {step.reason}</span>}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </div> : null}
          {needsReason ? <label className={FIELD}>
            <span className="font-medium">고객이 고른 방식과 다르게 바꾸는 이유 (필수)</span>
            <Textarea disabled={pending} maxLength={DISPATCH_REASON_MAX_LENGTH} onChange={(event) => setReason(event.target.value)} placeholder="예: 고객이 전화로 퀵 배송을 요청함" required rows={2} value={reason} />
            <span className={NOTE}>{canReadOrders ? '주문 상세의 방식·인계 이력과 ' : '인계 이력과 '}감사 기록에 남습니다.</span>
          </label> : null}
          {withHandoff ? <fieldset className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0" disabled={pending}>
            <legend className="mb-1 font-medium">인계 기록</legend>
            <div className="grid min-w-0 gap-2.5 sm:grid-cols-2">
              <label className={FIELD}><span>인계한 담당자</span><Input maxLength={100} onChange={(event) => setEvidence({ ...evidence, operatorName: event.target.value })} placeholder="물건을 넘긴 우리 담당자" required value={evidence.operatorName} /></label>
              <label className={FIELD}><span>배송 업체·기사</span><Input maxLength={100} onChange={(event) => setEvidence({ ...evidence, providerName: event.target.value })} placeholder="고객 주문 화면에 보입니다" required value={evidence.providerName} /></label>
              <label className={FIELD}><span>업체 연락처</span><Input maxLength={40} onChange={(event) => setEvidence({ ...evidence, providerPhone: event.target.value })} required type="tel" value={evidence.providerPhone} /></label>
              <div className={FIELD}><Label htmlFor={`${fieldId}-occurred`}>인계 시각 (KST)</Label>
                <Input className="w-auto self-start" id={`${fieldId}-occurred`} onChange={(event) => setEvidence({ ...evidence, occurredAt: event.target.value })} required type="datetime-local" value={evidence.occurredAt} /></div>
            </div>
            <label className={FIELD}><span>인계 확인 내용</span><Textarea maxLength={2000} onChange={(event) => setEvidence({ ...evidence, handoffReference: event.target.value })} placeholder="예: 퀵 접수번호 12345, 기사에게 직접 전달" required rows={2} value={evidence.handoffReference} /></label>
            <span className={NOTE}>고른 배송 건 모두에 같은 내용으로 남습니다. 업체나 시각이 다른 건은 따로 처리해주세요.</span>
          </fieldset> : null}
        </> : null}
      {error ? <p className="text-destructive" role="alert">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        {!receipt && lockNote ? <span className={`${NOTE} mr-auto`} data-dispatch-lock-note="">{lockNote}</span> : null}
        <Button disabled={pending} onClick={onClose} type="button" variant="outline">닫기</Button>
        {!receipt && options ? <Button disabled={pending || !applying.length || (needsReason && !reason.trim())} onClick={submit} type="button">
          {pending ? '처리 중…' : withHandoff ? `${applying.length}건 발송처리` : `${applying.length}건 방식 바꾸기`}
        </Button> : null}
      </div>
    </div>
  </CustomerServiceDialog>;
}

function DispatchReceipt({ options, receipt }: { options: DispatchDeliveryOptions; receipt: DispatchDeliveryReceipt }) {
  const label = (id: string) => { const shipment = options.shipments.find((row) => row.id === id); return shipment ? commerceReferenceLabel(shipment.id, shipment.shipmentNumber) : commerceReferenceLabel(id); };
  return <div className="flex flex-col gap-2" role="status">
    <p>방식 변경 {receipt.changed}건 · 인계 기록 {receipt.handedOff}건 · 실패 {receipt.failed}건. 실패한 건은 바뀌지 않았습니다.</p>
    <ul className="flex list-disc flex-col gap-1 pl-5 text-destructive">{receipt.results.filter((row) => !row.ok).map((row) => <li key={row.shipmentId}>
      <span className="tabular-nums">{label(row.shipmentId)}</span>: {dispatchDeliveryError(row.error)}
    </li>)}</ul>
  </div>;
}
