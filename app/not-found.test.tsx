import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import NotFound from './not-found';

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));

describe('404 기본 표면 (CH-14)', () => {
  it('h1 제목·안내·2CTA를 404 표면 훅 안에 세우고, 일러스트 자리는 비워 둔다', () => {
    const html = renderToStaticMarkup(<NotFound />);

    expect(html).toContain('<div class="wc-fallback wc-not-found">');
    expect(html).toContain('<h1 class="wc-empty__title">페이지를 찾을 수 없습니다</h1>');
    expect(html).toContain('주소가 바뀌었거나 삭제된 페이지예요.');
    expect(html).toContain('이전 페이지');
    expect(html).toContain('href="/"');
    expect(html).toContain('메인으로');
    /* LG-7 자산 전까지 대체 그림·빈 상자를 두지 않는다. */
    expect(html).not.toMatch(/<img|<svg|wc-not-found__art/);
  });
});
