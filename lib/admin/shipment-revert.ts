/*
 * 배송 상태 오처리 정정과 택배사 도착 일시(원장 #14, ADR-0045). 화면·서버 액션이 함께 쓰는 범위·문구다.
 * DB(admin_revert_shipment_delivery·admin_revert_shipment_dispatch·admin_complete_shipments_at)가 같은 범위를 다시 본다.
 */
import { conjunctionParticle, objectParticle } from '@/lib/korean-particle';
import { shipmentMutationError } from './shipment-dispatch';

export const SHIPMENT_REVERT_REASON_MIN = 5;
export const SHIPMENT_REVERT_REASON_MAX = 500;
/** 이 날수보다 이른 택배사 배송완료 일시는 사유를 받는다 — 단순 변심 청약철회 기간(7일)이 처리 시점에 이미 지나기 때문이다. */
export const SHIPMENT_ARRIVAL_LATE_DAYS = 7;
/** 운영자 PC 시계 차이로 받아 주는 미래 시각(분). DB가 지금으로 맞춘다. */
export const SHIPMENT_ARRIVAL_FUTURE_MINUTES = 10;
const DAY_MS = 86_400_000;

export type ShipmentRevertKind = 'delivery' | 'dispatch';

/** 택배 배송 건의 상태로 정할 수 있는 되돌리기. 배송완료면 배송 중으로, 배송 중이면 발송 대기로 한 단계만 되돌린다. */
export function shipmentRevertKind(status: string, parcel: boolean): ShipmentRevertKind | null {
  if (!parcel) return null;
  return status === 'delivered' ? 'delivery' : status === 'shipping' ? 'dispatch' : null;
}

export const SHIPMENT_REVERT_LABELS: Record<ShipmentRevertKind, string> = { delivery: '배송완료 되돌리기', dispatch: '발송 되돌리기' };

/** 되돌리기 확인창 문구. 이미 나간 알림·메일은 회수할 수 없어 고객 연락을 함께 적는다. */
export function shipmentRevertPrompt(kind: ShipmentRevertKind, { reference, packCount, trackingLabel }: { reference: string; packCount?: number | null; trackingLabel?: string | null }) {
  const pack = packCount && packCount > 1 ? ` 합포장 묶음 ${packCount}건이 함께 되돌아갑니다.` : ' 합포장 묶음이면 묶인 배송 건이 함께 되돌아갑니다.';
  if (kind === 'delivery') return {
    title: SHIPMENT_REVERT_LABELS.delivery,
    message: `배송 건 ${reference}${objectParticle(reference)} 배송 중으로 되돌립니다.${pack} 배송완료 일시와 구매확정 기한이 지워지고, 청약철회 기간은 다시 배송완료할 때 넣는 택배사 배송완료 일시부터 셉니다. `
      + '고객 앱의 "배송이 완료됐어요" 알림은 받은편지함에서 지우지만 이미 본 알림은 회수할 수 없으니 필요하면 고객에게 연락해주세요. '
      + '구매확정·리뷰·취소·반품·교환 요청이 있는 주문은 되돌리지 않습니다.',
    confirmLabel: '배송 중으로 되돌리기',
  };
  return {
    title: SHIPMENT_REVERT_LABELS.dispatch,
    message: `배송 건 ${reference}${objectParticle(reference)} 발송 대기로 되돌립니다.${pack} 운송장${trackingLabel ? ` ${trackingLabel}` : ''}${conjunctionParticle(trackingLabel || '운송장')} 추가 운송장·발송 시각을 비워 그 번호를 올바른 배송 건에 다시 등록할 수 있습니다(이전 값은 감사 기록에 남습니다). `
      + '출고지시 전달 표시는 그대로이니 올바른 운송장으로 다시 발송 처리해주세요. 고객에게 이미 나간 발송 안내 메일·알림은 회수할 수 없으니 고객에게 연락해주세요.',
    confirmLabel: '발송 대기로 되돌리기',
  };
}

const ERRORS: Record<string, string> = {
  shipment_revert_reason_required: `되돌리는 사유를 ${SHIPMENT_REVERT_REASON_MIN}자 이상 ${SHIPMENT_REVERT_REASON_MAX}자 이내로 적어주세요.`,
  shipment_revert_changed: '그 사이 배송 건이 바뀌었습니다(다시 처리됐거나 운송장이 바뀌었습니다). 새로고침한 뒤 다시 확인해주세요.',
  shipment_revert_not_delivered: '배송완료 상태가 아닌 배송 건입니다. 새로고침해주세요.',
  shipment_revert_not_shipping: '배송 중 상태가 아닌 배송 건입니다. 배송완료된 건은 먼저 배송완료를 되돌려주세요.',
  shipment_revert_pack_mixed: '합포장 묶음의 배송 건 상태가 서로 다릅니다. 주문 상세에서 묶음을 확인해주세요.',
  shipment_revert_parcel_only: '택배 배송 건만 되돌릴 수 있습니다. 퀵·직접배송·방문수령 같은 택배 외 배송의 인계·수령 기록 정정은 개발 담당에게 요청해주세요.',
  shipment_revert_purchase_confirmed: '구매확정(거래확정)된 주문은 되돌릴 수 없습니다. 적립금·정산이 이미 반영됐습니다.',
  shipment_revert_review_exists: '리뷰가 작성된 주문은 되돌릴 수 없습니다. 리뷰 작성이 구매확정입니다.',
  shipment_revert_claim_exists: '취소·반품·교환 요청이 있는 주문은 되돌릴 수 없습니다. 요청 처리 화면에서 먼저 정리해주세요.',
  shipment_revert_partial_cancel_in_progress: '재고 부족 부분 취소가 처리 중인 주문입니다. 처리가 끝난 뒤 다시 시도해주세요.',
  shipment_revert_order_canceled: '취소된 주문은 되돌릴 수 없습니다.',
  shipment_revert_order_state: '주문 상태가 바뀌어 되돌릴 수 없습니다. 새로고침해주세요.',
  shipment_revert_email_sending: '발송 안내 메일을 보내는 중입니다. 몇 분 뒤 다시 시도해주세요.',
  invalid_shipment_revert: '되돌릴 배송 건을 다시 선택해주세요.',
  shipment_not_found: '배송 건을 찾을 수 없습니다. 새로고침해주세요.',
  operation_conflict: '같은 요청 번호가 다른 내용으로 처리되었습니다. 새로고침한 뒤 다시 시도해주세요.',
  operator_capability_required: '판매 관리 권한이 있는 운영자만 배송 상태를 되돌릴 수 있습니다.',
  delivered_at_before_shipped: '택배사 배송완료 일시가 발송 등록 시각보다 이릅니다. 발송 등록 시각 이후로 넣어주세요.',
  delivered_at_in_future: '택배사 배송완료 일시는 지금보다 뒤일 수 없습니다.',
  delivered_at_late_reason_required: `${SHIPMENT_ARRIVAL_LATE_DAYS}일보다 이른 배송완료 일시는 늦게 처리한 사유가 필요합니다. 사유는 감사 기록에 남습니다.`,
  delivered_at_reason_invalid: `사유는 ${SHIPMENT_REVERT_REASON_MIN}자 이상 ${SHIPMENT_REVERT_REASON_MAX}자 이내로 적어주세요.`,
};

/** 되돌리기·도착 일시 DB 거절 코드를 운영 문구로. 모르는 코드는 일반 문구다. */
export function shipmentRevertError(code?: string | null): string {
  return (code && ERRORS[code]) || '배송 상태를 되돌리지 못했습니다. 새로고침해 현재 상태를 확인한 뒤 다시 시도해주세요.';
}

/** 선택 배송완료의 건별 실패 사유. 도착 일시 거절은 이 모듈이, 나머지는 기존 배송 처리 문구가 맡는다. */
export function shipmentCompletionFailure(code: string): string {
  return code.startsWith('delivered_at_') && ERRORS[code] ? ERRORS[code] : shipmentMutationError(code);
}

/**
 * 택배사 배송완료 일시 검증(DB와 같은 범위). iso가 null이면 처리 시각으로 기록하므로 문제없다.
 * 미래는 시계 차이 10분까지만, 7일보다 이른 일시는 사유(5~500자)가 있어야 한다. 사유를 적었다면 길이를 본다.
 */
export function shipmentArrivalError(iso: string | null, reason: string, now = new Date()): string | null {
  const trimmed = reason.trim();
  if (trimmed && (trimmed.length < SHIPMENT_REVERT_REASON_MIN || trimmed.length > SHIPMENT_REVERT_REASON_MAX)) return ERRORS.delivered_at_reason_invalid;
  if (iso === null) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '택배사 배송완료 일시를 확인해주세요.';
  if (time > now.getTime() + SHIPMENT_ARRIVAL_FUTURE_MINUTES * 60_000) return ERRORS.delivered_at_in_future;
  if (time < now.getTime() - SHIPMENT_ARRIVAL_LATE_DAYS * DAY_MS && !trimmed) return ERRORS.delivered_at_late_reason_required;
  return null;
}

/** 7일보다 이른 일시인가(사유 칸을 보일지). */
export function shipmentArrivalNeedsReason(iso: string | null, now = new Date()): boolean {
  if (iso === null) return false;
  const time = Date.parse(iso);
  return !Number.isNaN(time) && time < now.getTime() - SHIPMENT_ARRIVAL_LATE_DAYS * DAY_MS;
}
