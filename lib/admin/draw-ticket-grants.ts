/* 운영자 수동 뽑기권 발급의 순수 계층(#185).
 * 폼 정규화·행 파싱·오류 문구 매핑만 담는다. 권한과 멱등은 admin_grant_draw_tickets RPC가
 * 판단한다 — 여기 검증은 왕복을 아끼는 1차 방어일 뿐 신뢰 경계가 아니다. */

/** 수동 발급 1회 상한. 자동 발급 정책(1~100)보다 낮다 — 조건 없이 임의 사용자에게 나가기 때문이다. */
export const DRAW_TICKET_GRANT_MAX_QUANTITY = 10;

export interface AdminDrawTicketGrantRecord {
  operationId: string;
  grantedAt: string;
  actorNickname: string;
  recipientId: string;
  recipientNickname: string;
  recipientMaskedEmail: string;
  poolId: string;
  poolName: string;
  quantity: number;
  openedCount: number;
  revokedCount: number;
  reason: string;
}

export interface AdminDrawTicketGrantInput {
  operationId: string;
  profileId: string;
  poolId: string;
  quantity: number;
  reason: string;
}

export type AdminDrawTicketGrantFormResult =
  | { ok: true; value: AdminDrawTicketGrantInput }
  | { ok: false; errors: Record<string, string> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeAdminDrawTicketGrantForm(
  formData: FormData,
): AdminDrawTicketGrantFormResult {
  const operationId = readString(formData, 'operationId');
  const profileId = readString(formData, 'profileId');
  const poolId = readString(formData, 'poolId');
  const rawQuantity = readString(formData, 'quantity');
  const reason = readString(formData, 'reason');
  const quantity = /^\d+$/.test(rawQuantity) ? Number(rawQuantity) : Number.NaN;
  const errors: Record<string, string> = {};

  if (!UUID_PATTERN.test(operationId)) errors.form = '요청을 처리하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.';
  if (!UUID_PATTERN.test(profileId)) errors.profileId = '발급 대상 회원을 선택해주세요.';
  if (!UUID_PATTERN.test(poolId)) errors.poolId = '발급할 카드풀을 선택해주세요.';
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > DRAW_TICKET_GRANT_MAX_QUANTITY) {
    errors.quantity = `발급 수량은 1개 이상 ${DRAW_TICKET_GRANT_MAX_QUANTITY}개 이하로 입력해주세요.`;
  }
  if (reason.length < 1 || reason.length > 200) {
    errors.reason = '발급 사유는 1자 이상 200자 이하로 입력해주세요.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { operationId, profileId, poolId, quantity, reason } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** count(*)는 bigint라 supabase-js가 문자열로 줄 수 있다. */
function nonNegativeCount(value: unknown) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function parseAdminDrawTicketGrantRecord(value: unknown): AdminDrawTicketGrantRecord | null {
  if (!isRecord(value)) return null;

  const operationId = requiredString(value.operation_id);
  const grantedAt = requiredString(value.granted_at);
  const recipientId = requiredString(value.recipient_id);
  const poolId = requiredString(value.pool_id);
  const quantity = nonNegativeCount(value.quantity);
  const openedCount = nonNegativeCount(value.opened_count);
  const revokedCount = nonNegativeCount(value.revoked_count);

  if (
    !operationId
    || !UUID_PATTERN.test(operationId)
    || !grantedAt
    || !recipientId
    || !UUID_PATTERN.test(recipientId)
    || !poolId
    || quantity === null
    || openedCount === null
    || revokedCount === null
  ) return null;

  return {
    operationId,
    grantedAt,
    actorNickname: requiredString(value.actor_nickname) ?? '실행자 기록 없음',
    recipientId,
    recipientNickname: requiredString(value.recipient_nickname) ?? '알 수 없는 회원',
    recipientMaskedEmail: requiredString(value.recipient_masked_email) ?? '이메일 없음',
    poolId,
    poolName: requiredString(value.pool_name) ?? '삭제된 카드풀',
    quantity,
    openedCount,
    revokedCount,
    reason: requiredString(value.reason) ?? '사유 기록 없음',
  };
}

export function mapAdminDrawTicketGrantError(message: string): string {
  if (message.includes('reward_pool_not_ready') || message.includes('pool_not_found')) {
    return '지금 발급할 수 없는 카드풀입니다. 운영 기간과 등급별 확률·카드 구성을 확인해주세요.';
  }
  if (message.includes('recipient_suspended')) {
    return '정지된 회원에게는 카드팩을 발급할 수 없습니다.';
  }
  if (message.includes('profile_not_found')) {
    return '회원을 찾을 수 없습니다. 다시 검색해주세요.';
  }
  if (message.includes('grant_conflict')) {
    return '이미 처리된 발급 요청입니다. 화면을 새로고침한 뒤 다시 시도해주세요.';
  }
  if (message.includes('forbidden') || message.includes('auth_required')) {
    return '카드팩을 발급할 권한이 없습니다.';
  }
  if (message.includes('invalid_grant_quantity')) {
    return `발급 수량은 1개 이상 ${DRAW_TICKET_GRANT_MAX_QUANTITY}개 이하로 입력해주세요.`;
  }
  if (message.includes('invalid_grant_reason')) {
    return '발급 사유는 1자 이상 200자 이하로 입력해주세요.';
  }
  return '카드팩을 발급하지 못했습니다. 최신 상태를 확인한 뒤 다시 시도해주세요.';
}
