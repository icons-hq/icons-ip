export interface SubscriptionSchedule {
  readonly unit: 'week' | 'month';
  readonly interval: number;
  /** 원래 KST 기준일. 2월 보정 결과를 다음 기준일로 덮어쓰지 않는다. */
  readonly anchorDate: string;
  readonly time: string;
  readonly monthEnd: boolean;
}

const DAY_MS = 86_400_000;
const KST_MS = 9 * 60 * 60 * 1000;
export const SUBSCRIPTION_MAX_SLOT = 1200;
export const SUBSCRIPTION_LATE_WINDOW_MS = DAY_MS;

function dateParts(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 2000 || year > 2199) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? [year, month, day] : null;
}

export function parseSubscriptionSchedule(value: unknown): SubscriptionSchedule | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'anchorDate,interval,monthEnd,time,unit'
    || (row.unit !== 'week' && row.unit !== 'month') || typeof row.interval !== 'number'
    || !(row.unit === 'week' ? [1, 2, 4] : [1, 2, 3]).includes(row.interval)
    || !dateParts(row.anchorDate) || typeof row.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.time)
    || typeof row.monthEnd !== 'boolean' || (row.unit === 'week' && row.monthEnd)) return null;
  return { unit: row.unit, interval: row.interval, anchorDate: row.anchorDate as string, time: row.time, monthEnd: row.monthEnd };
}

export function subscriptionSlotAt(schedule: SubscriptionSchedule, slot: number): string {
  const checked = parseSubscriptionSchedule(schedule);
  if (!checked || !Number.isSafeInteger(slot) || slot < 0 || slot > SUBSCRIPTION_MAX_SLOT) throw new Error('invalid_subscription_schedule');
  const [year, month, anchorDay] = dateParts(checked.anchorDate)!;
  const [hour, minute] = checked.time.split(':').map(Number);
  let local: number;
  if (checked.unit === 'week') {
    local = Date.UTC(year, month - 1, anchorDay, hour, minute) + slot * checked.interval * 7 * DAY_MS;
  } else {
    const monthIndex = month - 1 + slot * checked.interval;
    const targetYear = year + Math.floor(monthIndex / 12); const targetMonth = monthIndex % 12;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    local = Date.UTC(targetYear, targetMonth, checked.monthEnd ? lastDay : Math.min(anchorDay, lastDay), hour, minute);
  }
  return new Date(local - KST_MS).toISOString();
}

/** 재개는 미래 slot 한 건을 고른다. 과거에 밀린 회차를 몰아서 실행하지 않는다. */
export function nextSubscriptionSlot(schedule: SubscriptionSchedule, after: Date): { slot: number; at: string } {
  if (!parseSubscriptionSchedule(schedule) || !Number.isFinite(after.getTime())) throw new Error('invalid_subscription_schedule');
  const first = Date.parse(subscriptionSlotAt(schedule, 0));
  if (after.getTime() < first) return { slot: 0, at: new Date(first).toISOString() };
  const [year, month] = dateParts(schedule.anchorDate)!;
  const local = new Date(after.getTime() + KST_MS);
  let candidate = schedule.unit === 'week'
    ? Math.floor((after.getTime() - first) / (schedule.interval * 7 * DAY_MS))
    : Math.floor(((local.getUTCFullYear() - year) * 12 + local.getUTCMonth() - (month - 1)) / schedule.interval);
  candidate = Math.max(0, candidate);
  for (let offset = 0; offset < 3; offset++) {
    const slot = candidate + offset; const at = subscriptionSlotAt(schedule, slot);
    if (Date.parse(at) > after.getTime()) return { slot, at };
  }
  throw new Error('invalid_subscription_schedule');
}

export function subscriptionSlotTiming(at: string, now: Date): 'future' | 'due' | 'missed' {
  const due = Date.parse(at); const current = now.getTime();
  if (!Number.isFinite(due) || !Number.isFinite(current)) throw new Error('invalid_subscription_schedule');
  return current < due ? 'future' : current - due > SUBSCRIPTION_LATE_WINDOW_MS ? 'missed' : 'due';
}
