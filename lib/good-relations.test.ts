import { describe, expect, it } from 'vitest';
import { parseGoodRelationReferences, resolveGoodRelations, type GoodRelationReferences } from './good-relations';
import type { Good } from './data';

const references: GoodRelationReferences = { groups: [{ id: '74000000-0000-4000-8000-000000000001', kind: 'similar', title: '유사한 굿즈', goodIds: ['good-c', 'good-b'] }], nextChangeAt: null };
const good = (id: string, price: number): Good => ({ id, name: id, ip: 'ip', type: '문구', price, priceMax: price + 1000, stock: 'ok', stockQty: 5, img: '', badge: null });
describe('공개 연관상품 결합', () => {
  it('현재 공개 카드의 가격을 재사용하며 저장한 순서를 유지하고 현재 상품을 제외한다', () => {
    expect(resolveGoodRelations(references, [good('good-b', 3000), good('good-c', 4000)], 'good-a').groups[0].goods.map(good => [good.id, good.price, good.priceMax]))
      .toEqual([['good-c', 4000, 5000], ['good-b', 3000, 4000]]);
    expect(resolveGoodRelations(references, [good('good-b', 3000)], 'good-b').groups).toEqual([]);
    expect(resolveGoodRelations(references, [], 'good-a').groups).toEqual([]);
  });
  it('중복·잘못된 상품 식별자와 초과 구성 응답을 거절한다', () => {
    expect(parseGoodRelationReferences(references)).toEqual(references);
    for (const goodIds of [['good-b', 'good-b'], ['https://outside.test'], [], Array.from({ length: 10 }, (_, i) => `good-${i}`)]) {
      expect(parseGoodRelationReferences({ ...references, groups: [{ ...references.groups[0], goodIds }] })).toBeNull();
    }
  });
  it('이미지 태그는 다시 조회된 공개 상품만 남기고 대표가 사라지면 편성 전체를 숨긴다', () => {
    const visual = { imagePath: 'public-media/catalog/curation/99000000-0000-4000-8000-000000000301.webp', alt: '이미지', description: '설명', hotspots: [{ goodId: 'good-c', x: 3000, y: 4000 }, { goodId: 'good-b', x: 6000, y: 7000 }] };
    const source: GoodRelationReferences = { groups: [{ ...references.groups[0], kind: 'codi', visual, allGoodIds: ['good-a', 'good-c', 'good-b'], representativeGoodId: 'good-a' }], nextChangeAt: null };
    expect(parseGoodRelationReferences(source)).not.toBeNull();
    const result = resolveGoodRelations(source, [good('good-a', 1000), good('good-c', 2000)], 'good-a');
    expect(result.groups[0].visual?.hotspots.map(point => point.goodId)).toEqual(['good-c']);
    expect(result.groups[0].goods.map(good => good.id)).toEqual(['good-c']);
    expect(resolveGoodRelations(source, [good('good-b', 1000), good('good-c', 2000)], 'good-b').groups).toEqual([]);
    expect(parseGoodRelationReferences({ ...source, groups: [{ ...source.groups[0], visual: { ...visual, hotspots: [{ goodId: 'hidden', x: 1, y: 1 }] } }] })).toBeNull();
  });
});
