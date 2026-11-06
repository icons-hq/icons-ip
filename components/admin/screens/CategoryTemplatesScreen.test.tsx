import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CategoryTemplatesScreen } from './CategoryTemplatesScreen';

it('uses a search region with non-submit buttons when embedded in a product picker', () => {
  const picker = renderToStaticMarkup(<CategoryTemplatesScreen onSelect={() => {}} />);
  expect(picker).not.toContain('<form');
  expect(picker).toContain('role="search"');
  expect(picker).toContain('type="button"');
  expect(picker).toMatch(/<button(?=[^>]*type="button")[^>]*>검색<\/button>/);
  expect(picker).not.toContain('카테고리 템플릿 등록');
  const management = renderToStaticMarkup(<CategoryTemplatesScreen />);
  expect(management).toContain('<form');
  // 관리 화면의 검색은 폼 제출이다(kit 버튼의 기본 type은 button).
  expect(management).toMatch(/<button(?=[^>]*type="submit")[^>]*>검색<\/button>/);
  expect(management).toContain('카테고리 템플릿 등록');
});
