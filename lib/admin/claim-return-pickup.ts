import type { OrderClaimType } from '@/lib/orders/claims';
import { parseReturnIntakeColumns, type ReturnIntakeColumns } from './claim-return-intake';

/*
 * 반품 자동 회수 접수(QNA-032·ADR-0034)의 운영 표시. 회수 묶음마다 접수 상태·회수 운송장·실패 이유를 보이고, 자동 수거 실패는 다시 접수할 수
 * 있다. 상태는 DB 큐(`private.claim_return_pickups`)의 값 그대로다. 스위치를 켠 적 없으면 묶음에 'pickup'이 없어 아무것도 그리지 않는다.
 */

export const RETURN_PICKUP_STATES = ['pending', 'failed', 'requested', 'collected', 'cancel_pending', 'cancel_failed', 'canceled'] as const;
export type ReturnPickupState = (typeof RETURN_PICKUP_STATES)[number];

export const RETURN_PICKUP_STATE_LABELS: Record<ReturnPickupState, string> = {
  pending: '회수 접수 대기',
  failed: '자동 수거 실패',
  requested: '회수 접수됨',
  collected: '회수 접수 · 입고 확인',
  cancel_pending: '수거 취소 대기',
  cancel_failed: '수거 취소 실패',
  canceled: '수거 취소됨',
};

const ERROR_LABELS: Record<string, string> = {
  pickup_address_unavailable: '회수지(고객 주소)를 읽지 못했습니다',
  adapter_unavailable: '회수 접수 연결 설정을 확인해야 합니다',
  pickup_timeout: '택배사 응답 시간이 지났습니다',
  pickup_failed: '택배사에 연결하지 못했습니다',
  invalid_tracking: '택배사가 준 회수 운송장 형식이 틀립니다',
  invalid_work_item: '접수 정보 형식이 틀립니다',
  upstream_error: '택배사가 접수를 거절했습니다',
};
export function returnPickupErrorLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return ERROR_LABELS[code] ?? `택배사 응답 ${code}`;
}

export const RETURN_PICKUP_CANCEL_REASON_LABELS: Record<string, string> = {
  withdrawn: '요청 철회', rejected: '요청 거절', completed: '요청 종결', not_required: '회수 불필요', waived: '회수 생략',
  customer_sent: '고객 직접 발송', manual: '수거 방법 별도 기록', collected: '입고 확인',
};

/** 운영 상세의 회수 묶음 하나의 회수 접수. */
export interface AdminReturnPickup {
  pickupId: string;
  state: ReturnPickupState;
  carrier: string;
  carrierLabel: string | null;
  trackingNumber: string | null;
  requestedAt: string | null;
  attempts: number;
  autoAttempts: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  nextAttemptAt: string | null;
  inProgress: boolean;
  cancelReason: string | null;
  canceledAt: string | null;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' && value ? value : null;
const integer = (value: unknown) => Number.isSafeInteger(value) ? Number(value) : 0;

export function parseAdminReturnPickup(value: unknown): AdminReturnPickup | null {
  if (!record(value) || typeof value.pickupId !== 'string' || !(RETURN_PICKUP_STATES as readonly unknown[]).includes(value.state) || typeof value.carrier !== 'string') return null;
  return {
    pickupId: value.pickupId, state: value.state as ReturnPickupState, carrier: value.carrier, carrierLabel: text(value.carrierLabel),
    trackingNumber: text(value.trackingNumber), requestedAt: text(value.requestedAt), attempts: integer(value.attempts),
    autoAttempts: integer(value.autoAttempts), maxAttempts: integer(value.maxAttempts), lastErrorCode: text(value.lastErrorCode),
    nextAttemptAt: text(value.nextAttemptAt), inProgress: value.inProgress === true, cancelReason: text(value.cancelReason), canceledAt: text(value.canceledAt),
  };
}

/** 운영자가 다시 접수할 수 있는 상태(접수 실패·취소 실패). 크론이 지금 보내는 중이면 기다린다. */
export function returnPickupRetryable(pickup: AdminReturnPickup): boolean {
  return (pickup.state === 'failed' || pickup.state === 'cancel_failed') && !pickup.inProgress;
}

export interface ClaimReturnPickupFailure {
  claimId: string;
  claimType: OrderClaimType;
  reference: number;
  orderNumber: string | null;
  bundleId: string;
  state: 'failed' | 'cancel_failed';
  lastErrorCode: string | null;
  attempts: number;
  updatedAt: string;
}

/** 클레임 목록 위 운영 요약. 꺼져 있으면 그 칸을 그리지 않는다. */
export interface ClaimReturnOperations {
  pickup: { enabled: false } | { enabled: true; failed: number; pending: number; items: ClaimReturnPickupFailure[] };
  intake: { enabled: false } | { enabled: true; columns: ReturnIntakeColumns };
}
export const CLAIM_RETURN_OPERATIONS_OFF: ClaimReturnOperations = { pickup: { enabled: false }, intake: { enabled: false } };

export function parseClaimReturnOperations(value: unknown): ClaimReturnOperations | null {
  if (!record(value) || !record(value.pickup) || !record(value.intake)) return null;
  let pickup: ClaimReturnOperations['pickup'] = { enabled: false };
  if (value.pickup.enabled === true) {
    if (!Number.isSafeInteger(value.pickup.failed) || !Number.isSafeInteger(value.pickup.pending) || !Array.isArray(value.pickup.items)) return null;
    const items = value.pickup.items.filter(record).flatMap((item): ClaimReturnPickupFailure[] =>
      typeof item.claimId === 'string' && (item.claimType === 'return' || item.claimType === 'exchange') && Number.isSafeInteger(item.reference)
        && typeof item.bundleId === 'string' && (item.state === 'failed' || item.state === 'cancel_failed') && typeof item.updatedAt === 'string'
        ? [{ claimId: item.claimId, claimType: item.claimType, reference: Number(item.reference), orderNumber: text(item.orderNumber), bundleId: item.bundleId,
          state: item.state, lastErrorCode: text(item.lastErrorCode), attempts: integer(item.attempts), updatedAt: item.updatedAt }] : []);
    pickup = { enabled: true, failed: Number(value.pickup.failed), pending: Number(value.pickup.pending), items };
  } else if (value.pickup.enabled !== false) return null;
  let intake: ClaimReturnOperations['intake'] = { enabled: false };
  if (value.intake.enabled === true) {
    const columns = parseReturnIntakeColumns(value.intake.columns);
    if (!columns) return null;
    intake = { enabled: true, columns };
  } else if (value.intake.enabled !== false) return null;
  return { pickup, intake };
}

export function claimReturnPickupError(message: string | null | undefined): string {
  const value = (message ?? '').toLowerCase();
  if (value.includes('return_pickup_disabled')) return '자동 회수 접수가 꺼져 있습니다. 택배사에 직접 접수하고 회수 정보 정정에 기록해주세요.';
  if (value.includes('return_pickup_in_progress')) return '지금 택배사에 보내는 중입니다. 잠시 뒤 새로고침해 결과를 확인해주세요.';
  if (value.includes('return_pickup_not_found')) return '이 회수 묶음의 회수 접수를 찾지 못했습니다. 새로고침해주세요.';
  return '다시 접수하지 못했습니다. 새로고침한 뒤 다시 시도해주세요.';
}
