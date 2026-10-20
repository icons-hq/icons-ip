import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GoodsGroupSelector } from './GoodsGroupSelector';
import type { PublicGoodsGroup } from '@/lib/goods-groups';

const base = { ip: 'ip', type: '키링', price: 10000, stock: 'ok' as const, stockQty: 5, badge: null, img: '' };
const group: PublicGoodsGroup = { id: 'a6140000-0000-4000-8000-000000000001', name: '키링', currentGoodId: 'red', optionNames: ['색상', '크기'],
  members: [{ goodId: 'red', values: ['빨강', 'S'], sortOrder: 0, good: { ...base, id: 'red', name: '빨강 키링' } },
    { goodId: 'blue', values: ['파랑', 'L'], sortOrder: 1, good: { ...base, id: 'blue', name: '파랑 키링' } }] };
describe('판매옵션별 상품 이동', () => {
  it('대상 상품의 모든 값을 읽을 수 있는 링크와 현재 선택을 제공한다', () => {
    const html = renderToStaticMarkup(<GoodsGroupSelector group={group} />);
    expect(html).toContain('href="/shop/blue"');
    expect(html).toContain('aria-label="색상 파랑, 크기 L 굿즈 보기"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('<legend>색상</legend>');
  });
  it('공개 상품이 하나만 남으면 선택 UI를 숨긴다', () => {
    expect(renderToStaticMarkup(<GoodsGroupSelector group={{ ...group, members: group.members.slice(0, 1) }} />)).toBe('');
  });
});
