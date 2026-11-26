'use server';

import { canAccessAdminScreen } from '@/lib/admin/access';

import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import {
  ADMIN_CLAIM_BULK_DB_ITEM_RESERVE_MS,
  ADMIN_CLAIM_BULK_PROVIDER_ITEM_RESERVE_MS,
  adminClaimBulkSummary,
  normalizeAdminClaimBulkForm,
  parseAdminClaimBulkContexts,
  runAdminClaimBulkSequentially,
  type AdminClaimBulkState,
} from '@/lib/admin/claim-bulk';
import {
  adminClaimBasePath,
  normalizeAdminClaimCollectionForm,
  normalizeAdminClaimOriginCollectionForm,
  normalizeAdminClaimOperationalFeeForm,
  normalizeAdminClaimEvidenceForm,
  normalizeAdminClaimDecisionForm,
  normalizeAdminClaimRefundForm,
} from '@/lib/admin/claims';
import { loadAdminClaimDetail } from '@/lib/admin/claims.server';
import { adminClaimDetailLoadFailureMessage } from '@/lib/admin/claim-transaction-snapshot';
import { DEFECTIVE_STOCK_PENDING_NOTICE, EXCHANGE_STOCK_DECISION_REQUIRED, readStockDispositions } from '@/lib/admin/defective-stock';
import { recordClaimDefectiveStock } from '@/lib/admin/defective-stock.server';
import { CLAIM_EVIDENCE_MAX_FILES, CLAIM_WAIVER_REASON_MAX, CLAIM_WAIVER_REASON_MIN, claimWaiverReasonValid, normalizeClaimWaiverReason } from '@/lib/admin/claim-evidence';
import { ADMIN_CANCELLATION_RECHECK_LABELS } from '@/lib/admin/orders';
import { withPreservedFormValues, type AdminFormValuesState } from '@/lib/admin/form-state';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { warehouseStopErrorMessage } from '@/lib/admin/warehouse-stop';
import {
  ORDER_CLAIM_REFUND_METHOD_LABELS,
  ORDER_CLAIM_TYPE_LABELS,
  isOrderClaimType,
  orderClaimReferenceLabel,
  orderClaimRefundMethodForProvider,
  type OrderClaimRefundMethod,
  type OrderClaimType,
} from '@/lib/orders/claims';
import { reconcileOrderCancellation } from '@/lib/orders/cancellation-orchestrator.server';
import { reconcileOrderPartialCancellation } from '@/lib/orders/partial-cancellation-orchestrator.server';
import { loadAdminClaimPartialReturn } from '@/lib/orders/partial-return.server';
import type { AdminClaimPartialReturn } from '@/lib/orders/partial-return';
import { recoverGoodsPaymentManually } from '@/lib/payments/goods-manual-recovery.server';
import {
  PAYMENT_PROVIDER_LABELS,
  automatedCancelProviderLabel,
  paymentProviderLabel,
  providerCancelsAutomatically,
} from '@/lib/payments/provider-capabilities';
import { createClient } from '@/lib/supabase/server';
import { adminPaymentCancelFailureMessage, withAdminSupportCode } from '@/lib/admin/payment-cancel-error';
import { isUuid } from '@/lib/uuid';
import { krwAmountWords } from '@/lib/format';

/* 어드민 클레임 콘솔 액션(#252).
 *
 * 이 파일은 돈을 직접 움직이지 않는다. 재고 복원과 카드팩 회수는
 * finalize_order_cancellation_with_provider_evidence 한 곳에만 있고, 여기서는
 * 이미 있는 정합화 경로 — 취소 요청 오케스트레이터와 Korpay 수동 복구 seam —
 * 를 그대로 호출한 뒤 그 결과를 환불 원장에 적을 뿐이다. 두 번째 원장을 만들면
 * "환불은 완료인데 재고는 그대로"인 주문이 생긴다.
 *
 * 토스 결제의 취소 클레임은 승인하는 순간 오케스트레이터가 토스 전액 취소를 발행하고
 * fresh 조회로 확인한다(2026-10-12 점검 REF-2). '환불 완료 확정'도 같은 경로를 다시
 * 부른다 — 그 버튼이 결제사 취소를 발행하는 지점이지, 운영자가 결제사 원장에서 취소를
 * 먼저 확인하는 버튼이 아니다. */

export interface AdminClaimActionState extends AdminFormValuesState {
  error?: string;
  message?: string;
}

const DECIDE_FAILED = '클레임을 처리하지 못했습니다. 최신 상태를 확인해주세요.';
const COLLECTION_FAILED = '수거 상태를 기록하지 못했습니다. 최신 상태를 확인해주세요.';
const REFUND_FAILED = '환불 기록을 남기지 못했습니다. 최신 상태를 확인해주세요.';
const OPERATIONAL_FEE_FAILED = '운영 확인액을 기록하지 못했습니다. 새로고침한 뒤 최신 요청에서 다시 저장해주세요.';
const FINALIZE_FAILED = "결제 취소를 확정하지 못했습니다. 주문과 재고는 그대로입니다. 새로고침한 뒤 [환불 완료 확정]을 다시 눌러주세요. 요청 상세에 '결제사 확인 오류'가 보이면 그 안내를 먼저 확인합니다.";
/** 정합화 결과 코드가 있는 실패. 문장은 다음에 할 일을 말하고, 코드는 끝에 한 번만 붙는다(QA-10 · L-12). */
function finalizeFailed(code: string) {
  return adminPaymentCancelFailureMessage(code);
}
const IN_PROGRESS = '결제 상태 처리가 아직 끝나지 않았습니다. 주문과 재고는 그대로 유지됩니다.';
const DEFECTIVE_PLAN_FAILED = '품목별 재고 처리를 저장하지 못했습니다. 환불과 재고는 그대로입니다. 최신 상태를 확인한 뒤 다시 시도해주세요.';
const DEFECTIVE_RECORD_FAILED = `불량 재고를 기록하지 못했습니다. ${DEFECTIVE_STOCK_PENDING_NOTICE}`;
const DEFECTIVE_STOCK_RECORDED_NOTE = '판매 재고에는 넣지 않았습니다.';
const EXCHANGE_STOCK_PLAN_FAILED = '회수품 재고 처리를 저장하지 못했습니다. 재고와 재출고는 그대로입니다. 최신 상태를 확인한 뒤 다시 시도해주세요.';
const REFRESH_AND_RETRY = '화면을 새로고침한 뒤 다시 진행해주세요.';
/**
 * 폼이 보낸 환불 수단이 정해진 수단과 다를 때의 안내. 이미 환불 기록에 적힌 수단이 있으면 그 수단이 기준이고(첫 기록이 이긴다),
 * 없으면 결제가 정한다. 결제사 이름은 이름표에서 읽는다 — 나이스페이 결제에 '토스'라고 말하지 않는다.
 */
function refundMethodMismatchMessage(provider: string | null, recorded: OrderClaimRefundMethod | null) {
  if (recorded) {
    return `이 요청의 환불은 이미 '${ORDER_CLAIM_REFUND_METHOD_LABELS[recorded]}' 수단으로 접수했습니다. 처음 기록한 수단으로만 이어서 처리합니다. ${REFRESH_AND_RETRY}`;
  }
  if (providerCancelsAutomatically(provider)) {
    const label = automatedCancelProviderLabel(provider);
    return `이 결제의 환불 수단과 다릅니다. ${label} 결제는 결제사 취소(${label} 전액 취소)로만 환불합니다. ${REFRESH_AND_RETRY}`;
  }
  if (provider === 'bank_transfer') {
    return `이 결제의 환불 수단과 다릅니다. ${PAYMENT_PROVIDER_LABELS.bank_transfer} 결제는 계좌 송금으로만 환불합니다. ${REFRESH_AND_RETRY}`;
  }
  return `이 결제의 환불 수단과 다릅니다. ${REFRESH_AND_RETRY}`;
}
/** 부분 반품의 결제사 부분 취소를 말할 때의 결제사 이름. 이름표에 없으면 '결제사'다. */
function partialCancelProviderLabel(provider: string | null) {
  return paymentProviderLabel(provider) ?? '결제사';
}

const DECISION_MESSAGES: Record<string, string> = {
  review: '검토중으로 표시했습니다.',
  approve: '클레임을 승인하고 수거를 시작했습니다.',
  reject: '클레임을 거부했습니다.',
};

/** 결제사가 부분 취소를 받지 않은 부분 반품을 계좌 송금으로 바꾸는 사유 길이(DB와 같다). */
const PARTIAL_RETURN_TRANSFER_REASON_MIN = 5;
const PARTIAL_RETURN_TRANSFER_REASON_MAX = 500;

/** DB가 던지는 message를 운영자 문구로 옮긴다. 원문을 그대로 노출하지 않는다. */
function rpcErrorMessage(message: string | null | undefined, fallback: string) {
  const value = (message ?? '').toLowerCase();
  /* 부분 반품(ADR-0047) */
  if (value.includes('partial_return_refund_method_mismatch')) return '이 부분 반품의 환불 수단과 맞지 않는 처리입니다. 토스 결제는 결제사 부분 취소로, 무통장 결제는 계좌 송금으로 환불합니다. 화면을 새로고침한 뒤 이 요청에 보이는 버튼으로 다시 처리해주세요.';
  if (value.includes('partial_return_state_changed')) return '부분 반품한 상품의 배송 상태나 수량이 그사이 바뀌어 처리하지 않았습니다. 환불과 재고는 바뀌지 않았습니다. 화면을 새로고침해 바뀐 내용을 확인한 뒤 다시 처리해주세요.';
  if (value.includes('partial_return_uses_partial_refund')) return '부분 반품은 주문 전체 결제 취소가 아니라 고른 상품 몫의 부분 환불로만 처리합니다. 화면을 새로고침한 뒤 [환불 완료 확정]을 다시 눌러주세요.';
  if (value.includes('partial_return_transfer_reason_required')) return `계좌 송금으로 바꾸는 사유를 ${PARTIAL_RETURN_TRANSFER_REASON_MIN}~${PARTIAL_RETURN_TRANSFER_REASON_MAX}자로 적어주세요.`;
  if (value.includes('partial_return_transfer_account_required')) return '고객에게 받은 환불계좌의 은행·계좌번호·예금주를 모두 입력해주세요. 계좌번호는 숫자와 - 만 써서 8~30자로 넣습니다.';
  if (value.includes('partial_return_transfer_operation_conflict')) return '이 화면의 처리 번호로 다른 요청이 이미 처리돼 저장하지 않았습니다. 화면을 새로고침한 뒤 다시 시도해주세요.';
  if (value.includes('partial_return_transfer_unavailable')) return '계좌 송금으로 바꿀 수 있는 것은 결제사가 부분 취소를 받지 않은 부분 반품뿐입니다. 이미 계좌 송금으로 바꿨거나 요청 상태가 바뀌었을 수 있으니 화면을 새로고침해 확인해주세요.';
  if (value.includes('partial_return_transfer_remainder_manual')) return '이 결제는 앞선 부분 반품 환불을 이미 계좌로 송금했습니다. 지금 환불 금액은 그 송금액을 빼지 않은 결제 금액 기준이라, 그대로 계좌 송금을 기록하면 같은 돈을 두 번 돌려주게 됩니다. 결제 담당이 개발팀에 요청해 남은 환불액을 맞춘 뒤 처리해주세요.';
  if (value.includes('bank_refund_permission_required')) return '계좌 송금 환불 권한(결제 담당)이 필요합니다. 대표 또는 계정 주매니저에게 요청해주세요.';
  if (value.includes('defective_stock_item_not_in_claim')) return '이 부분 반품에서 고른 품목만 불량으로 고를 수 있습니다.';
  if (value.includes('claim_conversion_partial_return')) return '부분 반품은 교환으로 바꿀 수 없습니다. 교환은 주문 전체로만 받습니다.';
  if (value.includes('partial_return_')) return '부분 반품을 처리할 수 없는 상태입니다(결제 수단, 상품별 결제 금액 기록, 품목 상태 가운데 맞지 않는 것이 있음). 요청 상세의 부분 반품 칸에서 이유를 확인해주세요.';
  if (value.includes('defective_stock_claim_closed')) return '이미 환불이 확정된 요청이라 재고 처리를 바꿀 수 없습니다.';
  if (value.includes('defective_stock_item_in_other_claim') || value.includes('defective_stock_plan_conflict')) return '다른 반품·교환 요청에서 이미 불량으로 고른 품목입니다. 이력을 확인해주세요.';
  if (value.includes('defective_stock_item_not_in_order') || value.includes('defective_stock_return_only')) return '이 반품 요청의 품목이 아닙니다. 화면을 새로고침한 뒤 다시 시도해주세요.';
  if (value.includes('defective_stock_item_not_shipped')) return '출고되지 않았거나 디지털인 품목은 불량으로 고를 수 없습니다. 화면을 새로고침해주세요.';
  if (value.includes('defective_stock_item_fully_canceled')) return '재고 부족 부분 취소로 남은 수량이 없는 품목은 불량으로 고를 수 없습니다. 화면을 새로고침해주세요.';
  if (value.includes('claim_collections_incomplete')) return '모든 출고지의 회수를 확인한 뒤 환불·재출고를 진행해주세요.';
  if (value.includes('origin_collection_required')) return '출고지별 회수 확인에서 각 배송 건의 입고를 기록해주세요.';
  if (value.includes('claim_return_address_required')) return '회수 주소가 없는 상품이 있습니다. 상품의 반품/교환지를 고르거나 출고지 설정에 반품 주소를 등록한 뒤 다시 진행해주세요.';
  if (value.includes('claim_collection_bundle_required')) return '반품지가 둘 이상인 배송 건입니다. 반품지별 회수 확인에서 도착한 곳을 골라 확인해주세요.';
  if (value.includes('claim_collection_conflict')) return '이미 다른 근거로 회수 확인된 배송 건입니다. 이력을 확인해주세요.';
  /* 출고지시가 나간 발송 전 배송 건의 창고 보관 확인은 창고 회신 기록이 근거다(ADR-0046). */
  if (value.includes('claim_collection_warehouse_already_shipped') || value.includes('claim_collection_warehouse_reply_required')) return warehouseStopErrorMessage(value);
  if (value.includes('claim_collection_not_found')) return '이 클레임에 속한 회수 배송 건을 찾을 수 없습니다.';
  if (value.includes('invalid_collection_evidence')) return '회수 확인 근거를 500자 이내로 입력해주세요.';
  if (value.includes('invalid_collection_received_on')) return '실제 입고일은 주문일부터 오늘 사이의 날짜로 입력해주세요.';
  if (value.includes('invalid_reshipment_delivery_evidence')) return '교환품 배송완료 확인 근거를 500자 이내로 입력해주세요.';
  if (value.includes('reshipment_delivery_conflict')) return '이미 기록된 배송완료 확인과 다릅니다. 담당자와 근거를 확인해주세요.';
  if (value.includes('claim_not_reshipped') || value.includes('claim_reshipment_not_dispatched')) return '재출고 운송장이 기록된 교환만 배송완료를 확인할 수 있습니다.';
  if (value.includes('order_not_cancelable') || value.includes('claim_not_cancelable')) return '발주확인 이후 주문은 취소를 승인할 수 없습니다. 배송·회수 상태와 접수 이력을 확인해주세요.';
  if (value.includes('withdrawal_deadline_expired')) {
    return '청약철회 기한이 지난 요청입니다. 승인 대신 사유를 남겨 거부해주세요.';
  }
  if (value.includes('claim_refund_finalization_required')) {
    return '결제 취소 확인이 끝나지 않았습니다. 재고 복원이 확인된 뒤에만 환불 완료를 기록할 수 있습니다.';
  }
  if (value.includes('claim_refund_ledger_missing')) {
    return '이 주문에는 환불 기록이 없습니다. 결제 내역을 먼저 확인해주세요.';
  }
  if (value.includes('exchange_has_no_refund')) return '교환 클레임에는 환불이 없습니다.';
  if (value.includes('claim_type_has_no_collection')) return '이 클레임에는 회수 확인이 필요하지 않습니다. 최신 처리 이력을 확인해주세요.';
  if (value.includes('claim_type_has_no_reshipment')) return '교환 클레임만 재출고를 기록할 수 있습니다.';
  if (value.includes('claim_not_rejectable')) {
    return '처리에 착수했거나 교환품을 재출고하기 시작한 클레임은 거부할 수 없습니다. 결제 취소나 남은 출고지 재출고를 마치거나, 사람이 판단할 일이면 보류로 남겨주세요.';
  }
  if (value.includes('claim_refund_account_missing')) {
    return '등록된 환불계좌가 없습니다. 무통장 주문은 결제한 분이 주문 상세에서 환불계좌를 등록한 뒤 다시 진행해주세요. 선물 주문은 선물 요청 화면에서 등록합니다.';
  }
  if (value.includes('claim_not_decidable')) return '지금 단계에서는 처리할 수 없습니다. 다른 담당자가 먼저 처리했을 수 있으니 새로고침해 현재 단계를 확인해주세요.';
  if (value.includes('claim_not_collectable')) return '수거 단계가 아닙니다. 새로고침해 현재 단계를 확인해주세요.';
  if (value.includes('claim_not_refundable')) return '환불을 접수할 수 있는 단계가 아닙니다. 새로고침해 현재 단계를 확인해주세요.';
  if (value.includes('claim_not_reshippable')) return '입고 확인이 끝난 교환만 재출고할 수 있습니다.';
  if (value.includes('goods_group_retry')) return '상품 전환이나 재고 처리가 진행 중입니다. 최신 상태를 확인한 뒤 다시 시도해주세요.';
  if (value.includes('physical_generation_already_restored')) return '이 회수 상품의 재고는 이미 복원됐습니다. 처리 이력을 확인해주세요.';
  if (value.includes('reshipment_variant_unavailable')) return '선택한 재출고 상품을 사용할 수 없습니다. 최신 목록에서 같은 상품의 옵션이나 같은 그룹의 상품을 선택해주세요.';
  if (value.includes('invalid reshipment items')) return '재출고할 주문 품목과 상품을 확인해주세요.';
  if (value.includes('reshipment_conflict')) return '이미 다른 운송장이나 상품으로 재출고한 교환입니다. 처리 이력을 확인해주세요.';
  if (value.includes('reshipment_shipment_required')) return '출고지가 둘 이상인 교환은 배송 건마다 재출고·배송완료를 확인해주세요.';
  if (value.includes('reshipment_shipment_not_found')) return '이 교환의 재출고 대상 출고지가 아닙니다. 최신 정보를 다시 확인해주세요.';
  /* 배송 분실(택배사 확인, 원장 #15) 기록. */
  if (value.includes('carrier_loss_return_only')) return '배송 분실은 반품 요청에서만 기록합니다. 분실된 상품을 다시 보내려면 하자·오배송 교환으로 접수해 회수 없이 재출고해주세요.';
  if (value.includes('carrier_loss_shipment_not_dispatched')) return '아직 발송되지 않은 배송 건은 분실로 기록할 수 없습니다. 발송 전 몫은 재고 부족 부분 취소로 처리해주세요.';
  if (value.includes('invalid_carrier_accident_number')) return '택배사 사고 번호를 앞뒤 공백 없이 2~60자로 입력해주세요.';
  if (value.includes('invalid_carrier_loss')) return '배송 분실 기록 내용을 읽지 못했습니다. 화면을 새로고침한 뒤 사고 번호·분실 확인 메모·근거 사진을 다시 넣어 기록해주세요.';
  if (value.includes('claim_changed')) return '그사이 요청 상태가 바뀌어 처리하지 않았습니다. 새로고침해 최신 상태를 확인한 뒤 다시 처리해주세요.';
  if (value.includes('collection_waiver_conflict')) return '이 출고지는 이미 다른 사유·사진으로 회수 생략을 기록했습니다. 처리 이력을 확인해주세요.';
  if (value.includes('collection_waiver_not_allowed')) return '회수 생략은 하자·오배송 교환에서만 쓸 수 있습니다.';
  if (value.includes('collection_waiver_not_needed')) return '이미 회수를 확인한 출고지입니다. 회수 생략 없이 진행해주세요.';
  if (value.includes('collection_waiver_partially_received')) return '이 출고지의 일부 반품지에서 이미 입고가 확인되어 회수 생략을 할 수 없습니다. 남은 반품지의 입고를 확인하고, 도착하지 않으면 고객에게 확인한 뒤 판단하세요.';
  if (value.includes('collection_waiver_unavailable')) return '출고지별 회수를 쓰지 않는 교환은 회수를 생략할 수 없습니다.';
  if (value.includes('collection_waiver_evidence_required')) return '회수 생략 근거 사진을 1~5장 올려주세요.';
  if (value.includes('invalid_collection_waiver_reason')) return '회수 생략 사유를 10~500자로 적어주세요.';
  if (value.includes('exchange_stock_decision_required')) return `${EXCHANGE_STOCK_DECISION_REQUIRED} 처리 칸의 회수품 재고 처리에서 저장한 뒤 다시 재출고해주세요.`;
  if (value.includes('production_incomplete')) return '주문제작 상품의 교환품 제작이 끝난 뒤 재출고할 수 있습니다. 주문 상세의 주문제작 처리를 확인해주세요.';
  if (value.includes('insufficient_or_overflowing_stock') || value.includes('stock_aggregate_overflow')) return '재고 수량을 적용할 수 없습니다. 최신 재고와 회수 수량을 확인해주세요.';
  if (value.includes('stock_out_of_range')) return '재출고할 옵션 재고가 부족합니다. 최신 옵션 수량을 확인해주세요.';
  if (value.includes('invalid rejection reason')) return '거부 사유는 앞뒤 공백 없이 10자 이상 200자 이하로 입력해주세요.';
  if (value.includes('invalid hold reason')) return '보류 사유는 앞뒤 공백 없이 10자 이상 200자 이하로 입력해주세요.';
  if (value.includes('claim_not_held')) return '보류 상태가 아닙니다.';
  if (value.includes('claim_not_found')) return '클레임을 찾을 수 없습니다.';
  if (value.includes('claim_operational_fee_conflict')) return '다른 담당자가 먼저 금액을 바꿨습니다. 새로고침해 바뀐 금액을 확인한 뒤 다시 저장해주세요.';
  if (value.includes('invalid_claim_operational_fee')) return '운영 확인액(0~1,000,000원)·비용 유형·비용 메모(1~500자)·확인 근거(1~1,000자)를 확인해주세요.';
  if (value.includes('unknown shipping carrier')) return '쓸 수 없는 택배사입니다. 택배사를 다시 골라주세요.';
  /* 운송장 등록 판정(SHP-030~032). 재출고·일괄 재출고 결과표가 같은 문구를 쓴다. */
  if (value.includes('tracking_number_in_use')) return '다른 주문의 배송 건(대표·추가 운송장 또는 교환 재출고)에 이미 등록된 운송장번호입니다. 교환품 상자의 운송장번호를 다시 확인해주세요.';
  if (value.includes('tracking_number_format_mismatch')) return '택배사의 운송장번호 형식(자릿수)과 맞지 않습니다. 숫자가 빠지거나 더해지지 않았는지 확인해주세요.';
  /* 환불 원장 기록(admin_record_order_claim_refund)의 입력·권한 거절. 일괄 환불 결과표도 이 문구를 그대로 쓴다(QA2 S-T12b-06). */
  if (value.includes('invalid settlement note')) return '환불 메모는 앞뒤 공백 없이 300자 이내로 적어주세요.';
  if (value.includes('invalid refund method') || value.includes('invalid refund stage')) return '환불 수단이나 처리 단계를 확인하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.';
  if (value.includes('bank_refund_method_required') || value.includes('bank_refund_confirmation_required') || value.includes('bank_refund_evidence_required')) {
    return '무통장 결제는 결제사 취소가 아니라 요청 상세의 무통장 환불 칸에서 [취소 확정 · 재고 복원]과 [송금 완료 기록]으로 환불합니다. 상세에서 처리해주세요.';
  }
  if (value.includes('operator_capability_required') || value.includes('staff required') || value.includes('staff_required')) {
    return '이 처리를 할 권한이 없습니다. 반품·교환 처리 권한을 확인해주세요.';
  }
  return fallback;
}

async function requireStaffAction(): Promise<
  { error?: AdminClaimActionState; userId?: string; canManagePayments?: boolean }
> {
  const auth = await requireAdminActionAccess('/admin/sales/claims/cancels', { capability: 'sales.manage' });
  if (!auth) return { error: { error: '관리자 권한이 필요합니다.' } };
  return { userId: auth.user.id, canManagePayments: canAccessAdminScreen(auth, null, { capability: 'sales.manage', adminOnly: true }) };
}

function revalidateClaimSurfaces(claimId: string, claimType?: OrderClaimType) {
  for (const type of ['cancel', 'return', 'exchange'] as const) {
    if (claimType && type !== claimType) continue;
    revalidatePath(adminClaimBasePath(type));
    revalidatePath(`${adminClaimBasePath(type)}/${claimId}`);
  }
  /* 클레임은 주문 사다리와 발송 큐를 동시에 움직인다. 한쪽만 갱신하면 방금
     처리한 주문이 다른 화면에 그대로 남아 두 번 처리된다. */
  revalidatePath('/admin/sales/orders');
  revalidatePath('/admin/sales/dispatch');
  revalidatePath('/orders');
}

function readClaimType(formData: FormData): OrderClaimType | undefined {
  const value = formData.get('claimType');
  return isOrderClaimType(value) ? value : undefined;
}

/*
 * 재시도 안내는 그 상황에서 실제로 그려지는 버튼만 가리킨다.
 * - 결제 행이 있는 토스 결제: 승인이 환불 원장을 열어 요청 상세에 [환불 완료 확정]이
 *   그려진다.
 * - 결제 행이 없는 주문(결제창만 열렸거나 결제 결과 미확정): 환불 원장이 없어
 *   [환불 완료 확정]이 그려지지 않는다(ClaimActionPanel refundLedgerMissing). 만료
 *   sweep도 처리중 요청을 건너뛰므로 주문 통합검색 주문 패널의 재확인 버튼만 이 건을
 *   닫는다 — 이름은 요청 단계에 따라 다르다(ADMIN_CANCELLATION_RECHECK_LABELS).
 */
const { processing: RECHECK_PROCESSING, needsReview: RECHECK_NEEDS_REVIEW, preparedKorpay: RECHECK_PREPARED_KORPAY } = ADMIN_CANCELLATION_RECHECK_LABELS;
const ORDER_PANEL_RECHECK = `주문 통합검색에서 이 주문을 열어 [${RECHECK_NEEDS_REVIEW}](처리중이면 [${RECHECK_PROCESSING}])`;

/**
 * 승인으로 processing이 된 취소 클레임의 결제사 취소를 바로 실행한다.
 *
 * 주문 콘솔의 청약철회 승인(approveAdminOrderCancellationAction)과 같은 동작이다.
 * Korpay는 취소 API가 없어 이메일 접수 → 수동 확인 seam이 정상 경로이고, 무통장은
 * 계좌 송금 절차를 따르므로 여기서 돌리지 않는다(돌리면 곧바로 needs_review가 돼
 * 접수 양식·계좌 송금 접수를 막는다).
 */
async function issueApprovedClaimCancellation(
  claimId: string,
  actorId: string,
): Promise<AdminClaimActionState> {
  let provider: string | null = null;
  try {
    const detail = await loadAdminClaimDetail(claimId);
    provider = detail?.payment?.provider ?? null;
  } catch {
    return { error: `취소를 승인했지만 결제 정보를 다시 읽지 못했습니다. 주문과 재고는 그대로 유지됩니다. 새로고침한 뒤 요청 상세의 [환불 완료 확정]으로 결제 취소를 진행해주세요. 그 버튼이 없으면 ${ORDER_PANEL_RECHECK}으로 진행합니다.` };
  }
  if (provider === 'korpay') {
    return { message: `취소를 승인했습니다. ${PAYMENT_PROVIDER_LABELS.korpay} 결제는 결제사 취소 접수 양식으로 접수한 뒤 환불 완료를 확정해주세요.` };
  }
  if (provider === 'bank_transfer') {
    return { message: '취소를 승인했습니다. 무통장 입금 결제는 결제사 취소가 없어 환불계좌 송금 절차로 진행합니다.' };
  }

  let result: Awaited<ReturnType<typeof reconcileOrderCancellation>>;
  try {
    result = await reconcileOrderCancellation({ requestId: claimId, actorId });
  } catch {
    result = { ok: false, code: 'local_finalize_failed' };
  }
  const hasPayment = provider !== null;
  if (!result.ok) {
    return {
      error: hasPayment
        ? `취소는 승인했습니다. ${adminPaymentCancelFailureMessage(result.code)}`
        : withAdminSupportCode(
          `취소는 승인했지만 주문 취소를 확정하지 못했습니다. 주문과 재고는 그대로입니다. 결제 내역이 없는 주문이라 [환불 완료 확정]은 보이지 않습니다. ${ORDER_PANEL_RECHECK}으로 다시 시도해주세요.`,
          result.code,
        ),
    };
  }
  if (result.status === 'in_progress') {
    return {
      message: hasPayment
        ? `취소를 승인했습니다. ${IN_PROGRESS} 잠시 뒤 [환불 완료 확정]으로 다시 확인해주세요.`
        : `취소를 승인했습니다. ${IN_PROGRESS} 결제 결과가 정해지기 전이라 환불 기록이 없어 [환불 완료 확정]은 보이지 않습니다. 잠시 뒤 주문 통합검색에서 이 주문을 열어 [${RECHECK_PROCESSING}]으로 다시 확인해주세요. ${PAYMENT_PROVIDER_LABELS.korpay} 결제창 주문은 그 자리의 [${RECHECK_PREPARED_KORPAY}] 버튼으로 처리합니다.`,
    };
  }
  return {
    message: providerCancelsAutomatically(provider)
      ? `취소를 승인하고 ${automatedCancelProviderLabel(provider)} 전액 취소까지 확인했습니다. 주문 취소·재고 복원과 환불 기록이 함께 끝났습니다.`
      : '취소를 승인하고 주문 취소를 마쳤습니다. 결제 전 주문이라 결제사 취소는 없었습니다.',
  };
}

/**
 * 결정 한 건의 단건 경로. 상세 패널과 목록 일괄 처리가 같은 함수를 지난다(R8 · D8).
 *
 * 승인 결과 단계는 폼이 아니라 DB가 돌려준 값으로 읽는다. 취소는 회수할 물건이 없어
 * 곧장 processing이 되고, 그 순간 결제사 취소를 발행한다.
 */
async function decideOneOrderClaim(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string,
  input: { claimId: string; decision: string; note: string | null },
): Promise<{ decided: boolean; state: AdminClaimActionState }> {
  const { data, error } = await supabase.rpc('admin_decide_order_claim', {
    p_claim_id: input.claimId,
    p_decision: input.decision,
    p_note: input.note,
  });
  if (error) return { decided: false, state: { error: rpcErrorMessage(error.message, DECIDE_FAILED) } };
  if (input.decision === 'approve' && data === 'processing') {
    return { decided: true, state: await issueApprovedClaimCancellation(input.claimId, actorId) };
  }
  return { decided: true, state: { message: DECISION_MESSAGES[input.decision] ?? '클레임을 처리했습니다.' } };
}

export async function decideOrderClaimAction(
  _state: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const access = await requireStaffAction();
  if (access.error || !access.userId) return access.error ?? { error: DECIDE_FAILED };

  const normalized = normalizeAdminClaimDecisionForm(formData);
  if (!normalized.ok) return { error: normalized.error };
  if (normalized.value.decision === 'hold' || normalized.value.decision === 'resume') {
    return { error: '보류·해제 화면을 다시 열어 최신 요청의 유형과 상태를 확인해주세요.' };
  }

  const supabase = await createClient();
  const { decided, state } = await decideOneOrderClaim(supabase, access.userId, normalized.value);
  if (decided) revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
  return state;
}

export type AdminClaimApprovalAmountState =
  | { ok: true; amount: number | null; paymentProvider: string | null }
  | { ok: false; error: string };

const APPROVAL_AMOUNT_FAILED = '취소할 금액을 다시 읽지 못해 승인하지 않았습니다. 새로고침한 뒤 다시 눌러주세요.';

/**
 * 취소 승인 확인창에 적을 금액을 읽는다(읽기 전용 — 아무것도 바꾸지 않는다).
 *
 * 승인 전에는 환불 기록이 없어 화면이 가진 금액이 주문 금액(orders.total)뿐이다. 재고 부족 부분 취소가 있었던
 * 주문은 주문 금액이 줄지 않으므로 그 금액은 실제 취소액(결제 금액 − 이미 부분 취소한 금액)보다 크다. 그래서
 * 누르는 시점에 DB가 승인 때 쓰는 것과 같은 계산(admin_order_claim_bulk_context.refundAmount — 일괄 처리 미리보기와
 * 같은 값)을 읽어 확인창이 그 금액을 말하게 한다. 승인할 수 없는 단계면 금액 대신 그 사실을 알린다.
 */
export async function readOrderClaimApprovalAmountAction(claimId: string): Promise<AdminClaimApprovalAmountState> {
  const access = await requireStaffAction();
  if (access.error) return { ok: false, error: access.error.error ?? APPROVAL_AMOUNT_FAILED };
  const id = typeof claimId === 'string' ? claimId.toLowerCase() : '';
  if (!isUuid(id)) return { ok: false, error: APPROVAL_AMOUNT_FAILED };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_order_claim_bulk_context', { p_claim_ids: [id] });
    if (error) return { ok: false, error: rpcErrorMessage(error.message, APPROVAL_AMOUNT_FAILED) };
    const context = parseAdminClaimBulkContexts(data)?.find((row) => row.claimId.toLowerCase() === id) ?? null;
    if (!context) return { ok: false, error: APPROVAL_AMOUNT_FAILED };
    if (context.stage !== 'requested' && context.stage !== 'in_review') {
      return { ok: false, error: rpcErrorMessage('claim_not_decidable', APPROVAL_AMOUNT_FAILED) };
    }
    return { ok: true, amount: context.refundAmount, paymentProvider: context.paymentProvider };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: APPROVAL_AMOUNT_FAILED };
  }
}

interface BulkClaimRow {
  id: string;
  reference: number | string | null;
}

/**
 * 목록 일괄 처리(R8 · D8) — 승인·거부(공통 사유)·검토중.
 *
 * 새 배열 RPC 없이 건마다 단건 경로(decideOneOrderClaim)를 그대로 탄다. 토스 취소 API는
 * 결제 단건이라 앞 건의 결제사 취소가 끝난 뒤에 다음 건을 시작하고(전체 직렬), 시간은 액션
 * 진입부터 잰다. 경과가 예산을 넘었거나 다음 건의 최악 시간(취소 승인 = 결제사 왕복 셋)이 목록
 * maxDuration 안에 끝나지 않으면 남은 건은 시작하지 않고 '미처리'로 돌려준다.
 *
 * 요청번호는 처음에 한 번 읽고, 유형은 건을 시작하기 직전에 다시 읽는다 — 그 사이 다른
 * 운영자가 반품↔교환을 전환한 요청을 이 목록의 결정으로 처리하지 않는다.
 */
export async function bulkDecideOrderClaimsAction(
  _state: AdminClaimBulkState,
  formData: FormData,
): Promise<AdminClaimBulkState> {
  const startedAt = Date.now();
  const access = await requireStaffAction();
  if (access.error || !access.userId) return { error: access.error?.error ?? DECIDE_FAILED };
  const actorId = access.userId;

  const claimType = readClaimType(formData);
  if (!claimType) return { error: '목록을 새로고침한 뒤 다시 실행해주세요.' };

  const normalized = normalizeAdminClaimBulkForm(formData);
  if (!normalized.ok) return { error: normalized.error };
  const { claimIds, decision, note } = normalized.value;

  const supabase = await createClient();
  const { data: rows, error: readError } = await supabase
    .from('order_cancellation_requests')
    .select('id,reference')
    .in('id', claimIds);
  if (readError || !Array.isArray(rows)) {
    return { error: '선택한 요청을 읽지 못했습니다. 새로고침한 뒤 다시 실행해주세요.' };
  }
  const claims = new Map((rows as BulkClaimRow[]).map((row) => [String(row.id).toLowerCase(), row]));
  const referenceOf = (id: string) => {
    const reference = Number(claims.get(id)?.reference);
    return Number.isSafeInteger(reference) && reference > 0 ? orderClaimReferenceLabel(reference) : null;
  };

  /* 취소 승인만 결정 직후 결제사 취소(사전 조회·취소·사후 조회)까지 간다. */
  const reserveMs = claimType === 'cancel' && decision === 'approve'
    ? ADMIN_CLAIM_BULK_PROVIDER_ITEM_RESERVE_MS
    : ADMIN_CLAIM_BULK_DB_ITEM_RESERVE_MS;

  const outcomes = await runAdminClaimBulkSequentially(claimIds, async (claimId) => {
    if (!claims.has(claimId)) return { ok: false, message: '클레임을 찾을 수 없습니다.' };
    const { data: latest, error: latestError } = await supabase
      .from('order_cancellation_requests')
      .select('claim_type')
      .eq('id', claimId)
      .maybeSingle<{ claim_type: string }>();
    if (latestError) return { ok: false, message: '요청을 다시 읽지 못했습니다. 최신 상태를 확인해주세요.' };
    if (!latest) return { ok: false, message: '클레임을 찾을 수 없습니다.' };
    if (latest.claim_type !== claimType) {
      return { ok: false, message: `${ORDER_CLAIM_TYPE_LABELS[claimType]} 요청이 아닙니다. 이 요청의 유형에 맞는 목록에서 처리해주세요.` };
    }
    const { decided, state } = await decideOneOrderClaim(supabase, actorId, { claimId, decision, note });
    if (decided) revalidateClaimSurfaces(claimId, claimType);
    return state.error
      ? { ok: false, message: state.error }
      : { ok: true, message: state.message ?? DECISION_MESSAGES[decision] ?? '클레임을 처리했습니다.' };
  }, { startedAt, reserveMs, clock: () => Date.now() });

  return {
    summary: adminClaimBulkSummary(outcomes.map((outcome) => outcome.outcome)),
    results: outcomes.map(({ item, outcome, message }) => ({
      claimId: item,
      reference: referenceOf(item),
      outcome,
      message,
    })),
  };
}

export async function recordOrderClaimCollectionAction(
  _state: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const access = await requireStaffAction();
  if (access.error) return access.error;

  const normalized = normalizeAdminClaimCollectionForm(formData);
  if (!normalized.ok) return { error: normalized.error };

  const supabase = await createClient();
  /* 실제 입고일(1027T-033)은 입고 확인 때만 보낸다. 비우면 DB가 오늘로 적는다. 레거시에는 근거 열이 없어 받은 근거는
     감사 기록에 남는다(선택). */
  const { error } = await supabase.rpc('admin_record_order_claim_collection', {
    p_claim_id: normalized.value.claimId,
    p_stage: normalized.value.stage,
    p_received_on: normalized.value.receivedOn,
    p_evidence: normalized.value.evidence,
  });
  if (error) return { error: rpcErrorMessage(error.message, COLLECTION_FAILED) };

  revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
  return {
    message: normalized.value.stage === 'collected'
      ? adminGoodsCopy(`반송 상품 입고를 확인했습니다. 환불 기한은 실제 입고일(${normalized.value.receivedOn ?? '오늘'})부터 셉니다.`)
      : '수거중으로 표시했습니다.',
  };
}

export async function recordOrderClaimOriginCollectionAction(
  previous: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const fail = (error: string) => withPreservedFormValues({ error }, previous, formData);
  const access = await requireStaffAction();
  if (access.error) return fail(access.error.error ?? COLLECTION_FAILED);
  const normalized = normalizeAdminClaimOriginCollectionForm(formData);
  if (!normalized.ok) return fail(normalized.error);
  const supabase = await createClient();
  /* 실제 입고일(1027T-033)을 함께 남긴다. 비우면 DB가 오늘로 적는다. 환급 기한은 모든 출고지 중 가장 늦은 입고일부터 센다.
     반품지가 갈린 배송 건(회수 묶음, S36-040)은 묶음 키로, 아니면 지금까지의 배송 건 키로 부른다. */
  const { bundleId } = normalized.value;
  const { data, error } = bundleId
    ? await supabase.rpc('admin_record_order_claim_collection_bundle', {
      p_claim_id: normalized.value.claimId,
      p_bundle_id: bundleId,
      p_evidence: normalized.value.evidence,
      p_received_on: normalized.value.receivedOn,
    })
    : await supabase.rpc('admin_record_order_claim_origin_collection', {
      p_claim_id: normalized.value.claimId,
      p_shipment_id: normalized.value.shipmentId,
      p_evidence: normalized.value.evidence,
      p_received_on: normalized.value.receivedOn,
    });
  if (error) return fail(rpcErrorMessage(error.message, COLLECTION_FAILED));
  if (data !== 'collecting' && data !== 'collected') return fail(COLLECTION_FAILED);
  revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
  return { message: data === 'collected'
    ? '모든 출고지의 회수를 확인했습니다. 환불 기한은 가장 늦은 실제 입고일부터 셉니다. 다음 처리 단계를 확인해주세요.'
    : bundleId ? '이 반품지의 회수를 확인했습니다. 남은 반품지·출고지를 확인해주세요.' : '이 출고지의 회수를 확인했습니다. 남은 출고지를 확인해주세요.' };
}

export async function recordOrderClaimOperationalFeeAction(
  previous: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const fail = (error: string) => withPreservedFormValues({ error }, previous, formData);
  try {
  const access = await requireStaffAction();
  if (access.error) return fail(access.error.error ?? OPERATIONAL_FEE_FAILED);
  const normalized = normalizeAdminClaimOperationalFeeForm(formData);
  if (!normalized.ok) return fail(normalized.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_record_order_claim_operational_fee', {
    p_claim_id: normalized.value.claimId,
    p_fee_kind: normalized.value.feeKind,
    p_amount: normalized.value.amount,
    p_note: normalized.value.note,
    p_evidence: normalized.value.evidence,
    p_expected_updated_at: normalized.value.expectedUpdatedAt,
  });
  if (error) return fail(rpcErrorMessage(error.message, OPERATIONAL_FEE_FAILED));
  revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
  return { message: normalized.value.amount === null ? '운영 확인액 기록을 해제했습니다.' : '운영 확인액을 기록했습니다.' };
  } catch (error) {
    unstable_rethrow(error);
    return fail(OPERATIONAL_FEE_FAILED);
  }
}

export async function recordOrderClaimReshipmentDeliveryAction(
  previous: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const failureMessage = '교환품 배송완료를 기록하지 못했습니다. 최신 상태를 확인해주세요.';
  const fail = (error: string) => withPreservedFormValues({ error }, previous, formData);
  const access = await requireStaffAction();
  if (access.error) return fail(access.error.error ?? failureMessage);
  const normalized = normalizeAdminClaimEvidenceForm(formData);
  if (!normalized.ok) return fail(normalized.error);
  /* 배송 건별 재출고(TKT-166)는 운송장마다 확인한다. 'order'는 배송 건 없는 옛 주문 전체 행이고,
     값이 없으면 이 표 이전의 클레임 단위 기록(옛 단일 열)이다. */
  const shipment = formData.get('reshipmentShipment');
  if (shipment !== null && shipment !== 'order' && !isUuid(shipment)) return fail(failureMessage);
  const supabase = await createClient();
  const { data, error } = shipment === null
    ? await supabase.rpc('admin_record_order_claim_reshipment_delivery', {
      p_claim_id: normalized.value.claimId, p_evidence: normalized.value.evidence,
    })
    : await supabase.rpc('admin_record_order_claim_shipment_reshipment_delivery', {
      p_claim_id: normalized.value.claimId, p_shipment_id: shipment === 'order' ? null : shipment, p_evidence: normalized.value.evidence,
    });
  if (error) return fail(rpcErrorMessage(error.message, failureMessage));
  if (data !== 'delivered') return fail(failureMessage);
  revalidateClaimSurfaces(normalized.value.claimId, 'exchange');
  return { message: shipment === null
    ? '교환품의 실제 배송완료를 확인했습니다. 이후 신청은 기존 신청 기한과 조건을 따릅니다.'
    : '이 운송장의 교환품 배송완료를 확인했습니다. 모든 운송장이 확인되면 이후 신청은 기존 신청 기한과 조건을 따릅니다.' };
}

/**
 * 회수 생략을 재출고보다 먼저 결정한다(주문제작 상품이 있는 출고지, QNA-039·ADR-0041).
 *
 * 결정하면 그 출고지의 교환품 제작이 열리고, 제작이 끝나면 회수·재배송 연락처 처리에서 회수 확인 없이 재출고한다.
 * 사유·근거 사진·하자 교환 여부·입고 여부는 DB(admin_waive_order_claim_collection)가 다시 검사한다.
 * '확인했습니다' 체크 값은 받지 않는다 — 화면의 확인창이 같은 말을 하고, DB에는 그 값을 받는 자리가 없다.
 */
export async function waiveOrderClaimCollectionAction(
  previous: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const failureMessage = '회수 생략을 기록하지 못했습니다. 최신 상태를 확인해주세요.';
  const fail = (error: string) => withPreservedFormValues({ error }, previous, formData, { exclude: ['evidenceFileId'] });
  const access = await requireStaffAction();
  if (access.error) return fail(access.error.error ?? failureMessage);
  const claimId = formData.get('claimId'), shipmentId = formData.get('shipmentId');
  if (!isUuid(claimId) || !isUuid(shipmentId)) return fail(failureMessage);
  const reason = normalizeClaimWaiverReason(String(formData.get('reason') ?? ''));
  if (!claimWaiverReasonValid(reason)) return fail(`회수 생략 사유를 ${CLAIM_WAIVER_REASON_MIN}~${CLAIM_WAIVER_REASON_MAX}자로 적어주세요.`);
  const evidenceValues = formData.getAll('evidenceFileId');
  const evidenceFileIds = evidenceValues.filter(isUuid);
  if (evidenceFileIds.length !== evidenceValues.length || evidenceFileIds.length < 1 || evidenceFileIds.length > CLAIM_EVIDENCE_MAX_FILES
    || new Set(evidenceFileIds).size !== evidenceFileIds.length) {
    return fail(`회수 생략 근거 사진을 1~${CLAIM_EVIDENCE_MAX_FILES}장 올려주세요.`);
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_waive_order_claim_collection', {
    p_claim_id: claimId, p_shipment_id: shipmentId, p_waiver: { reason, evidenceFileIds },
  });
  if (error) return fail(rpcErrorMessage(error.message, failureMessage));
  const result = typeof data === 'object' && data !== null && !Array.isArray(data) ? data as Record<string, unknown> : null;
  if (!result || result.claimId !== claimId || result.shipmentId !== shipmentId) return fail(failureMessage);
  revalidateClaimSurfaces(claimId, 'exchange');
  return { message: result.productionPending === true
    ? '회수 생략을 기록했습니다. 주문 상세의 주문제작 처리에서 교환품 제작을 마치면 회수 없이 재출고합니다.'
    : "회수 생략을 기록했습니다. '재출고 등록'에서 회수 없이 재출고합니다." };
}

/**
 * 배송 분실을 기록한다(택배사가 분실을 확인한 배송 건, 원장 #15 SHP-095·ADR-0018 보완 2026-11-19).
 *
 * 반품(접수 사유와 무관 — 분실은 회사·택배 귀책이라 반품배송비를 빼지 않는다)에서 발송된 배송 건의 회수를 사고 번호·메모·근거 사진으로 대신한다. 모든 출고지가 입고되거나 분실로 기록되면
 * 회수가 끝나 환불을 진행할 수 있고, 분실 품목은 환불 확정 때 판매 재고로 되돌리지 않는다. 반품·사유·발송 여부·리비전은 DB
 * (admin_record_order_claim_carrier_loss)가 다시 검사하고, 같은 작업 번호의 재전송은 같은 결과다.
 * '확인했습니다' 체크 값은 받지 않는다 — 화면의 확인창이 같은 말을 하고, DB에는 그 값을 받는 자리가 없다.
 */
export async function recordOrderClaimCarrierLossAction(
  previous: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const failureMessage = '배송 분실을 기록하지 못했습니다. 새로고침해 이 출고지가 이미 배송 분실로 기록됐는지 확인하고, 아니면 다시 기록해주세요.';
  const fail = (error: string) => withPreservedFormValues({ error }, previous, formData, { exclude: ['evidenceFileId'] });
  const access = await requireStaffAction();
  if (access.error) return fail(access.error.error ?? failureMessage);
  const claimId = formData.get('claimId'), shipmentId = formData.get('shipmentId'), operationId = formData.get('operationId');
  const revisionValue = formData.get('claimRevision');
  const revision = typeof revisionValue === 'string' && /^\d{1,9}$/u.test(revisionValue) ? Number(revisionValue) : Number.NaN;
  if (!isUuid(claimId) || !isUuid(shipmentId) || !isUuid(operationId) || !Number.isSafeInteger(revision) || revision < 0) return fail(failureMessage);
  const accidentNumber = String(formData.get('accidentNumber') ?? '').trim();
  if (accidentNumber.length < 2 || accidentNumber.length > 60) return fail('택배사 사고 번호를 2~60자로 입력해주세요.');
  const reason = normalizeClaimWaiverReason(String(formData.get('reason') ?? ''));
  if (!claimWaiverReasonValid(reason)) return fail(`분실 확인 메모를 ${CLAIM_WAIVER_REASON_MIN}~${CLAIM_WAIVER_REASON_MAX}자로 적어주세요.`);
  const evidenceValues = formData.getAll('evidenceFileId');
  const evidenceFileIds = evidenceValues.filter(isUuid);
  if (evidenceFileIds.length !== evidenceValues.length || evidenceFileIds.length < 1 || evidenceFileIds.length > CLAIM_EVIDENCE_MAX_FILES
    || new Set(evidenceFileIds).size !== evidenceFileIds.length) {
    return fail(`분실 근거 사진(택배사 회신·사고 접수 화면)을 1~${CLAIM_EVIDENCE_MAX_FILES}장 올려주세요.`);
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_record_order_claim_carrier_loss', {
    p_claim_id: claimId, p_shipment_id: shipmentId, p_loss: { reason, evidenceFileIds, accidentNumber },
    p_expected_revision: revision, p_operation_id: operationId,
  });
  if (error) return fail(rpcErrorMessage(error.message, failureMessage));
  const result = typeof data === 'object' && data !== null && !Array.isArray(data) ? data as Record<string, unknown> : null;
  if (!result || result.claimId !== claimId || result.shipmentId !== shipmentId) return fail(failureMessage);
  revalidateClaimSurfaces(claimId, 'return');
  return { message: result.collectionComplete === true
    ? '배송 분실을 기록했습니다. 모든 출고지의 회수가 끝나 환불을 진행할 수 있습니다. 분실 상품은 판매 재고로 되돌리지 않습니다.'
    : '배송 분실을 기록했습니다. 남은 출고지의 입고를 확인하면 환불을 진행할 수 있습니다.' };
}

/**
 * 결제사가 부분 취소를 받지 않아 닫힌 부분 반품(ADR-0047)을 계좌 송금 부분 환불로 바꾼다. 결제 담당(무통장 송금 담당과 같은 판정 —
 * DB가 세션까지 다시 본다)만, 사유와 고객에게 받은 환불계좌가 필요하다. 같은 계산을 송금 대기로 적용하고(고른 굿즈 재고 복원 포함),
 * 송금 완료는 주문 상세의 부분 환불 기록(또는 환불 송금 대기 목록)에서 증빙으로 적는다. 전액 환불로 돌리지 않는다.
 * '확인했습니다' 체크 값은 받지 않는다 — 화면의 확인창이 금액과 결과를 말하고, DB에는 그 값을 받는 자리가 없다.
 */
export async function convertPartialReturnToTransferAction(
  _previous: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const failure = '계좌 송금으로 바꾸지 못했습니다. 환불과 재고는 그대로입니다. 새로고침해 요청 상태를 확인한 뒤 다시 시도해주세요.';
  const access = await requireStaffAction();
  if (access.error || !access.userId) return access.error ?? { error: failure };
  if (!access.canManagePayments) return { error: '계좌 송금 환불 권한(결제 담당)이 필요합니다. 대표 또는 계정 주매니저에게 요청해주세요.' };
  const claimId = formData.get('claimId'), operationId = formData.get('operationId');
  if (!isUuid(claimId) || !isUuid(operationId)) return { error: failure };
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason.length < PARTIAL_RETURN_TRANSFER_REASON_MIN || reason.length > PARTIAL_RETURN_TRANSFER_REASON_MAX) {
    return { error: `계좌 송금으로 바꾸는 사유를 ${PARTIAL_RETURN_TRANSFER_REASON_MIN}~${PARTIAL_RETURN_TRANSFER_REASON_MAX}자로 적어주세요.` };
  }
  const bankName = String(formData.get('bankName') ?? '').trim();
  const accountNumber = String(formData.get('accountNumber') ?? '').trim();
  const accountHolder = String(formData.get('accountHolder') ?? '').trim();
  if (!bankName || bankName.length > 40 || !/^[0-9-]{8,30}$/u.test(accountNumber) || !accountHolder || accountHolder.length > 40) {
    return { error: '고객에게 받은 환불계좌의 은행·계좌번호·예금주를 모두 입력해주세요. 계좌번호는 숫자와 - 만 써서 8~30자로 넣습니다.' };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_convert_partial_return_refund_to_transfer', {
    p_claim_id: claimId, p_reason: reason,
    p_refund_account: { bankName, accountNumber, accountHolder }, p_operation_id: operationId,
  });
  if (error) return { error: rpcErrorMessage(error.message, failure) };
  const result = typeof data === 'object' && data !== null && !Array.isArray(data) ? data as Record<string, unknown> : null;
  if (!result || typeof result.refundAmount !== 'number' || (result.state !== 'awaiting_transfer' && result.state !== 'completed')) {
    return { error: failure };
  }
  revalidateClaimSurfaces(claimId, 'return');
  revalidatePath('/admin/sales/claims/refund-transfers');
  return { message: result.state === 'completed'
    ? '이미 송금까지 끝난 부분 반품입니다.'
    : `계좌 송금 부분 환불(${krwAmountWords(result.refundAmount)})로 바꿨습니다. 환불 송금 대기에 올렸습니다. 송금한 뒤 주문 상세의 부분 환불 기록에서 [송금 완료 기록]을 눌러주세요.` };
}

interface ManualRecoveryAttemptRow {
  order_id: string;
  request_id: string;
  attempt_id: string;
  manual_recovery_available: boolean;
}

/**
 * 클레임을 종결 가능한 상태로 만든다.
 *
 * Korpay는 `refund()`가 API를 부르지 않고 전건 needs_review로 떨어지므로 수동
 * 확인 seam이 정상 경로다(#208). toss 유상 캡처는 오케스트레이터가 게이트웨이
 * refund(취소 API + fresh 조회 검증)로 자동 취소한다(#389) — 클레임 승인이
 * 건별 메일 요청 없이 한 동작으로 종결되는 지점이 여기다.
 * 어느 쪽이든 마지막에 finalize_order_cancellation_with_provider_evidence를 지나며,
 * 그 함수만이 재고를 복원하고 미개봉 카드팩을 회수한다.
 */
async function finalizeClaimPayment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: { claimId: string; orderId: string; actorId: string; canManagePayments: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('admin_goods_manual_recovery_attempts', {
    p_order_ids: [input.orderId],
  });

  const attempts = (!error && Array.isArray(data) ? data : []) as ManualRecoveryAttemptRow[];
  const attempt = attempts.find((row) => (
    row.request_id === input.claimId && row.manual_recovery_available
  ));

  if (attempt) {
    /* 현재 결제 관리 권한과 원장 확인을 요구한다. 미전환 환경의 admin 전용 제한도 유지한다. */
    if (!input.canManagePayments) {
      return {
        ok: false,
        error: '코페이 결제 취소를 확인할 권한(결제 관리)이 없습니다. 대표나 계정 주매니저에게 요청해주세요. 아직 새 권한 체계로 바뀌기 전이면 기존 관리자에게 요청해주세요.',
      };
    }
    try {
      const result = await recoverGoodsPaymentManually({
        operation: 'provider_cancel_confirmed',
        attemptId: attempt.attempt_id,
        actorId: input.actorId,
        requestId: input.claimId,
        operatorAttested: true,
      });
      if (result.outcome === 'in_progress') {
        return { ok: false, error: '다른 담당자가 같은 결제의 취소 확인을 진행하고 있습니다. 잠시 뒤 다시 눌러주세요.' };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: FINALIZE_FAILED };
    }
  }

  const { error: beginError } = await supabase.rpc('admin_begin_order_cancellation_reconcile', {
    p_request_id: input.claimId,
  });
  if (beginError) return { ok: false, error: FINALIZE_FAILED };

  try {
    const result = await reconcileOrderCancellation({
      requestId: input.claimId,
      actorId: input.actorId,
    });
    if (!result.ok) return { ok: false, error: finalizeFailed(result.code) };
    if (result.status === 'in_progress') return { ok: false, error: IN_PROGRESS };
    return { ok: true };
  } catch {
    return { ok: false, error: FINALIZE_FAILED };
  }
}

export async function recordOrderClaimRefundAction(
  _state: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const access = await requireStaffAction();
  if (access.error || !access.userId) return access.error ?? { error: REFUND_FAILED };

  const normalized = normalizeAdminClaimRefundForm(formData);
  if (!normalized.ok) return { error: normalized.error };

  const supabase = await createClient();
  let finalizationRan = false;

  /* 환불 수단은 폼이 아니라 결제에서 정한다(2026-10-12 점검 REF-8·REF-3).
   *
   * 토스 결제는 '환불 완료 확정'이 토스 전액 취소를 발행한다. 폼에서 계좌 송금을
   * 고르면 취소는 이미 나간 뒤에 원장 기록만 실패하고, 그걸 보고 계좌로 또 보내면
   * 이중 환불이 된다. 그래서 결제와 이미 기록된 수단에서 파생한 값과 폼 값이 다르면
   * 결제사 호출 전에 거절한다. 단계·결제도 폼이 아니라 DB에서 읽는다. */
  let current: Awaited<ReturnType<typeof loadAdminClaimDetail>>;
  try {
    current = await loadAdminClaimDetail(normalized.value.claimId);
  } catch (error) {
    /* 읽기에서 멈춘 이유(결제 기록 대조·권한·일시 오류)를 그대로 알린다. 아무것도 시작하지 않았다. */
    return { error: adminClaimDetailLoadFailureMessage(error, REFUND_FAILED) };
  }
  if (!current) return { error: '클레임을 찾을 수 없습니다.' };

  /* 부분 반품(ADR-0047)은 주문 전체 결제 취소가 아니라 부분 환불 원장으로 간다 — 전액 정합화 경로를 부르지 않는다. */
  if (current.claim.claimType === 'return') {
    let partial: AdminClaimPartialReturn | null;
    try {
      partial = await loadAdminClaimPartialReturn(normalized.value.claimId);
    } catch {
      return { error: REFUND_FAILED };
    }
    if (partial) {
      return recordPartialReturnRefund(supabase, {
        actorId: access.userId, claimId: normalized.value.claimId, claimStage: current.claim.stage, formData,
        method: normalized.value.method, note: normalized.value.note, partial, provider: current.payment?.provider ?? null, stage: normalized.value.stage,
      });
    }
  }

  const derivedMethod: OrderClaimRefundMethod | null = current.refund?.method
    ?? orderClaimRefundMethodForProvider(current.payment?.provider ?? null);
  if (derivedMethod && derivedMethod !== normalized.value.method) {
    return { error: refundMethodMismatchMessage(current.payment?.provider ?? null, current.refund?.method ?? null) };
  }
  const paymentProvider = current.payment?.provider ?? null;
  const cancelLabel = providerCancelsAutomatically(paymentProvider)
    ? automatedCancelProviderLabel(paymentProvider)
    : null;
  /* 반품배송비 차감(ADR-0031). 판정·결정이 없으면 null이고 아래 문구는 지금 그대로다. 금액은 DB가 정한다 —
     여기서는 운영자에게 알릴 문구만 고른다. */
  const deduction = current.claim.claimType === 'return' && current.refundDeduction?.applicable
    && current.refundDeduction.refundAmount !== null
    ? current.refundDeduction
    : null;
  /* 반품 불량 재고(QNA-035): 품목별 '판매 재고 복원/불량' 선택. 선택 필드가 없으면 null이라 지금처럼 전부 복원한다. */
  const dispositions = normalized.value.stage === 'completed' && current.claim.claimType === 'return' ? readStockDispositions(formData) : null;
  if (dispositions && 'error' in dispositions) return { error: dispositions.error };

  if (normalized.value.stage === 'completed') {
    const orderId = String(formData.get('orderId') ?? '');
    if (!orderId || orderId.toLowerCase() !== current.claim.orderId.toLowerCase()) {
      return { error: REFUND_FAILED };
    }

    /* 이미 종결된 클레임에는 정합화를 다시 걸지 않는다.
     *
     * admin_begin_order_cancellation_reconcile은 completed 요청을
     * cancellation_request_not_reconcilable로 거절한다. 그래서 레거시 경로로
     * 완료된 건(재고 복원·카드팩 회수는 이미 끝났고 refunds.completed_at만 비어
     * 있는 상태)에 이 액션을 걸면 원장 기록에 닿기도 전에 항상 실패했다. 단계는
     * 폼이 아니라 DB에서 읽는다 — 클라이언트가 보낸 값으로 정합화를 건너뛸지
     * 정하면 그 자체가 게이트 우회가 된다. */
    // Derive this gate from the durable payment, never from the submitted method.
    // Bank refunds need cancellation evidence, an awaiting-transfer phase and a
    // separate immutable transfer receipt; the card orchestrator cannot do it.
    if (current.payment?.provider === 'bank_transfer') {
      return { error: '무통장 환불 칸에서 [취소 확정 · 재고 복원]과 [송금 완료 기록]을 각각 남겨주세요.' };
    }

    if (current.claim.stage !== 'completed') {
      /* 선택은 재고 복원(정합화) 전에 저장한다. 불량 품목은 복원 경로가 건너뛴다 — 복원한 뒤 빼면 재고 대조 기록과 어긋난다. */
      if (dispositions) {
        const { error: planError } = await supabase.rpc('admin_plan_claim_defective_stock', {
          p_claim_id: normalized.value.claimId,
          p_order_item_ids: dispositions.defectiveIds,
        });
        if (planError) {
          revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
          return { error: rpcErrorMessage(planError.message, DEFECTIVE_PLAN_FAILED) };
        }
      }
      finalizationRan = true;
      const finalized = await finalizeClaimPayment(supabase, {
        claimId: normalized.value.claimId,
        orderId: current.claim.orderId,
        actorId: access.userId,
        canManagePayments: access.canManagePayments === true,
      });
      if (!finalized.ok) {
        revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
        return { error: finalized.error };
      }
    }
  }

  const { error } = await supabase.rpc('admin_record_order_claim_refund', {
    p_claim_id: normalized.value.claimId,
    p_method: normalized.value.method,
    p_note: normalized.value.note,
    p_stage: normalized.value.stage,
  });
  if (error) {
    revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
    const reason = rpcErrorMessage(error.message, REFUND_FAILED);
    /* 결제사 취소와 주문 정합화가 이미 끝난 뒤의 원장 기록 실패를 "환불 실패"로
       보이면 운영자가 같은 돈을 다른 수단으로 다시 돌려준다. 끝난 일을 먼저 말한다. */
    return {
      error: finalizationRan
        ? `${cancelLabel ? `${cancelLabel} ${deduction ? '취소' : '전액 취소'}와 ` : ''}주문 취소·재고 복원은 이미 완료됐습니다. 환불 기록만 실패했습니다 — 다시 환불하지 마세요. ${reason}`
        : reason,
    };
  }

  const finishRefundMessage = async (): Promise<AdminClaimActionState> => {
    revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
    if (normalized.value.stage === 'filed') {
      if (deduction) {
        const amounts = `반품배송비 ${krwAmountWords(deduction.deductionAmount)}을 뺀 ${krwAmountWords(deduction.refundAmount ?? 0)}`;
        return {
          message: cancelLabel
            ? `환불 접수를 기록했습니다. ${amounts}을 환불합니다. ${cancelLabel} 부분 취소는 [환불 완료 확정]을 누를 때 결제사에 요청됩니다.`
            : `환불 접수를 기록했습니다. ${amounts}을 환불합니다.`,
        };
      }
      return {
        message: cancelLabel
          ? `환불 접수를 기록했습니다. ${cancelLabel} 전액 취소는 [환불 완료 확정]을 누를 때 결제사에 요청됩니다.`
          : '환불 접수를 기록했습니다.',
      };
    }
    /* 이미 종결된 클레임에는 재고 복원·카드팩 회수가 방금 일어나지 않았다. 문구가
       일어나지 않은 일을 보고하면 운영자가 그 주문을 다시 확인할 근거를 잃는다. */
    if (!finalizationRan) {
      return { message: '환불 완료를 기록했습니다. 주문 취소와 재고 복원은 이미 끝나 있던 상태라 다시 하지 않았습니다.' };
    }
    if (deduction && cancelLabel) {
      /* 결제사가 부분 취소를 받지 않으면 정합화가 전액 환불로 돌렸을 수 있다 — 방금 확정된 결정을 다시 읽어 일어난 일만 말한다. */
      let settled: Awaited<ReturnType<typeof loadAdminClaimDetail>> = null;
      try {
        settled = await loadAdminClaimDetail(normalized.value.claimId);
      } catch {
        settled = null;
      }
      const after = settled?.refundDeduction;
      if (after?.state === 'applied' && after.refundAmount !== null) {
        return {
          message: `${cancelLabel} 부분 취소(반품배송비 ${krwAmountWords(after.deductionAmount)}을 뺀 ${krwAmountWords(after.refundAmount)})를 확인하고 환불 완료를 기록했습니다. 재고 복원이 함께 확정됐습니다.`,
        };
      }
      if (after?.state === 'not_applied') {
        /* 확인창이 미리 말한 경우다(A-1). 실제로 취소된 전액과 빼지 못한 반품배송비를 금액으로 다시 말한다. */
        const refunded = after.refundAmount !== null ? ` ${krwAmountWords(after.refundAmount)}` : '';
        return {
          message: `결제사가 이 결제의 부분 취소를 받지 않아 ${cancelLabel} 전액${refunded} 취소로 환불 완료를 기록했습니다. 반품배송비 ${krwAmountWords(after.deductionAmount)}은 환불액에서 빼지 못했으니 배송비 청구로 따로 받아야 합니다. 재고 복원이 함께 확정됐습니다.`,
        };
      }
      return { message: '결제사 취소를 확인하고 환불 완료를 기록했습니다. 환불 금액은 처리 화면에서 확인해주세요. 재고 복원이 함께 확정됐습니다.' };
    }
    return {
      message: cancelLabel
        ? `${cancelLabel} 전액 취소를 확인하고 환불 완료를 기록했습니다. 재고 복원이 함께 확정됐습니다.`
        : '환불 완료를 기록했습니다. 재고 복원이 함께 확정됐습니다.',
    };
  };

  /* 환불 확정이 끝난 뒤 불량 선택을 원장에 기록한다(감사 RPC). 실패해도 확정은 되돌리지 않고 '불량 기록 필요'로 남는다 —
     같은 호출을 다시 시도해도 같은 클레임을 두 번 기록하지 않는다(멱등). */
  if (dispositions && dispositions.defectiveIds.length > 0) {
    const recorded = await recordClaimDefectiveStock(normalized.value.claimId);
    revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
    if (recorded.error) {
      return { error: `환불 완료와 재고 복원은 이미 확정됐습니다. 불량 재고 기록만 끝나지 않았습니다 — 환불은 다시 하지 마세요. ${recorded.error}` };
    }
    const done = await finishRefundMessage();
    return done.message ? { message: `${done.message} 불량 ${recorded.recorded}개 품목은 판매 재고에 넣지 않고 불량 재고에 기록했습니다.` } : done;
  }
  return finishRefundMessage();
}

const PARTIAL_RETURN_BANK_COMPLETE = '계좌 송금으로 돌려주는 부분 반품 환불은 여기서 완료하지 않습니다. 송금한 뒤 주문 상세의 부분 환불 기록에서 송금 근거를 적고 [송금 완료 기록]을 누르면 반품 요청도 완료됩니다.';

/**
 * 부분 반품의 환불 접수·완료(ADR-0047). 접수는 DB가 금액을 한 번 정해 부분 환불 원장을 만든다. 토스 결제의 완료는 그 원장으로
 * 결제사 부분 취소를 발행·조회로 확인하고(재고 부족 부분 취소와 같은 오케스트레이터), 확인되면 같은 트랜잭션에서 고른 수량만 재고 복원·
 * 적립금·카드팩을 적용하고 요청을 완료한다. 결제사가 부분 취소를 받지 않으면 돈이 움직이지 않았으므로 전액 환불로 돌리지 않는다.
 */
async function recordPartialReturnRefund(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    actorId: string; claimId: string; claimStage: string; formData: FormData; method: OrderClaimRefundMethod; note: string | null;
    partial: AdminClaimPartialReturn; provider: string | null; stage: 'filed' | 'completed';
  },
): Promise<AdminClaimActionState> {
  const expectedMethod = orderClaimRefundMethodForProvider(input.provider);
  if (expectedMethod && expectedMethod !== input.method) return { error: '이 부분 반품의 환불 수단과 맞지 않는 처리입니다. 토스 결제는 결제사 부분 취소로, 무통장 결제는 계좌 송금으로 환불합니다. 화면을 새로고침한 뒤 이 요청에 보이는 버튼으로 다시 처리해주세요.' };
  const live = input.partial.history.find((record) => record.id === input.partial.refundId) ?? null;
  /* 품목별 재고 처리(불량 선택)는 접수 양식에도 실린다 — 무통장·0원 부분 반품은 접수와 함께 적용(재고 처리)되므로 접수 전에 저장한다(Codex 리뷰). */
  const dispositions = readStockDispositions(input.formData);
  if (dispositions && 'error' in dispositions) return { error: dispositions.error };
  if (input.stage === 'filed' && dispositions && !input.partial.refundId) {
    const { error: planError } = await supabase.rpc('admin_plan_claim_defective_stock', { p_claim_id: input.claimId, p_order_item_ids: dispositions.defectiveIds });
    if (planError) {
      revalidateClaimSurfaces(input.claimId, 'return');
      return { error: rpcErrorMessage(planError.message, DEFECTIVE_PLAN_FAILED) };
    }
  }

  if (input.stage === 'completed') {
    /* 무통장 결제, 또는 결제사가 부분 취소를 받지 않아 계좌 송금으로 바꾼 카드 결제(정산 경로 bank_transfer)는 송금 증빙이 완료를 정한다. */
    if (input.provider === 'bank_transfer' || input.partial.settlement === 'bank_transfer') return { error: PARTIAL_RETURN_BANK_COMPLETE };
    if (input.claimStage !== 'completed') {
      if (!live) return { error: '먼저 [환불 접수]를 기록해주세요. 부분 반품 환불 금액은 환불 접수 때 정해집니다.' };
      if (dispositions) {
        const { error: planError } = await supabase.rpc('admin_plan_claim_defective_stock', { p_claim_id: input.claimId, p_order_item_ids: dispositions.defectiveIds });
        if (planError) {
          revalidateClaimSurfaces(input.claimId, 'return');
          return { error: rpcErrorMessage(planError.message, DEFECTIVE_PLAN_FAILED) };
        }
      }
      const result = await reconcileOrderPartialCancellation({ partialCancellationId: live.id, actorId: input.actorId });
      revalidateClaimSurfaces(input.claimId, 'return');
      if (!result.ok) {
        return {
          error: result.code === 'partial_cancel_rejected'
            ? '결제사가 이 결제의 부분 취소를 받지 않아 환불하지 못했습니다. 돈은 움직이지 않았고 요청은 확인 필요로 남았습니다. 전액 환불로 돌리지 마세요. 결제 담당이 고객에게 환불계좌를 받아 부분 반품 칸의 [계좌 송금 부분 환불로 전환]으로 처리합니다.'
            : withAdminSupportCode(
              '결제사에서 부분 취소 결과를 확인하지 못했습니다. 요청은 확인 필요로 남았습니다. 잠시 뒤 [환불 완료 확정]을 다시 눌러주세요. 같은 부분 취소로 다시 확인하므로 두 번 취소되지 않습니다.',
              result.code,
            ),
        };
      }
    }
  }

  const { error } = await supabase.rpc('admin_record_order_claim_refund', {
    p_claim_id: input.claimId, p_method: input.method, p_note: input.note, p_stage: input.stage,
  });
  revalidateClaimSurfaces(input.claimId, 'return');
  if (error) {
    return {
      error: input.stage === 'completed'
        ? `결제사 부분 취소와 고른 상품의 재고 복원은 이미 확정됐습니다. 환불 기록만 실패했습니다 — 다시 환불하지 마세요. ${rpcErrorMessage(error.message, REFUND_FAILED)}`
        : rpcErrorMessage(error.message, REFUND_FAILED),
    };
  }
  if (input.stage === 'filed') {
    const preview = input.partial.preview;
    const amount = preview ? `${preview.returnFeeDeduction > 0 ? `반품배송비 ${krwAmountWords(preview.returnFeeDeduction)}을 뺀 ` : ''}${krwAmountWords(preview.refundAmount)}` : '고른 상품 몫';
    return {
      message: input.provider === 'bank_transfer'
        ? `부분 반품 환불 접수를 기록했습니다. ${amount}을 환불 송금 대기에 올리고 고른 상품의 재고를 복원했습니다. 송금한 뒤 주문 상세의 부분 환불 기록에서 [송금 완료 기록]을 눌러주세요.`
        : `부분 반품 환불 접수를 기록했습니다. [환불 완료 확정]을 누르면 ${amount}을 ${partialCancelProviderLabel(input.provider)} 부분 취소로 돌려줍니다.`,
    };
  }
  let message = `${partialCancelProviderLabel(input.provider)} 부분 취소를 확인하고 부분 반품 환불 완료를 기록했습니다. 고른 상품의 재고 복원과 적립금 되돌림이 함께 확정됐습니다.`;
  if (dispositions && dispositions.defectiveIds.length > 0) {
    const recorded = await recordClaimDefectiveStock(input.claimId);
    if (recorded.error) return { error: `부분 반품 환불과 재고 처리는 이미 확정됐습니다. 불량 재고 기록만 끝나지 않았습니다 — 환불은 다시 하지 마세요. ${recorded.error}` };
    message += ` 불량 ${recorded.recorded}개 품목은 판매 재고에 넣지 않고 불량 재고에 기록했습니다.`;
  }
  return { message };
}

/** 환불 확정 전에 품목별 재고 처리 선택만 저장한다(무통장 환불처럼 확정이 다른 양식에서 일어나는 경로). 재고·환불에는 손대지 않는다. */
export async function planClaimDefectiveStockAction(
  _state: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const access = await requireStaffAction();
  if (access.error || !access.userId) return access.error ?? { error: DEFECTIVE_PLAN_FAILED };
  const claimId = String(formData.get('claimId') ?? '').toLowerCase();
  const dispositions = readStockDispositions(formData);
  if (!isUuid(claimId) || !dispositions || 'error' in dispositions) return { error: dispositions && 'error' in dispositions ? dispositions.error : DEFECTIVE_PLAN_FAILED };
  const { error } = await (await createClient()).rpc('admin_plan_claim_defective_stock', {
    p_claim_id: claimId,
    p_order_item_ids: dispositions.defectiveIds,
  });
  revalidateClaimSurfaces(claimId, readClaimType(formData));
  if (error) return { error: rpcErrorMessage(error.message, DEFECTIVE_PLAN_FAILED) };
  return {
    message: dispositions.defectiveIds.length > 0
      ? `불량 ${dispositions.defectiveIds.length}개 품목을 저장했습니다. 환불을 확정하면 판매 재고에 넣지 않고 불량 재고에 기록합니다.`
      : '모든 품목을 판매 재고 복원으로 저장했습니다.',
  };
}

/** 교환 회수품 재고 처리(CLM-046)의 DB 거절을 운영자 문구로 옮긴다. 반품과 다른 뜻의 코드만 여기서 고르고 나머지는 공용 문구다. */
function exchangeStockErrorMessage(message: string | null | undefined) {
  const value = (message ?? '').toLowerCase();
  if (value.includes('defective_stock_claim_closed')) return '이미 재출고한 출고지이거나 재출고할 수 있는 단계가 아니라 회수품 재고 처리를 바꿀 수 없습니다. 최신 상태를 확인해주세요.';
  if (value.includes('exchange_defective_not_collected')) return '회수를 확인한 출고지만 회수품 재고 처리를 정할 수 있습니다. 먼저 출고지별 회수를 확인해주세요.';
  if (value.includes('exchange_defective_collection_waived')) return '회수 생략을 결정한 출고지는 돌아오는 상품이 없어 회수품 재고 처리를 정하지 않습니다.';
  if (value.includes('defective_stock_item_not_in_order') || value.includes('defective_stock_exchange_only')) return '이 출고지의 회수 품목이 아닙니다. 화면을 새로고침한 뒤 다시 시도해주세요.';
  if (value.includes('defective_stock_item_fully_canceled')) return '재고 부족 부분 취소로 남은 수량이 없는 품목은 불량으로 고를 수 없습니다. 화면을 새로고침해주세요.';
  return rpcErrorMessage(message, EXCHANGE_STOCK_PLAN_FAILED);
}

/**
 * 교환 출고지의 회수품 재고 처리(CLM-046)를 재출고 전에 저장한다. 불량으로 고른 품목은 그 출고지를 재출고할 때 판매 재고에 넣지 않고
 * 불량 재고에 기록되며, 나머지는 지금처럼 복원된다. 저장만으로 재고는 움직이지 않는다. 하자·오배송 교환은 이 저장(모두 정상 복원 포함)이
 * 있어야 재출고할 수 있다.
 */
export async function planExchangeDefectiveStockAction(
  _state: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const access = await requireStaffAction();
  if (access.error || !access.userId) return access.error ?? { error: EXCHANGE_STOCK_PLAN_FAILED };
  const claimId = String(formData.get('claimId') ?? '').toLowerCase();
  /* 배송 건 없는 옛 주문(주문 전체)은 빈 값이다. */
  const shipmentValue = String(formData.get('shipmentId') ?? '').toLowerCase();
  const shipmentId = shipmentValue === '' ? null : shipmentValue;
  const dispositions = readStockDispositions(formData);
  if (dispositions && 'error' in dispositions) return { error: dispositions.error };
  if (!isUuid(claimId) || (shipmentId !== null && !isUuid(shipmentId)) || !dispositions) return { error: EXCHANGE_STOCK_PLAN_FAILED };
  const { error } = await (await createClient()).rpc('admin_plan_claim_exchange_defective_stock', {
    p_claim_id: claimId,
    p_shipment_id: shipmentId,
    p_order_item_ids: dispositions.defectiveIds,
  });
  revalidateClaimSurfaces(claimId, 'exchange');
  if (error) return { error: exchangeStockErrorMessage(error.message) };
  const origin = String(formData.get('originName') ?? '').trim();
  const where = origin ? `${origin} 출고지를` : '이 출고지를';
  return {
    message: dispositions.defectiveIds.length > 0
      ? `불량 ${dispositions.defectiveIds.length}개 품목을 저장했습니다. ${where} 재출고할 때 판매 재고에 넣지 않고 불량 재고에 기록합니다.`
      : `회수 상품을 모두 정상 재고로 복원하도록 저장했습니다. ${where} 재출고할 때 판매 재고로 돌아갑니다.`,
  };
}

/** 확정 뒤 '불량 기록 필요'로 남은 선택을 다시 기록한다. 환불·재고에는 손대지 않는다. */
export async function retryClaimDefectiveStockAction(
  _state: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const access = await requireStaffAction();
  if (access.error || !access.userId) return access.error ?? { error: DEFECTIVE_RECORD_FAILED };
  const claimId = String(formData.get('claimId') ?? '').toLowerCase();
  if (!isUuid(claimId)) return { error: DEFECTIVE_RECORD_FAILED };
  const recorded = await recordClaimDefectiveStock(claimId);
  revalidateClaimSurfaces(claimId, readClaimType(formData));
  return recorded.error
    ? { error: recorded.error }
    : { message: `불량 재고 ${recorded.recorded}개 품목을 기록했습니다. ${DEFECTIVE_STOCK_RECORDED_NOTE}` };
}
