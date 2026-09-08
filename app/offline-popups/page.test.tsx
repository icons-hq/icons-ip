import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FandomEvent, Ip } from '@/lib/data';
import Page from './page';

/* 오프라인 팝업 목록이 화면에 무엇을 넘기는지가 계약이다 — 목록 렌더는 Events 가
   따로 검증한다. 여기서는 온라인 이벤트가 이 표면에 닿지 않는지만 본다. */
const mocks = vi.hoisted(() => ({
  events: [] as FandomEvent[],
  ips: [] as Ip[],
  eventsPage: vi.fn(),
  gameLinks: [] as { eventId: string; gameId: string; title: string }[],
  screen: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('@/components/screens/Events', () => ({ Events: mocks.screen }));
/* 온라인 제외·정렬·자르기는 이제 서버가 한다(규모 후속) — 화면은 받은 판을 그대로 넘긴다. */
vi.mock('@/lib/storefront.server', () => ({ getStorefrontEventsPage: mocks.eventsPage }));
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

function serverPage(events: FandomEvent[], ips: Ip[] = []) {
  return { events, ips, total: events.length };
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
  mocks.gameLinks = [];
  mocks.screen.mockClear();
  mocks.eventsPage.mockReset();
  mocks.eventsPage.mockResolvedValue(serverPage([]));
});

describe('/offline-popups 목록', () => {
  /* 시드에 mode='온라인' 이벤트가 실제로 있다(e2·e5). 그대로 넘기면 "오프라인 팝업"
     제목 아래에 현장 안내를 붙일 수 없는 줄이 예매 CTA 를 달고 나온다.
     **거르는 자리는 서버다** — 페이지를 자른 뒤 화면에서 거르면 한 페이지가 통째로 빈다. */
  it('온라인 제외를 서버에 맡긴다', async () => {
    mocks.eventsPage.mockResolvedValue(serverPage([event('e1'), event('e3')]));

    renderToStaticMarkup(await Page(pageProps()));

    expect(mocks.eventsPage).toHaveBeenCalledWith({ excludeMode: '온라인' });
    expect(passedEventIds()).toEqual(['e1', 'e3']);
  });

  it('받은 IP 와 게임 링크를 그대로 넘긴다', async () => {
    const ip = { id: 'ip1', title: 'IP 하나' } as unknown as Ip;
    mocks.eventsPage.mockResolvedValue(serverPage([event('e1')], [ip]));
    mocks.gameLinks = [{ eventId: 'e1', gameId: 'g1', title: '미니 게임' }];

    renderToStaticMarkup(await Page(pageProps()));

    const props = passedProps();
    expect((props.catalog as { ips: Ip[] }).ips).toEqual([ip]);
    expect(props.gameLinks).toEqual(mocks.gameLinks);
  });

  it('오프라인 이벤트가 있는 IP 로 열면 그 IP 를 선택한 채 연다', async () => {
    mocks.eventsPage.mockResolvedValue(serverPage([event('e1', { ip: 'ip1' })]));

    renderToStaticMarkup(await Page(pageProps({ ip: 'ip1' })));

    expect(passedProps().initialIpId).toBe('ip1');
  });

  /* 온라인 이벤트만 가진 IP 로 들어오면 고를 수 없는 필터가 눌린 채 빈 목록이 뜬다 —
     검증도 걸러낸 배열 기준이어야 한다. */
  it('온라인 이벤트만 가진 IP 는 선택하지 않는다', async () => {
    /* 서버가 이미 뺐으므로 목록은 비어 있다 — 그래도 칩이 눌린 채 열리면 안 된다. */
    mocks.eventsPage.mockResolvedValue(serverPage([]));

    renderToStaticMarkup(await Page(pageProps({ ip: 'ip9' })));

    expect(passedProps().initialIpId).toBeUndefined();
    expect(passedEventIds()).toEqual([]);
  });

  it('같은 키가 여러 번 온 ip 파라미터는 첫 값만 본다', async () => {
    mocks.eventsPage.mockResolvedValue(serverPage([event('e1', { ip: 'ip1' })]));

    renderToStaticMarkup(await Page(pageProps({ ip: ['ip1', 'ip2'] })));

    expect(passedProps().initialIpId).toBe('ip1');
  });
});
