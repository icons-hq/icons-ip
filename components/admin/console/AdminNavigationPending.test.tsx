import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminNavigationPending } from '@/lib/admin/navigation-pending';

const mocks = vi.hoisted(() => ({ snapshot: null as AdminNavigationPending | null }));

/* renderToStaticMarkup은 서버 스냅샷만 읽으므로, 단계별 화면을 보려고 구독 값만 저장소에서 바로 읽게 한다. */
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
vi.mock('@/lib/admin/navigation-pending', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin/navigation-pending')>('@/lib/admin/navigation-pending');
  return {
    ...actual,
    createAdminNavigationPendingStore: () => ({
      subscribe: () => () => {},
      getSnapshot: () => mocks.snapshot ?? actual.ADMIN_NAVIGATION_IDLE,
      routeChanged: () => {},
      start: () => {},
      finish: () => {},
      restoreFocus: () => {},
      connect: () => () => {},
    }),
  };
});

import { AdminNavigationBody, AdminNavigationIndicators, AdminNavigationPendingProvider } from './AdminNavigationPending';

function render(snapshot: AdminNavigationPending | null, children: ReactNode) {
  mocks.snapshot = snapshot;
  return renderToStaticMarkup(<AdminNavigationPendingProvider currentPath="/admin/a">{children}</AdminNavigationPendingProvider>);
}

const pending = (stage: AdminNavigationPending['stage'], barVisible: boolean): AdminNavigationPending => ({ path: '/admin/b', href: 'https://icons.test/admin/b', stage, barVisible });

describe('본문 칸', () => {
  it('평소에는 잠기지 않고 낭독 칸만 비어 있다', () => {
    const html = render(null, <AdminNavigationBody className="x"><p>본문</p></AdminNavigationBody>);
    expect(html).toContain('role="status"></p>');
    expect(html).not.toContain('inert');
    expect(html).not.toContain('opacity-60');
    expect(html).toContain('<p>본문</p>');
  });

  it('1초 미만 단계에서는 흐리지 않는다', () => {
    for (const stage of ['waiting', 'bar'] as const) {
      const html = render(pending(stage, stage === 'bar'), <AdminNavigationBody><p>본문</p></AdminNavigationBody>);
      expect(html).not.toContain('inert');
      expect(html).toContain('role="status"></p>');
    }
  });

  it('1초가 지나면 이전 본문을 흐리고 잠그며 안내를 넣는다', () => {
    const html = render(pending('dim', true), <AdminNavigationBody className="x"><p>본문</p></AdminNavigationBody>);
    expect(html).toMatch(/<div class="x opacity-60 transition-opacity duration-150 ease-in" data-admin-nav-dimmed="" inert="">/);
    expect(html).toContain('화면을 불러오는 중입니다.');
    expect(html).toContain('<p>본문</p>');
  });

  it('흐림은 대기가 끝나면 전환 없이 사라진다 — 전환 속성은 흐린 동안에만 있다', () => {
    const html = render(null, <AdminNavigationBody className="x"><p>본문</p></AdminNavigationBody>);
    expect(html).toContain('<div class="x">');
  });
});

describe('진행 표시', () => {
  it('대기가 없거나 500ms 전이면 그리지 않는다', () => {
    expect(render(null, <AdminNavigationIndicators />)).toBe('');
    expect(render(pending('waiting', false), <AdminNavigationIndicators />)).toBe('');
  });

  it('2px 점근 막대는 본문 영역 위에만 붙는다(높이 0 컨테이너)', () => {
    const html = render(pending('bar', true), <AdminNavigationIndicators />);
    expect(html).toContain('sticky top-12');
    expect(html).toContain('h-0');
    expect(html).toContain('data-admin-nav-progress="running"');
    expect(html).toContain('h-0.5');
    expect(html).toContain('aria-hidden="true"');
  });

  it('대기가 끝나고 최소 시간만 남았으면 마무리 상태다', () => {
    const html = render({ path: null, href: null, stage: 'idle', barVisible: true }, <AdminNavigationIndicators />);
    expect(html).toContain('data-admin-nav-progress="finishing"');
    expect(html).toContain('scale-x-100');
  });

  it('10초가 지나면 지연 안내와 다시 시도를 잠금 밖에 보인다', () => {
    const html = render(pending('slow', true), <AdminNavigationIndicators />);
    expect(html).toContain('응답이 늦어지고 있습니다');
    expect(html).toContain('다시 시도');
    expect(html).toContain('type="button"');
  });

  /* 본문 상단 요약 글자를 가렸다. */
  it('지연 안내는 본문을 가리지 않게 오른쪽 아래 구석에 뜬다', () => {
    const html = render(pending('slow', true), <AdminNavigationIndicators />);
    const box = html.match(/<div[^>]*data-admin-nav-slow=""[^>]*>/)?.[0] ?? '';
    expect(box).toContain('fixed');
    expect(box).toContain('right-4');
    expect(box).toContain('bottom-4');
    expect(html).not.toContain('top-3');
  });
});
