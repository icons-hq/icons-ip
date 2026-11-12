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

/**
 * 주문서 품목 가운데 판매기간 밖인 굿즈의 안내(QA1 S-D2-11). 공통 '재고 변경' 안내 대신 어떤 굿즈가 왜 주문에서 빠져야 하는지
 * 말한다. 카탈로그 판정(state)과, 화면을 연 뒤 지난 종료 시각(endsAt ≤ now)을 함께 본다. 해당 굿즈가 없으면 null.
 */
export function goodsSalePeriodOrderNotice(
  goods: readonly { name: string; salePeriod?: GoodsSalePeriod | null }[],
  scope: 'cart' | 'direct',
  now: number = Date.now(),
): string | null {
  const ended = new Set<string>();
  const scheduled = new Set<string>();
  for (const good of goods) {
    const period = good.salePeriod;
    if (!period) continue;
    const endsAt = period.endsAt ? Date.parse(period.endsAt) : NaN;
    if (period.state === 'ended' || Number.isFinite(endsAt) && endsAt <= now) ended.add(good.name);
    else if (period.state === 'scheduled') scheduled.add(good.name);
  }
  if (ended.size) {
    return `판매기간이 끝난 굿즈가 있어요: ${[...ended].join(', ')}. ${scope === 'direct' ? '이 굿즈는 지금 주문할 수 없어요.' : '장바구니에서 이 굿즈를 빼고 다시 주문해주세요.'}`;
  }
  if (scheduled.size) {
    return `아직 판매를 시작하지 않은 굿즈가 있어요: ${[...scheduled].join(', ')}. ${scope === 'direct' ? '판매가 시작된 뒤 주문해주세요.' : '장바구니에서 이 굿즈를 빼고 다시 주문해주세요.'}`;
  }
  return null;
}
