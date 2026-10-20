import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { GoodSizeChart } from './GoodSizeChart';
it('renders one accessible read-only table with exact decimal text and unit', () => {
  const html = renderToStaticMarkup(<GoodSizeChart chart={{ unit: 'mm', sizes: ['단일', '확장'], measurements: [{ name: '가로', values: ['37.4', '63'] }], note: '합성 측정\n안내' }} />);
  expect(html).toContain('단위: mm'); expect(html).toContain('scope="col"'); expect(html).toContain('scope="row"');
  expect(html).toContain('37.4'); expect(html).toContain('tabindex="0"'); expect(html).toContain('합성 측정\n안내');
  expect(html).not.toContain('<button'); expect(html).not.toContain('<input');
  expect(renderToStaticMarkup(<GoodSizeChart chart={null} />)).toBe('');
});
