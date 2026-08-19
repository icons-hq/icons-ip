import type { OrderWithdrawalReasonType } from '@/lib/orders';

/**
 * 청약철회 기한 계산(#189, #250).
 *
 * 판정의 진실원은 DB의 `order_withdrawal_deadline_passed`다. 여기 있는 것은 화면이
 * "언제까지"를 말하기 위한 같은 규칙의 사본이며, 승인·거절을 이 값으로 결정하지 않는다.
 * 규칙이 갈라지면 구매자는 아직 열려 있다고 읽은 창을 서버가 닫아 버린다 — 그래서
 * 기산점(`delivered_at`)도, 기간도, 경계 부등호도 SQL과 글자 그대로 맞춘다:
 *
 *   delivered_at is null            → 기한이 아직 시작하지 않음
 *   defect                          → delivered_at + interval '3 months'
 *   change_of_mind(그 외)           → delivered_at + interval '7 days'
 *   지났는가                        → deadline < at (경계 시각 당일은 아직 유효)
 *
 * 사다리에서 `delivered_at`은 shipping→delivered 전이가 찍는다. 그 전에는 null이고,
 * 화면은 남은 기간 대신 "아직 시작하지 않았다"를 말해야 한다.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function daysInUtcMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Postgres `interval '3 months'`와 같은 달력 덧셈.
 *
 * JS의 `setUTCMonth`는 1월 31일 + 3개월을 5월 1일로 넘긴다. Postgres는 그 달의
 * 마지막 날(4월 30일)로 잘라낸다. 넘기는 쪽을 택하면 화면이 DB보다 하루 긴 기한을
 * 약속하게 되므로 Postgres를 따라 자른다.
 */
function addCalendarMonths(date: Date, months: number) {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth() + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const day = Math.min(date.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));

  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    day,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ));
}

function parseInstant(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 공급받은 날 기준 청약철회 마감 시각. 기산점이 없으면 `null`(아직 시작 전). */
export function orderWithdrawalDeadline(
  deliveredAt: string | null | undefined,
  reasonType: OrderWithdrawalReasonType,
): Date | null {
  const delivered = parseInstant(deliveredAt);
  if (!delivered) return null;
  return reasonType === 'defect'
    ? addCalendarMonths(delivered, 3)
    : new Date(delivered.getTime() + 7 * DAY_MS);
}

/**
 * 기한이 지났는지. `order_withdrawal_deadline_passed`와 같은 경계다 —
 * 기산점이 없으면 지나지 않은 것으로 본다(fail open은 여기서만 허용된다.
 * 실제 승인 게이트는 DB가 다시 판정한다).
 */
export function orderWithdrawalDeadlinePassed(
  deliveredAt: string | null | undefined,
  reasonType: OrderWithdrawalReasonType,
  at: Date,
) {
  const deadline = orderWithdrawalDeadline(deliveredAt, reasonType);
  if (!deadline) return false;
  return deadline.getTime() < at.getTime();
}

/**
 * 마감까지 남은 일수. 이미 지났으면 0, 기산점이 없으면 `null`.
 *
 * 올림한다 — 22시간 남은 창을 "0일 남음"으로 적으면 아직 요청할 수 있는 구매자가
 * 포기한다.
 */
export function orderWithdrawalDaysRemaining(
  deliveredAt: string | null | undefined,
  reasonType: OrderWithdrawalReasonType,
  at: Date,
): number | null {
  const deadline = orderWithdrawalDeadline(deliveredAt, reasonType);
  if (!deadline) return null;
  const remaining = deadline.getTime() - at.getTime();
  return remaining <= 0 ? 0 : Math.ceil(remaining / DAY_MS);
}
