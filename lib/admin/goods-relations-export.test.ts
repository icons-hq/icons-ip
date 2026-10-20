import { expect, it } from 'vitest';
import { goodsRelationsExportHref } from './goods-relations-export';
it('파일 링크는 검색·유형·상태를 보존하고 화면 페이지를 제외한다', () => {
  const url = new URL(goodsRelationsExportHref({ query: '상품 & 사진', kind: 'codi', state: 'scheduled', page: 8, pageSize: 50 }), 'https://example.test');
  expect(Object.fromEntries(url.searchParams)).toEqual({ q: '상품 & 사진', kind: 'codi', state: 'scheduled' });
});
