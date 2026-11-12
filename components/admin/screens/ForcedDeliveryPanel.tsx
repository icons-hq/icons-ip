'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { forceOrderDeliveredAction, previewForcedDeliveryAction } from '@/app/admin/forced-delivery-actions';
import { AdminField, AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { SalesDisclosureCard } from '@/components/admin/sales/SalesConsole';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { CHECK_LABEL, CHECK_LABEL_TOP, NOTE } from '@/components/admin/settings-kit';
import { ADMIN_ORDER_STATUS_LABELS } from '@/lib/admin/orders';
import {
  FORCED_DELIVERY_ANCHOR, FORCED_DELIVERY_REASON_MAX_LENGTH, forcedDeliveryBlockerLabel, forcedDeliveryExportedPending, forcedDeliveryTargets, normalizeForcedDeliveryOrderNumber,
  type ForcedDeliveryPreview,
} from '@/lib/admin/forced-delivery';
import { commerceReferenceLabel } from '@/lib/commerce-number';
import { formatOrderDateTime } from '@/lib/orders';
import { shipmentStatusLabel } from '@/lib/orders/shipments';
import { DELIVERY_METHOD_LABELS } from '@/lib/shipment-delivery';
import { CustomerServiceDialog } from './CustomerServiceDialog';

/** 강제 배송완료가 일으키는 일. 카드 안내와 확인창이 같은 목록을 보인다. */
const EFFECTS = [
  '실제 배송과 관계없이 남은 배송 건(발송 전·배송 중)을 배송완료로 기록합니다. 택배는 운송장 없이, 퀵·직접배송·화물배송·방문수령·배송없음은 인계·일회 수령 확인값 대신 "강제 배송완료" 기록으로 옮깁니다. 합포장으로 묶인 배송 건은 묶음 전체를 함께 처리합니다.',
  '주문이 배송완료가 되면 고객에게 앱 알림 "배송이 완료됐어요"가 갑니다. 일부 배송 건만 남으면 주문은 배송중이 되고 "배송이 시작됐어요" 알림이 갈 수 있습니다. 배송 메일은 보내지 않습니다.',
  '배송완료 시각부터 구매확정·반품 기한이 계산되고 자동 구매확정·리뷰 작성이 정상 배송완료와 같이 열립니다.',
  '예외: 디지털 파일 배송 건은 구매자가 내려받을 때만 제공 시작으로 기록되어 제외합니다. 예약 재고 미할당·주문제작 미완료(실물 없음), 진행 중인 취소·반품·교환, 발주확인 전 주문은 처리하지 않습니다.',
];

/**
 * 강제 배송완료(1014-083, 2026-11-11 결정 '운영 전체 주문 허용'). 구매확정·리뷰를 시험하려고 운영에서도 주문을
 * 배송완료로 바꾼다. 안전장치: 사유 필수, 대상을 보여 주는 확인창(구매자·배송 건·배송 방법·출고지시 전달 여부·합포장
 * 동반 주문·막는 사유), 확인 체크(출고지시를 전달한 건이 있으면 창고 확인 체크 추가), 같은 요청 번호 재전송, 감사 기록.
 * 처리할 주문 목록을 밀어내지 않도록 접어 둔다. 주문 상세(전용 화면·목록 위 팝업)의 [강제 배송완료]로 열면 그 주문번호를 채우고
 * 펼친 채로 연다(QA1 S-T04-05) — 사유·확인창·감사 규칙은 같다.
 */
export function ForcedDeliveryPanel({ initialOrderNumber = null }: {
  /** 주문 상세에서 고른 주문번호(서버가 형식을 확인한 값). 있으면 카드를 펼치고 사유 칸으로 바로 간다. */
  initialOrderNumber?: string | null;
} = {}) {
  const router = useRouter();
  const [orderNumber, setOrderNumber] = useState(initialOrderNumber ?? ''), [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ preview: ForcedDeliveryPreview; reason: string } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false), [warehouseChecked, setWarehouseChecked] = useState(false);
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [dialogError, setDialogError] = useState('');
  /* 결과를 모른 채 끊긴 요청만 같은 요청 번호로 다시 보낸다. 대상 확인을 새로 하면 새 번호다. */
  const operation = useRef<string | null>(null);

  async function review() {
    if (pending) return;
    const value = normalizeForcedDeliveryOrderNumber(orderNumber), trimmed = reason.trim();
    if (!value) { setError('주문번호 전체를 확인해주세요.'); setMessage(''); return; }
    if (!trimmed || trimmed.length > FORCED_DELIVERY_REASON_MAX_LENGTH) { setError(`사유를 1~${FORCED_DELIVERY_REASON_MAX_LENGTH}자로 입력해주세요.`); setMessage(''); return; }
    setPending(true); setError(''); setMessage('');
    let result: Awaited<ReturnType<typeof previewForcedDeliveryAction>>;
    try { result = await previewForcedDeliveryAction(value); } catch { result = { error: '대상을 불러오지 못했습니다. 잠시 후 다시 확인해주세요.' }; }
    setPending(false);
    if ('error' in result) { setError(result.error); return; }
    operation.current = crypto.randomUUID(); setAcknowledged(false); setWarehouseChecked(false); setDialogError('');
    setPreview({ preview: result.preview, reason: trimmed });
  }

  const target = preview?.preview;
  const targets = target ? forcedDeliveryTargets(target) : [];
  const exported = target ? forcedDeliveryExportedPending(target) : [];
  const ready = Boolean(target && !target.blockers.length && acknowledged && (!exported.length || warehouseChecked));

  async function confirm() {
    if (pending || !preview || !ready) return;
    operation.current ??= crypto.randomUUID();
    setPending(true); setDialogError('');
    let result: Awaited<ReturnType<typeof forceOrderDeliveredAction>>;
    try { result = await forceOrderDeliveredAction(preview.preview.orderNumber, preview.reason, operation.current); }
    catch { setPending(false); setDialogError('처리 결과를 확인하지 못했습니다. 같은 내용으로 다시 누르면 같은 요청으로 확인합니다.'); return; }
    setPending(false);
    operation.current = null;
    if ('error' in result) { setDialogError(result.error); return; }
    const packed = result.receipt.orderCount > 1 ? ` 합포장으로 묶인 주문 ${result.receipt.orderCount}건을 함께 처리했습니다.` : '';
    const notified = result.receipt.status === 'delivered' ? ' 고객에게 앱 알림 "배송이 완료됐어요"가 갔습니다.' : ' 주문에 남은 배송 건(디지털 파일 등)이 있어 주문은 아직 배송완료가 아닙니다.';
    setPreview(null); setOrderNumber(''); setReason(''); setError('');
    setMessage(`주문 ${result.receipt.orderNumber}의 배송 건 ${result.receipt.deliveredShipments}건을 배송완료로 기록했습니다.${packed}${notified} 배송 메일은 보내지 않았고 사유는 감사 기록에 남았습니다.`);
    router.refresh();
  }

  return <SalesDisclosureCard closeLabel="접기" defaultOpen={Boolean(initialOrderNumber)} id={FORCED_DELIVERY_ANCHOR} openLabel="펼치기" status={<AdminStatusBadge tone="warning">감사 기록</AdminStatusBadge>}
    summary="실제 배송과 관계없이 주문을 배송완료로 기록합니다. 시험 주문의 구매확정·리뷰 확인처럼 꼭 필요할 때만 씁니다." title="강제 배송완료">
    <ul className={`${NOTE} flex list-disc flex-col gap-1 pl-5`}>{EFFECTS.map(effect => <li key={effect}>{effect}</li>)}<li>처리자·사유·처리한 배송 건은 감사 기록과 주문 기록에 남습니다.</li>
      <li>주문 상세(목록에서 주문번호를 눌러 여는 상세 포함)의 [강제 배송완료]를 누르면 그 주문번호를 채워 이 카드를 엽니다.</li></ul>
    {initialOrderNumber && orderNumber === initialOrderNumber ? <AdminNotice role="status" tone="info">주문 상세에서 고른 주문 <span className="tabular-nums">{initialOrderNumber}</span>를 채웠습니다. 사유를 입력하고 대상 확인을 눌러주세요.</AdminNotice> : null}
    <form className="flex min-w-0 flex-col gap-4" data-forced-delivery="" onSubmit={event => { event.preventDefault(); void review(); }}>
      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={pending}>
        <legend className="mb-1 text-sm text-muted-foreground">강제 배송완료할 주문</legend>
        <AdminField inputId="forced-delivery-order" label="주문번호 (전체)">
          <Input autoComplete="off" className="max-w-xs tabular-nums" id="forced-delivery-order" inputMode="numeric" maxLength={32} onChange={event => setOrderNumber(event.target.value)} value={orderNumber} />
        </AdminField>
        <AdminField hint={`예: 구매확정·리뷰 시험 주문. ${FORCED_DELIVERY_REASON_MAX_LENGTH}자까지 감사 기록에 남습니다.`} inputId="forced-delivery-reason" label="사유 (필수)">
          <Textarea autoFocus={Boolean(initialOrderNumber)} className="max-w-xl" id="forced-delivery-reason" maxLength={FORCED_DELIVERY_REASON_MAX_LENGTH} onChange={event => setReason(event.target.value)} rows={2} value={reason} />
        </AdminField>
      </fieldset>
      <div className="flex flex-col gap-2">
        <Button className="w-fit" disabled={pending} type="submit" variant="outline">{pending && !preview ? '확인 중…' : '대상 확인'}</Button>
        {error ? <AdminNotice role="alert" tone="danger">{error}</AdminNotice> : null}
        {message ? <AdminNotice role="status" tone="success">{message}</AdminNotice> : null}
      </div>
    </form>
    {target ? <CustomerServiceDialog busy={pending} onClose={() => { setPreview(null); setDialogError(''); }} title="강제 배송완료 확인" wide>
      <div className="flex min-w-0 flex-col gap-3 text-sm leading-relaxed" data-forced-delivery-confirm="">
        <dl className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">주문번호</dt><dd className="tabular-nums">{target.orderNumber}</dd>
          <dt className="text-muted-foreground">구매자 · 주문일</dt><dd>{target.buyerName} · <span className="tabular-nums">{formatOrderDateTime(target.createdAt)}</span></dd>
          <dt className="text-muted-foreground">주문 상태</dt><dd>{(ADMIN_ORDER_STATUS_LABELS as Record<string, string>)[target.status] ?? target.status}</dd>
          <dt className="text-muted-foreground">상품</dt><dd className="wrap-anywhere">{target.firstItemName ?? '상품 기록 없음'}{target.itemCount > 1 ? ` 외 ${target.itemCount - 1}건` : ''}</dd>
          <dt className="text-muted-foreground">사유</dt><dd className="whitespace-pre-wrap wrap-anywhere">{preview.reason}</dd>
        </dl>
        {target.shipments.length ? <div className="min-w-0 overflow-x-auto rounded-lg border"><Table>
          <caption className="sr-only">배송완료로 기록할 배송 건</caption>
          <TableHeader><TableRow className="bg-muted/50"><TableHead scope="col">배송건번호</TableHead><TableHead scope="col">주문번호</TableHead><TableHead scope="col">출고지</TableHead>
            <TableHead scope="col">배송 방법</TableHead><TableHead scope="col">지금 상태</TableHead><TableHead scope="col">출고지시 · 운송장</TableHead><TableHead scope="col">이번 처리</TableHead></TableRow></TableHeader>
          <TableBody>{target.shipments.map(shipment => <TableRow key={shipment.id}>
            <TableCell className="tabular-nums">{commerceReferenceLabel(shipment.id, shipment.shipmentNumber)}</TableCell>
            <TableCell className="tabular-nums">{shipment.orderNumber ?? '-'}</TableCell>
            <TableCell>{shipment.originName}</TableCell>
            <TableCell>{DELIVERY_METHOD_LABELS[shipment.method]}</TableCell>
            <TableCell>{shipmentStatusLabel(shipment.status)}</TableCell>
            <TableCell className="whitespace-normal">{shipment.exportedAt ? <AdminStatusBadge tone="warning">출고지시 전달</AdminStatusBadge> : <span className="text-muted-foreground">전달 전</span>}{shipment.trackingNumber ? <span className="ml-1 tabular-nums">{shipment.trackingNumber}</span> : null}</TableCell>
            <TableCell className="whitespace-normal">{shipment.method === 'digital' ? <span className="text-muted-foreground"><AdminStatusBadge>제외</AdminStatusBadge> 구매자 내려받기로 완료</span> : '배송완료로 기록'}</TableCell>
          </TableRow>)}</TableBody>
        </Table></div> : null}
        {target.orderCount > 1 ? <AdminNotice role="status" tone="warning">합포장으로 묶인 다른 주문까지 모두 {target.orderCount}개 주문이 함께 배송완료됩니다.</AdminNotice> : null}
        {target.blockers.length ? <AdminNotice role="alert" title="이 주문은 지금 강제 배송완료할 수 없습니다" tone="danger">
          <ul className="flex list-disc flex-col gap-1 pl-5">{target.blockers.map(blocker => <li key={blocker}>{forcedDeliveryBlockerLabel(blocker)}</li>)}</ul>
        </AdminNotice> : <>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground" data-forced-delivery-effects="">{EFFECTS.map(effect => <li key={effect}>{effect}</li>)}<li>처리 후에는 이 화면에서 되돌릴 수 없습니다.</li></ul>
          {exported.length ? <AdminNotice role="alert" title={`출고지시를 이미 전달한 배송 건 ${exported.length}건이 있습니다`} tone="warning">
            창고가 실제 출고할 수 있습니다. 배송완료로 기록해도 창고 출고는 멈추지 않으므로, 실제로 보내지 않을 주문이면 창고에 출고 보류를 먼저 요청해주세요.
          </AdminNotice> : null}
          <label className={CHECK_LABEL}><input checked={acknowledged} disabled={pending} onChange={event => setAcknowledged(event.target.checked)} type="checkbox" /> 실제 배송과 관계없이 배송완료로 기록되고 고객에게 앱 알림이 가는 것을 확인했습니다</label>
          {exported.length ? <label className={CHECK_LABEL_TOP}><input checked={warehouseChecked} className="mt-1" disabled={pending} onChange={event => setWarehouseChecked(event.target.checked)} type="checkbox" /> 출고지시를 전달한 배송 건의 창고 출고 여부(출고 보류 요청 포함)를 확인했습니다</label> : null}
        </>}
        {dialogError ? <p className="text-destructive" role="alert">{dialogError}</p> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button disabled={pending} onClick={() => { setPreview(null); setDialogError(''); }} type="button" variant="outline">취소</Button>
          {target.blockers.length ? null : <Button disabled={pending || !ready} onClick={() => void confirm()} type="button" variant="destructive">
            {pending ? '처리 중…' : `${targets.length}건 강제 배송완료`}
          </Button>}
        </div>
      </div>
    </CustomerServiceDialog> : null}
  </SalesDisclosureCard>;
}
