import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CART_BACK_PROBE_MS, type CartBackEnv, type ProbeWindow } from '@/components/cart/cart-back';
import { goBackFromNotFound, NotFoundActions } from './NotFoundActions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));

function fakeWindow({ length, canGoBack }: { length: number; canGoBack?: boolean }): CartBackEnv & ProbeWindow {
  return {
    location: { href: 'https://icons.test/no-such-page' },
    history: { length },
    ...(canGoBack === undefined ? {} : { navigation: { canGoBack } }),
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: (handler: () => void, timeout: number) => setTimeout(handler, timeout),
  };
}

describe('404 2CTA (CH-14)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /* 셸 QA(2026-10-27) — 탭의 첫 기록인 404 에서 '이전 페이지'가 앞 기록(빈 탭)으로 ICONS 를 떠났고, 홈에 갔다 브라우저 뒤로 가기로
     돌아온 404(기록 2개, 앞에 기록 없음)에서는 아무 일도 하지 않았다. 앞에 ICONS 화면이 있을 때만 뒤로 간다. */
  it('앞에 돌아갈 ICONS 화면이 없으면 이전 페이지 대신 홈으로 보낸다', () => {
    const cases = [
      { env: { length: 4, canGoBack: true }, back: 1, home: 0 },
      { env: { length: 2, canGoBack: false }, back: 0, home: 1 },
      { env: { length: 1 }, back: 0, home: 1 },
    ];
    for (const { env, back, home } of cases) {
      const router = { back: vi.fn(), push: vi.fn() };
      goBackFromNotFound(fakeWindow(env), router);
      vi.advanceTimersByTime(CART_BACK_PROBE_MS);
      expect([router.back.mock.calls.length, router.push.mock.calls.length], JSON.stringify(env)).toEqual([back, home]);
      if (home) expect(router.push).toHaveBeenCalledWith('/');
    }
  });

  it('Navigation API 없이 기록이 길면 뒤로 가 보고, 아무 이동이 없을 때만 홈으로 보낸다', () => {
    const router = { back: vi.fn(), push: vi.fn() };
    goBackFromNotFound(fakeWindow({ length: 3 }), router);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CART_BACK_PROBE_MS);
    expect(router.push).toHaveBeenCalledWith('/');
  });

  it('[이전 페이지] 잉크 버튼과 [메인으로] 아웃라인 링크를 한 그룹으로 세운다', () => {
    const html = renderToStaticMarkup(<NotFoundActions />);

    expect(html).toMatch(/^<div class="wc-btn-group wc-not-found__actions">/);
    expect(html).toContain('<button class="wc-btn primary" type="button">이전 페이지</button>');
    expect(html).toContain('<a class="wc-btn" href="/">메인으로</a>');
    expect(html.indexOf('이전 페이지')).toBeLessThan(html.indexOf('메인으로'));
  });
});
