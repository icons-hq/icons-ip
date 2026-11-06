'use client';
import { useRef, useState } from 'react';
import { markStagingTestDeliveredAction, type StagingTestDeliveryResult } from '@/app/admin/staging-test-delivery-actions';
import { AdminField, AdminSectionCard } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { ALERT_BOX, CHECK_LABEL, NOTE, SUCCESS_BOX } from '@/components/admin/settings-kit';
import { ORDER_NUMBER_PATTERN } from '@/lib/admin/staging-test-tools';

/**
 * 스테이징 전용 테스트 배송완료(ADR-0025). 구매확정·리뷰를 시험하려고 발주확인 이후 택배 주문을
 * 운송장 없이 배송완료로 기록한다. 서버와 DB가 모두 스테이징임을 확인한 경우에만 화면에 놓인다.
 */
export function StagingTestDeliveryPanel() {
  const [orderNumber, setOrderNumber] = useState(''), [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const request = useRef<{ orderNumber: string; id: string } | null>(null);
  async function submit() {
    if (pending) return;
    const value = orderNumber.trim();
    if (!ORDER_NUMBER_PATTERN.test(value)) { setMessage('주문번호 16자리를 확인해주세요.'); setError(true); return; }
    if (request.current?.orderNumber !== value) request.current = { orderNumber: value, id: crypto.randomUUID() };
    setPending(true); setMessage('');
    let result: StagingTestDeliveryResult;
    try { result = await markStagingTestDeliveredAction(request.current.orderNumber, request.current.id); }
    catch { result = { error: '처리 결과를 확인하지 못했습니다. 주문 상세에서 현재 상태를 확인해주세요.' }; }
    setPending(false);
    if ('error' in result) { setMessage(result.error); setError(true); return; }
    request.current = null; setError(false); setAcknowledged(false);
    const packed = result.receipt.orderCount > 1 ? ` 합포장으로 묶인 주문 ${result.receipt.orderCount}건을 함께 처리했습니다.` : '';
    setMessage(`주문 ${result.receipt.orderNumber}의 배송 건 ${result.receipt.deliveredShipments}건을 배송완료로 기록했습니다.${packed} 배송 메일은 보내지 않았습니다.`);
  }
  return <AdminSectionCard title="테스트 배송완료 (스테이징 전용)" summary="운영 환경에는 표시되지 않으며 서버와 DB가 모두 거절합니다.">
    <p className={NOTE}>구매확정·리뷰를 시험하려고 발주확인 이후 택배 주문의 남은 배송 건을 운송장 없이 배송완료로 기록합니다. 합포장으로 묶인 배송 건은 묶음 전체를 함께 처리합니다. 실제 발송·배송 메일은 없으며, 배송완료 시각부터 구매확정 기한과 반품 기한이 계산됩니다.</p>
    <form className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={pending} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <legend className="mb-1 text-sm text-muted-foreground">테스트 주문 선택</legend>
        <AdminField label="주문번호 (16자리)" inputId="staging-test-delivery-order">
          <Input autoComplete="off" className="max-w-xs tabular-nums" id="staging-test-delivery-order" inputMode="numeric" maxLength={16} onChange={event => setOrderNumber(event.target.value)} value={orderNumber} />
        </AdminField>
        <label className={CHECK_LABEL}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> 스테이징 테스트 주문임을 확인했습니다</label>
      </fieldset>
      <div className="flex flex-col gap-2">
        <Button className="w-fit" disabled={pending || !acknowledged} type="submit" variant="outline">{pending ? '처리 중…' : '테스트 배송완료'}</Button>
        {message ? <p className={error ? ALERT_BOX : SUCCESS_BOX} role={error ? 'alert' : 'status'}>{message}</p> : null}
      </div>
    </form>
  </AdminSectionCard>;
}
