import { describe, expect, it } from 'vitest';
import {
  HASH_LANDING_MAX_MOVES,
  HASH_LANDING_QUIET_MS,
  HASH_LANDING_REVEAL_MS,
  HASH_LANDING_TOLERANCE,
  HASH_LANDING_WATCH_MS,
  cssPixels,
  hashLandingLine,
  hashTargetIds,
  isHashLanded,
  shouldLandAfterNavigation,
  shouldLandOnHashChange,
  shouldLandOnLoad,
} from './hash-landing';

describe('해시 대상 id', () => {
  it('원문을 먼저, 디코드한 값을 다음에 찾는다(HTML indicated part 순서)', () => {
    expect(hashTargetIds('#reviews')).toEqual(['reviews']);
    expect(hashTargetIds('reviews')).toEqual(['reviews']);
    expect(hashTargetIds('#%EB%A6%AC%EB%B7%B0')).toEqual(['%EB%A6%AC%EB%B7%B0', '리뷰']);
  });

  it('빈 해시와 문서 맨 위(#top)는 브라우저에 맡긴다', () => {
    expect(hashTargetIds('')).toEqual([]);
    expect(hashTargetIds('#')).toEqual([]);
    expect(hashTargetIds('#top')).toEqual([]);
    expect(hashTargetIds('#TOP')).toEqual([]);
  });

  /* 선물 받기·운영자 초대는 해시에 토큰을 싣는다 — 요소를 찾을 일이 없고, 찾느라 토큰을 만지지도 않는다. */
  it('값을 실은 조각(key=value)은 착지 대상이 아니다', () => {
    expect(hashTargetIds('#token=abc')).toEqual([]);
    expect(hashTargetIds('#a=1&b=2')).toEqual([]);
  });

  it('깨진 퍼센트 인코딩은 던지지 않고 원문으로만 찾는다', () => {
    expect(hashTargetIds('#%E0%A4%A')).toEqual(['%E0%A4%A']);
  });
});

describe('착지선', () => {
  it('html scroll-padding-top 과 대상 scroll-margin-top 을 더한다', () => {
    expect(hashLandingLine('69px', '49px')).toBe(118);
    expect(hashLandingLine('52px', '71px')).toBe(123);
    expect(hashLandingLine('55px', '16px')).toBe(71);
  });

  it('셸이 없는 화면(auto)·여백 없는 대상(0px)은 0으로 읽는다', () => {
    expect(hashLandingLine('auto', '0px')).toBe(0);
    expect(cssPixels('auto')).toBe(0);
    expect(cssPixels('10%')).toBe(0);
    expect(cssPixels(' 123px ')).toBe(123);
  });
});

describe('착지 판정', () => {
  const base = { line: 118, scrollY: 1200, maxScrollY: 3000 };

  it('머리가 선 ±허용치 안이면 선 것이다', () => {
    expect(isHashLanded({ ...base, targetTop: 118 })).toBe(true);
    expect(isHashLanded({ ...base, targetTop: 118 + HASH_LANDING_TOLERANCE })).toBe(true);
    expect(isHashLanded({ ...base, targetTop: 118 - HASH_LANDING_TOLERANCE })).toBe(true);
  });

  /* 2026-10-23 실측: 새로 진입하면 맨 위에 멈추거나(스트리밍 경계), 데스크톱 헤더 접힘만큼(54) 아래에 섰다. */
  it('맨 위에 멈췄거나 헤더 접힘만큼 어긋났으면 다시 세운다', () => {
    expect(isHashLanded({ line: 118, scrollY: 0, maxScrollY: 3000, targetTop: 1366 })).toBe(false);
    expect(isHashLanded({ ...base, targetTop: 118 + 54 })).toBe(false);
    expect(isHashLanded({ ...base, targetTop: 118 - 54 })).toBe(false);
  });

  it('문서 끝에 막혀 선까지 못 올라온 대상은 선 것으로 본다', () => {
    expect(isHashLanded({ line: 118, scrollY: 3000, maxScrollY: 3000, targetTop: 400 })).toBe(true);
    expect(isHashLanded({ line: 118, scrollY: 2999.5, maxScrollY: 3000, targetTop: 400 })).toBe(true);
  });

  it('문서 맨 위라 선 위에 남는 대상도 더 올릴 수 없어 선 것으로 본다', () => {
    expect(isHashLanded({ line: 123, scrollY: 0, maxScrollY: 3000, targetTop: 40 })).toBe(true);
    expect(isHashLanded({ line: 123, scrollY: 300, maxScrollY: 3000, targetTop: 40 })).toBe(false);
  });
});

describe('문서를 열 때', () => {
  it('새 이동은 해시에 맞춘다', () => {
    expect(shouldLandOnLoad('navigate', 'auto')).toBe(true);
    expect(shouldLandOnLoad(undefined, 'auto')).toBe(true);
  });

  it('뒤로·앞으로 가기는 브라우저 스크롤 복원에 맡긴다', () => {
    expect(shouldLandOnLoad('back_forward', 'auto')).toBe(false);
    expect(shouldLandOnLoad('back_forward', 'manual')).toBe(false);
  });

  /* 새로고침은 읽던 자리를 복원한다. 리뷰 링크는 같은 주소에서 리뷰 탭으로 다시 열려고 복원을 끄고 새로고침한다. */
  it('새로고침은 복원을 끈 경우에만 해시에 맞춘다', () => {
    expect(shouldLandOnLoad('reload', 'auto')).toBe(false);
    expect(shouldLandOnLoad('reload', 'manual')).toBe(true);
  });
});

describe('클라이언트 이동 뒤', () => {
  it('다른 경로의 해시로 가면 맞춘다(홈 리뷰 → 굿즈 상세 #reviews)', () => {
    expect(shouldLandAfterNavigation({ pathname: '/', hash: '' }, { pathname: '/shop/g1', hash: '#reviews' })).toBe(true);
    expect(shouldLandAfterNavigation({ pathname: '/shop/g1', hash: '#reviews' }, { pathname: '/shop/g2', hash: '#reviews' })).toBe(true);
  });

  it('같은 경로에서 해시가 새로 붙거나 바뀌면 맞춘다(정렬 링크 → #reviews, 통계 순위 → #goods-ranking)', () => {
    expect(shouldLandAfterNavigation({ pathname: '/shop/g1', hash: '' }, { pathname: '/shop/g1', hash: '#reviews' })).toBe(true);
    expect(shouldLandAfterNavigation({ pathname: '/admin/stats/sales', hash: '' }, { pathname: '/admin/stats/sales', hash: '#goods-ranking' })).toBe(true);
  });

  /* 옵션을 고르면 굿즈 상세가 replaceState 로 ?variant= 만 바꾼다 — 해시가 남아 있어도 읽던 자리를 빼앗지 않는다. */
  it('같은 경로·같은 해시에서 검색어만 바뀌면 그대로 둔다', () => {
    expect(shouldLandAfterNavigation({ pathname: '/shop/g1', hash: '#reviews' }, { pathname: '/shop/g1', hash: '#reviews' })).toBe(false);
  });

  /* 읽던 굿즈 상세(#reviews)에서 다른 상품으로 갔다가 뒤로 오면 브라우저가 복원한 자리가 맞다 — 리뷰 머리로 되돌리지 않는다. */
  it('뒤로·앞으로 가기로 온 경로는 해시가 있어도 복원에 맡긴다', () => {
    expect(shouldLandAfterNavigation({ pathname: '/shop/g2', hash: '' }, { pathname: '/shop/g1', hash: '#reviews' }, { traversal: true })).toBe(false);
    expect(shouldLandAfterNavigation({ pathname: '/shop/g2', hash: '' }, { pathname: '/shop/g1', hash: '#reviews' }, { traversal: false })).toBe(true);
  });

  it('해시가 없거나 착지 대상이 아닌 해시면 그대로 둔다', () => {
    expect(shouldLandAfterNavigation({ pathname: '/shop/g1', hash: '#reviews' }, { pathname: '/shop', hash: '' })).toBe(false);
    expect(shouldLandAfterNavigation({ pathname: '/', hash: '' }, { pathname: '/gifts/receive', hash: '#token=abc' })).toBe(false);
  });
});

describe('같은 문서 안 해시 이동 뒤', () => {
  it('링크로 바꾼 해시는 맞춘다', () => {
    expect(shouldLandOnHashChange('#pdp-shipping-savings')).toBe(true);
  });

  /* 문서 안 해시로 간 뒤 뒤로 가기로 해시가 비면 브라우저가 복원한 자리에 둔다(앞선 감시는 HashLanding 이 먼저 끊는다). */
  it('뒤로·앞으로 가기로 바뀐 해시와 비워진 해시는 맞추지 않는다', () => {
    expect(shouldLandOnHashChange('#pdp-shipping-savings', { traversal: true })).toBe(false);
    expect(shouldLandOnHashChange('')).toBe(false);
    expect(shouldLandOnHashChange('#token=abc')).toBe(false);
  });
});

describe('지켜보는 시간', () => {
  /* 스트리밍 경계는 React 19 가 최대 300ms 묶어 드러낸다(2026-10-23 실측: 306ms 에 대상 위 블록이 드러나 457px 밀림).
     조용한 시간은 그보다 짧아 진행 중인 부드러운 이동이 끝나기를 기다릴 만큼만 둔다. */
  it('드러나기를 넉넉히 기다리고, 드러난 뒤에는 늦은 블록 한두 번을 볼 만큼만 지켜본다', () => {
    expect(HASH_LANDING_QUIET_MS).toBeLessThan(300);
    expect(HASH_LANDING_WATCH_MS).toBeGreaterThan(300 * 2);
    expect(HASH_LANDING_REVEAL_MS).toBeGreaterThan(HASH_LANDING_WATCH_MS);
  });

  /* 첫 이동 + 헤더 접힘 보정(동작 줄이기의 즉시 이동) + 늦게 드러난 블록 한 번. 그 이상은 세울 수 없는 대상이다. */
  it('다시 세우기는 세 번까지만 한다', () => {
    expect(HASH_LANDING_MAX_MOVES).toBe(3);
  });
});
