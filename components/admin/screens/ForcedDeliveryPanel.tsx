'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { forceOrderDeliveredAction, previewForcedDeliveryAction } from '@/app/admin/forced-delivery-actions';
import { searchForcedDeliveryOrdersAction } from '@/app/admin/forced-delivery-picker-actions';
import { AdminPickedBox } from '@/components/admin/AdminPickedValue';
import { AdminField, AdminNotice } from '@/components/admin/console/AdminKit';
import { AdminPickerDialog, type AdminPickerRowView } from '@/components/admin/console/AdminPickerDialog';
import { SalesDisclosureCard } from '@/components/admin/sales/SalesConsole';
import { Button } from '@/components/admin/kit/ui/button';
import { adminPrompt } from '@/lib/admin/confirm';
import { ADMIN_ORDER_SEARCH_FIELDS, ADMIN_ORDER_STATUS_LABELS, ADMIN_ORDER_STATUSES } from '@/lib/admin/orders';
import {
  FORCED_DELIVERY_ANCHOR, FORCED_DELIVERY_REASON_LABEL, FORCED_DELIVERY_REASON_MAX_LENGTH, FORCED_DELIVERY_REASON_PLACEHOLDER, forcedDeliveryBlockerLabel, forcedDeliveryConfirmMessage,
  type ForcedDeliveryPreview,
} from '@/lib/admin/forced-delivery';
import { FORCED_DELIVERY_PICKER_FIELDS, FORCED_DELIVERY_PICKER_STATUSES, forcedDeliveryOrderBlocked, type ForcedDeliveryOrderRow } from '@/lib/admin/forced-delivery-picker';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';

/* 주문 고르기 선택창(화면 규칙 1·2). 강제 배송완료를 할 수 있는 상태(발주확인·배송중)만 조건으로 나눠 보이고, 그 밖의 상태는 목록에 넣지 않는다. */
const loadOrders: AdminPickerLoader<ForcedDeliveryOrderRow> = async (request) => {
  const result = await searchForcedDeliveryOrdersAction({ query: request.query, field: request.field, filter: request.filter, page: request.page });
  return result.ok ? result.data : { error: result.error };
};
const SEARCH_FIELDS = ADMIN_ORDER_SEARCH_FIELDS.filter(field => (FORCED_DELIVERY_PICKER_FIELDS as readonly string[]).includes(field.value));
const STATUS_OPTIONS = FORCED_DELIVERY_PICKER_STATUSES.map(status => ({ value: status, label: ADMIN_ORDER_STATUS_LABELS[status] }));
const EXCLUDED_NOTE = `${ADMIN_ORDER_STATUSES.filter(status => !(FORCED_DELIVERY_PICKER_STATUSES as readonly string[]).includes(status)).map(status => ADMIN_ORDER_STATUS_LABELS[status]).join('·')} 주문은 목록에서 뺐습니다.`;
const orderRowKey = (row: ForcedDeliveryOrderRow) => row.orderNumber;
const orderRowView = (row: ForcedDeliveryOrderRow): AdminPickerRowView => ({
  title: <><span className="tabular-nums">{orderReferenceLabel(row.orderId, row.orderNumber)}</span> · {row.buyerName}</>,
  /* 목록은 고른 주문 상태 하나만 보이므로 줄마다 상태를 되풀이하지 않는다. */
  meta: `${formatOrderDateTime(row.createdAt)} · ${row.total.toLocaleString('ko-KR')}원`,
});

/** 고른 주문. 주문 상세에서 번호만 넘어온 경우 text는 번호뿐이다. */
interface PickedOrder { orderNumber: string; text: string }

/**
 * 강제 배송완료(1014-083, 2026-11-11 결정 '운영 전체 주문 허용'). 구매확정·리뷰를 시험하려고 운영에서도 주문을 배송완료로 바꾼다.
 * 주문번호를 손으로 적지 않는다 — 주문 상세의 [강제 배송완료]로 열면 그 주문이 골라진 채 열리고(QA1 S-T04-05), 그냥 들어오면 [주문 고르기]로 찾는다.
 * [강제 배송완료]를 누르면 DB 미리보기로 막는 사유를 먼저 읽고(있으면 카드에 이유를 보이고 멈춘다), 없으면 주문번호·구매자·상품·지금 상태와
 * 실행 결과를 말하는 확인창에서 사유(필수 — 감사 기록)를 받아 실행한다. 같은 요청 번호 재전송·감사 기록은 그대로다.
 * 처리할 주문 목록을 밀어내지 않도록 접어 둔다.
 */
export function ForcedDeliveryPanel({ initialOrderNumber = null }: {
  /** 주문 상세에서 고른 주문번호(서버가 형식을 확인한 값). 있으면 카드를 펼치고 그 주문을 고른 채로 연다. */
  initialOrderNumber?: string | null;
} = {}) {
  const router = useRouter();
  const [picked, setPicked] = useState<PickedOrder | null>(initialOrderNumber ? { orderNumber: initialOrderNumber, text: initialOrderNumber } : null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<'' | 'checking' | 'processing'>('');
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const [blocked, setBlocked] = useState<ForcedDeliveryPreview | null>(null);
  const pickedInput = useRef<HTMLInputElement>(null);
  /* 결과를 모른 채 끊긴 처리만 같은 요청 번호로 다시 보낸다. 주문이나 사유가 바뀌면 새 번호다. */
  const operation = useRef<{ key: string; id: string } | null>(null);

  async function start() {
    if (busy) return;
    setError(''); setMessage(''); setBlocked(null);
    if (!picked) { setError('강제 배송완료할 주문을 먼저 골라주세요.'); return; }
    setBusy('checking');
    try {
      let preview: Awaited<ReturnType<typeof previewForcedDeliveryAction>>;
      try { preview = await previewForcedDeliveryAction(picked.orderNumber); } catch { preview = { error: '대상을 불러오지 못했습니다. 잠시 뒤 다시 눌러주세요.' }; }
      if ('error' in preview) { setError(preview.error); return; }
      const target = preview.preview;
      if (target.blockers.length) { setBlocked(target); return; }
      const reason = await adminPrompt({
        title: '강제 배송완료', confirmLabel: '강제 배송완료', cancelLabel: '돌아가기', destructive: true,
        message: forcedDeliveryConfirmMessage(target, (ADMIN_ORDER_STATUS_LABELS as Record<string, string>)[target.status] ?? target.status),
        input: { label: FORCED_DELIVERY_REASON_LABEL, placeholder: FORCED_DELIVERY_REASON_PLACEHOLDER, minLength: 1, maxLength: FORCED_DELIVERY_REASON_MAX_LENGTH },
      });
      if (reason === null) return;
      const key = `${target.orderNumber}\u0000${reason}`;
      if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() };
      setBusy('processing');
      let result: Awaited<ReturnType<typeof forceOrderDeliveredAction>>;
      try { result = await forceOrderDeliveredAction(target.orderNumber, reason, operation.current.id); }
      catch { setError('배송완료로 기록됐는지 확인하지 못했습니다. 같은 사유로 [강제 배송완료]를 다시 누르면 두 번 처리되지 않습니다. 주문 상세에서 지금 상태도 확인할 수 있습니다.'); return; }
      operation.current = null;
      if ('error' in result) { setError(result.error); return; }
      const packed = result.receipt.orderCount > 1 ? ` 합포장으로 묶인 주문 ${result.receipt.orderCount}건을 함께 처리했습니다.` : '';
      const notified = result.receipt.status === 'delivered' ? ' 고객에게 앱 알림 "배송이 완료됐어요"가 갔습니다.' : ' 주문에 남은 배송 건(디지털 파일 등)이 있어 주문은 아직 배송완료가 아닙니다.';
      setPicked(null);
      setMessage(`주문 ${result.receipt.orderNumber}의 배송 건 ${result.receipt.deliveredShipments}건을 배송완료로 기록했습니다.${packed}${notified} 사유는 감사 기록에 남았습니다.`);
      router.refresh();
    } finally { setBusy(''); }
  }

  return <SalesDisclosureCard closeLabel="접기" defaultOpen={Boolean(initialOrderNumber)} id={FORCED_DELIVERY_ANCHOR} openLabel="펼치기"
    summary="실제 배송과 관계없이 주문을 배송완료로 기록합니다. 시험 주문으로 거래확정·리뷰를 확인할 때처럼 꼭 필요할 때만 씁니다." title="강제 배송완료">
    <div className="flex min-w-0 flex-col gap-4" data-forced-delivery="">
      <AdminField inputId="forced-delivery-order" label="강제 배송완료할 주문">
        <AdminPickedBox inputId="forced-delivery-order" inputRef={pickedInput} name="forcedDeliveryOrder" onOpen={() => { if (!busy) setPicking(true); }}
          pickLabel="주문 고르기" placeholder="아직 고르지 않았습니다" text={picked?.text ?? ''} value={picked?.orderNumber ?? ''} />
      </AdminField>
      <div className="flex min-w-0 flex-col gap-2">
        <Button autoFocus={Boolean(initialOrderNumber)} className="w-fit" disabled={Boolean(busy)} onClick={() => void start()} type="button" variant="outline">
          {busy === 'checking' ? '확인 중…' : busy === 'processing' ? '처리 중…' : '강제 배송완료'}
        </Button>
        {blocked ? <AdminNotice role="alert" title="이 주문은 지금 강제 배송완료할 수 없습니다" tone="danger">
          <ul className="flex list-disc flex-col gap-1 pl-5">{blocked.blockers.map(blocker => <li key={blocker}>{forcedDeliveryBlockerLabel(blocker)}</li>)}</ul>
        </AdminNotice> : null}
        {error ? <AdminNotice role="alert" tone="danger">{error}</AdminNotice> : null}
        {message ? <AdminNotice role="status" tone="success">{message}</AdminNotice> : null}
      </div>
    </div>
    {picking ? <AdminPickerDialog<ForcedDeliveryOrderRow>
      emptyText="이 상태에는 맞는 주문이 없습니다. 주문 상태를 바꿔 찾아보세요."
      excludedNote={EXCLUDED_NOTE}
      filterLabel="주문 상태"
      filterOptions={STATUS_OPTIONS}
      load={loadOrders}
      onClose={() => setPicking(false)}
      onSelect={row => { setPicked({ orderNumber: row.orderNumber, text: `${row.orderNumber} · ${row.buyerName} · ${ADMIN_ORDER_STATUS_LABELS[row.status]}` }); setError(''); setMessage(''); setBlocked(null); }}
      rowBlocked={forcedDeliveryOrderBlocked}
      rowKey={orderRowKey}
      rowView={orderRowView}
      searchFields={SEARCH_FIELDS}
      searchPlaceholder="찾을 내용"
      selectedKeys={picked ? [picked.orderNumber] : undefined}
      title="주문 고르기"
      unit="건"
    /> : null}
  </SalesDisclosureCard>;
}
