import type { Good } from '@/lib/data';
import { ProductDetailRefresh } from './ProductDetailRefresh';

/** One refresh boundary for a screen, including cards without selectable stock. */
export function GoodsSalePeriodRefresh({ goods, onRefresh }: { goods: readonly Pick<Good, 'salePeriod'>[]; onRefresh?: () => void }) {
  const boundaries = goods.flatMap(good => {
    const value = good.salePeriod?.nextChangeAt, time = value ? Date.parse(value) : NaN;
    return Number.isFinite(time) ? [time] : [];
  });
  return boundaries.length ? <ProductDetailRefresh nextChangeAt={new Date(Math.min(...boundaries)).toISOString()} onRefresh={onRefresh} /> : null;
}
