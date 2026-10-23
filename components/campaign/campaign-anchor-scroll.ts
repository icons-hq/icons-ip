/* 캠페인 앵커 내브의 착지·활성 판정 — 순수 계산만 둔다. CampaignAnchorNav가 DOM에서 읽은 수치를 넘기고,
   결과는 스크롤 위치와 활성 앵커 id로만 돌아간다.

   기준은 하나의 착지선이다: 셸이 알리는 고정 크롬 높이(--wc-sticky-chrome-h) + 앵커 내브 높이(하단 선 포함).
   목차로 이동하면 섹션 머리를 이 선에 맞추고, 활성 표시도 머리가 이 선까지 올라온 섹션을 고른다.
   선 아래로 여백을 더 두지 않는다 — 그 틈으로 앞 블록의 끝(이동 버튼 아랫단 등)이 비친다. 제목 위 여백은
   섹션 자신의 padding-top(모바일 40 / 데스크톱 64)이 맡는다. */

/** 반올림·서브픽셀 배치를 흡수하는 허용치(px). 목차로 착지한 섹션의 머리는 선 ±0.5px 안에 선다. */
export const CAMPAIGN_ANCHOR_TOLERANCE = 1;

/** 착지선 — 화면 위에서부터 고정 크롬과 앵커 내브가 덮는 높이. */
export function campaignAnchorLine(chromeHeight: number, navHeight: number): number {
  return Math.max(0, chromeHeight) + Math.max(0, navHeight);
}

/**
 * 고정 크롬 높이(px). 내브의 sticky top은 크롬 높이가 바뀔 때 .3s 전환으로 움직여 중간값이 읽히므로
 * 목표값이 곧바로 바뀌는 변수 쪽을 먼저 읽는다. 변수가 없으면 대체값이 풀린 sticky top을 쓴다.
 */
export function parseChromeHeight(variableValue: string, stickyTop: string): number {
  const fromVariable = Number.parseFloat(variableValue);
  if (Number.isFinite(fromVariable)) return fromVariable;
  const fromTop = Number.parseFloat(stickyTop);
  return Number.isFinite(fromTop) ? fromTop : 0;
}

/**
 * 섹션 머리를 착지선에 맞추는 문서 스크롤 위치. 문서 끝(maxScrollY)을 넘지 않게 자르고,
 * 이미 그 자리(1px 미만)면 null. sectionTop은 섹션의 뷰포트 기준 위치다.
 *
 * 데스크톱에서 펼친 헤더(크롬 123)로 누르면 이동 중 헤더가 54 접혀 본문이 그만큼 올라온다. 지금의
 * 크롬 높이로 계산한 목표는 그 54를 이미 품고 있어(123 − 69) 접힌 뒤의 선(69 + 내브)에 정확히 선다.
 */
export function campaignAnchorScrollTop(state: {
  scrollY: number;
  sectionTop: number;
  line: number;
  maxScrollY: number;
}): number | null {
  const wanted = state.scrollY + state.sectionTop - state.line;
  const target = Math.round(Math.min(Math.max(0, wanted), Math.max(0, state.maxScrollY)));
  return Math.abs(target - state.scrollY) < 1 ? null : target;
}

export type CampaignAnchorSettle =
  | { type: 'landed' }
  | { type: 'realign'; top: number }
  | { type: 'left' };

/**
 * 목차 이동이 멈춘 뒤의 판정. 이동 중 크롬 높이가 바뀌면(데스크톱 헤더가 접히거나 펴짐) 브라우저에 따라
 * 스크롤 앵커링이 본문 이동을 되돌려 선과 크롬 변화량만큼 어긋난다 — 즉시 이동(동작 줄이기)이 그렇다.
 * 그만큼은 다시 맞추고(realign), 그보다 크게 벗어났으면 사용자가 스크롤을 넘겨받은 것으로 보고
 * 건드리지 않는다(left). lineShift는 누를 때와 멈춘 뒤의 착지선 차이다.
 */
export function campaignAnchorSettle(state: {
  scrollY: number;
  sectionTop: number;
  line: number;
  maxScrollY: number;
  lineShift: number;
}): CampaignAnchorSettle {
  const top = campaignAnchorScrollTop(state);
  if (top === null) return { type: 'landed' };
  return Math.abs(top - state.scrollY) <= Math.abs(state.lineShift) + CAMPAIGN_ANCHOR_TOLERANCE
    ? { type: 'realign', top }
    : { type: 'left' };
}

export interface CampaignAnchorPosition {
  id: string;
  /** 섹션 머리의 뷰포트 기준 위치. */
  top: number;
}

/** 목차로 이동해 멈춘 자리. */
export interface CampaignAnchorLanding {
  id: string;
  scrollY: number;
}

/**
 * 활성 앵커 — 문서 순서상 머리가 착지선(+허용치)까지 올라온 마지막 앵커 섹션, 하나도 없으면 첫 앵커.
 * 목차로 이동해 그 자리에 머무는 동안은 누른 앵커를 둔다 — 문서 끝에 닿아 선까지 못 올라온 섹션도
 * 누른 것이 활성이어야 한다. 그 자리를 떠나면 위치 판정으로 돌아간다.
 */
export function activeCampaignAnchorId(
  positions: readonly CampaignAnchorPosition[],
  line: number,
  landing: CampaignAnchorLanding | null = null,
  scrollY = 0,
): string | null {
  if (
    landing
    && Math.abs(scrollY - landing.scrollY) < CAMPAIGN_ANCHOR_TOLERANCE
    && positions.some((position) => position.id === landing.id)
  ) {
    return landing.id;
  }
  let active = positions[0]?.id ?? null;
  for (const position of positions) {
    if (position.top <= line + CAMPAIGN_ANCHOR_TOLERANCE) active = position.id;
  }
  return active;
}

/**
 * 활성 판정을 다시 돌릴 IntersectionObserver의 rootMargin — 관찰 띠의 윗변을 착지선(+허용치)에 둔다.
 * 섹션은 위아래로 붙어 있어, 한 섹션의 머리가 선을 넘는 순간 바로 앞 형제의 바닥이 띠를 드나든다.
 * 그래서 앵커 섹션과 그 앞 형제를 함께 관찰하면 경계가 선을 넘을 때마다 콜백이 온다.
 * 아랫변은 화면 끝 그대로 둔다 — 위에서부터 잰 거리라 모바일 주소창이 접혀도 선이 움직이지 않는다.
 */
export function campaignAnchorRootMargin(line: number): string {
  return `-${Math.max(0, Math.round(line + CAMPAIGN_ANCHOR_TOLERANCE))}px 0px 0px 0px`;
}

/** 목차 클릭을 가로채도 되는지 — 수정 키나 주 버튼이 아닌 클릭(새 탭·새 창)은 브라우저에 맡긴다. */
export function isPlainPrimaryClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}): boolean {
  return !event.defaultPrevented
    && event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey;
}
