import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 모듈 상태(전송 줄·동의 표식·노출 화면)를 시험마다 새로 받는다. */
async function load() {
  vi.resetModules();
  return import('./store-analytics-client');
}
type Client = Awaited<ReturnType<typeof load>>;

const A = '33333333-3333-4333-8333-333333333333';
const B = '44444444-4444-4444-8444-444444444444';

/* 줄에 선 일이 모두 끝날 때까지 기다린다. */
async function settle(client: Client) {
  const done = vi.fn();
  client.enqueueStoreAnalytics(async () => done());
  await vi.waitFor(() => expect(done).toHaveBeenCalled());
}

describe('셸 공지 노출·클릭 전송', () => {
  const order: string[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    order.push(`${body.event.interaction}:${body.event.curationId.slice(0, 1)}`);
    return new Response('{}');
  });
  beforeEach(() => {
    fetchMock.mockClear();
    order.length = 0;
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const sentBodies = () => fetchMock.mock.calls.map((call) => JSON.parse(String(call[1].body)));
  /* 다음 한 번만 서버가 받지 않은 것처럼 답한다(보낸 순서 기록은 그대로). */
  const rejectNext = (status: number, body: string) => fetchMock.mockImplementationOnce(async (_url, init) => {
    const sent = JSON.parse(String(init.body));
    order.push(`${sent.event.interaction}:${sent.event.curationId.slice(0, 1)}`);
    return new Response(body, { status });
  });

  it('동의·수집 사용이 확인되기 전에는 보내지 않는다', async () => {
    const client = await load();
    client.enterShellNoticeView('/');
    client.recordShellNoticeEvent(A, 'impression');
    await settle(client);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.storeAnalyticsCollecting()).toBe(false);
  });

  it('페이지뷰 수집이 줄에서 끝난 뒤 같은 줄로 공지 사건을 보낸다(keepalive, 고정 모양)', async () => {
    const client = await load();
    client.enterShellNoticeView('/');
    let release!: () => void;
    client.enqueueStoreAnalytics(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      order.push('page-view');
      client.setStoreAnalyticsCollecting(true);
    });
    client.recordShellNoticeEvent(A, 'impression');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['page-view', 'impression:3']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/store-analytics');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', keepalive: true });
    expect(sentBodies()[0]).toEqual({ action: 'notice', event: { eventId: expect.stringMatching(/^[0-9a-f-]{36}$/), curationId: A, interaction: 'impression' } });
  });

  /* 하드 로드에서는 셸 공지(Nav)가 StoreAnalytics(별도 Suspense)보다 먼저 하이드레이트돼, 노출이 상태 확인보다 먼저
     빈 줄에서 돌 수 있다(l8a-data-1·ui-1). 그때 버리지 않고 그 화면 페이지뷰가 기록된 뒤에 보낸다. */
  it('노출이 페이지뷰 상태 확인보다 먼저 줄에 서도 버리지 않고, 그 화면 페이지뷰 기록 뒤에 공지마다 한 번 보낸다', async () => {
    const client = await load();
    client.enterShellNoticeView('/');
    client.recordShellNoticeEvent(A, 'impression');
    client.recordShellNoticeEvent(B, 'impression');
    await settle(client);
    expect(fetchMock).not.toHaveBeenCalled();
    /* StoreAnalytics의 첫 수집: 상태 확인 → 수집 사용 → 페이지뷰 기록 → 그 화면의 보류 노출 해제. */
    client.enqueueStoreAnalytics(async () => {
      client.setStoreAnalyticsCollecting(true);
      order.push('record');
      client.releaseShellNoticeImpressions('/');
    });
    await settle(client);
    expect(order).toEqual(['record', 'impression:3', 'impression:4']);
    const eventIds = sentBodies().map((body) => body.event.eventId);
    /* 같은 화면에서 다시 해제되거나 같은 공지가 다시 보여도 두 번 보내지 않는다. */
    client.enqueueStoreAnalytics(async () => client.releaseShellNoticeImpressions('/'));
    client.recordShellNoticeEvent(A, 'impression');
    await settle(client);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Set(eventIds).size).toBe(2);
  });

  /* 동의는 그 화면의 페이지뷰만 남긴다 — 노출도 같은 화면 것만 남겨 노출·클릭의 분모를 페이지뷰와 맞춘다(l8a-ui-3). */
  it('동의 전에 보인 공지는 동의한 화면의 페이지뷰 뒤에만 보내고, 다른 화면에서 동의 전에 본 공지는 보내지 않는다', async () => {
    const client = await load();
    client.enterShellNoticeView('/');
    client.recordShellNoticeEvent(A, 'impression');
    client.enterShellNoticeView('/shop/g1');
    client.recordShellNoticeEvent(B, 'impression');
    await settle(client);
    expect(fetchMock).not.toHaveBeenCalled();
    client.enqueueStoreAnalytics(async () => {
      order.push('accept');
      client.setStoreAnalyticsCollecting(true);
      order.push('record');
      client.releaseShellNoticeImpressions('/shop/g1');
    });
    await settle(client);
    expect(order).toEqual(['accept', 'record', 'impression:4']);
  });

  it('수집이 꺼졌거나 거부한 뒤에는 해제해도 보내지 않는다', async () => {
    const client = await load();
    client.enterShellNoticeView('/');
    client.recordShellNoticeEvent(A, 'impression');
    client.enqueueStoreAnalytics(async () => client.releaseShellNoticeImpressions('/'));
    await settle(client);
    client.setStoreAnalyticsCollecting(true);
    client.enqueueStoreAnalytics(async () => client.setStoreAnalyticsCollecting(false));
    client.enqueueStoreAnalytics(async () => client.releaseShellNoticeImpressions('/'));
    await settle(client);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /* 페이지뷰는 측정 밖 화면(검색·장바구니)을 거쳐 같은 경로로 돌아오면 다시 센다 — 노출도 같은 경계로 다시 센다(l8a-data-2·ui-2). */
  it('측정 밖 화면을 거쳐 같은 경로로 돌아오면 새 화면으로 다시 세고, 같은 경로 재렌더는 같은 화면이다', async () => {
    const client = await load();
    client.setStoreAnalyticsCollecting(true);
    expect(client.enterShellNoticeView('/')).toBe(true);
    client.recordShellNoticeEvent(A, 'impression');
    expect(client.shellNoticeSeen(A)).toBe(true);
    for (const path of ['/search', '/cart', '/my', '/legal/terms']) {
      expect(client.enterShellNoticeView(path), path).toBe(false);
      expect(client.shellNoticeSeen(A)).toBe(false);
      client.recordShellNoticeEvent(A, 'impression');
      client.recordShellNoticeEvent(A, 'click');
    }
    expect(client.enterShellNoticeView('/')).toBe(true);
    expect(client.shellNoticeSeen(A)).toBe(false);
    client.recordShellNoticeEvent(A, 'impression');
    expect(client.enterShellNoticeView('/')).toBe(true);
    client.recordShellNoticeEvent(A, 'impression');
    await settle(client);
    expect(order).toEqual(['impression:3', 'impression:3']);
    const [first, second] = sentBodies().map((body) => body.event.eventId);
    expect(first).not.toBe(second);
  });

  it('셸이 사라졌다 돌아오면(전용 셸 화면) 같은 경로여도 새 화면이다', async () => {
    const client = await load();
    client.setStoreAnalyticsCollecting(true);
    client.enterShellNoticeView('/');
    client.recordShellNoticeEvent(A, 'impression');
    client.leaveShellNoticeView();
    expect(client.shellNoticeSeen(A)).toBe(false);
    client.recordShellNoticeEvent(A, 'impression');
    client.enterShellNoticeView('/');
    client.recordShellNoticeEvent(A, 'impression');
    await settle(client);
    expect(order).toEqual(['impression:3', 'impression:3']);
  });

  it('서버가 받지 않은 노출은 보낸 것으로 치지 않아, 그 화면 페이지뷰 뒤에 같은 사건 ID로 다시 보낸다', async () => {
    const client = await load();
    client.setStoreAnalyticsCollecting(true);
    rejectNext(409, '{"ok":false,"code":"session_expired"}');
    client.enterShellNoticeView('/');
    client.recordShellNoticeEvent(A, 'impression');
    await settle(client);
    client.enqueueStoreAnalytics(async () => client.releaseShellNoticeImpressions('/'));
    await settle(client);
    const [failed, retried] = sentBodies();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retried.event).toEqual(failed.event);
  });

  it('노출을 보낸 화면의 클릭은 클릭만, 동의 전에 보여 노출을 못 보낸 공지는 클릭 직전에 노출을 한 번 보낸다', async () => {
    const client = await load();
    client.enterShellNoticeView('/');
    client.recordShellNoticeEvent(A, 'impression'); // 동의 전 — 보내지 않는다
    await settle(client);
    client.setStoreAnalyticsCollecting(true);
    client.recordShellNoticeEvent(A, 'click');
    /* 클릭이 화면을 바꿔 다음 화면이 시작돼도 클릭한 화면 기준으로 판단한다. */
    client.enterShellNoticeView('/events');
    await settle(client);
    expect(order).toEqual(['impression:3', 'click:3']);

    fetchMock.mockClear();
    order.length = 0;
    client.enterShellNoticeView('/shop/g1');
    client.recordShellNoticeEvent(A, 'impression');
    client.recordShellNoticeEvent(A, 'click');
    client.enterShellNoticeView('/events');
    await settle(client);
    expect(order).toEqual(['impression:3', 'click:3']);
    /* 절반 미만으로 보여 노출로 세지 않은 공지를 눌러도 클릭 직전에 노출을 남긴다. */
    order.length = 0;
    client.recordShellNoticeEvent(B, 'click');
    await settle(client);
    expect(order).toEqual(['impression:4', 'click:4']);
  });

  it('클릭 직전 노출을 서버가 받지 않으면 클릭도 보내지 않는다', async () => {
    const client = await load();
    client.setStoreAnalyticsCollecting(true);
    rejectNext(400, '{"ok":false}');
    client.enterShellNoticeView('/');
    client.recordShellNoticeEvent(A, 'click');
    await settle(client);
    expect(order).toEqual(['impression:3']);
  });

  it('철회되면 줄에 남은 공지 사건도 보내지 않고, 전송 실패가 다음 일을 막지 않는다', async () => {
    const client = await load();
    client.setStoreAnalyticsCollecting(true);
    client.enterShellNoticeView('/');
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    client.recordShellNoticeEvent(A, 'impression');
    client.enqueueStoreAnalytics(async () => client.setStoreAnalyticsCollecting(false));
    client.recordShellNoticeEvent(B, 'impression');
    client.recordShellNoticeEvent(B, 'click');
    await settle(client);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
