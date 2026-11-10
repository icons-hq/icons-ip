import { describe, expect, it, vi } from 'vitest';
import { safeShoppingStoryLink, sanitizeShoppingStoryContent } from './shopping-stories-content';
vi.mock('./media', () => ({ publicMediaUrl: (path: string) => `https://media.example.test/${path}` }));
const image = 'public-media/catalog/curation/11111111-1111-4111-8111-111111111111.webp';
describe('shopping story safe document boundary', () => {
  it('drops active content, styles, embedded resources and external links on save and render', () => {
    const result = sanitizeShoppingStoryContent('<h1 style="color:red">제목</h1><script>alert(1)</script><iframe src="https://evil.test">secret</iframe><p onclick="bad()">본문 <a href="https://evil.test">외부</a><a href="/shop/safe">상품</a></p><img src="https://evil.test/a.png">');
    expect(result.html).toContain('<h2>제목</h2>'); expect(result.html).toContain('href="/shop/safe"');
    for (const text of ['script','iframe','onclick','style=','evil.test','alert(1)','secret']) expect(result.html).not.toContain(text);
    expect(result.warnings.length).toBeGreaterThan(0); expect(result.description).toBe('제목 본문 외부상품');
  });
  it('blocks decoded and dot-segment administrative paths', () => {
    for (const value of ['/admin','/admin?x=1','/api/ping','/%61dmin/users','/shop/../admin','/%2e%2e/api/a','//evil.test','/\\evil.test','/%2fexample.test']) expect(safeShoppingStoryLink(value), value).toBe(false);
    for (const value of ['/shop/a','/stories?id=a','/ips/example']) expect(safeShoppingStoryLink(value)).toBe(true);
  });
  it('uses only attached images and the first visible image for the summary', () => {
    const raw = `<p>안녕 &amp; &lt;script&gt; &amp;lt;</p><img src="${image}" onerror="bad()" alt="설명"><img src="${image.replace('11111111-','22222222-')}" />`;
    const saved = sanitizeShoppingStoryContent(raw, { imagePaths: [image] });
    expect(saved.imagePaths).toEqual([image]); expect(saved.representativeImagePath).toBe(image); expect(saved.text).toBe('안녕 & <script> &lt;');
    const publicResult = sanitizeShoppingStoryContent(saved.html, { imagePaths: [image], renderImages: true });
    expect(publicResult.html).toContain(`https://media.example.test/${image}`); expect(publicResult.html).not.toContain('onerror');
    expect(sanitizeShoppingStoryContent(saved.html, { imagePaths: [] }).imagePaths).toEqual([]);
  });
  it('limits actual image occurrences and extracts one escaping layer of text', () => {
    const result = sanitizeShoppingStoryContent(`<img src="${image}">`.repeat(22));
    expect(result.html.match(/<img/g)).toHaveLength(20); expect(result.imagePaths).toEqual([image]); expect(result.description).toBe('');
    expect(sanitizeShoppingStoryContent('<p>'+'가'.repeat(161)+'</p>').description).toHaveLength(160);
    expect(sanitizeShoppingStoryContent('<p>&amp;lt;img onerror=bad&amp;gt;</p>').description).toBe('&lt;img onerror=bad&gt;');
  });
});
