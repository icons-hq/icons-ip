import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('@/lib/media', () => ({ publicMediaUrl: (path: string) => `https://cdn.example/${path}` }));
import { GoodsBenefitContent } from './GoodsBenefitContent';
it('shows only supplied benefit text and bounded images with safe escaped copy', () => {
  const html = renderToStaticMarkup(<GoodsBenefitContent value={{ eventText: '<script>bad</script>', giftText: '사은품을 안내합니다.', giftImagePaths: ['public-media/catalog/good/93800000-0000-4000-8000-000000000777.webp'] }} />);
  expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;'); expect(html).not.toContain('<script>');
  expect(html).toContain('사은품 이미지 1 새 창에서 보기'); expect(html).toContain('width="72"');
  expect(html).not.toMatch(/자동 지급|재고 차감|updatedBy|revision/);
});
it('does not render an empty informational block', () => {
  expect(renderToStaticMarkup(<GoodsBenefitContent value={null} />)).toBe('');
  expect(renderToStaticMarkup(<GoodsBenefitContent value={{ eventText: '', giftText: '', giftImagePaths: [] }} />)).toBe('');
});
