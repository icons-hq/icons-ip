import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CategoryTemplatesScreen } from './CategoryTemplatesScreen';

it('uses a search region with non-submit buttons when embedded in a product picker', () => {
  const picker = renderToStaticMarkup(<CategoryTemplatesScreen onSelect={() => {}} />);
  expect(picker).not.toContain('<form');
  expect(picker).toContain('role="search"');
  expect(picker).toContain('type="button"');
  expect(picker).not.toContain('카테고리 템플릿 등록');
  const management = renderToStaticMarkup(<CategoryTemplatesScreen />);
  expect(management).toContain('<form');
  expect(management).toContain('카테고리 템플릿 등록');
});
