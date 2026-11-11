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
import { CHECK_LABEL, NOTE } from '@/components/admin/settings-kit';
import { ADMIN_ORDER_STATUS_LABELS } from '@/lib/admin/orders';
import { FORCED_DELIVERY_REASON_MAX_LENGTH, forcedDeliveryBlockerLabel, normalizeForcedDeliveryOrderNumber, type ForcedDeliveryPreview } from '@/lib/admin/forced-delivery';
import { commerceReferenceLabel } from '@/lib/commerce-number';
import { formatOrderDateTime } from '@/lib/orders';
import { shipmentStatusLabel } from '@/lib/orders/shipments';
import { CustomerServiceDialog } from './CustomerServiceDialog';

const EFFECTS = '발주확인 이후 택배 주문의 남은 배송 건(발송 전·배송 중)을 운송장 없이 배송완료로 기록합니다. 합포장으로 묶인 배송 건은 묶음 전체를 함께 처리합니다. 배송 메일은 보내지 않으며, 배송완료 시각부터 구매확정 기한·반품 기한이 계산되고 자동 구매확정·리뷰 작성이 정상 배송완료와 같이 열립니다.';

/**
 * 강제 배송완료(1014-083, 2026-11-11 결정 '운영 전체 주문 허용'). 구매확정·리뷰를 시험하려고 운영에서도 주문을
 * 배송완료로 바꾼다. 안전장치: 사유 필수, 대상을 보여 주는 확인창(구매자·배송 건·합포장 동반 주문·막는 사유),
 * 확인 체크, 같은 요청 번호 재전송, 감사 기록. 처리할 주문 목록을 밀어내지 않도록 접어 둔다.
 */
export function ForcedDeliveryPanel() {
  const router = useRouter();
  const [orderNumber, setOrderNumber] = useState(''), [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ preview: ForcedDeliveryPreview; reason: string } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
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
    operation.current = crypto.randomUUID(); setAcknowledged(false); setDialogError('');
    setPreview({ preview: result.preview, reason: trimmed });
  }

  async function confirm() {
    if (pending || !preview || !acknowledged || preview.preview.blockers.length) return;
    operation.current ??= crypto.randomUUID();
    setPending(true); setDialogError('');
    let result: Awaited<ReturnType<typeof forceOrderDeliveredAction>>;
    try { result = await forceOrderDeliveredAction(preview.preview.orderNumber, preview.reason, operation.current); }
    catch { setPending(false); setDialogError('처리 결과를 확인하지 못했습니다. 같은 내용으로 다시 누르면 같은 요청으로 확인합니다.'); return; }
    setPending(false);
    operation.current = null;
    if ('error' in result) { setDialogError(result.error); return; }
    const packed = result.receipt.orderCount > 1 ? ` 합포장으로 묶인 주문 ${result.receipt.orderCount}건을 함께 처리했습니다.` : '';
    setPreview(null); setOrderNumber(''); setReason(''); setError('');
    setMessage(`주문 ${result.receipt.orderNumber}의 배송 건 ${result.receipt.deliveredShipments}건을 배송완료로 기록했습니다.${packed} 배송 메일은 보내지 않았고, 사유는 감사 기록에 남았습니다.`);
    router.refresh();
  }

  const target = preview?.preview;
  return <SalesDisclosureCard closeLabel="접기" openLabel="펼치기" status={<AdminStatusBadge tone="warning">감사 기록</AdminStatusBadge>}
    summary="실제 배송과 관계없이 주문을 배송완료로 기록합니다. 시험 주문의 구매확정·리뷰 확인처럼 꼭 필요할 때만 씁니다." title="강제 배송완료">
    <p className={NOTE}>{EFFECTS} 처리자·사유·처리한 배송 건은 감사 기록과 주문 기록에 남습니다.</p>
    <form className="flex min-w-0 flex-col gap-4" data-forced-delivery="" onSubmit={event => { event.preventDefault(); void review(); }}>
      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={pending}>
        <legend className="mb-1 text-sm text-muted-foreground">강제 배송완료할 주문</legend>
        <AdminField inputId="forced-delivery-order" label="주문번호 (전체)">
          <Input autoComplete="off" className="max-w-xs tabular-nums" id="forced-delivery-order" inputMode="numeric" maxLength={32} onChange={event => setOrderNumber(event.target.value)} value={orderNumber} />
        </AdminField>
        <AdminField hint={`예: 구매확정·리뷰 시험 주문. ${FORCED_DELIVERY_REASON_MAX_LENGTH}자까지 감사 기록에 남습니다.`} inputId="forced-delivery-reason" label="사유 (필수)">
          <Textarea className="max-w-xl" id="forced-delivery-reason" maxLength={FORCED_DELIVERY_REASON_MAX_LENGTH} onChange={event => setReason(event.target.value)} rows={2} value={reason} />
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
          <TableHeader><TableRow className="bg-muted/50"><TableHead scope="col">배송건번호</TableHead><TableHead scope="col">주문번호</TableHead><TableHead scope="col">출고지</TableHead><TableHead scope="col">지금 상태</TableHead><TableHead scope="col">운송장</TableHead></TableRow></TableHeader>
          <TableBody>{target.shipments.map(shipment => <TableRow key={shipment.id}>
            <TableCell className="tabular-nums">{commerceReferenceLabel(shipment.id, shipment.shipmentNumber)}</TableCell>
            <TableCell className="tabular-nums">{shipment.orderNumber ?? '-'}</TableCell>
            <TableCell>{shipment.originName}</TableCell>
            <TableCell>{shipmentStatusLabel(shipment.status)}</TableCell>
            <TableCell className="tabular-nums">{shipment.trackingNumber ?? '없음'}</TableCell>
          </TableRow>)}</TableBody>
        </Table></div> : null}
        {target.orderCount > 1 ? <AdminNotice role="status" tone="warning">합포장으로 묶인 다른 주문까지 모두 {target.orderCount}개 주문이 함께 배송완료됩니다.</AdminNotice> : null}
        {target.blockers.length ? <AdminNotice role="alert" title="이 주문은 지금 강제 배송완료할 수 없습니다" tone="danger">
          <ul className="flex list-disc flex-col gap-1 pl-5">{target.blockers.map(blocker => <li key={blocker}>{forcedDeliveryBlockerLabel(blocker)}</li>)}</ul>
        </AdminNotice> : <>
          <p className="text-muted-foreground">{EFFECTS} 처리 후에는 이 화면에서 되돌릴 수 없습니다.</p>
          <label className={CHECK_LABEL}><input checked={acknowledged} disabled={pending} onChange={event => setAcknowledged(event.target.checked)} type="checkbox" /> 실제 배송과 관계없이 배송완료로 기록되는 것을 확인했습니다</label>
        </>}
        {dialogError ? <p className="text-destructive" role="alert">{dialogError}</p> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button disabled={pending} onClick={() => { setPreview(null); setDialogError(''); }} type="button" variant="outline">취소</Button>
          {target.blockers.length ? null : <Button disabled={pending || !acknowledged} onClick={() => void confirm()} type="button" variant="destructive">
            {pending ? '처리 중…' : `${target.shipments.length}건 강제 배송완료`}
          </Button>}
        </div>
      </div>
    </CustomerServiceDialog> : null}
  </SalesDisclosureCard>;
}
