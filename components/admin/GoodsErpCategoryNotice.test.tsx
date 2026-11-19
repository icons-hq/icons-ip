import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { GoodsErpCategoryNotice } from './GoodsErpCategoryNotice';

const render = (suggestion: Parameters<typeof GoodsErpCategoryNotice>[0]['suggestion'], currentCategoryId = '') =>
  renderToStaticMarkup(<GoodsErpCategoryNotice suggestion={suggestion} currentCategoryId={currentCategoryId} onReplace={() => {}} onReview={() => {}} />);

it('비어 있던 대표 카테고리를 채웠을 때와 바꾸기를 제안할 때의 안내를 구분한다', () => {
  expect(render(null)).toBe('');
  expect(render({ kind: 'filled', categoryId: 'leaf', path: '문구 > 노트' })).toContain('고른 ERP 품목의 ERP 분류에 연결된 카테고리로 대표 카테고리를 채웠습니다. 다른 카테고리로 바꿔도 됩니다.');
  const offer = render({ kind: 'offer', categoryId: 'leaf', path: '문구 > 노트' }, 'other');
  expect(offer).toContain('대표 카테고리는 그대로 두었습니다.');
  expect(offer).toContain('대표 카테고리를 &#x27;문구 &gt; 노트&#x27;로 바꾸기');
  expect(render({ kind: 'offer', categoryId: 'leaf', path: '문구 > 노트' }, 'leaf')).toContain('대표 카테고리를 ERP 분류에 연결된 카테고리로 바꿨습니다.');
});

it('연결된 고객 카테고리가 없으면 ERP 원문과 연결 방법을 안내한다', () => {
  expect(render({ kind: 'unmapped', erpCategory: 'ERP 문구' })).toContain('ERP 분류: ERP 문구 — 이 분류에 연결된 고객 카테고리가 없습니다.');
  expect(render({ kind: 'unavailable', erpCategory: 'ERP 문구' })).toContain('대표 카테고리를 채우지 않았습니다');
  expect(render({ kind: 'same', path: '문구 > 노트' })).toContain('대표 카테고리가 ERP 분류에 연결된 카테고리와 같습니다.');
});
