import { describe, expect, it } from 'vitest';
import { sanitizeGoodsDescription } from './goods-description';
import { sanitizeShoppingStoryContent } from './shopping-stories-content';
import { CONTENT_DIVIDER_STYLES, CONTENT_QUOTE_STYLES, cleanContentFormat, sanitizedContentFormat } from './content-format';

describe.each([
  ['goods', sanitizeGoodsDescription], ['story', sanitizeShoppingStoryContent],
] as const)('%s closed document formats', (_kind, clean) => {
  it('retains formats through save, second sanitization and public render', () => {
    const html = '<p data-icons-align="right" data-icons-size="24"><strong>제품 &amp; 이야기</strong></p><span data-icons-size="14">작은 글</span>';
    const saved = clean(html);
    expect(saved.html).toBe(html);
    expect(saved.warnings).toEqual([]);
    expect(clean(saved.html, { renderImages: true }).html).toBe(html);
    expect(clean(saved.html).html).toBe(html);
  });
  it.each(CONTENT_QUOTE_STYLES)('preserves quote %s without allowing arbitrary classes', style => {
    const result = clean(`<blockquote data-icons-quote="${style}" class="admin-nav" onclick="alert(1)">인용</blockquote>`);
    expect(result.html).toBe(`<blockquote data-icons-quote="${style}">인용</blockquote>`);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it.each(CONTENT_DIVIDER_STYLES)('preserves divider %s', style => {
    expect(clean(`<hr data-icons-divider="${style}">`).html).toBe(`<hr data-icons-divider="${style}" />`);
  });
  it('normalizes headings/wrappers and removes invalid attributes even on specific transforms', () => {
    const result = clean('<h1 data-icons-size="999" data-icons-align="right" style="color:red">큰 제목</h1><div data-icons-size="24" data-icons-quote="bubble">본문</div><span data-icons-align="url(https://bad)">글</span>');
    expect(result.html).toContain('<h2 data-icons-align="right">큰 제목</h2>');
    expect(result.html).toContain('data-icons-size="24"');
    for (const invalid of ['999', 'bubble', 'url(', 'style=']) expect(result.html).not.toContain(invalid);
  });
  it.each(['20px', ' 20', '20 ', '1e2', 'toString', '__proto__', '20;position:fixed', '20&quot; onclick=&quot;alert(1)'])('rejects non-enumerated size %s', value => {
    const result = clean(`<p data-icons-size="${value}" data-icons-align="center">본문</p>`);
    expect(result.html).toBe('<p data-icons-align="center">본문</p>');
  });
  it('rejects format names on the wrong tag and all wildcard data attributes', () => {
    expect(clean('<p data-icons-divider="line" data-icons-custom="x">내용</p><hr data-icons-align="left"><strong data-icons-size="24">강조</strong>').html)
      .toBe('<p>내용</p><hr /><strong>강조</strong>');
  });
  it('does not weaken the URL or active-content boundary', () => {
    const result = clean('<p data-icons-size="24"><script>x()</script><svg onload="x()"></svg><a href="javascript:alert(1)">링크</a><img src="data:image/svg+xml,bad"></p>');
    expect(result.html).toContain('data-icons-size="24"');
    for (const invalid of ['script', 'svg', 'javascript', 'onload', '<img']) expect(result.html).not.toContain(invalid);
  });
});

it('does not inherit attributes and retains unrelated attrs only for the caller allowlist', () => {
  expect(sanitizedContentFormat('p', Object.create({ 'data-icons-size': '24' }))).toEqual({});
  expect(cleanContentFormat('p', { 'data-icons-size': '20', 'data-icons-unknown': 'x', id: 'unsafe' }))
    .toEqual({ 'data-icons-size': '20', id: 'unsafe' });
});
