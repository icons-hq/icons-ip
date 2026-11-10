/* 전역 크롬의 스크롤 판정 — 순수 함수만 둔다. Nav가 스크롤 이벤트마다 부르고, 결과는
   data-* 속성으로만 내려가 실제 표현(축약·숨김·전환)은 wc-chrome.css가 맡는다.
   수치 정본은 11-parity-audit §6의 B1(데스크톱 축약)·B3(하단 탭바)다. */

/* B1 — 데스크톱 헤더는 scrollY가 150을 넘으면 GNB를 접고, 64 아래로 돌아오면 편다.
   방향과 무관한 한 쌍의 히스테리시스다. 접힐 때 헤더가 54px 줄어 스크롤 앵커링이 scrollY를
   54만큼 당겨도 밴드(86px) 안에 머물러 경계 위에서 출렁이지 않는다 — 그래서 두 기준은 항상 함께 옮긴다. */
export const HEADER_CONDENSE_AFTER = 150;
export const HEADER_EXPAND_BELOW = 64;

/** 공지 스트립(과 그 위에 붙는 공지 행)의 높이는 두 기준 모두에 더한다 — 공지가 보이는 동안 GNB부터 접히지 않는다. */
export function nextHeaderCondensed(previous: boolean, scrollY: number, noticeOffset = 0): boolean {
  const offset = Math.max(0, noticeOffset);
  if (scrollY > HEADER_CONDENSE_AFTER + offset) return true;
  if (scrollY < HEADER_EXPAND_BELOW + offset) return false;
  return previous;
}

/* B3 — 모바일 하단 탭바는 아래로 누적 300px 이상 스크롤하면 숨고,
   위로 조금이라도 스크롤하거나 최상단에 닿으면 다시 보인다. */
export const TAB_BAR_HIDE_AFTER = 300;

export interface TabBarScroll {
  hidden: boolean;
  /** 직전 판정 시점의 scrollY(0 미만은 0으로 자른다 — iOS 고무줄 스크롤). */
  lastY: number;
  /** 마지막으로 위로 스크롤한 뒤 아래로 누적한 거리. */
  travel: number;
}

/** 첫 판정의 출발점. 스크롤이 복원된 채 열려도(뒤로 가기) 마운트만으로는 숨기지 않는다. */
export function tabBarScrollAt(scrollY: number): TabBarScroll {
  return { hidden: false, lastY: Math.max(0, scrollY), travel: 0 };
}

export function nextTabBarScroll(state: TabBarScroll, scrollY: number): TabBarScroll {
  const y = Math.max(0, scrollY);
  if (y === 0) return tabBarScrollAt(0);
  const delta = y - state.lastY;
  if (delta < 0) return { hidden: false, lastY: y, travel: 0 };
  if (delta === 0) return state;
  const travel = state.travel + delta;
  return { hidden: state.hidden || travel >= TAB_BAR_HIDE_AFTER, lastY: y, travel };
}

/** 하단 탭바 숨김을 막는 포커스는 키보드 포커스뿐이다. 탭·클릭으로 생긴 포커스와 오버레이가 닫히며
 * 되돌린 포커스(포인터로 닫은 경우)는 :focus-visible이 아니라 숨김을 막지 않는다 — 그렇지 않으면 메뉴 시트를
 * 닫은 뒤 '메뉴' 버튼에 남은 포커스 때문에 스크롤해도 탭바가 내려가지 않는다(B3·MC-02). */
export function focusKeepsTabBarVisible(target: { matches?: (selector: string) => boolean } | null): boolean {
  try {
    return Boolean(target?.matches?.(':focus-visible'));
  } catch {
    return false;
  }
}
