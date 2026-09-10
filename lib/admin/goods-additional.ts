export const MAX_ADDITIONAL_GOODS = 50;
export interface AdminAdditionalGood { goodId: string; name: string; available: boolean }
export interface AdminAdditionalGoods { revision: number | null; items: AdminAdditionalGood[] }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseAdditionalGoodIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ADDITIONAL_GOODS) return null;
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== 'string' || !id.trim() || id.length > 200 || id.trim() !== id || ids.includes(id)) return null;
    ids.push(id);
  }
  return ids;
}
export function parseAdditionalGoodCandidates(value: unknown): AdminAdditionalGood[] | null {
  if (!Array.isArray(value) || value.length > MAX_ADDITIONAL_GOODS) return null;
  const items: AdminAdditionalGood[] = [];
  for (const item of value) {
    if (!record(item) || typeof item.goodId !== 'string' || !item.goodId || typeof item.name !== 'string'
      || typeof item.available !== 'boolean' || items.some((previous) => previous.goodId === item.goodId)) return null;
    items.push({ goodId: item.goodId, name: item.name, available: item.available });
  }
  return items;
}
export function parseAdminAdditionalGoods(value: unknown): AdminAdditionalGoods | null {
  if (!record(value) || (value.revision !== null && (typeof value.revision !== 'number'
    || !Number.isInteger(value.revision) || value.revision < 1 || value.revision > 2147483647))) return null;
  const items = parseAdditionalGoodCandidates(value.items);
  return items && !(items.length && value.revision === null) ? { revision: value.revision as number | null, items } : null;
}
