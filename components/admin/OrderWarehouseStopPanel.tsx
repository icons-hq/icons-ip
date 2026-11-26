'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  loadOrderWarehouseStopAction,
  recordWarehouseStopReplyAction,
  resolveCanceledShipmentDispatchAction,
} from '@/app/admin/warehouse-stop-actions';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { useClaimPreviewBusy } from '@/components/orders/claim-preview-busy';
import { adminConfirm } from '@/lib/admin/confirm';
import { statusTone } from '@/lib/admin/status-tone';
import {
  CANCELED_DISPATCH_NOTE_MIN,
  CANCELED_DISPATCH_STATE_LABELS,
  WAREHOUSE_STOP_CHANNEL_LABELS,
  WAREHOUSE_STOP_CHANNELS,
  WAREHOUSE_STOP_NOTE_LIMIT,
  WAREHOUSE_STOP_OUTCOME_LABELS,
  WAREHOUSE_STOP_RETURNED_LOCK_REASON,
  WAREHOUSE_STOP_STATUS_LABELS,
  canceledDispatchResolveConfirm,
  canceledDispatchResolveMissing,
  isoToKstLocal,
  warehouseStopReplyConfirm,
  warehouseStopReplyMissing,
  warehouseStopRequirement,
  warehouseStopReturnedAllowed,
  type CanceledDispatchResolution,
  type CanceledShipmentDispatch,
  type OrderWarehouseStopContext,
  type WarehouseStopChannel,
  type WarehouseStopOutcome,
  type WarehouseStopShipment,
} from '@/lib/admin/warehouse-stop';
import { formatOrderDateTime } from '@/lib/orders';

const HINT = 'text-xs text-muted-foreground';
const FIELD = 'flex min-w-0 flex-col gap-1.5';
/** 주문 상세 안의 이 패널 위치. 취소 양식의 '창고 회신 기록' 링크가 가리킨다. */
export const WAREHOUSE_STOP_ANCHOR = 'warehouse-stop';

/** 배송 건 이름: 출고지 · 배송건번호. 번호가 없는 옛 배송 건은 내부 번호 대신 '번호 없음'으로 보인다. */
const shipmentLabel = (shipment: { originName: string; shipmentNumber: string | null }) =>
  `${shipment.originName} · ${shipment.shipmentNumber ?? '번호 없음'}`;
const USED_LABELS = { staff_cancellation: '운영자 전액 취소에 씀', partial_cancellation: '재고 부족 부분 취소에 씀', claim_collection: '반품·교환 회수 확인에 씀' } as const;
const SOURCE_LABELS = { tracking_reply: '운송장 회신 올리기', warehouse_reply: '창고 회신(이미 출고)' } as const;

function ReplyHistory({ shipment }: { shipment: WarehouseStopShipment }) {
  if (!shipment.replies.length) return <p className={HINT}>기록된 창고 회신이 없습니다.</p>;
  return <ol className="flex flex-col gap-1.5">{shipment.replies.map(reply => <li className="flex flex-col gap-0.5 rounded-lg border px-3 py-2" key={reply.id}>
    <span className="flex flex-wrap items-center gap-2">
      <AdminStatusBadge tone={statusTone('warehouseStop', reply.outcome)}>{WAREHOUSE_STOP_OUTCOME_LABELS[reply.outcome]}</AdminStatusBadge>
      <span className="tabular-nums">회신 {formatOrderDateTime(reply.repliedAt)}</span>
      <span className="text-muted-foreground">· {WAREHOUSE_STOP_CHANNEL_LABELS[reply.channel]}</span>
      {reply.usedKind ? <AdminStatusBadge>{USED_LABELS[reply.usedKind]}</AdminStatusBadge> : null}
      {reply.supersededAt ? <AdminStatusBadge>발송돼 무효</AdminStatusBadge> : reply.current ? null : <AdminStatusBadge>예전 출고지시의 회신</AdminStatusBadge>}
    </span>
    {reply.note ? <span className="wrap-anywhere">{reply.note}</span> : null}
    <span className={HINT}>기록 {formatOrderDateTime(reply.recordedAt)}{reply.recordedByName ? ` · ${reply.recordedByName}` : ''}</span>
  </li>)}</ol>;
}

/**
 * 창고 회신 기록 양식. 같은 회신을 이 주문의 여러 배송 건에 한 번에 남길 수 있다.
 * 못 하는 것은 누르기 전에 막고 이유를 보인다: 빠진 칸이 있으면 [회신 기록]이, 이미 출고 회신이 없는 배송 건이 섞이면 반송 입고가 잠긴다.
 */
function ReplyForm({ orderId, shipments, onRecorded }: { orderId: string; shipments: WarehouseStopShipment[]; onRecorded: (message: string) => void }) {
  const id = useId();
  const [selected, setSelected] = useState<string[]>(() => shipments.filter(shipment => shipment.stopStatus !== 'stopped').map(shipment => shipment.shipmentId));
  const [outcome, setOutcome] = useState<WarehouseStopOutcome | ''>('');
  const [channel, setChannel] = useState<WarehouseStopChannel | ''>('');
  const [repliedAt, setRepliedAt] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationId = useRef<string | null>(null);
  useClaimPreviewBusy(pending);
  const picked = shipments.filter(shipment => selected.includes(shipment.shipmentId));
  const canceledSelected = picked.some(shipment => shipment.status === 'canceled');
  const returnedAllowed = warehouseStopReturnedAllowed(picked);
  /* 반송 입고를 골라 둔 채 배송 건을 바꿔 못 고르게 되면 고른 것으로 치지 않는다(저장한 선택은 그대로 두고 여기서만 걷어 낸다). */
  const chosen: WarehouseStopOutcome | '' = outcome === 'returned' && !returnedAllowed ? '' : outcome;
  const missing = warehouseStopReplyMissing({ selected: picked.length, outcome: chosen, channel, repliedAt, note });

  async function submit() {
    setError(null);
    if (missing || !chosen) { setError(missing ?? '창고 회신 결과를 골라주세요.'); return; }
    const targets = picked.map(shipmentLabel).join(', ');
    const confirmed = await adminConfirm({ ...warehouseStopReplyConfirm({ targets, outcome: chosen, canceledSelected }), cancelLabel: '돌아가기' });
    if (!confirmed) return;
    operationId.current ??= crypto.randomUUID();
    setPending(true);
    try {
      const result = await recordWarehouseStopReplyAction({ orderId, shipmentIds: selected, outcome: chosen, channel, repliedAt, note, operationId: operationId.current });
      if (result.ok) { operationId.current = null; onRecorded(result.value.message); } else setError(result.error);
    } catch {
      setError('기록됐는지 확인하지 못했습니다. 새로고침해 회신 기록에 남았는지 보고, 없을 때만 다시 기록해주세요.');
    } finally { setPending(false); }
  }

  return <form className="flex min-w-0 flex-col gap-3 border-t pt-3" aria-label="창고 회신 기록" noValidate
    onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h4 className="font-medium">창고 회신 기록</h4>
    <p className={HINT}>회신을 받은 뒤에 적습니다. 출고지시를 다시 보냈다면 회신도 새로 받아야 합니다.</p>
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0" disabled={pending}>
      <legend className="p-0 text-sm font-medium">배송 건</legend>
      {shipments.map(shipment => <label className="flex items-center gap-2" key={shipment.shipmentId}>
        <input checked={selected.includes(shipment.shipmentId)} onChange={event => { operationId.current = null; setSelected(current => event.target.checked
          ? [...current, shipment.shipmentId] : current.filter(value => value !== shipment.shipmentId)); }} type="checkbox" />
        <span className="wrap-anywhere">{shipmentLabel(shipment)}{shipment.status === 'canceled' ? ' (취소됨)' : ''}</span>
      </label>)}
    </fieldset>
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0" disabled={pending}>
      <legend className="p-0 text-sm font-medium">창고 회신 결과</legend>
      {(['stopped', 'already_shipped', 'returned'] as const).map(value => {
        const locked = value === 'returned' && !returnedAllowed;
        return <label className={locked ? 'flex items-start gap-2 text-muted-foreground' : 'flex items-start gap-2'} key={value}>
          <input checked={chosen === value} disabled={locked} name={`${id}-outcome`} onChange={() => { operationId.current = null; setOutcome(value); }} type="radio" value={value} />
          <span>{value === 'stopped' ? '출고 중단 확인 — 창고가 이 배송 건(부분 취소면 그 상품·수량)을 내보내지 않기로 확인했습니다'
            : value === 'already_shipped' ? '이미 출고 — 창고가 이미 내보냈다고 알렸습니다'
              : '반송 입고 — 이미 나간 상품을 고객이 돌려보내 창고에 다시 들어왔습니다'}
            {locked ? <span className="block text-xs" data-warehouse-stop-returned-lock="">{WAREHOUSE_STOP_RETURNED_LOCK_REASON}</span> : null}</span>
        </label>;
      })}
    </fieldset>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={FIELD}><span className="text-sm font-medium">회신 경로</span>
        <NativeSelect className="w-full" disabled={pending} onChange={event => { operationId.current = null; setChannel(event.target.value as WarehouseStopChannel); }} value={channel}>
          <option disabled value="">경로를 골라주세요</option>
          {WAREHOUSE_STOP_CHANNELS.map(value => <option key={value} value={value}>{WAREHOUSE_STOP_CHANNEL_LABELS[value]}</option>)}
        </NativeSelect>
      </label>
      <label className={FIELD}><span className="text-sm font-medium">창고가 회신한 시각 (KST)</span>
        <Input disabled={pending} onChange={event => { operationId.current = null; setRepliedAt(event.target.value); }} type="datetime-local" value={repliedAt} />
      </label>
    </div>
    <Button className="w-fit" disabled={pending} onClick={() => setRepliedAt(isoToKstLocal(new Date()))} size="sm" type="button" variant="outline">현재 시각 입력</Button>
    <label className={FIELD}><span className="text-sm font-medium">{channel === 'other' ? '메모 (필수)' : '메모 (선택)'}</span>
      <Textarea disabled={pending} maxLength={WAREHOUSE_STOP_NOTE_LIMIT} onChange={event => { operationId.current = null; setNote(event.target.value); }}
        placeholder="예: 서원 김OO 담당 카카오톡 14:05 — 포장 전 회수, 출고 목록에서 뺌" rows={2} value={note} />
    </label>
    {error ? <p className="text-destructive" role="alert">{error}</p> : null}
    <div className="flex flex-wrap items-center gap-3">
      <Button aria-describedby={missing ? `${id}-missing` : undefined} className="w-fit" disabled={pending || Boolean(missing)} type="submit">{pending ? '기록 중…' : '회신 기록'}</Button>
      {missing ? <span className={HINT} data-warehouse-stop-missing="" id={`${id}-missing`}>{missing}</span> : null}
    </div>
  </form>;
}

function DispatchResolveForm({ orderId, dispatch, onResolved }: { orderId: string; dispatch: CanceledShipmentDispatch; onResolved: (message: string) => void }) {
  const id = useId();
  const [outcome, setOutcome] = useState<CanceledDispatchResolution | ''>('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationId = useRef<string | null>(null);
  useClaimPreviewBusy(pending);
  const missing = canceledDispatchResolveMissing({ outcome, note });
  async function submit() {
    setError(null);
    if (missing || !outcome) { setError(missing ?? '처리 결과를 골라주세요.'); return; }
    const confirmed = await adminConfirm({
      ...canceledDispatchResolveConfirm({ target: shipmentLabel(dispatch), outcome, withdrawnQty: dispatch.withdrawnQty }),
      cancelLabel: '돌아가기',
      destructive: true,
    });
    if (!confirmed) return;
    operationId.current ??= crypto.randomUUID();
    setPending(true);
    try {
      const result = await resolveCanceledShipmentDispatchAction({ orderId, dispatchId: dispatch.id, outcome, note, operationId: operationId.current });
      if (result.ok) { operationId.current = null; onResolved(result.value.message); } else setError(result.error);
    } catch {
      setError('처리됐는지 확인하지 못했습니다. 새로고침해 처리 결과가 남았는지 보고, 아직 처리 대기면 다시 처리해주세요.');
    } finally { setPending(false); }
  }
  return <form className="flex min-w-0 flex-col gap-2 border-t pt-2" aria-label="취소 뒤 출고 처리" noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0" disabled={pending}>
      <legend className="p-0 text-sm font-medium">처리 결과</legend>
      <label className="flex items-start gap-2"><input checked={outcome === 'returned'} name={`${id}-resolve`} onChange={() => { operationId.current = null; setOutcome('returned'); }} type="radio" value="returned" />
        <span>회수 입고 확인 — 고객에게서 돌려받아 창고에 들어왔습니다(재고를 되돌립니다)</span></label>
      <label className="flex items-start gap-2"><input checked={outcome === 'lost'} name={`${id}-resolve`} onChange={() => { operationId.current = null; setOutcome('lost'); }} type="radio" value="lost" />
        <span>회수 불가·손실 처리 — 돌려받지 못했습니다(재고는 그대로)</span></label>
    </fieldset>
    <label className={FIELD}><span className="text-sm font-medium">근거 (필수)</span>
      <Textarea disabled={pending} maxLength={WAREHOUSE_STOP_NOTE_LIMIT} onChange={event => { operationId.current = null; setNote(event.target.value); }}
        placeholder="예: 11/20 고객 반송 상자 서원 입고 확인(반송 운송장 …)" rows={2} value={note} />
      <small className={HINT}>{CANCELED_DISPATCH_NOTE_MIN}자 이상 적습니다. 처리 결과 줄에 그대로 남습니다.</small>
    </label>
    {error ? <p className="text-destructive" role="alert">{error}</p> : null}
    <div className="flex flex-wrap items-center gap-3">
      <Button aria-describedby={missing ? `${id}-missing` : undefined} className="w-fit" disabled={pending || Boolean(missing)} type="submit" variant="outline">{pending ? '처리 중…' : '처리 기록'}</Button>
      {missing ? <span className={HINT} data-canceled-dispatch-missing="" id={`${id}-missing`}>{missing}</span> : null}
    </div>
  </form>;
}

function DispatchEntry({ orderId, dispatch, canResolve, onChanged }: { orderId: string; dispatch: CanceledShipmentDispatch; canResolve: boolean; onChanged: (message: string) => void }) {
  return <li className="flex flex-col gap-2 rounded-lg border p-3" data-canceled-dispatch={dispatch.state}>
    <span className="flex flex-wrap items-center gap-2">
      <AdminStatusBadge tone={statusTone('canceledDispatch', dispatch.state)}>{CANCELED_DISPATCH_STATE_LABELS[dispatch.state]}</AdminStatusBadge>
      <strong className="font-medium wrap-anywhere">{shipmentLabel(dispatch)}</strong>
    </span>
    <span>{SOURCE_LABELS[dispatch.source]} · 발견 {formatOrderDateTime(dispatch.discoveredAt)}{dispatch.discoveredByName ? ` · ${dispatch.discoveredByName}` : ''}</span>
    <span className="tabular-nums">운송장 · {dispatch.trackingNumber ? `${dispatch.carrierLabel ?? dispatch.carrier ?? ''} ${dispatch.trackingNumber}`.trim() : '아직 없음(창고 운송장 회신을 올리면 붙습니다)'}</span>
    <span className="tabular-nums">재고 · 취소 때 되돌린 {dispatch.restoredQty}개 중 발견 때 다시 뺀 {dispatch.withdrawnQty}개
      {dispatch.shortfallQty ? ` · 그사이 다시 팔려 빼지 못한 ${dispatch.shortfallQty}개(초과 판매 확인 필요)` : ''}</span>
    {dispatch.lines.length ? <ul className={`${HINT} flex flex-col gap-0.5`}>{dispatch.lines.map(line => <li className="wrap-anywhere" key={line.orderItemId}>
      {line.goodName}{line.variantName ? ` · ${line.variantName}` : ''} {line.restoredQty}개</li>)}</ul> : null}
    {dispatch.state !== 'open' ? <span className="wrap-anywhere">{CANCELED_DISPATCH_STATE_LABELS[dispatch.state]}{dispatch.resolvedAt ? ` ${formatOrderDateTime(dispatch.resolvedAt)}` : ''}
      {dispatch.resolvedByName ? ` · ${dispatch.resolvedByName}` : ''}{dispatch.state === 'returned' ? ` · 재고 ${dispatch.returnedQty ?? 0}개 되돌림` : ''}
      {dispatch.resolutionNote ? ` · ${dispatch.resolutionNote}` : ''}</span> : null}
    {dispatch.state === 'open' && canResolve ? <DispatchResolveForm dispatch={dispatch} onResolved={onChanged} orderId={orderId} /> : null}
  </li>;
}

export function OrderWarehouseStopPanelView({ context, onReload }: { context: OrderWarehouseStopContext; onReload: (message?: string) => void }) {
  const open = context.discoveries.filter(dispatch => dispatch.state === 'open');
  const recordable = context.shipments.filter(shipment => shipment.status === 'ready' || shipment.status === 'canceled');
  const pendingStops = context.shipments.filter(shipment => shipment.stopStatus !== 'not_applicable');
  const requirement = warehouseStopRequirement(context);
  return <section aria-label="창고 회신·취소 뒤 출고" className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-sm text-card-foreground"
    data-warehouse-stop-panel="" id={WAREHOUSE_STOP_ANCHOR}>
    <div className="flex flex-col gap-1">
      <h3 className="flex flex-wrap items-center gap-2 text-base leading-snug font-medium">창고 회신·취소 뒤 출고
        {open.length ? <AdminStatusBadge data-canceled-dispatch-badge="" tone={statusTone('canceledDispatch', 'open')}>취소 뒤 출고 발견 {open.length}건</AdminStatusBadge> : null}
      </h3>
      <p className="text-muted-foreground">출고지시가 나간 배송 건은 창고에 출고 중단을 요청하고, 받은 회신을 여기에 기록해야 운영자 전액·부분 취소를 실행할 수 있습니다.</p>
    </div>
    {open.length ? <AdminNotice role="status" tone="danger" title={`취소한 주문의 상품이 출고됐습니다 · ${open.length}건`}>
      환불이 끝난 주문입니다. 고객에게 연락해 반송을 요청하고, 회수 입고를 확인하면 아래에서 처리합니다. 회수할 수 없으면 손실로 처리합니다. 고객 반품 접수는 열리지 않습니다.
    </AdminNotice> : null}
    {context.discoveries.length ? <div className="flex flex-col gap-2">
      <h4 className="font-medium">취소 뒤 출고 발견</h4>
      <ol className="flex flex-col gap-2">{context.discoveries.map(dispatch => <DispatchEntry canResolve={context.canResolve} dispatch={dispatch}
        key={`${dispatch.id}:${dispatch.state}`} onChanged={onReload} orderId={context.orderId} />)}</ol>
    </div> : null}
    {pendingStops.length ? <AdminNotice role="status" tone={statusTone('warehouseStop', requirement.state === 'ready' ? 'stopped' : requirement.state)}
      title={requirement.state === 'ready' ? '취소 근거가 되는 출고 중단 회신이 모두 있습니다' : WAREHOUSE_STOP_STATUS_LABELS[requirement.state]}>
      {requirement.state === 'already_shipped' ? '창고가 이미 출고했다고 회신한 배송 건이 있습니다. 취소하지 말고 운송장 회신을 받아 발송 처리한 뒤 고객 반품으로 접수합니다.'
        : requirement.state === 'required' ? '출고지시가 나간 배송 건입니다. 취소하려면 먼저 창고에 출고 중단을 요청하고 회신을 기록해주세요.'
          : requirement.state === 'used' ? '출고 중단 회신을 이미 다른 취소에 썼습니다. 다시 취소하려면 창고에 확인하고 회신을 새로 기록해주세요.'
            : '이 회신을 근거로 전액·부분 취소를 한 번 실행할 수 있습니다.'}
    </AdminNotice> : null}
    {context.shipments.length ? <ul className="flex flex-col gap-3">{context.shipments.map(shipment => <li className="flex flex-col gap-2" key={shipment.shipmentId}>
      <span className="flex flex-wrap items-center gap-2">
        <strong className="font-medium wrap-anywhere">{shipmentLabel(shipment)}</strong>
        <span className="text-muted-foreground tabular-nums">출고지시 {formatOrderDateTime(shipment.exportedAt)}</span>
        {shipment.stopStatus !== 'not_applicable' ? <AdminStatusBadge data-warehouse-stop-status={shipment.stopStatus} tone={statusTone('warehouseStop', shipment.stopStatus)}>
          {WAREHOUSE_STOP_STATUS_LABELS[shipment.stopStatus]}</AdminStatusBadge> : shipment.status === 'canceled' ? <AdminStatusBadge>취소됨</AdminStatusBadge> : null}
      </span>
      <ReplyHistory shipment={shipment} />
    </li>)}</ul> : null}
    {context.canRecord && recordable.length ? <ReplyForm onRecorded={onReload} orderId={context.orderId} shipments={recordable} /> : null}
  </section>;
}

/**
 * 주문 상세의 창고 회신·취소 뒤 출고 발견(ADR-0046). 출고지시가 나간 배송 건도 발견도 없으면 아무것도 그리지 않는다.
 * 기록은 주문 조회 권한(sales.read)에도 보이고, 기록·처리 버튼은 DB가 알려주는 권한으로만 그린다.
 */
export function OrderWarehouseStopPanel({ orderId }: { orderId: string }) {
  const [context, setContext] = useState<OrderWarehouseStopContext | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadOrderWarehouseStopAction(orderId).then(result => { if (active && result.ok) setContext(result.value); }, () => undefined);
    return () => { active = false; };
  }, [orderId, refresh]);
  if (!context || (!context.shipments.length && !context.discoveries.length)) return null;
  return <div className="flex min-w-0 flex-col gap-2">
    {message ? <AdminNotice role="status" tone="info">{message}</AdminNotice> : null}
    <OrderWarehouseStopPanelView context={context} key={`${orderId}:${refresh}`} onReload={next => { setMessage(next ?? null); setRefresh(value => value + 1); }} />
  </div>;
}

/**
 * 운영자 전액·부분 취소 양식 안의 창고 회신 상태 한 줄. 확인란 대신 이 줄이 근거를 보인다 — 회신이 없으면 주문 상세의
 * 창고 회신 기록으로 잇는다. 판정의 진실원은 DB다(양식을 연 뒤 회신이 바뀌면 실행 때 DB가 다시 거절한다).
 */
export function WarehouseStopRequirementNote({ orderId, shipmentIds, detailHref }: { orderId: string; shipmentIds?: readonly string[]; detailHref: string }) {
  const [context, setContext] = useState<OrderWarehouseStopContext | null>(null);
  const [failed, setFailed] = useState(false);
  const key = shipmentIds?.join(',') ?? '';
  useEffect(() => {
    let active = true;
    void loadOrderWarehouseStopAction(orderId).then(result => {
      if (!active) return;
      if (result.ok) setContext(result.value); else setFailed(true);
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [orderId, key]);
  const href = `${detailHref}#${WAREHOUSE_STOP_ANCHOR}`;
  if (!context) {
    return <p className="text-sm" data-warehouse-stop-requirement={failed ? 'unknown' : 'loading'}>
      출고지시가 나간 배송 건이 있습니다. 창고의 출고 중단 회신 기록이 있어야 취소됩니다.{' '}
      <a className="underline underline-offset-4" href={href}>주문 상세에서 창고 회신 확인·기록</a>
    </p>;
  }
  const requirement = warehouseStopRequirement(context, shipmentIds);
  return <div className="flex flex-col items-start gap-1 text-sm" data-warehouse-stop-requirement={requirement.state}>
    <span className="flex flex-wrap items-center gap-2">
      <AdminStatusBadge tone={statusTone('warehouseStop', requirement.state === 'ready' ? 'stopped' : requirement.state)}>
        {requirement.state === 'ready' ? WAREHOUSE_STOP_STATUS_LABELS.stopped : WAREHOUSE_STOP_STATUS_LABELS[requirement.state]}</AdminStatusBadge>
      <span className="wrap-anywhere">{requirement.shipments.map(shipmentLabel).join(', ')}</span>
    </span>
    <span>{requirement.state === 'ready' ? '창고의 출고 중단 회신이 기록돼 있어 취소할 수 있습니다.'
      : requirement.state === 'already_shipped' ? '창고가 이미 출고했다고 회신했습니다. 취소하지 말고 발송 처리 뒤 고객 반품으로 접수해주세요.'
        : '창고에 출고 중단을 요청하고 회신을 기록한 뒤 실행해주세요.'}{' '}
      <a className="underline underline-offset-4" href={href}>{requirement.state === 'ready' ? '회신 기록 보기' : '창고 회신 기록하기'}</a></span>
  </div>;
}
