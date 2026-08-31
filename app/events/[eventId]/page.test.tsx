import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { FandomEvent } from '@/lib/data';
import Page from './page';

/* 실제 notFound·permanentRedirect는 throw로 렌더를 끊는다. 대역이 그냥 반환하면
   미존재 id에서도 아래 리다이렉트까지 실행돼 계약이 거꾸로 통과한다 — 대역도 throw한다. */
const mocks = vi.hoisted(() => ({
  catalog: null as CatalogSnapshot | null,
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  permanentRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  permanentRedirect: mocks.permanentRedirect,
}));
vi.mock('@/lib/catalog', () => ({ getCatalogSnapshot: () => mocks.catalog }));

const event: FandomEvent = {
  id: 'e100',
  title: '테스트 팝업',
  ip: 'ip100',
  mode: '오프라인',
  status: '예매중',
  date: '7.25',
  loc: '성수',
  accent: '#38F0C0',
  img: 'linear-gradient(#111, #222)',
};

function snapshot(events: FandomEvent[]): CatalogSnapshot {
  return { source: 'mock', verticals: [], ips: [], goods: [], cards: [], events };
}

describe('/events/[eventId] 레거시 브리지', () => {
  beforeEach(() => {
    mocks.notFound.mockClear();
    mocks.permanentRedirect.mockClear();
    mocks.catalog = snapshot([event]);
  });

  it('저장된 오프라인 팝업 딥링크를 새 경로로 영구 이전한다', async () => {
    await expect(Page({ params: Promise.resolve({ eventId: event.id }) }))
      .rejects.toThrow(`NEXT_REDIRECT:/offline-popups/${event.id}`);

    expect(mocks.permanentRedirect).toHaveBeenCalledWith(`/offline-popups/${event.id}`);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it('경로 세그먼트를 인코딩해 넘긴다', async () => {
    mocks.catalog = snapshot([{ ...event, id: 'e 100/x' }]);

    await expect(Page({ params: Promise.resolve({ eventId: 'e 100/x' }) }))
      .rejects.toThrow('NEXT_REDIRECT:/offline-popups/e%20100%2Fx');
  });

  it('카탈로그에 없는 id는 리다이렉트하지 않고 404로 끝낸다', async () => {
    await expect(Page({ params: Promise.resolve({ eventId: 'missing' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND');

    expect(mocks.notFound).toHaveBeenCalled();
    expect(mocks.permanentRedirect).not.toHaveBeenCalled();
  });
});
