/*
 * 선택 방문 통계 안내(배너)·설정 버튼은 화면 아래에 고정돼 Tab 포커스를 덮을 수 있다(WCAG 2.2 SC 2.4.11). 하단 착지선
 * (html scroll-padding-bottom, globals.css)이 그 위로 올라가야 하는데, 배너 높이는 문구 줄바꿈·폭마다 달라 CSS 수치로 적을 수 없다.
 * 보이는 동안 윗변이 뷰포트 바닥에서 올라온 거리를 html 의 변수로 올리고, 착지선은 하단 바 높이와 이 값 중 큰 쪽을 쓴다.
 */

export const STORE_ANALYTICS_CLEARANCE_PROPERTY = '--wc-store-analytics-clearance';

/** 고정 요소의 윗변이 뷰포트 바닥에서 올라온 거리(px, 올림). 상자가 없으면(인쇄·숨김) 0 — 착지선을 뷰포트 전체로 올리지 않는다. */
export function bottomClearance(rect: { top: number; height: number }, viewportHeight: number): number {
  if (rect.height <= 0) return 0;
  return Math.max(0, Math.ceil(viewportHeight - rect.top));
}

interface ClearanceWindow {
  readonly innerHeight: number;
  readonly document: { readonly documentElement: { readonly style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'> } };
  readonly ResizeObserver?: typeof ResizeObserver;
  addEventListener(type: 'resize', listener: () => void): void;
  removeEventListener(type: 'resize', listener: () => void): void;
}

/** 요소가 보이는 동안 크기·뷰포트가 바뀔 때마다 다시 잰다. 돌려준 정리 함수가 변수를 지운다. */
export function holdStoreAnalyticsClearance(element: Pick<Element, 'getBoundingClientRect'>, win: ClearanceWindow): () => void {
  const style = win.document.documentElement.style;
  const measure = () => {
    style.setProperty(STORE_ANALYTICS_CLEARANCE_PROPERTY, `${bottomClearance(element.getBoundingClientRect(), win.innerHeight)}px`);
  };
  measure();
  const observer = win.ResizeObserver ? new win.ResizeObserver(measure) : null;
  observer?.observe(element as Element);
  win.addEventListener('resize', measure);
  return () => {
    observer?.disconnect();
    win.removeEventListener('resize', measure);
    style.removeProperty(STORE_ANALYTICS_CLEARANCE_PROPERTY);
  };
}
