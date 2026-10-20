import type { Good } from './data';
import { isUuid } from './uuid';

export interface GoodOtherCompositionReference {
  id: string;
  title: string;
  goods: { goodId: string; compositionLabel: string | null }[];
}

export interface GoodOtherCompositionReferences {
  groups: GoodOtherCompositionReference[];
  nextChangeAt: string | null;
}

export interface PublicGoodOtherCompositions {
  groups: {
    id: string;
    title: string;
    goods: { good: Good; compositionLabel: string | null }[];
  }[];
  nextChangeAt: string | null;
  unavailable?: boolean;
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function isDisplayText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
    && [...value].length <= maxLength && !/[\p{Cc}]/u.test(value);
}

function isBoundary(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) return false;
  const date = value.slice(0, 10);
  return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

/** The public contract deliberately has no representative or hidden-member fields. */
export function parseGoodOtherCompositionReferences(value: unknown, currentGoodId?: string): GoodOtherCompositionReferences | null {
  if (!hasExactKeys(value, ['groups', 'nextChangeAt']) || !Array.isArray(value.groups) || !isBoundary(value.nextChangeAt)) return null;
  const groups: GoodOtherCompositionReference[] = [];
  const groupIds = new Set<string>();
  for (const group of value.groups) {
    if (!hasExactKeys(group, ['id', 'title', 'goods']) || !isUuid(group.id)
      || groupIds.has(group.id.toLowerCase()) || !isDisplayText(group.title, 15)
      || !Array.isArray(group.goods) || group.goods.length < 1 || group.goods.length > 9) return null;
    const goods: GoodOtherCompositionReference['goods'] = [];
    const goodIds = new Set<string>();
    for (const member of group.goods) {
      if (!hasExactKeys(member, ['goodId', 'compositionLabel']) || typeof member.goodId !== 'string'
        || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(member.goodId) || member.goodId === currentGoodId || goodIds.has(member.goodId)
        || member.compositionLabel !== null && !isDisplayText(member.compositionLabel, 40)) return null;
      goodIds.add(member.goodId);
      goods.push({ goodId: member.goodId, compositionLabel: member.compositionLabel });
    }
    groupIds.add(group.id.toLowerCase());
    groups.push({ id: group.id, title: group.title, goods });
  }
  return { groups, nextChangeAt: value.nextChangeAt };
}

/** Only freshly re-read public cards participate; groups remain independent. */
export function resolveGoodOtherCompositions(references: GoodOtherCompositionReferences, goods: readonly Good[], currentGoodId: string): PublicGoodOtherCompositions {
  const byId = new Map(goods.map(good => [good.id, good]));
  if (!byId.has(currentGoodId)) return { groups: [], nextChangeAt: references.nextChangeAt };
  return {
    nextChangeAt: references.nextChangeAt,
    groups: references.groups.flatMap(group => {
      const selected = group.goods.flatMap(member => {
        const good = member.goodId !== currentGoodId ? byId.get(member.goodId) : undefined;
        return good ? [{ good, compositionLabel: member.compositionLabel }] : [];
      });
      return selected.length ? [{ id: group.id, title: group.title, goods: selected }] : [];
    }),
  };
}

export function goodOtherCompositionsNextChange(data: PublicGoodOtherCompositions): string | null {
  const boundaries = [data.nextChangeAt, ...data.groups.flatMap(group => group.goods.flatMap(({ good }) => [
    good.salePeriod?.nextChangeAt,
    ...(good.options?.flatMap(option => [option.pricing?.nextChangeAt, option.supply?.nextChangeAt]) ?? []),
  ]))];
  const next = boundaries.reduce<number | null>((earliest, value) => {
    const time = value ? Date.parse(value) : NaN;
    return Number.isFinite(time) ? Math.min(earliest ?? time, time) : earliest;
  }, null);
  return next === null ? null : new Date(next).toISOString();
}
