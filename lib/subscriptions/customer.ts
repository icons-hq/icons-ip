import { normalizeCheckoutAddress, type CheckoutAddress } from '../checkout';
import { parseGoodsTransactionDisplay, parseGoodsTransactionSelection, type GoodsTransactionDisplay, type GoodsTransactionSelection } from '../goods-transaction';
import { isUuid } from '../uuid';
import { SUBSCRIPTION_CYCLE_STATES, SUBSCRIPTION_PLAN_STATES, SUBSCRIPTION_PAUSE_REASONS, type SubscriptionCycleState, type SubscriptionPlanState, type SubscriptionPauseReason } from './model';
import { parseSubscriptionSchedule, type SubscriptionSchedule } from './schedule';
import { GOODS_SUBSCRIPTION_INTERVALS, type GoodsSubscriptionInterval } from '../admin/goods-subscription-policy';

export interface SubscriptionCard { id: string; state: 'active' | 'revoking' | 'revoked' | 'needs_review'; issuerCode: string; number: string; revision: number; createdAt?: string; activePlanCount?: number }
export interface SubscriptionCycle { id: string; number: number; state: SubscriptionCycleState; scheduledAt: string; orderId: string | null; orderStatus: string | null; amount: number | null; settledAt: string | null; reason: string | null }
export interface GoodsSubscription {
  id: string; state: SubscriptionPlanState; revision: number; termsId: string; pauseReason: SubscriptionPauseReason | null;
  nextRunAt: string | null; consentedAt: string | null; canceledAt: string | null; createdAt: string; updatedAt: string;
  draftExpiresAt: string; firstCycleId: string; firstQuoteId: string | null; policyTermsVersion: string;
  schedule: SubscriptionSchedule; selection: GoodsTransactionSelection[]; firstDisplay: GoodsTransactionDisplay; renewalDisplay: GoodsTransactionDisplay; card: SubscriptionCard | null;
  address?: CheckoutAddress; deliveryChoices?: Record<string, 'prepaid' | 'collect'>; addressRevision?: string; cycles?: SubscriptionCycle[];
}
export interface SubscriptionProposal { id: string; planId: string; expectedRevision: number; command: SubscriptionChangeCommand;
  termsId: string; quoteId: string; expiresAt: string; schedule: SubscriptionSchedule; address: CheckoutAddress;
  deliveryChoices: Record<string, 'prepaid' | 'collect'>; display: GoodsTransactionDisplay; policyTermsVersion: string }
export const SUBSCRIPTION_CHANGE_COMMANDS = ['resume', 'change_schedule', 'change_destination', 'replace_card', 'accept_terms'] as const;
export type SubscriptionChangeCommand = typeof SUBSCRIPTION_CHANGE_COMMANDS[number];
export interface SubscriptionOffer { goodId: string; intervals: GoodsSubscriptionInterval[]; message: string }
export type SubscriptionResult<T> = { ok: true; value: T } | { ok: false; error: string; uncertain?: boolean; committed?: boolean };
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && (value as number) >= min;
const instant = (value: unknown): value is string => typeof value === 'string' && value.length <= 35 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const nullableInstant = (value: unknown) => value === null || instant(value);
const enumValue = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === 'string' && values.includes(value as T);
function choices(value: unknown): Record<string, 'prepaid' | 'collect'> | null {
  if (!record(value) || Object.entries(value).some(([key, val]) => key.length > 200 || !enumValue(['prepaid', 'collect'], val))) return null;
  return value as Record<string, 'prepaid' | 'collect'>;
}
export function parseSubscriptionCard(value: unknown): SubscriptionCard | null {
  if (!record(value) || !isUuid(value.id) || !enumValue(['active', 'revoking', 'revoked', 'needs_review'], value.state)
    || typeof value.issuerCode !== 'string' || !/^[A-Z0-9]{2}$/.test(value.issuerCode) || !integer(value.revision, 1)
    || typeof value.number !== 'string' || !/^[0-9*]{8,20}$/.test(value.number) || (value.number.match(/\*/g)?.length ?? 0) < 4
    || (value.number.match(/\d/g)?.length ?? 0) > 12 || /\d{9}/.test(value.number)
    || value.createdAt !== undefined && !instant(value.createdAt) || value.activePlanCount !== undefined && !integer(value.activePlanCount)) return null;
  return { id: value.id, state: value.state, issuerCode: value.issuerCode, number: value.number, revision: value.revision,
    ...(value.createdAt !== undefined ? { createdAt: value.createdAt as string } : {}), ...(value.activePlanCount !== undefined ? { activePlanCount: value.activePlanCount as number } : {}) };
}
export function parseGoodsSubscription(value: unknown): GoodsSubscription | null {
  if (!record(value) || ![value.id, value.termsId, value.firstCycleId].every(isUuid) || !enumValue(SUBSCRIPTION_PLAN_STATES, value.state)
    || !integer(value.revision, 1) || value.pauseReason !== null && !enumValue(SUBSCRIPTION_PAUSE_REASONS, value.pauseReason)
    || ![value.nextRunAt, value.consentedAt, value.canceledAt].every(nullableInstant) || ![value.createdAt, value.updatedAt, value.draftExpiresAt].every(instant)
    || value.firstQuoteId !== null && !isUuid(value.firstQuoteId) || typeof value.policyTermsVersion !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.policyTermsVersion)) return null;
  const schedule = parseSubscriptionSchedule(value.schedule), selection = parseGoodsTransactionSelection(value.selection), firstDisplay = parseGoodsTransactionDisplay(value.firstDisplay), renewalDisplay = parseGoodsTransactionDisplay(value.renewalDisplay);
  const card = value.card === null ? null : parseSubscriptionCard(value.card);
  if (!schedule || !selection || selection.length > 100 || !firstDisplay || !renewalDisplay || value.card !== null && !card) return null;
  const result: GoodsSubscription = { id: value.id as string, state: value.state, revision: value.revision, termsId: value.termsId as string,
    pauseReason: value.pauseReason as SubscriptionPauseReason | null, nextRunAt: value.nextRunAt as string | null, consentedAt: value.consentedAt as string | null,
    canceledAt: value.canceledAt as string | null, createdAt: value.createdAt as string, updatedAt: value.updatedAt as string,
    draftExpiresAt: value.draftExpiresAt as string, firstCycleId: value.firstCycleId as string, firstQuoteId: value.firstQuoteId as string | null,
    policyTermsVersion: value.policyTermsVersion, schedule, selection, firstDisplay, renewalDisplay, card };
  if (value.address !== undefined) {
    const address = normalizeCheckoutAddress(value.address), deliveryChoices = choices(value.deliveryChoices);
    if (!address || !deliveryChoices || !isUuid(value.addressRevision) || !Array.isArray(value.cycles) || value.cycles.length > 50) return null;
    const cycles = value.cycles.map(parseSubscriptionCycle);
    if (cycles.some(cycle => cycle === null)) return null;
    Object.assign(result, { address, deliveryChoices, addressRevision: value.addressRevision, cycles });
  }
  return result;
}
export function parseSubscriptionProposal(value: unknown): SubscriptionProposal | null {
  if (!record(value) || ![value.id, value.planId, value.termsId, value.quoteId].every(isUuid) || !integer(value.expectedRevision, 1)
    || !enumValue(SUBSCRIPTION_CHANGE_COMMANDS, value.command) || !instant(value.expiresAt) || typeof value.policyTermsVersion !== 'string') return null;
  const schedule = parseSubscriptionSchedule(value.schedule), address = normalizeCheckoutAddress(value.address), deliveryChoices = choices(value.deliveryChoices), display = parseGoodsTransactionDisplay(value.display);
  if (!schedule || !address || !deliveryChoices || !display) return null;
  return { id: value.id as string, planId: value.planId as string, expectedRevision: value.expectedRevision, command: value.command,
    termsId: value.termsId as string, quoteId: value.quoteId as string, expiresAt: value.expiresAt, schedule, address, deliveryChoices, display, policyTermsVersion: value.policyTermsVersion };
}
export function parseSubscriptionOffers(value: unknown): SubscriptionOffer[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const result: SubscriptionOffer[] = [];
  for (const entry of value) {
    if (!record(entry) || typeof entry.goodId !== 'string' || !entry.goodId || !Array.isArray(entry.intervals) || !entry.intervals.length
      || entry.intervals.some(item => !enumValue(GOODS_SUBSCRIPTION_INTERVALS, item)) || typeof entry.message !== 'string' || entry.message.length > 500) return null;
    result.push({ goodId: entry.goodId, intervals: entry.intervals, message: entry.message });
  }
  return result;
}
export function subscriptionError(code?: string, message?: string): string {
  if (code === '42501' || message?.includes('actor')) return '현재 계정에서 처리할 수 없습니다. 로그인 상태를 확인해주세요.';
  if (code === 'PT409' || message?.includes('changed')) return '일정이나 금액이 변경됐습니다. 최신 내용을 다시 확인해주세요.';
  if (message?.includes('credential_in_use')) return '연결된 정기구매를 해지하거나 다른 카드로 변경한 뒤 삭제해주세요.';
  if (message?.includes('payment_pending')) return '진행 중인 결제 결과를 확인한 뒤 변경할 수 있습니다. 일시정지와 해지는 가능합니다.';
  if (message?.includes('future_schedule')) return '현재보다 늦은 다음 결제일을 선택해주세요.';
  if (message?.includes('card_unavailable')) return '사용할 수 있는 결제카드를 선택해주세요.';
  if (message?.includes('unavailable') || message?.includes('disabled')) return '현재 정기구매를 처리할 수 없습니다. 기존 신청 내역은 계속 확인할 수 있어요.';
  return '처리 결과를 확인하지 못했습니다. 입력을 유지하고 같은 요청으로 다시 확인해주세요.';
}

export interface SubscriptionPlanPage { rows: GoodsSubscription[]; total: number; hasMore: boolean; nextCursor: { updatedAt: string; id: string } | null }
export interface SubscriptionCyclePage { rows: SubscriptionCycle[]; total: number; hasMore: boolean; nextBeforeNumber: number | null }
export function parseSubscriptionCycle(value: unknown): SubscriptionCycle | null {
  if (!record(value) || !isUuid(value.id) || !integer(value.number, 1) || !enumValue(SUBSCRIPTION_CYCLE_STATES, value.state) || !instant(value.scheduledAt)
    || value.orderId !== null && !isUuid(value.orderId) || value.orderStatus !== null && typeof value.orderStatus !== 'string'
    || value.amount !== null && !integer(value.amount) || !nullableInstant(value.settledAt)
    || value.reason !== null && (typeof value.reason !== 'string' || !/^[a-z0-9_]{1,64}$/.test(value.reason))) return null;
  return { id: value.id, number: value.number, state: value.state, scheduledAt: value.scheduledAt, orderId: value.orderId as string | null,
    orderStatus: value.orderStatus as string | null, amount: value.amount as number | null, settledAt: value.settledAt as string | null, reason: value.reason as string | null };
}
export function parseSubscriptionPlanPage(value: unknown): SubscriptionPlanPage | null {
  if (!record(value) || !Array.isArray(value.rows) || value.rows.length > 100 || !integer(value.total) || typeof value.hasMore !== 'boolean') return null;
  const rows = value.rows.map(parseGoodsSubscription), cursor = value.nextCursor;
  if (rows.some(row => row === null) || value.total < rows.length || value.hasMore && (!record(cursor) || !isUuid(cursor.id) || !instant(cursor.updatedAt))
    || !value.hasMore && cursor !== null) return null;
  return { rows: rows as GoodsSubscription[], total: value.total, hasMore: value.hasMore, nextCursor: cursor as SubscriptionPlanPage['nextCursor'] };
}
export function parseSubscriptionCyclePage(value: unknown): SubscriptionCyclePage | null {
  if (!record(value) || !Array.isArray(value.rows) || value.rows.length > 100 || !integer(value.total) || typeof value.hasMore !== 'boolean') return null;
  const rows = value.rows.map(parseSubscriptionCycle);
  if (rows.some(row => row === null) || value.total < rows.length || value.hasMore && (!integer(value.nextBeforeNumber, 1) || !rows.length)
    || !value.hasMore && value.nextBeforeNumber !== null) return null;
  if (rows.some((row, index) => index > 0 && row!.number >= rows[index - 1]!.number) || value.hasMore && value.nextBeforeNumber !== rows.at(-1)!.number) return null;
  return { rows: rows as SubscriptionCycle[], total: value.total, hasMore: value.hasMore, nextBeforeNumber: value.nextBeforeNumber as number | null };
}
