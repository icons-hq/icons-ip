import { GOODS_RELATION_KINDS, GOODS_RELATION_STATES, type GoodsRelation, type GoodsRelationFilters } from './goods-relations';

export const GOODS_RELATIONS_EXPORT_PATH = '/api/admin/goods-relations/export';
export const GOODS_RELATIONS_EXPORT_LIMIT = 2000;
export interface GoodsRelationsExport {
  filters: GoodsRelationFilters;
  rows: GoodsRelation[];
  startedAt: string;
  verifiedAt: string;
}
export function goodsRelationsExportHref(filters: GoodsRelationFilters) {
  return `${GOODS_RELATIONS_EXPORT_PATH}?${new URLSearchParams({ q: filters.query, kind: filters.kind, state: filters.state })}`;
}
export function goodsRelationKindLabel(row: Pick<GoodsRelation, 'kind' | 'visual'>) {
  return `${GOODS_RELATION_KINDS.find(item => item.value === row.kind)?.label ?? row.kind}${row.visual && row.kind === 'together' ? ' · 이미지형' : ''}`;
}
export function goodsRelationStateLabel(value: GoodsRelationFilters['state']) {
  return value === 'all' ? '전체' : GOODS_RELATION_STATES.find(item => item.value === value)?.label ?? value;
}
