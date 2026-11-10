export interface GoodsSalePeriod {
  startsAt: string | null;
  endsAt: string | null;
  state: 'unlimited' | 'scheduled' | 'open' | 'ended';
  calculatedAt: string;
  nextChangeAt: string | null;
}

export function goodsSalePeriodState(startsAt: string | null, endsAt: string | null, now: number): GoodsSalePeriod['state'] {
  if (!startsAt && !endsAt) return 'unlimited';
  const start = Date.parse(startsAt ?? ''); const end = Date.parse(endsAt ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return 'ended';
  return now < start ? 'scheduled' : now >= end ? 'ended' : 'open';
}

export function parseGoodsSalePeriod(value: unknown): GoodsSalePeriod | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const period = value as GoodsSalePeriod;
  if (typeof period.calculatedAt !== 'string' || !Number.isFinite(Date.parse(period.calculatedAt))) return null;
  if (period.startsAt !== null && (typeof period.startsAt !== 'string' || !Number.isFinite(Date.parse(period.startsAt)))) return null;
  if (period.endsAt !== null && (typeof period.endsAt !== 'string' || !Number.isFinite(Date.parse(period.endsAt)))) return null;
  if ((period.startsAt === null) !== (period.endsAt === null)
    || period.startsAt && period.endsAt && Date.parse(period.startsAt) >= Date.parse(period.endsAt)) return null;
  const state = goodsSalePeriodState(period.startsAt, period.endsAt, Date.parse(period.calculatedAt));
  const nextChangeAt = state === 'scheduled' ? period.startsAt : state === 'open' ? period.endsAt : null;
  return period.state === state && period.nextChangeAt === nextChangeAt ? period : null;
}

export function goodsSaleUnavailableLabel(period: GoodsSalePeriod | undefined | null): string | null {
  if (!period) return null;
  return period.state === 'scheduled' ? '판매 시작 전' : period.state === 'ended' ? '판매 종료' : null;
}
