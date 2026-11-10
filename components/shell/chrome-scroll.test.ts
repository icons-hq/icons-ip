import { describe, expect, it } from 'vitest';
import {
  HEADER_CONDENSE_AFTER,
  HEADER_EXPAND_BELOW,
  TAB_BAR_HIDE_AFTER,
  focusKeepsTabBarVisible,
  nextHeaderCondensed,
  nextTabBarScroll,
  tabBarScrollAt,
  type TabBarScroll,
} from './chrome-scroll';

function scrollThrough(start: TabBarScroll, ys: number[]) {
  return ys.reduce(nextTabBarScroll, start);
}

describe('데스크톱 헤더 축약 (B1)', () => {
  it('레퍼런스 기준 한 쌍을 쓴다', () => {
    expect(HEADER_CONDENSE_AFTER).toBe(150);
    expect(HEADER_EXPAND_BELOW).toBe(64);
  });

  it('150을 넘어야 접고, 경계값 자체에서는 접지 않는다', () => {
    expect(nextHeaderCondensed(false, 150)).toBe(false);
    expect(nextHeaderCondensed(false, 151)).toBe(true);
  });

  it('64 아래로 돌아와야 펴고, 64에서는 접힌 채 둔다', () => {
    expect(nextHeaderCondensed(true, 64)).toBe(true);
    expect(nextHeaderCondensed(true, 63)).toBe(false);
  });

  /* 접히면 헤더가 54px 줄고 스크롤 앵커링이 scrollY를 그만큼 당긴다. 밴드 안에서는
     직전 상태를 유지해야 151 → 97 같은 보정이 다시 펼침으로 튀지 않는다. */
  it('밴드 안에서는 방향과 무관하게 직전 상태를 유지한다', () => {
    for (const y of [64, 97, 120, 150]) {
      expect(nextHeaderCondensed(true, y), `${y}`).toBe(true);
      expect(nextHeaderCondensed(false, y), `${y}`).toBe(false);
    }
    const afterCondense = nextHeaderCondensed(false, 151);
    expect(nextHeaderCondensed(afterCondense, 151 - 54)).toBe(true);
    const afterExpand = nextHeaderCondensed(true, 63);
    expect(nextHeaderCondensed(afterExpand, 63 + 54)).toBe(false);
  });

  /* 공지 스트립이 보이는 동안 GNB부터 접히면 54px 점프가 보인다 — 높이를 양쪽 기준에 더한다.
     해제만 옮기면 접힘 기준보다 해제 기준이 커지는 역전 구간이 생긴다. */
  it('공지 높이를 접힘·해제 기준 양쪽에 더한다', () => {
    expect(nextHeaderCondensed(false, 151, 36)).toBe(false);
    expect(nextHeaderCondensed(false, 186, 36)).toBe(false);
    expect(nextHeaderCondensed(false, 187, 36)).toBe(true);
    expect(nextHeaderCondensed(true, 100, 36)).toBe(true);
    expect(nextHeaderCondensed(true, 99, 36)).toBe(false);
    /* 공지 높이만큼 평행 이동한 판정이 공지 없는 판정과 같다. */
    for (const previous of [true, false]) {
      for (const y of [0, 40, 63, 64, 100, 150, 151, 400]) {
        expect(nextHeaderCondensed(previous, y + 36, 36), `${previous}@${y}`).toBe(nextHeaderCondensed(previous, y));
      }
    }
  });

  it('음수 공지 높이(측정 실패)는 0으로 본다', () => {
    expect(nextHeaderCondensed(false, 151, -20)).toBe(true);
  });
});

describe('모바일 하단 탭바 숨김 (B3)', () => {
  it('아래로 누적 300px부터 숨긴다', () => {
    expect(TAB_BAR_HIDE_AFTER).toBe(300);
    const start = tabBarScrollAt(0);
    expect(scrollThrough(start, [100, 200, 299]).hidden).toBe(false);
    expect(scrollThrough(start, [100, 200, 300]).hidden).toBe(true);
  });

  it('누적은 절대 위치가 아니라 마지막 위 스크롤 이후의 거리다', () => {
    const start = tabBarScrollAt(1000);
    expect(scrollThrough(start, [1200]).hidden).toBe(false);
    expect(scrollThrough(start, [1200, 1301]).hidden).toBe(true);
    /* 중간에 위로 한 번 스크롤하면 누적을 다시 센다. */
    expect(scrollThrough(start, [1200, 1190, 1450]).hidden).toBe(false);
    expect(scrollThrough(start, [1200, 1190, 1490]).hidden).toBe(true);
  });

  it('위로 스크롤하면 바로 다시 보인다', () => {
    const hidden = scrollThrough(tabBarScrollAt(0), [400]);
    expect(hidden.hidden).toBe(true);
    expect(nextTabBarScroll(hidden, 399).hidden).toBe(false);
  });

  it('최상단에 닿으면 보이고, 고무줄 스크롤의 음수도 최상단으로 본다', () => {
    const hidden = scrollThrough(tabBarScrollAt(0), [500]);
    expect(nextTabBarScroll(hidden, 0)).toEqual(tabBarScrollAt(0));
    expect(nextTabBarScroll(hidden, -30)).toEqual(tabBarScrollAt(0));
  });

  it('위치가 그대로면 상태를 바꾸지 않는다', () => {
    const hidden = scrollThrough(tabBarScrollAt(0), [500]);
    expect(nextTabBarScroll(hidden, 500)).toBe(hidden);
  });

  /* 뒤로 가기로 스크롤이 복원된 채 마운트돼도 첫 판정만으로 숨기지 않는다. */
  it('복원된 스크롤 위치에서 시작해도 처음에는 보인다', () => {
    expect(tabBarScrollAt(2400)).toEqual({ hidden: false, lastY: 2400, travel: 0 });
  });
});

describe('탭바 숨김을 막는 포커스', () => {
  it('키보드 포커스(:focus-visible)만 숨김을 막고 탭·클릭·포인터로 닫은 오버레이의 되돌린 포커스는 막지 않는다', () => {
    const keyboard = { matches: (s: string) => s === ':focus-visible' };
    const pointer = { matches: () => false };
    expect(focusKeepsTabBarVisible(keyboard)).toBe(true);
    expect(focusKeepsTabBarVisible(pointer)).toBe(false);
    expect(focusKeepsTabBarVisible(null)).toBe(false);
    expect(focusKeepsTabBarVisible({ matches: () => { throw new Error('unsupported'); } })).toBe(false);
  });
});
