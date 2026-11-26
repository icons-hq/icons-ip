import { ClaimCollectionPlan } from '@/components/orders/ClaimCollectionPlan';
import { ClaimFeePanel } from '@/components/orders/ClaimFeePanel';
import { partialReturnFeePanelNote } from '@/lib/admin/claim-fees';

import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import { ShipmentDetails } from '@/components/shop/ShipmentDetails';
import type { ReactNode } from 'react';
import { Clock } from 'lucide-react';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { AdminLabelWithHelp } from '@/components/admin/console/AdminHelpTip';
import { LARGE_STATUS_BADGE_CLASS } from '@/components/admin/sales/OrderStatusBadge';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { cn } from 'cn';
import { Card, CardContent, CardHeader } from '@/components/admin/kit/ui/card';
import { adminClaimReasonText } from '@/lib/admin/claims';
import Link from 'next/link';
import type { AdminClaimDetail } from '@/lib/admin/claims.server';
import { adminClaimStageLabel } from '@/lib/admin/claims';
import { ADMIN_WITHDRAWAL_RETURN_SHIPPING_LABELS, adminOrderPanelHref } from '@/lib/admin/orders';
import { krw } from '@/lib/format';
import { returnFeeDeductionBasisLabel, returnFeeDeductionFeePanelNote } from '@/lib/claims/return-fee-deduction';
import { CLAIM_DETAIL_HELP } from '@/lib/admin/help/claim-detail';
import { paymentProviderLabel } from '@/lib/payments/provider-capabilities';
import { statusTone } from '@/lib/admin/status-tone';
import {
  formatOrderDateTime,
  orderReferenceLabel,
  paymentStatusLabel,
  refundStatusLabel,
} from '@/lib/orders';
import {
  isOpenOrderClaimStage,
  ORDER_CLAIM_REFUND_METHOD_LABELS,
  ORDER_CLAIM_TYPE_LABELS,
  orderClaimReferenceLabel,
  orderClaimSlaState,
} from '@/lib/orders/claims';
import { shippingCarrierLabel, type ShippingCarrierRegistry } from '@/lib/orders/shipment';
import type { OrderPartialCancellationRecord } from '@/lib/orders/partial-cancellation';
import { ClaimWithdrawal } from '@/components/orders/ClaimWithdrawal';
import { ClaimTypeConversion } from '@/components/admin/ClaimTypeConversion';
import { ClaimReasonChange } from '@/components/admin/ClaimReasonChange';
import { ClaimActionPanel } from './ClaimActionPanel';
import { VirtualAccountRefundAccountEntry } from '@/components/admin/VirtualAccountRefundAccountEntry';
import { ClaimPartialReturnPanel } from './ClaimPartialReturnPanel';
import type { AdminClaimPartialReturn } from '@/lib/orders/partial-return';
import type { ClaimDefectiveStock } from '@/lib/admin/defective-stock';
import { ClaimPreviewFullScreenLink } from './ClaimPreviewDialog';
import { ClaimOperationalFeePanel } from './ClaimOperationalFeePanel';
import { ClaimReshipmentDelivery } from './ClaimReshipmentDelivery';
import { SellerClaimIntakeEvidence } from './SellerClaimIntakeEvidence';
import { ClaimExchangeSteps, ClaimProgressSummary } from './ClaimProgressSummary';
import { ClaimContactOperations } from '@/components/admin/ClaimContactOperations';
import { adminPaymentCancelErrorLabel } from '@/lib/admin/payment-cancel-error';
import { ClaimContactHistory } from '@/components/claim-contact/ClaimContactHistory';
import { adminClaimExchangeStockTargets, adminClaimPendingReshipments, adminClaimRemainingReshipments, adminClaimStockDecisionPending } from '@/lib/admin/claim-reshipments';

/* 어드민 클레임 상세(#252) — 템플릿 룩 kit Card(ADR-0028).
 *
 * 왼쪽이 주문 맥락, 오른쪽이 처리다(처리 박스가 오른쪽 맨 위). 운영자가 승인 버튼을 누르기 전에 확인해야 하는
 * 것 — 품목·금액·결제사·환불계좌 — 이 전부 이 화면에 있어야 한다.
 * (카드팩 발급·개봉 줄은 2026-11-24 일반 쇼핑몰 전환으로 카드 기능과 함께 지웠다, ADR-0052.)
 *
 * 타임라인은 감사 로그를 그대로 읽는다. 별도 이력 테이블을 만들면 감사와 화면이
 * 갈라지고, 갈라지면 어느 쪽이 사실인지 알 수 없다.
 *
 * 회수 계획·배송비 청구·요청 철회(components/orders)는 고객 화면과 같이 쓰는 부품이라 모양을 그대로 두고
 * kit Card로 감싸기만 한다. */

const TIMELINE_LABELS: Record<string, string> = {
  'admin.order.claim_intake_created': '판매자 직접 접수',
  'order.claim_withdrawn': '고객 요청 철회',
  'order.claim_refund_account_confirmed': '고객 환불계좌 등록',
  'admin.order.claim_refund_account_entered': '운영자 환불계좌 대신 입력',
  /* 무통장 환불 칸의 버튼 이름과 같은 말이다(취소 확정 · 재고 복원 / 환불 접수 기록 / 송금 완료 기록 / 계좌번호 전체 보기). */
  'admin.order.bank_refund_confirm_cancellation': '무통장 취소 확정 · 재고 복원',
  'admin.order.bank_refund_file_transfer': '환불 접수 기록',
  'admin.order.bank_refund_complete_transfer': '송금 완료 기록',
  'admin.order.bank_refund_account_viewed': '계좌번호 전체 보기',
  'order.claim_auto_approved': '자동 승인 (발주확인 전 취소)',
  /* 결제 가능 시간이 지난 결제 준비 건을 결제 없이 닫은 취소. 주문 상세 타임라인과 같은 이름이다. */
  'order.prepared_goods_cancellation_completed': '결제 준비 건 취소 완료 (구매자 취소)',
  'system.order.prepared_goods_cancellation_completed': '결제 준비 건 취소 완료 (자동)',
  'system.order.unpaid_cart_order_closed': '결제 대기 주문 자동 취소 (재주문·장바구니 복귀)',
  'system.order.cart_hold_detached': '장바구니 보류 해제 (결제 확인 필요 주문)',
  'admin.order.prepared_goods_cancellation_completed': '결제 준비 건 취소 완료',
  'admin.order.claim_in_review': '검토중으로 변경',
  'admin.order.claim_approved': '승인',
  'admin.order.claim_rejected': '거부',
  'admin.order.claim_held': '보류',
  'admin.order.claim_resumed': '보류 해제',
  'admin.order.claim_collected': '입고 확인',
  'admin.order.claim_origin_collected': '출고지 회수 확인',
  'admin.order.claim_contact_changed': '회수지·교환품 받을 곳 고치기',
  'admin.order.claim_collection_corrected': '회수 방법·운송장 정정',
  'admin.order.claim_fee_issue': '반품·교환 배송비 청구',
  'order.claim_fee_report_payment': '배송비 고객 입금 알림',
  'admin.order.claim_fee_confirm_payment': '배송비 실제 입금 확인',
  'admin.order.claim_fee_waive': '배송비 청구 면제',
  'admin.order.claim_fee_cancel': '배송비 청구 취소',
  'admin.order.claim_fee_refund': '배송비 실제 반환 완료',
  'admin.order.claim_refund_filed': '환불 접수',
  'admin.order.claim_refund_completed': '환불 완료',
  'admin.order.claim_reshipped': '교환 재출고',
  'admin.order.claim_reshipment_delivered': '교환품 배송완료 확인',
  'admin.order.claim_evidence_uploaded': '회수 생략 근거 사진 등록',
  'admin.order.claim_collection_waived': '회수 생략 결정',
  'admin.order.claim_collection_reopened': '회수 생략 무효로 수거중 복귀',
  /* 출고지 입고 확인 밖에서 끝난 회수 완료(입고완료). 원인은 timelineLabel이 diff.cause로 가른다. */
  'admin.order.claim_collection_completed': '회수 완료',
  'admin.order.claim_type_changed': '반품·교환 유형 전환',
  'admin.order.claim_reason_changed': '교환 사유 정정',
  'admin.order.cancellation_approved': '청약철회 승인 (이전 처리 방식)',
  'admin.order.cancellation_rejected': '청약철회 거절 (이전 처리 방식)',
  'admin.order.cancellation_completed': '결제 취소 확인 · 주문 취소 완료',
  'system.order.cancellation_completed': '결제 취소 확인 · 주문 취소 완료 (자동)',
  'admin.order.cancellation_needs_review': '결제 취소 확인 필요',
  'system.order.cancellation_needs_review': '결제 취소 확인 필요 (자동)',
  'admin.order.cancellation_reconcile_started': '결제 취소 다시 확인',
  'admin.order.staff_cancellation_started': '운영자 전액 취소 시작',
  'admin.order.claim_operational_fee_recorded': '운영 확인액 기록',
  /* 반품 불량 재고(QNA-035). */
  'admin.order.claim_defective_stock_planned': '품목별 재고 처리 선택 저장',
  'order.claim_defective_stock_recorded': '불량 재고 기록',
  'admin.order.claim_defective_stock_recorded': '불량 재고 기록',
  /* 반품 자동 회수 접수(QNA-032). */
  'system.order.claim_return_pickup_requested': '반품 자동 회수 접수 (자동)',
  'system.order.claim_return_pickup_canceled': '반품 자동 회수 취소 (자동)',
  'admin.order.claim_return_pickup_retried': '반품 자동 회수 다시 접수',
  /* 반품배송비 차감(ADR-0031). */
  'admin.order.claim_refund_deduction_decided': '반품배송비 차감 결정',
  'admin.order.claim_refund_deduction_confirmed': '반품배송비 차감 확인 · 부분 환불',
  'system.order.claim_refund_deduction_confirmed': '반품배송비 차감 확인 · 부분 환불 (자동)',
  'admin.order.claim_refund_deduction_not_applied': '반품배송비 차감 안 함 · 전액 환불',
  'system.order.claim_refund_deduction_not_applied': '반품배송비 차감 안 함 · 전액 환불 (자동)',
  /* 재고 부족 부분 취소(ADR-0032). 주문 단위 기록이라 이 요청 전후의 부분 취소도 함께 보인다. */
  'admin.order.partial_cancellation_started': '재고 부족 부분 취소 시작',
  'admin.order.partial_cancellation_applied': '재고 부족 부분 취소 적용',
  'admin.order.partial_cancellation_completed': '재고 부족 부분 취소 환불 완료',
  'admin.order.partial_cancellation_transferred': '재고 부족 부분 취소 송금 완료',
  'admin.order.partial_cancellation_rejected': '재고 부족 부분 취소 진행 안 함',
  'admin.order.partial_cancellation_needs_review': '재고 부족 부분 취소 결제 확인 필요',
  'admin.order.partial_cancellation_resolved': '재고 부족 부분 취소 결제 확인 해소',
  'admin.order.partial_cancellation_account_viewed': '부분 취소 계좌번호 전체 보기',
};

/* 환불 계좌 열람의 경로(감사 diff.purpose, QA1 S-T03-04). 요청 상세 열람과 환불 송금 대기 목록 엑셀이 같은 감사 액션을 남긴다.
   계좌 원문은 감사에도 타임라인에도 없다 — 열람자·시각·경로만 보인다. */
const ACCOUNT_VIEW_ROUTES: Record<string, string> = {
  prepare_bank_transfer: '요청 상세',
  list_export: '환불 송금 대기 목록 엑셀',
};

/* 이름표에 없는 값은 영문 원문을 그대로 내지 않고 '확인 필요'로 받는다(화면 규칙 8). */
const UNKNOWN_LABEL = '확인 필요';
const UNKNOWN_CARRIER_LABEL = '택배사 확인 필요';
/* 감사 기록에 이름이 없는 동작. 원문 코드 대신 이 이름으로 보인다. */
const UNKNOWN_TIMELINE_LABEL = '기타 처리';

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: '결제 대기',
  paid: '신규주문',
  confirmed: '발주확인',
  shipping: '배송중',
  delivered: '배송완료',
  done: '거래확정',
  canceled: '취소',
};

/* 환불 기한이 실제로 계산된 때만 머리에 적는다. 버튼으로 오해받지 않게 알약이 아니라 시계 아이콘 + 글자이고, 임박·초과만 의미색을 입는다. */
const SLA_TEXT_CLASS = 'inline-flex items-center gap-1 tabular-nums text-muted-foreground data-[sla-tone=warning]:font-semibold data-[sla-tone=warning]:text-warning data-[sla-tone=danger]:font-semibold data-[sla-tone=danger]:text-destructive';
/* 구역 바로가기 — 셸의 콘솔 전환과 같은 모양의 구분 선택. */
const SECTION_LINK_CLASS = 'inline-flex h-7 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-background hover:text-foreground';
const OUTLINE_SM = `${cn(buttonVariants({ size: 'sm', variant: 'outline' }))} w-fit`;
const ROW_INLINE = 'flex flex-wrap items-center gap-2';

/* 배송 건(출고지)별 재출고(TKT-166)는 감사 기록에 출고지와 회수 생략 여부가 함께 있다. 같은 이름의 줄이 여러 개여도 어느 출고지인지 보이게 한다. */
/* 회수 생략 결정·결정 효력 회복으로 끝난 회수 완료(입고완료)는 무엇 때문에 끝났는지 함께 보인다. */
const COLLECTION_COMPLETED_CAUSE_LABELS: Record<string, string> = {
  collection_waiver_decided: '회수 생략 결정으로 회수 완료',
  collection_waiver_effective: '사유·유형 변경으로 회수 완료',
};
/* 회수지·교환품 받을 곳 고치기(감사 diff.target). 이름은 그 부품(ClaimContactOperations)의 제목과 같다. */
const CONTACT_TARGET_LABELS: Record<string, string> = { collection: '회수지 고치기', reshipment: '교환품 받을 곳 고치기' };

function timelineLabel(entry: AdminClaimDetail['timeline'][number]) {
  if (entry.action === 'admin.order.claim_collection_completed') {
    const cause = typeof entry.diff?.cause === 'string' ? COLLECTION_COMPLETED_CAUSE_LABELS[entry.diff.cause] : undefined;
    return cause ?? TIMELINE_LABELS[entry.action];
  }
  /* 사유 정정은 교환만 받다가 2026-11-25부터 반품도 받는다(CLM-029). 이전 기록(유형 없음)은 교환 정정이다. 반품은 바뀐 반품배송비 차감을 함께 보인다. */
  if (entry.action === 'admin.order.claim_reason_changed' && entry.diff?.claimType === 'return') {
    const from = entry.diff.fromReturnFeeDeduction; const to = entry.diff.toReturnFeeDeduction;
    return typeof from === 'number' && typeof to === 'number' && from !== to
      ? `반품 사유 정정 · 반품배송비 차감 ${krw(from)} → ${krw(to)}`
      : '반품 사유 정정';
  }
  /* 앞선 재고 부족 부분 취소가 결제액을 모두 돌려준 무통장 취소는 송금대기 없이 환불 0원으로 닫힌다(송금 원장에 '송금 없이 완료'). */
  if (entry.action === 'admin.order.bank_refund_confirm_cancellation' && entry.diff?.transferAmount === 0) return '무통장 취소 확정 · 송금 없이 완료';
  /* 주소 고치기는 회수지와 교환품 받을 곳 가운데 어느 쪽인지 감사 기록(diff.target)이 말한다. 모르면 둘을 함께 부른다. */
  if (entry.action === 'admin.order.claim_contact_changed') {
    const target = typeof entry.diff?.target === 'string' ? CONTACT_TARGET_LABELS[entry.diff.target] : undefined;
    return target ?? TIMELINE_LABELS[entry.action];
  }
  const label = TIMELINE_LABELS[entry.action] ?? UNKNOWN_TIMELINE_LABEL;
  if (entry.action === 'admin.order.bank_refund_account_viewed') {
    const route = typeof entry.diff?.purpose === 'string' ? ACCOUNT_VIEW_ROUTES[entry.diff.purpose] : undefined;
    return route ? `${label} (${route})` : label;
  }
  if (entry.action !== 'admin.order.claim_reshipped' && entry.action !== 'admin.order.claim_reshipment_delivered'
    && entry.action !== 'admin.order.claim_collection_waived') return label;
  const origin = typeof entry.diff?.originName === 'string' && entry.diff.originName ? ` · ${entry.diff.originName}` : '';
  return `${label}${origin}${entry.diff?.collectionWaived === true ? ' (회수 생략)' : ''}`;
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(5.5rem,8rem)_minmax(0,1fr)] gap-3 border-b py-2 last:border-b-0" data-claim-summary-row="">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}

/**
 * 부분 반품(ADR-0047)의 환불 단계 금액: 접수 뒤에는 원장, 접수 전에는 미리보기. 원장 줄의 환불액은 차감 뒤 금액이다. 송금 여부는 살아 있는
 * 원장의 정산 경로가 정한다 — 무통장 결제, 또는 결제사가 부분 취소를 받지 않아 계좌 송금으로 바꾼 카드 결제. 원장 전이면 결제 수단이다.
 */
function partialReturnRefund(partialReturn: AdminClaimPartialReturn, bankPayment: boolean) {
  const live = partialReturn.history.find((record) => record.id === partialReturn.refundId);
  const refileable = !live && partialReturn.history.some((record) => record.state === 'rejected');
  const bank = partialReturn.settlement ? partialReturn.settlement === 'bank_transfer' : bankPayment;
  const convertible = partialReturn.transferConvertible;
  if (live) return { refundAmount: live.refundAmount, deductionAmount: live.returnFeeDeduction, bank, refileable, convertible };
  return { refundAmount: partialReturn.preview?.refundAmount ?? null, deductionAmount: partialReturn.preview?.returnFeeDeduction ?? 0, bank, refileable, convertible };
}

/* 부분 환불 원장의 상태 → 환불 기록의 상태. 모르는 상태는 그대로 두어 refundStatusLabel이 '환불 처리 확인 필요'로 읽게 한다. */
const PARTIAL_REFUND_STATUS: Record<string, string> = { processing: 'requested', needs_review: 'failed', awaiting_transfer: 'awaiting_transfer', completed: 'done' };

/**
 * 부분 반품(ADR-0047)은 주문 전체 환불 기록(refunds)을 열지 않고 부분 환불 원장으로 간다. 환불 요약과 환불 칸은 그 원장의 살아 있는 줄을
 * 환불 기록과 같은 모양으로 옮겨 읽는다 — 그러지 않으면 환불을 접수·완료한 뒤에도 '환불 기록 없음'으로 보인다. 처리 칸의 판정은 이 값을 쓰지 않는다.
 */
function partialRefundRecord(live: OrderPartialCancellationRecord): NonNullable<AdminClaimDetail['refund']> {
  return {
    status: PARTIAL_REFUND_STATUS[live.state] ?? live.state,
    amount: live.refundAmount,
    method: live.provider === 'bank_transfer' ? 'bank_transfer' : 'pg_cancel',
    filedAt: live.createdAt,
    completedAt: live.completedAt ?? live.transferredAt,
    settlementNote: null,
    handlerName: null,
  };
}

function CardHeading({ children }: { children: string }) {
  return <CardHeader><h3 className="text-base leading-snug font-medium text-foreground">{children}</h3></CardHeader>;
}

export function ClaimDetailScreen({
  actorId,
  autoPickupOnApproval = false,
  backHref,
  carriers,
  cancellationForm,
  defectiveStock = null,
  detail,
  detailHref,
  embedded = false,
  now = new Date(),
  partialReturn,
  partialReturnEnabled = false,
}: {
  actorId?: string;
  /** 반품·교환을 승인하면 택배사에 회수가 자동으로 접수되는가(자동 회수 접수 스위치). 켜져 있을 때만 승인 전에 확인을 묻는다. */
  autoPickupOnApproval?: boolean;
  backHref: string;
  carriers: ShippingCarrierRegistry;
  /** 코페이 취소 접수 양식. 카드 결제가 아니면 null이다. */
  cancellationForm: string | null;
  /** 반품 품목별 재고 처리 선택(QNA-035). 반품이 아니면 null. */
  defectiveStock?: ClaimDefectiveStock | null;
  detail: AdminClaimDetail;
  /** 팝업(embedded)에서 같은 요청을 전체 화면 상세로 여는 주소. */
  detailHref?: string;
  /**
   * 목록 위 팝업으로 그린다(R8). 대화상자가 제목과 닫기를 맡으므로 뒤로가기 링크와 h2를
   * 빼고, 처리 패널·유형 전환은 상세 화면과 같은 것을 그대로 쓴다.
   */
  embedded?: boolean;
  now?: Date;
  /**
   * 부분 반품(ADR-0047) 칸. 주문 전체 클레임이면 null, 반품인데 읽지 못했으면 undefined — 경고를 보이고 환불 단계를 열지 않는다
   * (주문 전체 환불 문구·무통장 전체 환불 흐름을 부분 반품에 그리지 않기 위해서다). 반품이 아니면 값과 무관하다.
   */
  partialReturn?: AdminClaimPartialReturn | null;
  /** 부분 반품 스위치. 꺼져 있으면 처리할 요청 아래에 주문 전체로만 처리한다는 안내가 한 줄 보인다. */
  partialReturnEnabled?: boolean;
}) {
  const { claim, order, payment, refund, refundAccount, timeline } = detail;
  /* 반품배송비 차감(ADR-0031). 스위치가 꺼져 있고 결정이 없으면 null — 아래 화면은 지금 그대로다. */
  const refundDeduction = detail.refundDeduction ?? null;
  const typeLabel = ORDER_CLAIM_TYPE_LABELS[claim.claimType];
  const partialLive = partialReturn ? partialReturn.history.find((record) => record.id === partialReturn.refundId) ?? null : null;
  const partialReturnUnavailable = claim.claimType === 'return' && partialReturn === undefined;
  /* 환불 계좌 대신 입력 확인창이 되읽을 환불 금액. 화면에 이미 있는 환불 금액(환불 기록, 부분 반품은 살아 있는 원장 줄)만 넘기고 모르면 넘기지 않는다. */
  const entryRefundAmount = claim.claimType === 'return' && partialReturn !== null ? partialLive?.refundAmount ?? null : refund?.amount ?? null;
  /* 환불 요약·환불 칸이 읽는 환불 기록. 부분 반품은 주문 전체 환불 기록이 없어 부분 환불 원장의 살아 있는 줄을 읽는다. */
  const shownRefund = partialLive ? partialRefundRecord(partialLive) : refund;
  const sla = orderClaimSlaState(
    {
      claimType: claim.claimType,
      stage: claim.stage,
      collectedAt: claim.collectedAt,
      completedAt: claim.completedAt,
      /* 환불 기한은 운영자가 적은 실제 입고일부터 센다(1027T-033). 옛 기록은 입고 확인 시각이다. */
      collectionReceivedOn: claim.collectionReceivedOn ?? null,
    },
    now,
  );

  /* 아직 끝나지 않은 요청만 처리 박스를 강조한다 — 종결된 요청에서 눈을 끌 이유가 없다. */
  const awaitsOperator = isOpenOrderClaimStage(claim.stage);
  /* 부분 반품 기능이 꺼져 있어 이 요청이 주문 전체로만 처리되는 경우. 부분 반품(칸이 있는 요청)이나 읽지 못한 반품은 해당하지 않는다. */
  const wholeOrderOnly = !partialReturnEnabled && awaitsOperator && !partialReturn && !partialReturnUnavailable;

  const collectionContactBody = actorId && claim.claimType !== 'cancel' ? <>
    <ClaimCollectionPlan actorId={actorId} claimId={claim.id} operator carriers={carriers} />
    {/* 재출고는 배송 건(출고지)마다 최종 주소를 확인하고 등록한다. 회수 확인 전 배송 건은 하자·오배송 교환일 때만 회수 없이 보낼 수 있다. */}
    <ClaimContactOperations actorId={actorId} orderId={claim.orderId} claimId={claim.id}
      reshipTargets={claim.collectionPolicy !== null ? adminClaimPendingReshipments(claim) : []}
      remainingTargets={adminClaimRemainingReshipments(claim)}
      stockDecisionPendingOrigins={claim.collectionPolicy !== null ? (claim.reshipmentTargets ?? [])
        .filter(target => adminClaimStockDecisionPending(claim, target)).map(target => target.originName ?? '주문 전체') : []}
      carriers={carriers} reshipItems={order?.items ?? []} claimType={claim.claimType} />
    <ClaimContactHistory actorId={actorId} orderId={claim.orderId} claimId={claim.id} operator />
  </> : null;
  /* 반품은 이 내용이 단계 칸 안에 들어간다. 카드 안의 카드로 겹치지 않게 구분선으로만 나눈다(강조 테두리는 지금 단계 한 겹이다). */
  const collectionContact = claim.claimType === 'return'
    ? collectionContactBody ? <div className="flex min-w-0 flex-col gap-4 border-t pt-4">{collectionContactBody}</div> : null
    : collectionContactBody ? <Card><CardContent className="flex min-w-0 flex-col gap-4">{collectionContactBody}</CardContent></Card> : null;
  /* 교환에서 가장 먼저 보는 정보다. 바꿀 옵션을 따로 받는 칸은 없어 고객이 남긴 요청 글과 지금 주문의 상품·옵션을 처리 칸 맨 위에 함께 보인다. */
  const exchangeRequest = claim.claimType === 'exchange' ? <section aria-label="교환 요청 내용" className="flex min-w-0 flex-col gap-1.5 rounded-lg border bg-muted/40 p-3" data-claim-exchange-request="">
    <h4 className="text-xs font-medium text-muted-foreground">고객이 남긴 교환 요청</h4>
    <p className="font-medium break-words whitespace-pre-wrap">{claim.reason}</p>
    <p className="text-muted-foreground">접수 사유 {adminClaimReasonText(claim.reasonType, claim.staffReasonCode)}{claim.reasonType !== 'staff' ? ` · ${ADMIN_WITHDRAWAL_RETURN_SHIPPING_LABELS[claim.reasonType]}` : ''}</p>
    {order?.items.length ? <ul className="flex flex-col gap-0.5 text-muted-foreground">
      {order.items.map(item => <li className="break-words" key={item.id}>지금 주문 · {item.name}{item.variantName ? ` · ${item.variantName}` : ''} × {item.qty}</li>)}
    </ul> : null}
  </section> : null;
  const refundSummaryBody = <>
      {shownRefund ? (
        <div>
          <Row label="환불 기록" value={<span className={ROW_INLINE}><AdminStatusBadge tone={statusTone('refund', shownRefund.status)}>{refundStatusLabel(shownRefund.status)}</AdminStatusBadge><span className="tabular-nums">{krw(shownRefund.amount)}</span></span>} />
          <Row
            label="환불 수단"
            value={shownRefund.method ? ORDER_CLAIM_REFUND_METHOD_LABELS[shownRefund.method] : '-'}
          />
          <Row
            label="접수 · 완료"
            value={`${shownRefund.filedAt ? formatOrderDateTime(shownRefund.filedAt) : '-'} · ${shownRefund.completedAt ? formatOrderDateTime(shownRefund.completedAt) : '-'}`}
          />
          {refundDeduction?.source === 'decision' ? (
            <Row label="반품배송비" value={refundDeduction.applicable
              ? `${krw(refundDeduction.deductionAmount)} 차감 · ${returnFeeDeductionBasisLabel(refundDeduction)}`
              : '차감 없음 · 결제사 부분 취소 불가로 전액 환불'} />
          ) : null}
          {shownRefund.settlementNote ? (
            <Row label="환불 메모" value={shownRefund.settlementNote} />
          ) : null}
          {shownRefund.handlerName ? <Row label="처리자" value={`@${shownRefund.handlerName}`} /> : null}
        </div>
      ) : (
        <p className="text-muted-foreground">
          {claim.claimType === 'exchange'
            ? '교환에는 환불 기록이 없습니다.'
            : '아직 환불 기록이 없습니다.'}
        </p>
      )}

      {refundAccount ? (
        <div className="border-t pt-1">
          {/* 일부만 보이는 이유와 전체 번호를 보는 길은 늘 적어 두지 않고 칸 이름 옆 "?"가 말한다. 지워진 뒤에만 할 일이 있어 한 줄을 보인다. */}
          <Row label={<AdminLabelWithHelp help={CLAIM_DETAIL_HELP.refundAccount} label="환불계좌">환불계좌</AdminLabelWithHelp>} value={refundAccount.maskedAccount} />
          <Row label="예금주" value={refundAccount.maskedHolder} />
          {refundAccount.purgedAt ? <p className="mt-1.5 text-xs text-muted-foreground">전체 번호는 지워졌습니다. 송금이 필요하면 구매자에게 환불계좌를 다시 요청하세요.</p> : null}
        </div>
      ) : null}
  </>;
  const refundSummary = claim.claimType === 'return'
    ? <section aria-label="환불" className="flex min-w-0 scroll-mt-16 flex-col gap-3 border-t pt-4 outline-none" id="claim-refund" tabIndex={-1}><h4 className="font-medium">환불</h4>{refundSummaryBody}</section>
    : <Card id="claim-refund" tabIndex={-1} className="scroll-mt-16 outline-none"><CardHeading>환불</CardHeading><CardContent className="flex flex-col gap-3">{refundSummaryBody}</CardContent></Card>;

  return (
    <section className="flex min-w-0 flex-col gap-4 text-sm text-foreground" data-admin-kit="claim-detail">
      {/* 지금 할 일(처리 칸)이 첫 화면에 오도록 머리는 한 줄로 모은다. 넓은 화면에서는 처리 칸이 바로 보여 처리하기 버튼을 두지 않는다. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {embedded ? null : <>
          <Link className={OUTLINE_SM} data-slot="button" href={backHref}>← 목록으로</Link>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {typeLabel} {orderClaimReferenceLabel(claim.reference)}
          </h2>
        </>}
        <AdminStatusBadge className={LARGE_STATUS_BADGE_CLASS} tone={statusTone('claim', claim.stage)}>{adminClaimStageLabel(claim.claimType, claim.stage)}</AdminStatusBadge>
        <p className="text-muted-foreground">
          {adminClaimReasonText(claim.reasonType, claim.staffReasonCode)}
          {' · 접수 '}
          <time dateTime={claim.requestedAt}>{formatOrderDateTime(claim.requestedAt)}</time>
        </p>
        {sla.tone !== 'muted' ? <span className={SLA_TEXT_CLASS} data-sla-tone={sla.tone}><Clock aria-hidden="true" className="size-3.5" />{claim.claimType === 'return' ? '환불 기한' : '처리 기한'} {sla.label}</span> : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {awaitsOperator ? <Link className={`${buttonVariants({ variant: 'soft' })} lg:hidden`} data-slot="button" href="#claim-process">처리하기</Link> : null}
          {embedded && detailHref ? <ClaimPreviewFullScreenLink href={detailHref} /> : null}
          <nav aria-label="요청 상세 항목" className="inline-flex w-fit max-w-full flex-wrap gap-0.5 rounded-lg bg-muted p-0.5">
            <Link className={SECTION_LINK_CLASS} href="#claim-order">주문정보</Link>
            <Link className={SECTION_LINK_CLASS} href="#claim-request">요청·처리이력</Link>
            <Link className={SECTION_LINK_CLASS} href="#claim-process">{typeLabel} 처리</Link>
          </nav>
        </div>
      </header>
      <ClaimProgressSummary claim={claim} refund={shownRefund} />

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card id="claim-order" className="scroll-mt-16">
            <CardHeading>주문 요약</CardHeading>
            <CardContent className="flex min-w-0 flex-col gap-3">
              {order ? (
                <>
                  <div>
                    <Row
                      label="주문번호"
                      value={<span className={ROW_INLINE}><span className="tabular-nums">{orderReferenceLabel(order.id, order.orderNumber)}</span><AdminStatusBadge tone={statusTone('order', order.status)}>{ORDER_STATUS_LABELS[order.status] ?? UNKNOWN_LABEL}</AdminStatusBadge></span>}
                    />
                    <Row label="구매자" value={`${order.buyerName ?? '-'} (${order.buyerEmail ?? '이메일 없음'})`} />
                    {detail.gift ? <><Row label="선물 요청자" value={`${detail.gift.requesterName} · ${detail.gift.requesterRole === 'recipient' ? '선물 받는 분' : '구매자'}`} /><AdminNotice className="my-2" tone="warning">환불은 구매자의 결제수단으로 처리합니다. 받는 분에게 결제정보를 전달하지 마세요.</AdminNotice></> : null}
                    <Row label="결제금액" value={`${krw(order.total)} (배송비 ${krw(order.shippingFee)} 포함)`} />
                    <Row
                      label="결제사"
                      value={payment
                        ? <span className={ROW_INLINE}>{paymentProviderLabel(payment.provider) ?? UNKNOWN_LABEL}<AdminStatusBadge tone={statusTone('payment', payment.status)}>{paymentStatusLabel(payment.status)}</AdminStatusBadge></span>
                        : '결제 내역 없음'}
                    />
                    {order.transaction ? <><Row label="복수구매 할인" value={krw(order.transaction.totals.volumeDiscountTotal)} /><Row label="계약상 착불 배송비" value={`${krw(order.transaction.totals.collectShippingTotal)} · 온라인 환불금액에 포함되지 않음`} /></> : null}
                  </div>
                  {/* 배송 건의 품목 줄은 아래 주문 상품(옵션·금액 포함)과 겹친다. ShipmentDetails는 고객 화면과 함께 쓰는 부품이라 여기서만 감춘다. */}
                  <div className="[&_section>ul]:hidden"><ShipmentDetails admin shipments={order.shipments} items={order.items} transactionShipping={order.transaction?.shipping} /></div>
                  <section aria-label="주문 상품" className="flex flex-col gap-1.5 border-t pt-3">
                    <h4 className="text-xs font-medium text-muted-foreground">주문 상품</h4>
                    <ul className="flex flex-col gap-1.5">
                      {order.items.map((item, index) => (
                        <li className="flex items-baseline justify-between gap-3" key={`${item.name}-${index}`}>
                          <span className="min-w-0 break-words">
                            {item.name} × {item.qty}
                            {item.variantName ? <span className="ml-1.5 text-xs text-muted-foreground">{item.variantName}</span> : null}
                            <GoodsCustomInputsSummary selection={item.customInputs} />
                          </span>
                          <span className="shrink-0 tabular-nums">{krw(item.unitPrice * item.qty)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                  {claim.claimType === 'return' ? <ClaimPartialReturnPanel claimId={claim.id} orderId={order.id} partialReturn={partialReturn} /> : null}
                  {/* 부분 반품은 위 부분 반품 칸이 말한다. 기능이 꺼져 있으면 모든 요청이 주문 전체로만 처리되므로, 아직 처리할 요청에만 한 줄을 보인다. */}
                  {wholeOrderOnly ? <p className="text-xs text-muted-foreground" data-claim-whole-order-only="">
                    이 요청은 주문 전체로만 처리합니다. 일부 상품만 불량이면 고객에게 전체 반품, 또는 교환에서 하자·오배송 배송 건의 회수 없는 재출고를 안내하세요. 부분 환불을 약속하지 마세요.
                  </p> : null}
                  <Link className={OUTLINE_SM} data-slot="button" href={adminOrderPanelHref(order.id, order.orderNumber)}>
                    주문 통합검색에서 열기
                  </Link>
                </>
              ) : (
                <p className="text-muted-foreground">주문 정보를 불러오지 못했습니다.</p>
              )}
            </CardContent>
          </Card>

          <Card id="claim-request" className="scroll-mt-16">
            <CardHeading>요청 내용</CardHeading>
            <CardContent className="flex min-w-0 flex-col gap-3">
              <p className="break-words whitespace-pre-wrap">{claim.reason}</p>
              {claim.staffNote || claim.decisionNote || claim.holdReason || claim.lastErrorCode || claim.reshipTrackingNumber || claim.reshipments?.length || claim.reshippedItems?.length ? <div>
                {claim.staffNote ? <Row label="운영 메모" value={claim.staffNote} /> : null}
                {claim.decisionNote ? <Row label="거부 사유" value={claim.decisionNote} /> : null}
                {claim.holdReason ? <Row label="보류 사유" value={claim.holdReason} /> : null}
                {claim.lastErrorCode ? (
                  <Row label="결제사 확인 오류" value={adminPaymentCancelErrorLabel(claim.lastErrorCode)} />
                ) : null}
                {claim.reshipments?.length ? claim.reshipments.map(row => <Row key={row.id} label={`재출고 운송장${row.originName ? ` · ${row.originName}` : ''}`}
                  value={`${row.carrierLabel ?? shippingCarrierLabel(carriers, row.carrier) ?? UNKNOWN_CARRIER_LABEL} ${row.trackingNumber}${row.collectionWaived ? ' · 회수 생략' : ''}`} />)
                  : claim.reshipTrackingNumber ? (
                  <Row
                    label="재출고 운송장"
                    value={`${claim.reshipCarrier ? shippingCarrierLabel(carriers, claim.reshipCarrier) ?? UNKNOWN_CARRIER_LABEL : ''} ${claim.reshipTrackingNumber}`.trim()}
                  />
                ) : null}
                {claim.reshippedItems?.map((item) => <Row key={item.orderItemId} label="재출고 상품"
                  value={`${item.name} · ${item.variantName} · ${item.variantCode} · ${item.qty}개`} />)}
              </div> : null}
              {claim.stage === 'needs_review' ? <VirtualAccountRefundAccountEntry claimId={claim.id} claimType={claim.claimType}
                lastErrorCode={claim.lastErrorCode} orderId={claim.orderId} {...(entryRefundAmount === null ? {} : { refundAmount: entryRefundAmount })} /> : null}
              {detail.sellerIntake ? <SellerClaimIntakeEvidence carriers={carriers} intake={detail.sellerIntake} /> : null}

              <h4 className="font-medium">타임라인</h4>
              {timeline.length === 0 ? (
                <p className="text-muted-foreground">아직 기록된 처리가 없습니다.</p>
              ) : (
                <ol className="flex flex-col gap-1.5 border-l pl-4">
                  {timeline.map((entry, index) => (
                    <li className="break-words" key={`${entry.action}-${index}`}>
                      <time className="text-muted-foreground tabular-nums" dateTime={entry.createdAt}>{formatOrderDateTime(entry.createdAt)}</time>
                      {' · '}
                      {timelineLabel(entry)}
                      {entry.actorName ? ` · @${entry.actorName}` : ''}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
          {/* 배송비 청구와 운영 확인액은 승인에 앞서 채우는 칸이 아니다 — 주문 맥락과 요청 아래에 둔다. 반품배송비 차감 안내는 부분 반품이면 부분 반품 칸이 읽는 미리보기·원장에서, 주문 전체 반품이면 환불 단계의 차감 판정에서 만든다(두 칸이 반대로 말하지 않게). */}
          {actorId && claim.claimType !== 'cancel' ? <Card><CardContent className="min-w-0"><ClaimFeePanel actorId={actorId} claimId={claim.id} operator deductionNote={claim.claimType === 'return' ? (partialReturn ? partialReturnFeePanelNote(partialReturn) : returnFeeDeductionFeePanelNote(refundDeduction)) : null} /></CardContent></Card> : null}
          <ClaimOperationalFeePanel claimId={claim.id} claimType={claim.claimType} fee={claim.operationalFee} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {/* 승인·거부가 이 화면의 본론이다 — 처리 박스를 오른쪽 맨 위에 두고 진행 중인 요청은 주 색 테두리로 표시한다. 반품은 안쪽의 지금 단계 칸이 그 표시라 바깥 테두리를 겹치지 않는다. */}
          <Card id="claim-process" tabIndex={-1} className={`scroll-mt-16 outline-none${awaitsOperator && claim.claimType !== 'return' ? ' ring-2 ring-primary/40' : ''}`}>
            <CardContent className="flex min-w-0 flex-col gap-4">
              <ClaimActionPanel
                actorId={actorId}
                /* 확인창이 누르는 대상(요청번호·주문번호·구매자)과, 승인이 택배사 회수 접수로 이어지는지를 말하게 한다. */
                claimReference={orderClaimReferenceLabel(claim.reference)}
                orderReference={order ? orderReferenceLabel(order.id, order.orderNumber) : null}
                orderNumber={order?.orderNumber ?? null}
                buyerName={order?.buyerName ?? null}
                autoPickupOnApproval={autoPickupOnApproval}
                refundAmount={refund?.amount ?? refundDeduction?.refundAmount ?? order?.total ?? null}
                paidAmount={payment?.amount ?? null}
                refundDeduction={refundDeduction}
                partialReturn={partialReturn ? partialReturnRefund(partialReturn, payment?.provider === 'bank_transfer') : null}
                partialReturnUnavailable={partialReturnUnavailable}
                defectiveStock={defectiveStock}
                exchangeStockTargets={claim.claimType === 'exchange' && claim.collectionPolicy !== null ? adminClaimExchangeStockTargets(claim, order?.items ?? []) : []}
                requestSummary={exchangeRequest}
                bankTransfer={payment?.provider === 'bank_transfer' && !partialReturn && !partialReturnUnavailable}
                key={claim.id}
                cancellationForm={cancellationForm}
                claimId={claim.id}
                claimType={claim.claimType}
                collectionPolicy={claim.collectionPolicy}
                collectionComplete={claim.collectionComplete}
                collectedAt={claim.collectedAt}
                returnCollectionContact={claim.claimType === 'return' ? collectionContact : undefined}
                returnRefundSummary={claim.claimType === 'return' ? refundSummary : undefined}
                collections={claim.collections}
                claimRevision={claim.claimRevision ?? null}
                heldFrom={claim.heldFrom}
                reshipmentStarted={claim.reshippedAt !== null || (claim.reshipments ?? []).length > 0}
                orderId={claim.orderId}
                paymentProvider={payment?.provider ?? null}
                recordedRefundMethod={refund?.method ?? null}
                /* 부분 반품(ADR-0047)은 주문 전체 환불 원장(refunds) 대신 부분 환불 원장의 살아 있는 줄이 접수·완료를 말한다. */
                refundCompleted={partialLive ? partialLive.state === 'completed' : Boolean(refund?.completedAt)}
                refundFiled={partialLive ? true : Boolean(refund?.filedAt)}
                refundLedgerOpen={partialLive ? true : Boolean(refund)}
                stage={claim.stage}
                exchangeSteps={claim.claimType === 'exchange' ? <ClaimExchangeSteps claim={claim} /> : undefined}
                exchangeShipping={claim.claimType === 'exchange' ? <ClaimReshipmentDelivery carriers={carriers} claim={claim} /> : undefined}
                secondaryActions={claim.claimType === 'exchange' ? <>
                  <ClaimWithdrawal claimId={claim.id} stage={claim.stage} operator />
                  <ClaimTypeConversion embedded={embedded} key={`${claim.id}-${claim.claimType}`} claimId={claim.id} />
                  <ClaimReasonChange key={`reason-${claim.id}`} claimId={claim.id} claimType="exchange" />
                </> : undefined}
              />
              {claim.claimType !== 'exchange' ? <>
                <ClaimReshipmentDelivery claim={claim} />
                <ClaimWithdrawal claimId={claim.id} stage={claim.stage} operator />
                {claim.claimType !== 'cancel' ? <ClaimTypeConversion embedded={embedded} key={`${claim.id}-${claim.claimType}`} claimId={claim.id} /> : null}
                {/* 반품 사유 정정(CLM-029): 실제 하자·오배송을 단순 변심으로 고른 반품의 반품배송비 차감을 [환불 접수] 전에 바로잡는다. */}
                {claim.claimType === 'return' ? <ClaimReasonChange key={`reason-${claim.id}`} claimId={claim.id} claimType="return" /> : null}
              </> : null}
            </CardContent>
          </Card>
          {claim.claimType !== 'return' ? <>{collectionContact}{refundSummary}</> : null}
        </div>
      </div>
    </section>
  );
}
