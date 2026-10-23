import { STORE_ANALYTICS_API } from './store-analytics';

/*
 * 브라우저의 선택 방문 통계 전송 줄. 페이지뷰 수집(components/shell/StoreAnalytics.tsx)과 공지 노출·클릭이
 * 같은 줄에 서서, 페이지뷰가 서버 상태 확인·세션 생성까지 끝낸 뒤에 공지 사건이 같은 세션으로 나간다.
 * 동의·수집 사용 여부는 StoreAnalytics가 서버에 확인할 때마다 갱신한다 — 확인 전이거나 동의가 없으면 보내지 않는다.
 */
let queue: Promise<void> = Promise.resolve();
let collecting = false;

export function enqueueStoreAnalytics(work: () => Promise<void>): void {
  queue = queue.then(work).catch(() => { /* Optional collection never interrupts browsing. */ });
}

/** 수집 사용 중 + 이 브라우저가 동의함 + 거부 기록 없음일 때만 true로 둔다. */
export function setStoreAnalyticsCollecting(value: boolean): void {
  collecting = value;
}

export function storeAnalyticsCollecting(): boolean {
  return collecting;
}

export type ShellNoticeInteraction = 'impression' | 'click';

/** 셸 공지 노출·클릭 한 건. 사건 ID는 지금 정해 재전송이 같은 사건으로 남게 한다. */
export function recordShellNoticeEvent(curationId: string, interaction: ShellNoticeInteraction): void {
  const event = { eventId: crypto.randomUUID(), curationId, interaction };
  enqueueStoreAnalytics(async () => {
    if (!collecting) return;
    await fetch(STORE_ANALYTICS_API, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      // 클릭 뒤 화면이 바뀌어도 요청이 끊기지 않게 한다.
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'notice', event }),
    });
  });
}
