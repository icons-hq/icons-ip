import { analyticsPage, STORE_ANALYTICS_API } from './store-analytics';

/*
 * 브라우저의 선택 방문 통계 전송 줄. 페이지뷰 수집(components/shell/StoreAnalytics.tsx)과 공지 노출·클릭이
 * 같은 줄에 차례로 선다. 동의·수집 사용 여부는 StoreAnalytics가 서버에 확인할 때마다 갱신한다 —
 * 확인 전이거나 동의가 없으면 아무것도 보내지 않는다.
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

/*
 * 공지 노출의 '화면'은 경로 한 번의 방문이다. 경로가 바뀔 때마다(측정 밖 화면 포함) 새 화면이 시작되므로, 검색·장바구니를
 * 거쳐 같은 경로로 돌아와도 다시 센다 — 방문 통계 페이지뷰가 측정 밖 화면을 거쳐 돌아오면 다시 세는 것과 같은 경계다.
 * 화면마다 절반 이상 보인 공지(seen)와 서버가 노출을 받은 공지(sent)를 따로 둔다. 보인 공지의 노출은
 *   - 이미 수집 중이면 바로 보내고,
 *   - 하드 로드의 첫 상태 확인 전이거나 동의 전이라 못 보냈으면, 그 화면의 페이지뷰가 기록된 뒤
 *     (releaseShellNoticeImpressions) 같은 세션으로 보낸다. 동의가 끝내 없으면 보내지 않는다.
 * 노출 사건 ID는 공지를 처음 본 순간 정해, 다시 보내도 같은 사건으로 남는다(서버는 같은 ID를 한 번만 센다).
 * 클릭은 같은 세션의 노출 뒤에만 서버가 받으므로, 노출을 아직 못 보낸 공지를 누르면 클릭 직전에 노출을 보낸다.
 * 클릭이 화면을 바꿔도 클릭한 화면 기준으로 판단하도록 화면 객체를 붙잡고, 최근 몇 화면만 기억한다.
 */
interface NoticeView {
  path: string;
  measured: boolean;
  /** 공지 ID → 노출 사건 ID */
  seen: Map<string, string>;
  sent: Set<string>;
}
/** 화면 하나를 가리키는 손잡이. 페이지뷰 기록이 자기 화면의 보류 노출만 보내도록 그 화면을 붙잡아 둔다. */
export type ShellNoticeViewHandle = Readonly<Pick<NoticeView, 'path'>>;
const KEPT_VIEWS = 5;
const views: NoticeView[] = [];
let current: NoticeView | null = null;

function viewFor(path: string): NoticeView {
  if (current?.path !== path) {
    /* 방문 통계와 같은 공개 화면에서만 센다(회원·주문·결제·검색 화면 제외 — 방문 통계 안내와 같은 범위). */
    current = { path, measured: analyticsPage(path, new URLSearchParams()) !== null, seen: new Map(), sent: new Set() };
    views.push(current);
    if (views.length > KEPT_VIEWS) views.shift();
  }
  return current;
}

/** 경로 화면에 들어간다(같은 경로가 이어지면 그 화면 그대로). 공지 노출을 세는 공개 화면이면 true. */
export function enterShellNoticeView(path: string): boolean {
  return viewFor(path).measured;
}

/**
 * 이 경로의 지금 화면(없거나 다른 경로면 새 화면)을 돌려준다. 방문 통계가 페이지뷰 항목을 만들 때 부르고, 그 페이지뷰가 기록되면
 * 이 손잡이로 releaseShellNoticeImpressions를 부른다 — 기록이 늦게 끝나는 사이 같은 경로를 다시 방문해도 두 방문을 섞지 않는다.
 * 셸 공지와 방문 통계 중 누가 먼저 하이드레이트해도 같은 경로면 같은 화면이다.
 */
export function shellNoticeViewFor(path: string): ShellNoticeViewHandle {
  return viewFor(path);
}

/** 셸이 사라지면(전용 셸 화면) 화면을 닫는다 — 다음에 같은 경로로 들어와도 새 화면이다. */
export function leaveShellNoticeView(): void {
  current = null;
}

/** 지금 화면에서 이미 절반 이상 보여 노출로 남긴 공지인가. */
export function shellNoticeSeen(curationId: string): boolean {
  return current?.seen.has(curationId) ?? false;
}

function postNoticeEvent(curationId: string, interaction: ShellNoticeInteraction, eventId: string) {
  return fetch(STORE_ANALYTICS_API, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    // 클릭 뒤 화면이 바뀌어도 요청이 끊기지 않게 한다.
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'notice', event: { eventId, curationId, interaction } }),
  });
}

/* 전송 줄 안에서만 부른다. 수집 중이 아니면 보내지 않고, 서버가 기록했을 때만 보낸 것으로 친다 —
   세션 만료 등으로 받지 않은 노출은 다음 페이지뷰 기록 뒤나 클릭 직전에 같은 사건 ID로 다시 보낸다. */
async function sendImpression(view: NoticeView, curationId: string): Promise<boolean> {
  const eventId = view.seen.get(curationId);
  if (!collecting || !eventId) return false;
  if (view.sent.has(curationId)) return true;
  const response = await postNoticeEvent(curationId, 'impression', eventId);
  if (response.ok) view.sent.add(curationId);
  return view.sent.has(curationId);
}

/** 셸 공지 노출·클릭 한 건. 노출은 화면마다 공지당 한 번만 남는다. 측정 밖 화면에서는 아무것도 하지 않는다. */
export function recordShellNoticeEvent(curationId: string, interaction: ShellNoticeInteraction): void {
  const view = current;
  if (!view?.measured) return;
  if (interaction === 'impression') {
    if (view.seen.has(curationId)) return;
    view.seen.set(curationId, crypto.randomUUID());
    enqueueStoreAnalytics(async () => { await sendImpression(view, curationId); });
    return;
  }
  /* 절반 미만으로 보이던 공지도 누를 수 있다 — 그때도 클릭 직전에 노출을 남긴다. */
  if (!view.seen.has(curationId)) view.seen.set(curationId, crypto.randomUUID());
  const eventId = crypto.randomUUID();
  enqueueStoreAnalytics(async () => {
    if (!await sendImpression(view, curationId)) return;
    await postNoticeEvent(curationId, 'click', eventId);
  });
}

/**
 * 페이지뷰가 기록된 직후 StoreAnalytics가 전송 줄 안에서, 그 페이지뷰 항목을 만들 때 붙잡은 화면 손잡이로 부른다. 하드 로드의 첫
 * 상태 확인 전이나 동의 전에 보여 아직 못 보낸 노출을, 페이지뷰를 기록한 바로 그 화면 것만 같은 세션으로 보낸다(다른 화면이나 같은
 * 경로의 다른 방문에서 본 공지는 보내지 않는다).
 */
export function releaseShellNoticeImpressions(handle: ShellNoticeViewHandle): void {
  const view = handle as NoticeView;
  if (!view?.measured) return;
  const target = view;
  for (const curationId of target.seen.keys()) {
    if (!target.sent.has(curationId)) enqueueStoreAnalytics(async () => { await sendImpression(target, curationId); });
  }
}
