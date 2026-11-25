export const MAX_ADDITIONAL_GOODS = 50;
/**
 * 추가 구성으로 연결한 상품 한 줄. `goodId`·`name`·`available`은 저장 함수가 돌려주는 값이고,
 * `code`(상품 자동코드)·`imageUrl`(사진)은 화면에서 알아보게 하려고 읽을 때 덧붙인다 — 저장에는 `goodId`만 쓴다.
 */
export interface AdminAdditionalGood { goodId: string; name: string; available: boolean; code?: string | null; imageUrl?: string | null }
export interface AdminAdditionalGoods { revision: number | null; items: AdminAdditionalGood[] }
/** 후보 확인 결과: 연결할 수 있음 / 없음 / 알 수 없음(저장할 때 DB가 다시 가린다). */
export type AdditionalCandidateVerdict = 'available' | 'unavailable' | 'unknown';
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
/**
 * 후보 검색(판매 중인 상품만, 이름·상품 URL에 검색어가 든 것 최대 50개) 결과에서 이 상품을 새로 연결할 수 있는지 가린다.
 * 상품 URL 전체로 찾았는데 결과에 없고 결과가 50개 미만이면 지금 고객이 살 수 없는 상품이다. 결과가 50개로 꽉 찼는데
 * 없다면 50개 밖에 있을 수도 있어 단정하지 않는다('unknown') — 그 경우는 저장할 때 DB가 다시 판정한다.
 */
export function additionalCandidateVerdict(found: readonly AdminAdditionalGood[], goodId: string): AdditionalCandidateVerdict {
  if (found.some((item) => item.goodId === goodId)) return 'available';
  return found.length >= MAX_ADDITIONAL_GOODS ? 'unknown' : 'unavailable';
}
export function parseAdminAdditionalGoods(value: unknown): AdminAdditionalGoods | null {
  if (!record(value) || (value.revision !== null && (typeof value.revision !== 'number'
    || !Number.isInteger(value.revision) || value.revision < 1 || value.revision > 2147483647))) return null;
  const items = parseAdditionalGoodCandidates(value.items);
  return items && !(items.length && value.revision === null) ? { revision: value.revision as number | null, items } : null;
}
