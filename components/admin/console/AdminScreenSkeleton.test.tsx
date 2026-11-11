import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminEntryFallback, AdminScreenSkeleton } from './AdminScreenSkeleton';

describe('AdminScreenSkeleton', () => {
  it.each(['list', 'chat', 'home'] as const)('%s: 낭독되지 않는 kit 골격만 그린다', (kind) => {
    const html = renderToStaticMarkup(<AdminScreenSkeleton kind={kind} />);
    expect(html).toMatch(new RegExp(`aria-hidden="true"[^>]*data-admin-screen-skeleton="${kind}"`));
    expect(html).toContain('data-slot="skeleton"');
    expect(html).not.toContain('role=');
    expect(html.replace(/<[^>]+>/g, '')).toBe('');
  });

  it('기본은 조회 카드·건수·표 배치다', () => {
    const html = renderToStaticMarkup(<AdminScreenSkeleton />);
    expect(html).toContain('data-admin-screen-skeleton="list"');
    expect(html.match(/data-slot="skeleton"/g)!.length).toBeGreaterThan(20);
  });

  it('상담하기는 본문 전체 높이의 세 칸이다', () => {
    const html = renderToStaticMarkup(<AdminScreenSkeleton kind="chat" />);
    expect(html).toContain('h-full min-h-0');
    expect(html).toContain('xl:grid-cols-[16rem_minmax(0,1fr)_18rem]');
  });
});

describe('AdminEntryFallback', () => {
  it('쇼핑몰 모양 없이 콘솔 토큰의 빈 바탕이다', () => {
    const html = renderToStaticMarkup(<AdminEntryFallback />);
    expect(html).toContain('class="wc-admin min-h-svh bg-sidebar"');
    expect(html).toContain('data-admin-entry-fallback=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('wc-root');
    expect(html).not.toContain('wc-skeleton');
  });
});
