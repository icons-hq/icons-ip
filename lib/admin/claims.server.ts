import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { isOrderWithdrawalReasonType, type OrderWithdrawalReasonType } from '@/lib/orders';
import {
  isOrderClaimRefundMethod,
  isOrderClaimStage,
  isOrderClaimType,
  type OrderClaimRefundMethod,
  type OrderClaimStage,
  type OrderClaimType,
} from '@/lib/orders/claims';
import {
  ADMIN_CLAIM_PAGE_SIZE,
  adminClaimBuyerLabel,
  type AdminClaimConsoleData,
  type AdminClaimFilters,
  type AdminClaimRow,
} from './claims';

/* 어드민 클레임 콘솔 로더(#252).
 *
 * 목록·집계·상세 모두 staff 게이트가 붙은 RPC로만 읽는다. 상세는 한 번의 왕복으로
 * 주문 요약·결제·환불 원장·카드팩 발급 여부·마스킹된 환불계좌·타임라인을 함께
 * 받는다 — 운영자가 승인 버튼을 누르기 전에 봐야 하는 것들이 화면을 옮기지 않고
 * 한 자리에 있어야 한다. */

interface ClaimQueueRow {
  id: string;
  reference: number | string;
  order_id: string;
  claim_type: string;
  stage: string;
  reason_type: string;
  buyer_name: string | null;
  buyer_email: string | null;
  order_status: string;
  order_total: number | string;
  requested_at: string;
  collected_at: string | null;
  completed_at: string | null;
  refund_method: string | null;
  handler_name: string | null;
  total_count: number | string;
}

interface StageCountRow {
  stage: string;
  total: number | string;
}

function toNumber(value: number | string | null | undefined) {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function emptyCounts(): Record<OrderClaimStage, number> {
  return {
    requested: 0,
    in_review: 0,
    collecting: 0,
    collected: 0,
    on_hold: 0,
    processing: 0,
    needs_review: 0,
    completed: 0,
    rejected: 0,
  };
}

function toRow(row: ClaimQueueRow): AdminClaimRow {
  return {
    id: row.id,
    reference: toNumber(row.reference),
    orderId: row.order_id,
    claimType: (isOrderClaimType(row.claim_type) ? row.claim_type : 'cancel') as OrderClaimType,
    stage: (isOrderClaimStage(row.stage) ? row.stage : 'requested') as OrderClaimStage,
    reasonType: (isOrderWithdrawalReasonType(row.reason_type)
      ? row.reason_type
      : 'change_of_mind') as OrderWithdrawalReasonType,
    buyerName: adminClaimBuyerLabel(row.buyer_name, row.order_id),
    buyerEmail: row.buyer_email,
    orderStatus: row.order_status,
    orderTotal: toNumber(row.order_total),
    requestedAt: row.requested_at,
    collectedAt: row.collected_at,
    completedAt: row.completed_at,
    refundMethod: (isOrderClaimRefundMethod(row.refund_method)
      ? row.refund_method
      : null) as OrderClaimRefundMethod | null,
    handlerName: row.handler_name?.trim() || null,
  };
}

export async function getAdminClaimConsoleData(
  claimType: OrderClaimType,
  filters: AdminClaimFilters,
): Promise<AdminClaimConsoleData> {
  const supabase = await createClient();

  const [listResult, countResult] = await Promise.all([
    supabase.rpc('admin_search_order_claims', {
      p_claim_type: claimType,
      p_from: filters.from,
      p_limit: ADMIN_CLAIM_PAGE_SIZE,
      p_offset: (filters.page - 1) * ADMIN_CLAIM_PAGE_SIZE,
      p_query: filters.query || null,
      p_reason_type: filters.reasonType === 'all' ? null : filters.reasonType,
      p_stage: filters.stage === 'all' ? null : filters.stage,
      p_to: filters.to,
    }),
    supabase.rpc('admin_order_claim_stage_counts', { p_claim_type: claimType }),
  ]);

  if (listResult.error) {
    throw new Error(`Failed to load claims: ${listResult.error.message}`);
  }
  if (countResult.error) {
    throw new Error(`Failed to count claims: ${countResult.error.message}`);
  }

  const counts = emptyCounts();
  for (const entry of (countResult.data ?? []) as StageCountRow[]) {
    if (isOrderClaimStage(entry.stage)) counts[entry.stage] = toNumber(entry.total);
  }

  const rows = (listResult.data ?? []) as ClaimQueueRow[];

  return {
    claimType,
    counts,
    filters,
    pageSize: ADMIN_CLAIM_PAGE_SIZE,
    rows: rows.map(toRow),
    total: rows.length ? toNumber(rows[0].total_count) : 0,
  };
}

export interface AdminClaimDetailOrder {
  id: string;
  status: string;
  total: number;
  shippingFee: number;
  createdAt: string;
  deliveredAt: string | null;
  shippingCarrier: string | null;
  trackingNumber: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  items: { name: string; qty: number; unitPrice: number }[];
}

export interface AdminClaimDetailPayment {
  id: string;
  provider: string | null;
  status: string;
  amount: number;
  createdAt: string;
}

export interface AdminClaimDetailRefund {
  status: string;
  amount: number;
  method: OrderClaimRefundMethod | null;
  filedAt: string | null;
  completedAt: string | null;
  settlementNote: string | null;
  handlerName: string | null;
}

export interface AdminClaimDetail {
  claim: {
    id: string;
    reference: number;
    orderId: string;
    claimType: OrderClaimType;
    stage: OrderClaimStage;
    status: string;
    reason: string;
    reasonType: OrderWithdrawalReasonType;
    decisionNote: string | null;
    holdReason: string | null;
    heldAt: string | null;
    /** 보류 해제 시 돌아갈 단계. 보류가 아니면 null이다. */
    heldFrom: OrderClaimStage | null;
    requestedAt: string;
    decidedAt: string | null;
    collectingAt: string | null;
    collectedAt: string | null;
    completedAt: string | null;
    reshipCarrier: string | null;
    reshipTrackingNumber: string | null;
    reshippedAt: string | null;
    lastErrorCode: string | null;
    handlerName: string | null;
  };
  order: AdminClaimDetailOrder | null;
  payment: AdminClaimDetailPayment | null;
  refund: AdminClaimDetailRefund | null;
  cardPacks: { issued: number; consumed: number; revoked: number };
  refundAccount: {
    maskedAccount: string;
    maskedHolder: string;
    purgeAfter: string | null;
    purgedAt: string | null;
  } | null;
  timeline: {
    action: string;
    createdAt: string;
    actorName: string | null;
    diff: Record<string, unknown> | null;
  }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function loadAdminClaimDetail(
  claimId: string,
): Promise<AdminClaimDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_order_claim_detail', {
    p_claim_id: claimId,
  });

  if (error) throw new Error(`Failed to load claim: ${error.message}`);
  if (!isRecord(data)) return null;

  const claim = isRecord(data.claim) ? data.claim : null;
  if (!claim || typeof claim.id !== 'string') return null;

  const order = isRecord(data.order) ? data.order : null;
  const payment = isRecord(data.payment) ? data.payment : null;
  const refund = isRecord(data.refund) ? data.refund : null;
  const packs = isRecord(data.cardPacks) ? data.cardPacks : null;
  const account = isRecord(data.refundAccount) ? data.refundAccount : null;
  const timeline = Array.isArray(data.timeline) ? data.timeline : [];

  return {
    claim: {
      id: claim.id,
      reference: toNumber(claim.reference as number | string),
      orderId: String(claim.orderId ?? ''),
      claimType: (isOrderClaimType(claim.claimType) ? claim.claimType : 'cancel') as OrderClaimType,
      stage: (isOrderClaimStage(claim.stage) ? claim.stage : 'requested') as OrderClaimStage,
      status: String(claim.status ?? ''),
      reason: String(claim.reason ?? ''),
      reasonType: (isOrderWithdrawalReasonType(String(claim.reasonType ?? ''))
        ? claim.reasonType
        : 'change_of_mind') as OrderWithdrawalReasonType,
      decisionNote: text(claim.decisionNote),
      holdReason: text(claim.holdReason),
      heldAt: text(claim.heldAt),
      heldFrom: isOrderClaimStage(claim.heldFrom) ? claim.heldFrom : null,
      requestedAt: String(claim.requestedAt ?? ''),
      decidedAt: text(claim.decidedAt),
      collectingAt: text(claim.collectingAt),
      collectedAt: text(claim.collectedAt),
      completedAt: text(claim.completedAt),
      reshipCarrier: text(claim.reshipCarrier),
      reshipTrackingNumber: text(claim.reshipTrackingNumber),
      reshippedAt: text(claim.reshippedAt),
      lastErrorCode: text(claim.lastErrorCode),
      handlerName: text(claim.handlerName),
    },
    order: order
      ? {
        id: String(order.id ?? ''),
        status: String(order.status ?? ''),
        total: toNumber(order.total as number | string),
        shippingFee: toNumber(order.shippingFee as number | string),
        createdAt: String(order.createdAt ?? ''),
        deliveredAt: text(order.deliveredAt),
        shippingCarrier: text(order.shippingCarrier),
        trackingNumber: text(order.trackingNumber),
        buyerName: text(order.buyerName),
        buyerEmail: text(order.buyerEmail),
        items: (Array.isArray(order.items) ? order.items : [])
          .filter(isRecord)
          .map((item) => ({
            name: String(item.name ?? ''),
            qty: toNumber(item.qty as number | string),
            unitPrice: toNumber(item.unitPrice as number | string),
          })),
      }
      : null,
    payment: payment
      ? {
        id: String(payment.id ?? ''),
        provider: text(payment.provider),
        status: String(payment.status ?? ''),
        amount: toNumber(payment.amount as number | string),
        createdAt: String(payment.createdAt ?? ''),
      }
      : null,
    refund: refund
      ? {
        status: String(refund.status ?? ''),
        amount: toNumber(refund.amount as number | string),
        method: (isOrderClaimRefundMethod(refund.method)
          ? refund.method
          : null) as OrderClaimRefundMethod | null,
        filedAt: text(refund.filedAt),
        completedAt: text(refund.completedAt),
        settlementNote: text(refund.settlementNote),
        handlerName: text(refund.handlerName),
      }
      : null,
    cardPacks: {
      issued: toNumber(packs?.issued as number | string),
      consumed: toNumber(packs?.consumed as number | string),
      revoked: toNumber(packs?.revoked as number | string),
    },
    refundAccount: account
      ? {
        maskedAccount: String(account.maskedAccount ?? ''),
        maskedHolder: String(account.maskedHolder ?? ''),
        purgeAfter: text(account.purgeAfter),
        purgedAt: text(account.purgedAt),
      }
      : null,
    timeline: timeline.filter(isRecord).map((entry) => ({
      action: String(entry.action ?? ''),
      createdAt: String(entry.createdAt ?? ''),
      actorName: text(entry.actorName),
      diff: isRecord(entry.diff) ? entry.diff : null,
    })),
  };
}
