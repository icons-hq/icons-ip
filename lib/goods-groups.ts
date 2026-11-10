import type { Good } from './data';
import { isUuid } from './uuid';
import { transactionExactKeys, transactionInteger, transactionRecord } from './goods-transaction-values';

export interface PublicGoodsGroupReference {
  id: string;
  name: string;
  optionNames: string[];
  currentGoodId: string;
  members: { goodId: string; values: string[]; sortOrder: number }[];
}
export interface PublicGoodsGroup extends Omit<PublicGoodsGroupReference, 'members'> {
  members: (PublicGoodsGroupReference['members'][number] & { good: Good })[];
}

function label(value: unknown, max: number): value is string {
  return typeof value === 'string' && value === value.trim() && [...value].length > 0
    && [...value].length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
const goodId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);

export function parsePublicGoodsGroup(value: unknown, expectedGoodId: string): PublicGoodsGroupReference | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['id', 'name', 'optionNames', 'currentGoodId', 'members'])
    || typeof value.id !== 'string' || !isUuid(value.id) || !label(value.name, 40)
    || value.currentGoodId !== expectedGoodId || !goodId(value.currentGoodId)
    || !Array.isArray(value.optionNames) || value.optionNames.length < 1 || value.optionNames.length > 3
    || value.optionNames.some(axis => !label(axis, 40)) || new Set(value.optionNames).size !== value.optionNames.length
    || !Array.isArray(value.members) || value.members.length < 1 || value.members.length > 100) return null;
  const ids = new Set<string>(); const combinations = new Set<string>(); const positions = new Set<number>();
  const members: PublicGoodsGroupReference['members'] = [];
  for (const member of value.members) {
    if (!transactionRecord(member) || !transactionExactKeys(member, ['goodId', 'values', 'sortOrder'])
      || !goodId(member.goodId) || ids.has(member.goodId)
      || !transactionInteger(member.sortOrder, 0, 99) || positions.has(member.sortOrder)
      || !Array.isArray(member.values) || member.values.length !== value.optionNames.length
      || member.values.some(entry => !label(entry, 80))) return null;
    const key = JSON.stringify(member.values);
    if (combinations.has(key)) return null;
    ids.add(member.goodId); combinations.add(key); positions.add(member.sortOrder);
    members.push({ goodId: member.goodId, values: member.values as string[], sortOrder: member.sortOrder });
  }
  if (!ids.has(expectedGoodId)) return null;
  return { id: value.id, name: value.name, optionNames: value.optionNames as string[], currentGoodId: expectedGoodId,
    members: members.sort((a, b) => a.sortOrder - b.sortOrder) };
}

export function resolvePublicGoodsGroup(reference: PublicGoodsGroupReference | null, goods: readonly Good[]): PublicGoodsGroup | null {
  if (!reference) return null;
  const byId = new Map(goods.map(good => [good.id, good]));
  const members = reference.members.flatMap(member => {
    const good = byId.get(member.goodId);
    return good ? [{ ...member, good }] : [];
  });
  if (!members.some(member => member.goodId === reference.currentGoodId)) return null;
  return { ...reference, members };
}

/** Prefer the product that preserves the other selected values. Non-rectangular
 * combinations remain reachable; the link announces the complete destination. */
export function goodsGroupAxisChoices(group: PublicGoodsGroup, axis: number) {
  const current = group.members.find(member => member.goodId === group.currentGoodId);
  if (!current || axis < 0 || axis >= group.optionNames.length) return [];
  const values = [...new Set(group.members.map(member => member.values[axis]))];
  return values.map(value => {
    const candidates = group.members.filter(member => member.values[axis] === value);
    const score = (member: PublicGoodsGroup['members'][number]) => member.values.reduce((total, candidate, index) =>
      total + (index !== axis && candidate === current.values[index] ? 1 : 0), 0);
    const destination = candidates.toSorted((a, b) => score(b) - score(a) || a.sortOrder - b.sortOrder)[0];
    return { value, destination, selected: value === current.values[axis] };
  });
}
