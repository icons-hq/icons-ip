import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { FandomEvent } from '@/lib/data';
import Page from './page';

/* 오프라인 팝업 목록이 화면에 무엇을 넘기는지가 계약이다 — 목록 렌더는 Events 가
   따로 검증한다. 여기서는 온라인 이벤트가 이 표면에 닿지 않는지만 본다. */
const mocks = vi.hoisted(() => ({
  catalog: null as CatalogSnapshot | null,
  gameLinks: [] as { eventId: string; gameId: string; title: string }[],
  screen: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('@/components/screens/Events', () => ({ Events: mocks.screen }));
vi.mock('@/lib/catalog', () => ({ getCatalogSnapshot: () => mocks.catalog }));
vi.mock('@/lib/games/catalog', () => ({ listEventGameLinks: async () => mocks.gameLinks }));

function event(id: string, overrides: Partial<FandomEvent> = {}): FandomEvent {
  return {
    id,
    title: `이벤트 ${id}`,
    ip: 'ip1',
    mode: '오프라인',
    status: '예매중',
    date: '7.25',
    loc: '성수',
    accent: '#38F0C0',
    img: 'linear-gradient(#111, #222)',
    ...overrides,
  };
}

function snapshot(events: FandomEvent[]): CatalogSnapshot {
  return { source: 'mock', verticals: [], ips: [], goods: [], cards: [], events };
}

function pageProps(searchParams: Record<string, string | string[] | undefined> = {}) {
  return { searchParams: Promise.resolve(searchParams) } as Parameters<typeof Page>[0];
}

function passedProps() {
  return mocks.screen.mock.calls[0]?.[0] ?? {};
}

function passedEventIds() {
  return ((passedProps().catalog as { events: FandomEvent[] }).events).map((e) => e.id);
}

beforeEach(() => {
  mocks.catalog = snapshot([]);
  mocks.gameLinks = [];
  mocks.screen.mockClear();
});

describe('/offline-popups 목록', () => {
  /* 시드에 mode='온라인' 이벤트가 실제로 있다(e2·e5). 그대로 넘기면 "오프라인 팝업"
     제목 아래에 현장 안내를 붙일 수 없는 줄이 예매 CTA 를 달고 나온다. */
  it('온라인 이벤트를 목록에서 뺀다', async () => {
    mocks.catalog = snapshot([
      event('e1'),
      event('e2', { mode: '온라인' }),
      event('e3'),
    ]);

    renderToStaticMarkup(await Page(pageProps()));

    expect(passedEventIds()).toEqual(['e1', 'e3']);
  });

  /* 거르는 것은 events 뿐이다 — 스냅샷을 새로 짜지 않고 그 필드만 갈아 끼운다. */
  it('이벤트 말고 나머지 카탈로그와 게임 링크는 그대로 넘긴다', async () => {
    mocks.catalog = snapshot([event('e1')]);
    mocks.gameLinks = [{ eventId: 'e1', gameId: 'g1', title: '미니 게임' }];

    renderToStaticMarkup(await Page(pageProps()));

    const props = passedProps();
    expect((props.catalog as CatalogSnapshot).source).toBe('mock');
    expect(props.gameLinks).toEqual(mocks.gameLinks);
  });

  it('오프라인 이벤트가 있는 IP 로 열면 그 IP 를 선택한 채 연다', async () => {
    mocks.catalog = snapshot([event('e1', { ip: 'ip1' })]);

    renderToStaticMarkup(await Page(pageProps({ ip: 'ip1' })));

    expect(passedProps().initialIpId).toBe('ip1');
  });

  /* 온라인 이벤트만 가진 IP 로 들어오면 고를 수 없는 필터가 눌린 채 빈 목록이 뜬다 —
     검증도 걸러낸 배열 기준이어야 한다. */
  it('온라인 이벤트만 가진 IP 는 선택하지 않는다', async () => {
    mocks.catalog = snapshot([event('e2', { ip: 'ip9', mode: '온라인' })]);

    renderToStaticMarkup(await Page(pageProps({ ip: 'ip9' })));

    expect(passedProps().initialIpId).toBeUndefined();
    expect(passedEventIds()).toEqual([]);
  });

  it('같은 키가 여러 번 온 ip 파라미터는 첫 값만 본다', async () => {
    mocks.catalog = snapshot([event('e1', { ip: 'ip1' })]);

    renderToStaticMarkup(await Page(pageProps({ ip: ['ip1', 'ip2'] })));

    expect(passedProps().initialIpId).toBe('ip1');
  });
});
