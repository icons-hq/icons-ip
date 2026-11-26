import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
import { CHANGED_BY_OTHER, SAVE_UNKNOWN_MESSAGE } from './goods-template-save';
import { ADMIN_SALES_ACCESS_DENIED } from './vocabulary';

/** 자동 발주확인(ADR-0025) 설정은 발주확인/발송관리 화면에서 바로 바꾼다. */
export const AUTO_ORDER_CONFIRMATION_PATH = '/admin/sales/dispatch';
export const AUTO_ORDER_CONFIRMATION_DEFAULT_TIME = '16:30';

export const AUTO_ORDER_CONFIRMATION_EXCLUSIONS = {
  cancellation_in_progress: '취소 요청 진행 중',
  fulfillment_hold: '출고 보류(테스트 결제·결제사 취소)',
  preorder_unallocated: '예약 입고 확인 전',
  // 20261125180000: 가상계좌는 마지막 입금 확인 뒤 1시간이 지나야 대상이다(은행의 늦은 입금 취소 통보 대비).
  deposit_settling: '가상계좌 입금 1시간 미만(다음 날 처리)',
  locked: '다른 처리와 겹쳐 다음 실행으로 넘김',
  failed: '처리 확인 필요',
} as const;
export type AutoOrderConfirmationExclusion = keyof typeof AUTO_ORDER_CONFIRMATION_EXCLUSIONS;

export interface AutoOrderConfirmationRun {
  runDate: string; cutoffAt: string; startedAt: string; finishedAt: string | null; confirmedCount: number; excludedCount: number;
}
export interface AutoOrderConfirmationState {
  revision: number; enabled: boolean; runTime: string; enabledAt: string | null; updatedAt: string; nextRunAt: string | null;
  lastRun: AutoOrderConfirmationRun | null;
  lastExclusions: { orderId: string; orderNumber: string | null; outcome: AutoOrderConfirmationExclusion }[];
}

export function isAutoOrderRunTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}
const nullableInstant = (value: unknown): value is string | null => value === null || transactionInstant(value);
const runDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

function parseRun(value: unknown): AutoOrderConfirmationRun | null | undefined {
  if (value === null) return null;
  if (!transactionRecord(value) || !transactionExactKeys(value, ['runDate', 'cutoffAt', 'startedAt', 'finishedAt', 'confirmedCount', 'excludedCount'])
    || !runDate(value.runDate) || !transactionInstant(value.cutoffAt) || !transactionInstant(value.startedAt) || !nullableInstant(value.finishedAt)
    || !transactionInteger(value.confirmedCount) || !transactionInteger(value.excludedCount)) return undefined;
  return value as unknown as AutoOrderConfirmationRun;
}

/** DB 문서를 그대로 믿지 않고 화면이 쓰는 모양만 통과시킨다. */
export function parseAutoOrderConfirmation(value: unknown): AutoOrderConfirmationState | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['revision', 'enabled', 'runTime', 'enabledAt', 'updatedAt', 'nextRunAt', 'lastRun', 'lastExclusions'])
    || !transactionInteger(value.revision, 1) || typeof value.enabled !== 'boolean' || !isAutoOrderRunTime(value.runTime)
    || !nullableInstant(value.enabledAt) || (value.enabled && value.enabledAt === null) || !transactionInstant(value.updatedAt)
    || !nullableInstant(value.nextRunAt) || (value.enabled !== (value.nextRunAt !== null)) || !Array.isArray(value.lastExclusions)
    || value.lastExclusions.length > 20) return null;
  const lastRun = parseRun(value.lastRun);
  if (lastRun === undefined) return null;
  if (value.lastExclusions.some(row => !transactionRecord(row) || !transactionExactKeys(row, ['orderId', 'orderNumber', 'outcome']) || !isUuid(row.orderId)
    || !(row.orderNumber === null || typeof row.orderNumber === 'string') || !Object.hasOwn(AUTO_ORDER_CONFIRMATION_EXCLUSIONS, String(row.outcome)))) return null;
  return { ...(value as unknown as AutoOrderConfirmationState), lastRun };
}

export function autoOrderConfirmationError(code?: string, message?: string) {
  if (code === 'PT409' || message?.includes('auto_order_confirmation_changed')) return `${CHANGED_BY_OTHER} 새로고침해 지금 설정을 확인해주세요.`;
  if (['42501', '28000'].includes(code ?? '') || message?.includes('operator_capability_required')) return ADMIN_SALES_ACCESS_DENIED;
  if (code === '22023' || message?.includes('invalid_auto_order_confirmation')) return '실행 시각을 00:00~23:59 사이로 입력해주세요.';
  return SAVE_UNKNOWN_MESSAGE;
}
