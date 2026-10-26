/*
 * 모바일 카트 서브헤더 [← 이전]이 어디로 갈지(CT-03).
 *
 * history.length 는 이 탭의 기록 개수일 뿐이라 지금 위치가 몇 번째인지, 앞 기록이 ICONS 화면인지 모른다. 그래서
 * 길이만 보면 두 경우를 놓친다 — 탭의 첫 기록인 장바구니에서 다른 화면으로 갔다가 브라우저 뒤로 가기로 돌아오면
 * 길이는 2 이상인데 뒤로 가기는 아무 일도 하지 않는다(죽은 버튼). 첫 기록이 빈 탭·다른 사이트면 ICONS 를 떠난다.
 *
 * Navigation API 의 navigation.canGoBack 은 지금 항목 앞에 같은 출처 항목이 있을 때만 true 다(다른 출처 항목은 그 목록에
 * 들지 않는다). 같은 출처 = ICONS 화면이니 true 면 뒤로, false 면 직전에 보던 굿즈 목록(없으면 굿즈샵)으로 보낸다.
 * 이 API 가 없는 브라우저는 길이가 1 이면 직전 목록으로 보내고, 그보다 길면 뒤로 가 보고(probe) 잠시 안에 아무 이동도
 * 없으면 직전 목록으로 보낸다 — 죽은 버튼은 없앤다. 다만 앞 기록이 다른 사이트인 경우는 그 브라우저에서 가릴 수 없다.
 */

export type CartBackPlan = 'back' | 'listing' | 'probe';

/* Navigation API 중 쓰는 부분만 — TypeScript lib.dom 에 아직 타입이 없다. */
interface NavigationLike {
  readonly canGoBack?: unknown;
}

export interface CartBackEnv {
  readonly navigation?: NavigationLike | null;
  readonly history: { readonly length: number };
}

export function cartBackPlan(env: CartBackEnv): CartBackPlan {
  const canGoBack = env.navigation?.canGoBack;
  if (typeof canGoBack === 'boolean') return canGoBack ? 'back' : 'listing';
  return env.history.length > 1 ? 'probe' : 'listing';
}

/* 같은 문서 안 기록 이동의 popstate 는 보통 수 ms 안에 온다 — 느린 기기에도 넉넉하고, 죽은 버튼으로 느껴지기 전인 값. */
export const CART_BACK_PROBE_MS = 600;

export interface ProbeWindow {
  readonly location: { readonly href: string };
  addEventListener(type: 'popstate' | 'pagehide', listener: () => void): void;
  removeEventListener(type: 'popstate' | 'pagehide', listener: () => void): void;
  setTimeout(handler: () => void, timeout: number): unknown;
}

/**
 * 뒤로 가 보고, 정한 시간 안에 이 문서에서 기록 이동(popstate)도 문서 떠남(pagehide — 다른 문서로 돌아감·bfcache)도 없고
 * 주소도 그대로면 fallback 을 부른다. bfcache 에서 되살아나도 pagehide 를 이미 봤으니 늦게 보내지 않는다.
 */
export function probeBack(win: ProbeWindow, back: () => void, fallback: () => void, ms = CART_BACK_PROBE_MS): void {
  const start = win.location.href;
  let moved = false;
  const markMoved = () => {
    moved = true;
  };
  win.addEventListener('popstate', markMoved);
  win.addEventListener('pagehide', markMoved);
  back();
  win.setTimeout(() => {
    win.removeEventListener('popstate', markMoved);
    win.removeEventListener('pagehide', markMoved);
    if (!moved && win.location.href === start) fallback();
  }, ms);
}

/** 서브헤더 [← 이전]: 판정대로 뒤로 가거나 직전 목록으로 보낸다. */
export function goBackFromCart(win: CartBackEnv & ProbeWindow, back: () => void, toListing: () => void): void {
  const plan = cartBackPlan(win);
  if (plan === 'back') back();
  else if (plan === 'listing') toListing();
  else probeBack(win, back, toListing);
}
