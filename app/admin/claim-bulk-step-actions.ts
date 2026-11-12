'use server';

import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import {
  ADMIN_CLAIM_BULK_DB_ITEM_RESERVE_MS,
  ADMIN_CLAIM_BULK_REFUND_ITEM_RESERVE_MS,
  ADMIN_CLAIM_BULK_RESHIP_COLLECTION_REASON,
  ADMIN_CLAIM_BULK_RESHIP_DECISION_REASON,
  ADMIN_CLAIM_BULK_RESHIP_PRODUCTION_REASON,
  ADMIN_CLAIM_BULK_RESHIP_WAIVER_REASON,
  adminClaimBulkCollectPlan,
  adminClaimBulkCollectTargetLabel,
  adminClaimBulkProviderLabel,
  adminClaimBulkRefundBlockerMessage,
  adminClaimBulkRefundTotals,
  adminClaimBulkSummary,
  normalizeAdminClaimBulkCollectInput,
  normalizeAdminClaimBulkRefundInput,
  normalizeAdminClaimBulkStepPreviewInput,
  parseAdminClaimBulkContexts,
  runAdminClaimBulkSequentially,
  type AdminClaimBulkCollectRow,
  type AdminClaimBulkContext,
  type AdminClaimBulkRefundRow,
  type AdminClaimBulkReshipClaim,
  type AdminClaimBulkReshipLoad,
  type AdminClaimBulkState,
  type AdminClaimBulkStepPreviewState,
} from '@/lib/admin/claim-bulk';
import { adminClaimPendingReshipments, adminClaimWaiverDecisions } from '@/lib/admin/claim-reshipments';
import { adminClaimBasePath } from '@/lib/admin/claims';
import type { ClaimDefectiveItem } from '@/lib/admin/defective-stock';
import { loadAdminClaimDetail } from '@/lib/admin/claims.server';
import { stockDispositionField } from '@/lib/admin/defective-stock';
import { loadClaimDefectiveStock } from '@/lib/admin/defective-stock.server';
import { krw } from '@/lib/format';
import {
  ORDER_CLAIM_TYPE_LABELS,
  orderClaimReferenceLabel,
  orderClaimRefundMethodForProvider,
  type OrderClaimType,
} from '@/lib/orders/claims';
import { getShippingCarrierRegistry } from '@/lib/orders/shipment.server';
import { createClient } from '@/lib/supabase/server';
import {
  recordOrderClaimCollectionAction,
  recordOrderClaimOriginCollectionAction,
  recordOrderClaimRefundAction,
} from './claim-actions';

/*
 * 목록 단계 일괄 처리(1027T-033·SHEET-049·SHEET-052 · 2026-11-11 결정 "회수·환불·재출고 일괄").
 *
 * 이 파일은 돈·재고·상태를 직접 바꾸지 않는다. 건마다 상세 화면과 같은 단건 서버 액션을 그대로 부른다:
 * 회수 확인은 recordOrderClaimOriginCollectionAction(레거시는 recordOrderClaimCollectionAction), 환불 완료 확정은
 * recordOrderClaimRefundAction(입고완료 건은 접수 먼저) — 그 액션이 결제사 취소 오케스트레이터와 finalizer를 지난다.
 * 규칙이 한 벌로 남아야 단건과 일괄의 결과가 갈라지지 않는다(R8 원칙).
 *
 * 확인창의 건수·환불 합계·제외 사유는 서버가 읽기 RPC(admin_order_claim_bulk_context)로 계산한다. 실행은 건을
 * 시작하기 직전에 같은 RPC로 다시 읽어, 그 사이 단계·결제·금액이 바뀐 건은 처리하지 않는다. 결제사 취소는
 * 같은 결제에 겹치지 않게 한 건씩 순서대로 보내고, 목록 함수 시간(60초) 안에 끝나지 않을 건은 시작하지 않고
 * '미처리'로 돌려준다 — 화면이 남은 건을 이어서 보낸다. 이미 나간 결제사 취소는 되돌릴 수 없으므로 일부가 실패해도
 * 나머지를 되돌리지 않고 건별 결과로 보인다.
 *
 * 재출고는 최종 주소 확인(10분 결속)이 브라우저 세션의 연락처 경로(/api/admin/claim-contact/*)에 묶여 있어 여기서는
 * 대상 배송 건과 품목만 읽는다(loadOrderClaimBulkReshipmentsAction). 주소는 싣지 않는다.
 */

const ACCESS_DENIED = '관리자 권한이 필요합니다.';
const CONTEXT_FAILED = '선택한 요청을 읽지 못했습니다. 새로고침한 뒤 다시 실행해주세요.';
const PREVIEW_FAILED = '확인할 내용을 불러오지 못했습니다. 새로고침한 뒤 다시 실행해주세요.';
const RUN_FAILED = '일괄 처리를 시작하지 못했습니다. 새로고침한 뒤 다시 실행해주세요.';
const CLAIM_MISSING = '클레임을 찾을 수 없습니다.';

type Supabase = Awaited<ReturnType<typeof createClient>>;

function access(claimType: OrderClaimType) {
  return requireAdminActionAccess(adminClaimBasePath(claimType), { capability: 'sales.manage' });
}

async function readContexts(supabase: Supabase, claimIds: readonly string[]): Promise<AdminClaimBulkContext[] | null> {
  const { data, error } = await supabase.rpc('admin_order_claim_bulk_context', { p_claim_ids: claimIds });
  if (error) return null;
  return parseAdminClaimBulkContexts(data);
}

function wrongType(claimType: OrderClaimType) {
  return `${ORDER_CLAIM_TYPE_LABELS[claimType]} 요청이 아닙니다. 해당 목록에서 처리해주세요.`;
}

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

/** 확인창을 연다. 회수 확인은 요청마다 확인할 출고지, 환불은 결제사·금액·제외 사유와 합계(서버 계산)를 돌려준다. */
export async function previewOrderClaimBulkStepAction(input: unknown): Promise<AdminClaimBulkStepPreviewState> {
  try {
    const normalized = normalizeAdminClaimBulkStepPreviewInput(input);
    if (!normalized.ok) return { error: normalized.error };
    const { claimType, claimIds, step } = normalized.value;
    if (!await access(claimType)) return { error: ACCESS_DENIED };
    if (step === 'reship') return { error: PREVIEW_FAILED };

    const contexts = await readContexts(await createClient(), claimIds);
    if (!contexts) return { error: CONTEXT_FAILED };
    const byId = new Map(contexts.map((context) => [context.claimId, context]));

    if (step === 'collect') {
      const rows: AdminClaimBulkCollectRow[] = claimIds.map((claimId) => {
        const context = byId.get(claimId);
        if (!context) return { claimId, reference: '확인 불가', targets: [], skipped: [], blocker: CLAIM_MISSING };
        const reference = orderClaimReferenceLabel(context.reference);
        if (context.claimType !== claimType) return { claimId, reference, targets: [], skipped: [], blocker: wrongType(claimType) };
        return { claimId, reference, ...adminClaimBulkCollectPlan(context) };
      });
      return { preview: { step, rows } };
    }

    /* 반품이면 품목과 재고 처리 선택을 싣는다(QNA-035). 읽지 못하면 선택 칸 없이 지금처럼 전부 복원한다. */
    const defectiveByClaim = claimType === 'return'
      ? new Map((await loadClaimDefectiveStock(claimIds)).map((entry) => [entry.claimId, entry.items]))
      : new Map<string, ClaimDefectiveItem[]>();

    const rows: AdminClaimBulkRefundRow[] = claimIds.map((claimId) => {
      const context = byId.get(claimId);
      if (!context) return { claimId, reference: '확인 불가', providerLabel: adminClaimBulkProviderLabel(null), amount: null, blocker: CLAIM_MISSING };
      const base = { claimId, reference: orderClaimReferenceLabel(context.reference), providerLabel: adminClaimBulkProviderLabel(context.paymentProvider), amount: context.refundAmount,
        ...(context.refundDeductionAmount ? { deductionAmount: context.refundDeductionAmount } : {}) };
      if (context.claimType !== claimType) return { ...base, blocker: wrongType(claimType) };
      if (context.refundBlocker) return { ...base, blocker: adminClaimBulkRefundBlockerMessage(context.refundBlocker) };
      if (context.refundAmount === null) return { ...base, blocker: adminClaimBulkRefundBlockerMessage('payment_missing') };
      const items = defectiveByClaim.get(claimId);
      return { ...base, ...(items && items.length > 0 ? { items } : {}), blocker: null };
    });
    return { preview: { step, rows, totals: adminClaimBulkRefundTotals(rows) } };
  } catch (error) {
    unstable_rethrow(error);
    return { error: PREVIEW_FAILED };
  }
}

async function referencesOf(supabase: Supabase, claimIds: readonly string[]) {
  const contexts = await readContexts(supabase, claimIds);
  return new Map((contexts ?? []).map((context) => [context.claimId, orderClaimReferenceLabel(context.reference)]));
}

/**
 * 일괄 회수 확인. 요청마다 확인창에서 고른 출고지를 공통 실제 입고일·근거로 하나씩 확인한다. 레거시 회수(출고지별
 * 회수 이전 요청)는 요청 전체 입고 확인 한 번이다. 실행 직전에 다시 읽어 이미 확인된 출고지는 건너뛴다.
 */
export async function runOrderClaimBulkCollectionsAction(input: unknown): Promise<AdminClaimBulkState> {
  const startedAt = Date.now();
  try {
    const normalized = normalizeAdminClaimBulkCollectInput(input);
    if (!normalized.ok) return { error: normalized.error };
    const { claimType, evidence, items, receivedOn } = normalized.value;
    if (!await access(claimType)) return { error: ACCESS_DENIED };
    const supabase = await createClient();
    const references = await referencesOf(supabase, items.map((item) => item.claimId));

    const outcomes = await runAdminClaimBulkSequentially(items, async (item) => {
      const [context] = await readContexts(supabase, [item.claimId]) ?? [];
      if (!context) return { ok: false, message: CLAIM_MISSING };
      if (context.claimType !== claimType) return { ok: false, message: wrongType(claimType) };
      const plan = adminClaimBulkCollectPlan(context);
      if (plan.blocker) return { ok: false, excluded: true, message: plan.blocker };

      if (context.collectionPolicy === 'legacy') {
        /* 레거시 회수에는 근거 열이 없어 공통 근거를 감사 기록에 남긴다(같은 단건 경로). */
        const state = await recordOrderClaimCollectionAction({}, form({ claimId: item.claimId, claimType, stage: 'collected', receivedOn, evidence }));
        return state.error ? { ok: false, message: state.error } : { ok: true, message: `입고를 확인했습니다(실제 입고일 ${receivedOn}).` };
      }

      /* 확인창에서 고른 출고지 가운데 아직 남은 것만 확인한다. 그 사이 다른 운영자가 확인한 출고지는 건너뛴다. */
      const chosen = plan.targets.filter((target) => target.shipmentId !== null && item.shipmentIds.includes(target.shipmentId));
      if (chosen.length === 0) return { ok: false, excluded: true, message: '고른 출고지의 회수 확인이 이미 끝났거나 확인할 수 없는 상태로 바뀌었습니다. 상세에서 확인해주세요.' };
      const done: string[] = [];
      for (const target of chosen) {
        const state = await recordOrderClaimOriginCollectionAction({}, form({
          claimId: item.claimId, claimType, shipmentId: target.shipmentId ?? '', evidence, receivedOn,
        }));
        const label = adminClaimBulkCollectTargetLabel(target);
        if (state.error) {
          return { ok: false, message: done.length > 0 ? `${done.join('·')} 회수는 확인했습니다. ${label}: ${state.error}` : `${label}: ${state.error}` };
        }
        done.push(label);
      }
      const rest = plan.targets.length - chosen.length + plan.skipped.length;
      return { ok: true, message: `${done.join('·')} 회수를 확인했습니다(실제 입고일 ${receivedOn}).${rest > 0 ? ` 남은 출고지 ${rest}곳은 따로 확인해주세요.` : ''}` };
    }, {
      startedAt,
      reserveMs: (item) => ADMIN_CLAIM_BULK_DB_ITEM_RESERVE_MS * (Math.max(1, item.shipmentIds.length) + 1),
    });

    return {
      summary: adminClaimBulkSummary(outcomes.map((outcome) => outcome.outcome)),
      results: outcomes.map(({ item, outcome, message }) => ({ claimId: item.claimId, reference: references.get(item.claimId) ?? null, outcome, message })),
    };
  } catch (error) {
    unstable_rethrow(error);
    return { error: RUN_FAILED };
  }
}

/**
 * 일괄 환불 완료 확정. 요청마다 실행 직전에 사실을 다시 읽어 제외 사유가 생겼거나 금액이 확인창과 다르면 결제사
 * 취소를 발행하지 않는다. 입고완료 반품은 환불 접수를 먼저 적고, 이어서 상세의 [환불 완료 확정]과 같은 액션으로
 * 결제사 전액 취소 → 결제사 조회 검증 → 주문 취소·재고 복원·카드팩 회수 → 환불 원장 완료를 한 건씩 끝낸다.
 */
export async function runOrderClaimBulkRefundsAction(input: unknown): Promise<AdminClaimBulkState> {
  const startedAt = Date.now();
  try {
    const normalized = normalizeAdminClaimBulkRefundInput(input);
    if (!normalized.ok) return { error: normalized.error };
    const { claimType, items } = normalized.value;
    if (!await access(claimType)) return { error: ACCESS_DENIED };
    const supabase = await createClient();
    const references = await referencesOf(supabase, items.map((item) => item.claimId));

    const outcomes = await runAdminClaimBulkSequentially(items, async (item) => {
      const [context] = await readContexts(supabase, [item.claimId]) ?? [];
      if (!context) return { ok: false, message: CLAIM_MISSING };
      if (context.claimType !== claimType) return { ok: false, message: wrongType(claimType) };
      if (context.refundBlocker) return { ok: false, excluded: true, message: adminClaimBulkRefundBlockerMessage(context.refundBlocker) };
      if (context.refundAmount === null) return { ok: false, excluded: true, message: adminClaimBulkRefundBlockerMessage('payment_missing') };
      if (context.refundAmount !== item.expectedAmount) {
        return { ok: false, message: `확인한 금액(${krw(item.expectedAmount)})과 지금 환불 금액(${krw(context.refundAmount)})이 달라 처리하지 않았습니다. 확인창을 다시 열어 확인해주세요.` };
      }
      const method = orderClaimRefundMethodForProvider(context.paymentProvider);
      if (method !== 'pg_cancel') return { ok: false, excluded: true, message: adminClaimBulkRefundBlockerMessage('provider_unsupported') };
      const base = { claimId: item.claimId, claimType, orderId: context.orderId, method };
      if (context.stage === 'collected') {
        const filed = await recordOrderClaimRefundAction({}, form({ ...base, stage: 'filed' }));
        if (filed.error) return { ok: false, message: filed.error };
      }
      const completeForm = form({ ...base, stage: 'completed' });
      /* 품목별 재고 처리(QNA-035): 확인창에서 고른 불량 품목을 지금 품목 목록에 대어 단건 액션과 같은 필드로 싣는다. */
      if (item.defectiveItemIds) {
        const [stock] = await loadClaimDefectiveStock([item.claimId]);
        const known = new Set((stock?.items ?? []).map((entry) => entry.orderItemId));
        if (!stock || item.defectiveItemIds.some((id) => !known.has(id))) {
          return { ok: false, message: '품목이 바뀌어 처리하지 않았습니다. 확인창을 다시 열어 불량 선택을 확인해주세요.' };
        }
        for (const entry of stock.items) completeForm.set(stockDispositionField(entry.orderItemId), item.defectiveItemIds.includes(entry.orderItemId) ? 'defective' : 'restore');
      }
      const completed = await recordOrderClaimRefundAction({}, completeForm);
      return completed.error
        ? { ok: false, message: completed.error }
        : { ok: true, message: completed.message ?? '환불 완료를 확정했습니다.' };
    }, { startedAt, reserveMs: ADMIN_CLAIM_BULK_REFUND_ITEM_RESERVE_MS });

    return {
      summary: adminClaimBulkSummary(outcomes.map((outcome) => outcome.outcome)),
      results: outcomes.map(({ item, outcome, message }) => ({ claimId: item.claimId, reference: references.get(item.claimId) ?? null, outcome, message })),
    };
  } catch (error) {
    unstable_rethrow(error);
    return { error: RUN_FAILED };
  }
}

/**
 * 재출고 표를 연다. 요청마다 지금 재출고할 수 있는 배송 건(회수 확인을 마친 출고지)과 품목·재출고 옵션, 택배사
 * 목록과 처리자 id를 돌려준다. 회수 확인 전 출고지는 회수 생략(근거 사진)이 필요해 상세로 보낸다.
 */
export async function loadOrderClaimBulkReshipmentsAction(input: unknown): Promise<AdminClaimBulkReshipLoad> {
  try {
    const normalized = normalizeAdminClaimBulkStepPreviewInput(input);
    if (!normalized.ok) return { error: normalized.error };
    const { claimIds, claimType, step } = normalized.value;
    if (step !== 'reship' || claimType !== 'exchange') return { error: '교환 요청만 재출고합니다.' };
    const auth = await access(claimType);
    if (!auth) return { error: ACCESS_DENIED };

    const registry = await getShippingCarrierRegistry();
    const claims: AdminClaimBulkReshipClaim[] = [];
    const excluded: { claimId: string; reference: string | null; reason: string }[] = [];
    for (const claimId of claimIds) {
      const detail = await loadAdminClaimDetail(claimId);
      if (!detail) { excluded.push({ claimId, reference: null, reason: CLAIM_MISSING }); continue; }
      const reference = orderClaimReferenceLabel(detail.claim.reference);
      if (detail.claim.claimType !== 'exchange') { excluded.push({ claimId, reference, reason: wrongType('exchange') }); continue; }
      /* 재출고할 수 있는 배송 건은 상세와 같은 판정(adminClaimPendingReshipments)이다: 회수를 확인했거나 회수 생략을
         결정한 배송 건. 결정이 아직 없는 회수 생략(사진 필요)·주문제작의 회수 생략 결정·교환품 제작 대기는 사유와 함께 뺀다. */
      const pending = detail.claim.collectionPolicy !== null ? adminClaimPendingReshipments(detail.claim) : [];
      const pendingKeys = new Set(pending.map((target) => target.shipmentId ?? 'order'));
      const decisionKeys = new Set(adminClaimWaiverDecisions(detail.claim).map((target) => target.shipmentId ?? 'order'));
      const skipped = [
        ...pending.filter((target) => !target.collected && !target.waived)
          .map((target) => ({ originName: target.originName ?? '주문 전체', reason: ADMIN_CLAIM_BULK_RESHIP_WAIVER_REASON })),
        ...(detail.claim.collectionPolicy !== null ? (detail.claim.reshipmentTargets ?? []) : [])
          .filter((target) => !target.reshipped && !pendingKeys.has(target.shipmentId ?? 'order'))
          .map((target) => ({
            originName: target.originName ?? '주문 전체',
            reason: decisionKeys.has(target.shipmentId ?? 'order') ? ADMIN_CLAIM_BULK_RESHIP_DECISION_REASON
              : target.productionPending ? ADMIN_CLAIM_BULK_RESHIP_PRODUCTION_REASON : ADMIN_CLAIM_BULK_RESHIP_COLLECTION_REASON,
          })),
      ];
      const rows = pending.filter((target) => target.collected || target.waived).map((target) => ({
        shipmentId: target.shipmentId,
        originName: target.originName,
        waived: target.waived,
        items: (detail.order?.items ?? []).filter((item) => target.orderItemIds.includes(item.id)).map((item) => ({
          orderItemId: item.id,
          name: item.name,
          variantName: item.variantName,
          qty: item.qty,
          currentVariantId: item.currentVariantId,
          options: item.options.map((option) => ({
            id: option.id,
            label: `${option.goodName ? `${option.goodName} · ` : ''}${option.name} · ${option.code} · 재고 ${option.stockQty}개`,
          })),
        })),
      }));
      if (rows.length === 0) {
        excluded.push({
          claimId, reference,
          reason: skipped.length > 0 ? skipped.map((entry) => `${entry.originName}: ${entry.reason}`).join(' ')
            : detail.claim.stage === 'completed' ? '이미 재출고로 종결된 교환입니다.'
              : '재출고할 수 있는 단계가 아닙니다. 승인과 회수 확인 뒤에 재출고합니다.',
        });
        continue;
      }
      claims.push({ claimId, orderId: detail.claim.orderId, reference, rows, skipped });
    }
    return {
      actorId: auth.user.id,
      carriers: registry.filter((carrier) => carrier.active).map((carrier) => ({ code: carrier.code, label: carrier.label })),
      claims,
      excluded,
    };
  } catch (error) {
    unstable_rethrow(error);
    return { error: PREVIEW_FAILED };
  }
}
