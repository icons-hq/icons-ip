import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 모듈 상태(전송 줄·동의 표식)를 시험마다 새로 받는다. */
async function load() {
  vi.resetModules();
  return import('./store-analytics-client');
}

describe('셸 공지 노출·클릭 전송', () => {
  const fetchMock = vi.fn(async () => new Response('{}'));
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('동의·수집 사용이 확인되기 전에는 보내지 않는다', async () => {
    const client = await load();
    client.recordShellNoticeEvent('33333333-3333-4333-8333-333333333333', 'impression');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.storeAnalyticsCollecting()).toBe(false);
  });

  const sentBodies = () => fetchMock.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));

  it('페이지뷰 수집이 줄에서 끝난 뒤 같은 줄로 공지 사건을 보낸다(keepalive, 고정 모양)', async () => {
    const client = await load();
    client.beginShellNoticePageView('/');
    const order: string[] = [];
    let release!: () => void;
    client.enqueueStoreAnalytics(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      order.push('page-view');
      client.setStoreAnalyticsCollecting(true);
    });
    client.recordShellNoticeEvent('33333333-3333-4333-8333-333333333333', 'impression');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['page-view']);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/store-analytics');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', keepalive: true });
    expect(sentBodies()[0]).toEqual({ action: 'notice', event: { eventId: expect.stringMatching(/^[0-9a-f-]{36}$/), curationId: '33333333-3333-4333-8333-333333333333', interaction: 'impression' } });
  });

  it('노출을 보낸 화면의 클릭은 클릭만, 동의 전에 보여 노출을 못 보낸 공지는 클릭 직전에 노출을 한 번 보낸다', async () => {
    const client = await load();
    const ID = '33333333-3333-4333-8333-333333333333';
    client.beginShellNoticePageView('/');
    client.recordShellNoticeEvent(ID, 'impression'); // 동의 전 — 보내지 않는다
    client.setStoreAnalyticsCollecting(true);
    client.recordShellNoticeEvent(ID, 'click');
    /* 클릭이 화면을 바꿔 다음 화면이 시작돼도 클릭한 화면 기준으로 판단한다. */
    client.beginShellNoticePageView('/legal/terms');
    const done = vi.fn();
    client.enqueueStoreAnalytics(async () => done());
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(sentBodies().map((body) => body.event.interaction)).toEqual(['impression', 'click']);

    fetchMock.mockClear();
    client.beginShellNoticePageView('/shop/g1');
    client.recordShellNoticeEvent(ID, 'impression');
    client.recordShellNoticeEvent(ID, 'click');
    client.beginShellNoticePageView('/events');
    const after = vi.fn();
    client.enqueueStoreAnalytics(async () => after());
    await vi.waitFor(() => expect(after).toHaveBeenCalled());
    expect(sentBodies().map((body) => body.event.interaction)).toEqual(['impression', 'click']);
  });

  it('철회되면 줄에 남은 공지 사건도 보내지 않고, 전송 실패가 다음 일을 막지 않는다', async () => {
    const client = await load();
    client.setStoreAnalyticsCollecting(true);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    client.recordShellNoticeEvent('33333333-3333-4333-8333-333333333333', 'impression');
    client.enqueueStoreAnalytics(async () => client.setStoreAnalyticsCollecting(false));
    client.recordShellNoticeEvent('33333333-3333-4333-8333-333333333333', 'impression');
    const done = vi.fn();
    client.enqueueStoreAnalytics(async () => done());
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
