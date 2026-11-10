import { describe, expect, it, vi } from 'vitest';
import { bottomClearance, holdStoreAnalyticsClearance, STORE_ANALYTICS_CLEARANCE_PROPERTY } from './store-analytics-clearance';

/* 선택 방문 통계 배너(모바일 바닥 76 위, 문구 줄바꿈으로 높이가 바뀐다)가 목록 하트 포커스를 덮었다(셸 QA 2026-10-27, 375 /shop Tab 120회 중 26회).
   윗변이 바닥에서 올라온 거리를 html 변수로 올려 하단 착지선(globals.css)이 그 위에 서게 한다. */

describe('바닥에서 윗변까지', () => {
  it('뷰포트 높이에서 윗변 위치를 뺀 값을 올림한다', () => {
    expect(bottomClearance({ top: 560.4, height: 176 }, 812)).toBe(252);
    expect(bottomClearance({ top: 790, height: 90 }, 900)).toBe(110);
  });

  it('상자가 없으면(인쇄·숨김) 0 이다 — 착지선을 뷰포트 전체로 올리지 않는다', () => {
    expect(bottomClearance({ top: 0, height: 0 }, 812)).toBe(0);
    expect(bottomClearance({ top: 900, height: 40 }, 812)).toBe(0);
  });
});

describe('보이는 동안 html 변수 유지', () => {
  function fakeWindow(innerHeight: number) {
    const style = { setProperty: vi.fn(), removeProperty: vi.fn() };
    const listeners = new Set<() => void>();
    const observers: Array<{ callback: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    class FakeResizeObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(public callback: () => void) {
        observers.push(this);
      }
    }
    const win = {
      innerHeight,
      document: { documentElement: { style } },
      ResizeObserver: FakeResizeObserver as unknown as typeof ResizeObserver,
      addEventListener: (_: 'resize', listener: () => void) => listeners.add(listener),
      removeEventListener: (_: 'resize', listener: () => void) => listeners.delete(listener),
    };
    return { win, style, listeners, observers };
  }

  it('처음·크기 변화·창 크기 변화마다 다시 재고, 정리하면 변수를 지운다', () => {
    const { win, style, listeners, observers } = fakeWindow(812);
    let rect = { top: 600, height: 136 };
    const element = { getBoundingClientRect: () => rect as DOMRect };

    const release = holdStoreAnalyticsClearance(element, win);
    expect(style.setProperty).toHaveBeenLastCalledWith(STORE_ANALYTICS_CLEARANCE_PROPERTY, '212px');
    expect(observers[0].observe).toHaveBeenCalledWith(element);

    rect = { top: 560, height: 176 };
    observers[0].callback();
    expect(style.setProperty).toHaveBeenLastCalledWith(STORE_ANALYTICS_CLEARANCE_PROPERTY, '252px');

    win.innerHeight = 700;
    listeners.forEach((listener) => listener());
    expect(style.setProperty).toHaveBeenLastCalledWith(STORE_ANALYTICS_CLEARANCE_PROPERTY, '140px');

    release();
    expect(observers[0].disconnect).toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    expect(style.removeProperty).toHaveBeenCalledWith(STORE_ANALYTICS_CLEARANCE_PROPERTY);
  });

  it('ResizeObserver 가 없어도 처음 값과 창 크기 변화는 잰다', () => {
    const { win, style, listeners } = fakeWindow(900);
    const release = holdStoreAnalyticsClearance({ getBoundingClientRect: () => ({ top: 852, height: 36 }) as DOMRect }, { ...win, ResizeObserver: undefined });
    expect(style.setProperty).toHaveBeenLastCalledWith(STORE_ANALYTICS_CLEARANCE_PROPERTY, '48px');
    expect(listeners.size).toBe(1);
    release();
  });
});
