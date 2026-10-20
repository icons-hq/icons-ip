import { parseGoodsPricePeriodInput, toKstDateTimeInput } from './goods-price-periods';
import { goodsSalePeriodState, type GoodsSalePeriod } from '@/lib/goods-sale-period';

export const GOODS_SALE_PERIOD_FIELDS = ['salePeriodEnabled', 'saleStartsAt', 'saleEndsAt', 'salePeriodRevision'] as const;
export const GOODS_SALE_PERIOD_PRESETS = [3, 5, 7, 15, 30, 60, 90, 120] as const;

export function readGoodsSalePeriod(form: FormData):
  { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  if (!form.has('salePeriodEnabled')) return { ok: true, fields: {} };
  const enabled = form.get('salePeriodEnabled');
  const revision = String(form.get('salePeriodRevision') ?? '0');
  if (!['true', 'false'].includes(String(enabled)) || !/^(0|[1-9]\d*)$/.test(revision) || Number(revision) > 2147483647) {
    return { ok: false, error: '판매기간 설정을 확인해주세요.' };
  }
  const parsed = parseGoodsPricePeriodInput({ state: 'draft', discountPrice: null,
    startsAt: enabled === 'true' ? form.get('saleStartsAt') : null,
    endsAt: enabled === 'true' ? form.get('saleEndsAt') : null });
  if (!parsed || enabled === 'true' && (!parsed.startsAt || !parsed.endsAt)) return {
    ok: false, error: '판매 시작·종료 시각을 모두 입력해주세요. 종료 시각은 시작 시각보다 늦어야 합니다.',
  };
  return { ok: true, fields: { sale_period: { startsAt: parsed.startsAt, endsAt: parsed.endsAt, expectedRevision: Number(revision) } } };
}

/** Include today in day presets, ending at the next KST midnight after the last sale day. */
export function goodsSalePeriodPreset(days: number, now = new Date()) {
  const today = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const start = Date.parse(`${today}T00:00:00+09:00`);
  return { saleStartsAt: toKstDateTimeInput(new Date(start).toISOString()),
    saleEndsAt: toKstDateTimeInput(new Date(start + days * 24 * 60 * 60 * 1000).toISOString()) };
}

export function goodsSalePeriodPreview(values: Record<string, string>, now = new Date()): GoodsSalePeriod | undefined {
  const form = new FormData(); Object.entries(values).forEach(([key, value]) => form.set(key, value));
  const result = readGoodsSalePeriod(form);
  if (!result.ok || !result.fields.sale_period) return undefined;
  const { startsAt, endsAt } = result.fields.sale_period as { startsAt: string | null; endsAt: string | null };
  const state = goodsSalePeriodState(startsAt, endsAt, now.getTime());
  return { startsAt, endsAt, state, calculatedAt: now.toISOString(), nextChangeAt: state === 'scheduled' ? startsAt : state === 'open' ? endsAt : null };
}
