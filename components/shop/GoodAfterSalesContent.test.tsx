import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { GoodAfterSalesContent } from './GoodAfterSalesContent';
it('renders saved customer guidance as plain multiline text and omits absent content', () => {
  expect(renderToStaticMarkup(<GoodAfterSalesContent value={null} />)).toBe('');
  expect(renderToStaticMarkup(<GoodAfterSalesContent value={{ phone: '', guide: '', sellerSpecialNotes: '' }} />)).toBe('');
  const html = renderToStaticMarkup(<GoodAfterSalesContent value={{ phone: '02-123', guide: '첫 줄\n둘째 줄', sellerSpecialNotes: '<script>alert(1)</script>' }} />);
  expect(html).toContain('첫 줄\n둘째 줄'); expect(html).toContain('판매자 특이사항'); expect(html).not.toContain('<script>');
  expect(html.indexOf('A/S 안내')).toBeLessThan(html.indexOf('판매자 특이사항'));
});
