'use client';

import { useActionState } from 'react';
import {
  updateAdminOrderStatusAction,
  type AdminOrderActionState,
} from '@/app/admin/order-actions';
import {
  selectableShippingCarriers,
  type ShippingCarrierRegistry,
} from '@/lib/orders/shipment';

const EMPTY_ACTION_STATE: AdminOrderActionState = {};

const SHIP_CONFIRMATION = '입력한 택배사·운송장번호로 발송처리할까요? 고객 주문 상세에 그대로 노출되고 배송 시작 메일이 나갑니다.';

/**
 * 발송 대기 행의 인라인 발송처리 (#251).
 *
 * 전용 액션을 만들지 않고 기존 `updateAdminOrderStatusAction`에 `status=shipping`으로
 * 보낸다 — 운송장 필수 게이트, 활성 클레임 검사, 배송 시작 메일, 감사 로그가 모두
 * 그 경로에 이미 있다. 새 경로를 만들면 규칙이 두 벌이 된다.
 *
 * 행마다 독립된 폼이라 실패도 그 행에만 뜬다. 목록 전체가 하나의 폼이면 어느 행이
 * 거절됐는지 운영자가 알 수 없다.
 *
 * **어드민 운송장은 진실원이 아니다.** 김포 창고 WMS가 발행한 번호를 옮겨 적는
 * 운영 기록이다(#177) — 어긋나면 WMS가 맞다.
 */
export function DispatchShipForm({
  carriers,
  orderId,
  reference,
}: {
  carriers: ShippingCarrierRegistry;
  orderId: string;
  /** 접근성 이름에 쓰는 주문번호 표기. 행이 여러 개라 필드 이름이 겹치면 안 된다. */
  reference: string;
}) {
  const [state, action, pending] = useActionState(updateAdminOrderStatusAction, EMPTY_ACTION_STATE);
  const selectable = selectableShippingCarriers(carriers);
  /* 고를 수 있는 택배사가 하나뿐이면 미리 고른다. 둘 이상이면 비워 둔다 —
     기본값이 있는 드롭다운은 잘못 고른 것도 고른 것처럼 지나간다. */
  const defaultCarrier = selectable.length === 1 ? selectable[0].code : '';
  const fieldError = state.errors?.carrier ?? state.errors?.trackingNumber ?? state.errors?.form;

  return (
    <form
      action={action}
      className="admin-console-row-form"
      data-confirm={SHIP_CONFIRMATION}
      onSubmit={(event) => {
        /* 되돌릴 수 없는 전이다. 이 저장소의 확인 관용구를 그대로 따른다. */
        if (!window.confirm(SHIP_CONFIRMATION)) event.preventDefault();
      }}
    >
      <input name="orderId" type="hidden" value={orderId} />
      <input name="status" type="hidden" value="shipping" />
      <select
        aria-label={`주문 ${reference} 택배사`}
        defaultValue={defaultCarrier}
        disabled={pending || selectable.length === 0}
        name="carrier"
        required
      >
        <option disabled value="">택배사</option>
        {selectable.map((carrier) => (
          <option key={carrier.code} value={carrier.code}>{carrier.label}</option>
        ))}
      </select>
      <input
        aria-label={`주문 ${reference} 운송장번호`}
        disabled={pending || selectable.length === 0}
        inputMode="numeric"
        maxLength={30}
        name="trackingNumber"
        placeholder="운송장번호"
        required
        type="text"
      />
      <button className="btn btn-sm" disabled={pending || selectable.length === 0} type="submit">
        {pending ? '처리 중' : '발송처리'}
      </button>
      <div aria-live="polite" className="admin-order-action-feedback">
        {fieldError ? <span role="alert">{fieldError}</span> : null}
        {state.message ? <span role="status">{state.message}</span> : null}
      </div>
    </form>
  );
}
