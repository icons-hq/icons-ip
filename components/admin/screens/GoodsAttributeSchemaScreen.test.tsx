import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { AdminCategoryNode } from '@/lib/admin/category';

/* 훅을 모킹하지 않고 실제 React로 처음 화면을 그려, 훅 순서·서버 렌더링 문제를 잡는다. 눌러 보는 시험은 .client.test.tsx에 있다. */
vi.mock('@/app/admin/goods-attribute-actions', () => ({ readGoodsAttributesAction: vi.fn(), saveGoodsAttributeSchemaAction: vi.fn() }));
import { GoodsAttributeSchemaScreen } from './GoodsAttributeSchemaScreen';

const categories: AdminCategoryNode[] = [
  { id: 'goods', code: 'goods', name: '굿즈', parentId: null, depth: 1, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 1, assignedGoodCount: 0 },
  { id: 'doll', code: 'doll', name: '인형', parentId: 'goods', depth: 2, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 0, assignedGoodCount: 0 },
];

it('처음에는 카테고리를 고르는 칸만 보이고, 고른 뒤에야 보이는 항목·저장 버튼은 없다', () => {
  const html = renderToStaticMarkup(<GoodsAttributeSchemaScreen categories={categories} />);
  expect(html).toContain('data-admin-screen="goods-attributes"');
  expect(html).toContain('상품속성 관리');
  expect(html).toContain('placeholder="아직 고르지 않았습니다"');
  /* kit Button은 type이 없으면 submit이 아니라 button이다. 이 화면에는 폼이 없으므로 눌러도 제출되지 않는다. */
  expect(html).toMatch(/<button(?=[^>]*type="button")[^>]*aria-haspopup="dialog"[^>]*>카테고리 고르기<\/button>/);
  expect(html).not.toContain('<select');
  for (const hidden of ['항목 추가', '가져올 카테고리 고르기', '최신 항목 보기', '>저장<', '상품속성 조회']) expect(html).not.toContain(hidden);
});

it('카테고리가 하나도 없어도 같은 화면이 그려진다', () => {
  expect(renderToStaticMarkup(<GoodsAttributeSchemaScreen categories={[]} />)).toContain('카테고리 고르기');
});
