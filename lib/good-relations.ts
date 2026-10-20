import type { Good } from './data';
import { isUuid } from './uuid';
import { parseGoodsRelationVisual, type GoodsRelationVisual } from './good-relation-visual';

export type GoodsRelationKind = 'together' | 'similar' | 'codi' | 'other_composition';
export type PublicGoodsRelationKind = Exclude<GoodsRelationKind, 'other_composition'>;
export const relationDefaultTitle = (kind: GoodsRelationKind) => kind === 'together' ? '함께 사면 좋은 굿즈' : kind === 'codi' ? '이렇게 함께 연출해요' : kind === 'other_composition' ? '다른 구성도 살펴보세요' : '유사한 굿즈';

export interface GoodRelationReference { id: string; kind: PublicGoodsRelationKind; title: string; goodIds: string[]; allGoodIds?: string[]; representativeGoodId?: string; visual?: GoodsRelationVisual | null }
export interface GoodRelationReferences { groups: GoodRelationReference[]; nextChangeAt: string | null; unavailable?: boolean }
export interface PublicGoodRelations { groups: { id: string; kind: PublicGoodsRelationKind; title: string; goods: Good[]; allGoods?: Good[]; visual?: GoodsRelationVisual | null }[]; currentGoodId?: string; nextChangeAt: string | null; unavailable?: boolean }

export function parseGoodRelationReferences(value: unknown): GoodRelationReferences | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as GoodRelationReferences;
  if (!Array.isArray(result.groups) || result.nextChangeAt !== null && (typeof result.nextChangeAt !== 'string' || !Number.isFinite(Date.parse(result.nextChangeAt)))
    || result.groups.some(group => !group || !isUuid(group.id) || !['together', 'similar', 'codi'].includes(group.kind)
      || typeof group.title !== 'string' || !group.title.trim() || [...group.title].length > 15 || !Array.isArray(group.goodIds)
      || group.goodIds.length < 1 || group.goodIds.length > (group.visual || group.kind === 'codi' ? 4 : group.kind === 'together' ? 5 : 9)
      || group.goodIds.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) || new Set(group.goodIds).size !== group.goodIds.length)) return null;
  for (const group of result.groups) {
    if (group.allGoodIds !== undefined && (!Array.isArray(group.allGoodIds) || group.allGoodIds.length !== group.goodIds.length + 1
      || new Set(group.allGoodIds).size !== group.allGoodIds.length || group.allGoodIds.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id))
      || group.goodIds.some(id => !group.allGoodIds!.includes(id)) || !group.allGoodIds.includes(group.representativeGoodId ?? ''))) return null;
    const visual = parseGoodsRelationVisual(group.visual, group.allGoodIds ?? group.goodIds);
    if (visual === false || group.kind === 'similar' && visual || group.kind === 'codi' && !visual || visual && !group.allGoodIds) return null;
  }
  return result;
}
export function resolveGoodRelations(references: GoodRelationReferences, goods: readonly Good[], currentGoodId: string): PublicGoodRelations {
  const byId = new Map(goods.map(good => [good.id, good]));
  return { ...references, currentGoodId, groups: references.groups.flatMap(group => {
    const allGoods = (group.allGoodIds ?? group.goodIds).flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
    if (group.allGoodIds && (allGoods.length < 2 || !allGoods.some(good => good.id === currentGoodId) || !allGoods.some(good => good.id === group.representativeGoodId))) return [];
    const selected = group.goodIds.flatMap(id => id !== currentGoodId && byId.has(id) ? [byId.get(id)!] : []);
    return selected.length ? [{ id: group.id, kind: group.kind, title: group.title, goods: selected,
      ...(group.visual ? { visual: { ...group.visual, hotspots: group.visual.hotspots.filter(point => byId.has(point.goodId)) }, allGoods } : {}) }] : [];
  }) };
}
