import { isUuid } from '../uuid';
import { transactionEpochMicros, transactionExactKeys, transactionGoodId, transactionInstant, transactionInteger, transactionRecord } from '../goods-transaction-values';

export const GOODS_SUBSCRIPTION_INTERVALS = ['week_1', 'week_2', 'week_4', 'month_1', 'month_2', 'month_3'] as const;
export type GoodsSubscriptionInterval = typeof GOODS_SUBSCRIPTION_INTERVALS[number];
export const GOODS_SUBSCRIPTION_INTERVAL_LABELS: Record<GoodsSubscriptionInterval, string> = {
  week_1: '1주마다', week_2: '2주마다', week_4: '4주마다', month_1: '1개월마다', month_2: '2개월마다', month_3: '3개월마다',
};
export interface GoodsSubscriptionDraft { enabled: boolean; intervals: GoodsSubscriptionInterval[]; message: string }
export interface GoodsSubscriptionPolicy extends GoodsSubscriptionDraft { goodId: string; revision: number; goodUpdatedAt: string }
export interface GoodsSubscriptionContext { goodId: string; expectedActorId: string }
export interface GoodsSubscriptionPolicyRequest extends GoodsSubscriptionContext, GoodsSubscriptionDraft {
  expectedRevision: number; expectedGoodUpdatedAt: string; operationId: string;
}
export interface GoodsSubscriptionPolicyReceipt extends GoodsSubscriptionPolicy { operationId: string; changed: boolean }
export interface GoodsSubscriptionRecovery { version: 1; sessionId: string; base: GoodsSubscriptionPolicy; draft: GoodsSubscriptionDraft; retry: GoodsSubscriptionPolicyRequest | null }
export type GoodsSubscriptionPolicyResult<T> = { ok: true; value: T } | {
  ok: false; error: string; uncertain?: boolean; conflict?: boolean; committed?: GoodsSubscriptionPolicyReceipt; latest?: GoodsSubscriptionPolicy;
};

export function createGoodsSubscriptionRequestLane() {
  let busy = false; let sequence = 0;
  return {
    busy: () => busy,
    read: () => busy ? null : ++sequence,
    begin: () => { if (busy) return null; busy = true; return ++sequence; },
    current: (candidate: number) => candidate === sequence,
    finish: (candidate: number) => { if (candidate === sequence) busy = false; },
  };
}

function intervals(value: unknown): GoodsSubscriptionInterval[] | null {
  if (!Array.isArray(value) || value.length > 6 || new Set(value).size !== value.length
    || value.some(item => !GOODS_SUBSCRIPTION_INTERVALS.includes(item))) return null;
  return [...value].sort() as GoodsSubscriptionInterval[];
}
export function parseGoodsSubscriptionDraft(value: unknown): GoodsSubscriptionDraft | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['enabled', 'intervals', 'message']) || typeof value.enabled !== 'boolean'
    || typeof value.message !== 'string' || [...value.message].length > 500 || /[\u0000-\u001f\u007f]/.test(value.message)) return null;
  const selected = intervals(value.intervals);
  return selected ? { enabled: value.enabled, intervals: selected, message: value.message } : null;
}
export function goodsSubscriptionDraft(value: GoodsSubscriptionPolicy): GoodsSubscriptionDraft {
  return { enabled: value.enabled, intervals: [...value.intervals], message: value.message };
}
export function validGoodsSubscriptionContext(value: unknown): value is GoodsSubscriptionContext {
  return transactionRecord(value) && transactionGoodId(value.goodId) && isUuid(value.expectedActorId);
}
export function parseGoodsSubscriptionPolicy(value: unknown): GoodsSubscriptionPolicy | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['goodId', 'revision', 'goodUpdatedAt', 'enabled', 'intervals', 'message'])
    || !transactionGoodId(value.goodId) || !transactionInteger(value.revision, 0, 2_147_483_647) || !transactionInstant(value.goodUpdatedAt)) return null;
  const draft = parseGoodsSubscriptionDraft({ enabled: value.enabled, intervals: value.intervals, message: value.message });
  return draft && draft.intervals.length > 0 && draft.message === draft.message.trim() ? { goodId: value.goodId, revision: value.revision, goodUpdatedAt: value.goodUpdatedAt, ...draft } : null;
}
export function parseGoodsSubscriptionPolicyRequest(value: unknown): GoodsSubscriptionPolicyRequest | null {
  if (!validGoodsSubscriptionContext(value) || !transactionRecord(value)
    || !transactionExactKeys(value, ['goodId', 'expectedActorId', 'expectedRevision', 'expectedGoodUpdatedAt', 'operationId', 'enabled', 'intervals', 'message'])
    || !transactionInteger(value.expectedRevision, 0, 2_147_483_647) || !transactionInstant(value.expectedGoodUpdatedAt) || !isUuid(value.operationId)) return null;
  const draft = parseGoodsSubscriptionDraft({ enabled: value.enabled, intervals: value.intervals, message: value.message });
  return draft && draft.intervals.length > 0 ? { goodId: value.goodId, expectedActorId: value.expectedActorId.toLowerCase(), expectedRevision: value.expectedRevision,
    expectedGoodUpdatedAt: value.expectedGoodUpdatedAt, operationId: value.operationId.toLowerCase(), ...draft, message: draft.message.trim() } : null;
}
export function parseGoodsSubscriptionPolicyReceipt(value: unknown): GoodsSubscriptionPolicyReceipt | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['goodId', 'revision', 'goodUpdatedAt', 'enabled', 'intervals', 'message', 'operationId', 'changed'])
    || !isUuid(value.operationId) || typeof value.changed !== 'boolean') return null;
  const { operationId, changed, ...rest } = value; const policy = parseGoodsSubscriptionPolicy(rest);
  return policy ? { ...policy, operationId, changed } : null;
}
export function sameGoodsSubscriptionDraft(left: GoodsSubscriptionDraft, right: GoodsSubscriptionDraft): boolean {
  return left.enabled === right.enabled && left.message === right.message && [...left.intervals].sort().join(',') === [...right.intervals].sort().join(',');
}
export function sameGoodsSubscriptionPolicy(left: GoodsSubscriptionPolicy, right: GoodsSubscriptionPolicy): boolean {
  return left.goodId === right.goodId && left.revision === right.revision && sameGoodsSubscriptionDraft(left, right)
    && transactionEpochMicros(left.goodUpdatedAt) === transactionEpochMicros(right.goodUpdatedAt);
}
export function goodsSubscriptionReceiptMatches(receipt: GoodsSubscriptionPolicyReceipt, request: GoodsSubscriptionPolicyRequest): boolean {
  return receipt.goodId === request.goodId && receipt.operationId === request.operationId
    && receipt.revision === request.expectedRevision + Number(receipt.changed) && sameGoodsSubscriptionDraft(receipt, request)
    && (receipt.changed || transactionEpochMicros(receipt.goodUpdatedAt) === transactionEpochMicros(request.expectedGoodUpdatedAt));
}
export function parseGoodsSubscriptionRecovery(value: unknown): GoodsSubscriptionRecovery | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['version', 'sessionId', 'base', 'draft', 'retry'])
    || value.version !== 1 || !isUuid(value.sessionId)) return null;
  const base = parseGoodsSubscriptionPolicy(value.base), draft = parseGoodsSubscriptionDraft(value.draft);
  const retry = value.retry === null ? null : parseGoodsSubscriptionPolicyRequest(value.retry);
  if (!base || !draft || value.retry !== null && !retry || retry && (retry.goodId !== base.goodId || retry.expectedRevision !== base.revision
    || transactionEpochMicros(retry.expectedGoodUpdatedAt) !== transactionEpochMicros(base.goodUpdatedAt)
    || !sameGoodsSubscriptionDraft(retry, { ...draft, message: draft.message.trim() }))) return null;
  return { version: 1, sessionId: value.sessionId, base, draft, retry };
}
export function goodsSubscriptionPolicyError(message?: string): string {
  const labels: Record<string, string> = {
    subscription_policy_conflict: '상품 또는 정기배송 설정이 변경됐습니다. 입력을 유지한 채 최신 저장본을 비교해주세요.',
    subscription_actor_changed: '로그인 계정이 바뀌었습니다. 현재 계정으로 상품 화면을 다시 열어주세요.',
    operator_capability_required: '상품관리 권한이 필요합니다.', subscription_good_not_found: '상품이 없습니다. 상품 목록에서 다시 확인해주세요.',
    operator_operation_conflict: '같은 요청 번호에 다른 내용이 있습니다. 최신 저장본을 확인해주세요.',
  };
  return Object.entries(labels).find(([key]) => message?.includes(key))?.[1] ?? '정기배송 설정을 저장하지 못했습니다. 주기와 안내 문구를 확인해주세요.';
}
