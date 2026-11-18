import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({ canView: false, marketEnabled: true }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/collectible-features.server', () => ({
  isCollectibleFeatureEnabled: async (feature: string) => feature === 'market' && mocks.marketEnabled,
}));
vi.mock('@/lib/secondary-market-demo.server', () => ({
  canViewSecondaryMarketDemo: async () => mocks.canView,
}));
vi.mock('@/components/screens/Market', () => ({ Market: () => <div data-surface="placeholder" /> }));
vi.mock('@/components/screens/MarketDemo', () => ({ MarketDemo: () => <div data-surface="demo" /> }));

beforeEach(() => {
  mocks.canView = false;
  mocks.marketEnabled = true;
});

/* 굿즈 마켓 공개 스위치가 켜져 있으면 공개 표면은 v2 플레이스홀더 그대로이고, 서버 게이트가 참일 때만 같은 라우트가 시연을 렌더한다. */
describe('/market', () => {
  it('일반 방문자에게는 플레이스홀더를 그린다', async () => {
    expect(renderToStaticMarkup(await Page())).toContain('data-surface="placeholder"');
  });

  it('staff/admin 에게는 시연 화면을 그린다', async () => {
    mocks.canView = true;
    expect(renderToStaticMarkup(await Page())).toContain('data-surface="demo"');
  });

  /* 운영하지 않는 동안(DB 공개 스위치 기본값)은 누구에게나 404다 — 스태프 시연도 함께 닫힌다. */
  it('굿즈 마켓이 숨김이면 일반 방문자·staff 모두 404다', async () => {
    mocks.marketEnabled = false;
    await expect(Page()).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.canView = true;
    await expect(Page()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
