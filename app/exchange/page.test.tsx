import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({ canView: false }));

vi.mock('@/lib/secondary-market-demo.server', () => ({
  canViewSecondaryMarketDemo: async () => mocks.canView,
}));
vi.mock('@/components/screens/Exchange', () => ({ Exchange: () => <div data-surface="placeholder" /> }));
vi.mock('@/components/screens/ExchangeDemo', () => ({ ExchangeDemo: () => <div data-surface="demo" /> }));

beforeEach(() => {
  mocks.canView = false;
});

/* 공개 표면은 v2 플레이스홀더 그대로이고, 서버 게이트가 참일 때만 같은 라우트가 시연을 렌더한다. */
describe('/exchange', () => {
  it('일반 방문자에게는 플레이스홀더를 그린다', async () => {
    expect(renderToStaticMarkup(await Page())).toContain('data-surface="placeholder"');
  });

  it('staff/admin 에게는 시연 화면을 그린다', async () => {
    mocks.canView = true;
    expect(renderToStaticMarkup(await Page())).toContain('data-surface="demo"');
  });
});
