import { isCardRewardDestination, isCommunityDestination, type NoticeStrip } from './home-catalog';
import type { ImageSize } from './image-size';
import { isGoodDetailPath } from './routes';

/*
 * 전역 셸 공지(텍스트 공지 바 · 이미지 스트립)의 공용 계약.
 * 로더(lib/notice-strip.server.ts)는 쿠키 없는 캐시 읽기로 유효한 공지 전체를 내려보내고(#325 — 법적 문서 SSG 유지),
 * 대상 화면 판정·같은 탭 닫힘·스트립 무작위 선택·노출 종료는 클라이언트(components/shell/ShellNotices.tsx)가 이 모듈로 한다.
 * 첫 페인트 전에 도는 인라인 스크립트(SHELL_NOTICE_SCRIPT)도 같은 규칙을 따른다 — 둘이 어긋나면 하이드레이션이 깨진다.
 * 셸 공지는 하드 로드 때 한 번 내려오고 앱 안 이동에는 다시 오지 않으므로, 종료 시각은 열린 화면에서 클라이언트가 지킨다.
 */

/** 공지를 보일 화면 유형. 레퍼런스의 data-show-home/product/collection/blog/others와 같은 다섯 갈래다. */
export const SHELL_NOTICE_PAGE_TYPES = ['home', 'collection', 'product', 'content', 'other'] as const;
export type ShellNoticePageType = typeof SHELL_NOTICE_PAGE_TYPES[number];

export interface ShellNoticeBar {
  /** 큐레이션 행 ID — 노출·클릭 집계의 대상이다. */
  id: string;
  /** 같은 탭 닫힘 키. 문구·버튼·대상을 바꾸면 달라져 닫았던 고객에게도 새 공지로 다시 보인다. */
  key: string;
  message: string;
  cta: { label: string; href: string } | null;
  pageTypes: readonly ShellNoticePageType[];
  /** 노출 종료 시각(epoch ms, active_to). 이미 열린 화면에서도 이 시각이 지나면 숨긴다. null = 종료 없음. */
  endsAt: number | null;
}

export interface ShellNoticeStrip extends NoticeStrip {
  /** 이미지 고유 크기 — 띠 자리를 첫 페인트 전에 잡는다(notice-strip.server.ts). 읽지 못했으면 null. */
  imageSize?: ImageSize | null;
  mobileImageSize?: ImageSize | null;
  /** null = 대상을 지정하지 않은 기존 스트립(모든 셸 화면). */
  pageTypes: readonly ShellNoticePageType[] | null;
  /** 노출 종료 시각(epoch ms, active_to). null = 종료 없음. */
  endsAt: number | null;
}

export interface ShellNotices {
  bars: ShellNoticeBar[];
  strips: ShellNoticeStrip[];
}

export const EMPTY_SHELL_NOTICES: ShellNotices = { bars: [], strips: [] };

/**
 * 띠배너 <img>·모바일 <source> 에 달 크기. 브라우저는 고른 <source> 에 크기가 없으면 <img> 의 크기로 비율을 잡는다 —
 * 모바일 소스 크기를 모르면 PC 비율이 모바일 이미지에 쓰여 자리가 틀리게 잡히므로(다시 밀린다) <img> 에도 달지 않는다.
 */
export function noticeStripDimensions(
  strip: Pick<ShellNoticeStrip, 'mobileImageUrl' | 'imageSize' | 'mobileImageSize'>,
): { image: ImageSize | null; mobile: ImageSize | null } {
  const mobile = strip.mobileImageUrl ? strip.mobileImageSize ?? null : null;
  const image = strip.imageSize && (!strip.mobileImageUrl || mobile) ? strip.imageSize : null;
  return { image, mobile };
}

export const SHELL_NOTICE_ROOT_ID = 'wc-shell-notices';
export const SHELL_NOTICE_DISMISSED_KEY = 'icons:notice-dismissed:v1';
/** 인라인 스크립트가 하드 로드마다 한 번 뽑는 스트립 선택 시드(0 이상 1 미만). */
export const SHELL_NOTICE_SEED_GLOBAL = '__iconsShellNoticeSeed';
/** 인라인 스크립트가 종료 판정에 쓴 시각(epoch ms) — 하이드레이션도 같은 시각으로 판정해 스크립트의 결과와 맞춘다. */
export const SHELL_NOTICE_NOW_GLOBAL = '__iconsShellNoticeNow';
const DISMISSED_LIMIT = 50;
const MAX_TIMER_DELAY = 2_147_483_647;

/**
 * 경로 → 공지 대상 화면 유형. 상품 목록은 굿즈샵·NEW·BEST와 IP관(브랜드 컬렉션)이다 — 레퍼런스 스트립은 이 유형에서 기본 미노출.
 * 검색·IP 디렉토리·장바구니·마이 등은 '그 밖의 화면'이다.
 */
export function shellNoticePageType(pathname: string): ShellNoticePageType {
  if (pathname === '/') return 'home';
  if (isGoodDetailPath(pathname)) return 'product';
  if (pathname === '/shop' || pathname === '/shop/new' || pathname === '/shop/best' || /^\/ip\/[^/]+$/.test(pathname)) {
    return 'collection';
  }
  if (pathname === '/stories' || pathname.startsWith('/stories/') || pathname === '/events' || pathname.startsWith('/events/')) {
    return 'content';
  }
  return 'other';
}

/** payload.page_types → 유형 배열. 형식이 틀리면 null(그 행을 그리지 않는다), 키가 없으면 undefined. */
export function parseShellNoticePageTypes(value: unknown): ShellNoticePageType[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > SHELL_NOTICE_PAGE_TYPES.length) return null;
  const known = new Set<string>(SHELL_NOTICE_PAGE_TYPES);
  if (value.some((entry) => typeof entry !== 'string' || !known.has(entry))) return null;
  if (new Set(value).size !== value.length) return null;
  return SHELL_NOTICE_PAGE_TYPES.filter((type) => value.includes(type));
}

export interface ShellNoticeGates {
  cardRewardsEnabled: boolean;
  communityEnabled: boolean;
}

/** 게이트가 꺼진 목적지(카드팩·게임·커뮤니티)로 보내는 공지는 GNB 항목과 같은 규칙으로 숨긴다. */
export function shellNoticeDestinationAllowed(href: string | null, gates: ShellNoticeGates): boolean {
  if (href === null) return true;
  return (gates.cardRewardsEnabled || !isCardRewardDestination(href))
    && (gates.communityEnabled || !isCommunityDestination(href));
}

/** 이 화면에 보일 수 있는 공지(대상 유형·게이트) — 순서는 운영 순서 그대로다. */
export function applicableShellNotices(notices: ShellNotices, pathname: string, gates: ShellNoticeGates): ShellNotices {
  const pageType = shellNoticePageType(pathname);
  return {
    bars: notices.bars.filter((bar) => bar.pageTypes.includes(pageType)
      && shellNoticeDestinationAllowed(bar.cta?.href ?? null, gates)),
    strips: notices.strips.filter((strip) => (strip.pageTypes === null || strip.pageTypes.includes(pageType))
      && shellNoticeDestinationAllowed(strip.href, gates)),
  };
}

/** 닫힘 기록을 읽는다. 저장소가 없거나(SSR·차단) 값이 깨졌으면 빈 목록 — 인라인 스크립트와 같은 규칙이다. */
export function readDismissedNoticeKeys(storage: Pick<Storage, 'getItem'> | null): string[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SHELL_NOTICE_DISMISSED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

/** 닫힘을 기록하고 새 목록을 돌려준다. 저장에 실패해도 이번 화면에서는 닫힌 상태를 유지한다. */
/**
 * 닫힘을 더한다. 지금 화면의 닫힘 상태(previous)에 합치고 저장소는 보존용으로만 쓴다 — 저장소가 막혀(사생활 모드·용량 초과)
 * 읽기가 비어도 앞서 닫은 공지가 다시 나타나지 않는다.
 */
export function rememberDismissedNotice(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  key: string,
  previous: readonly string[] = [],
): string[] {
  const known = [...new Set([...readDismissedNoticeKeys(storage), ...previous])];
  const next = [...known.filter((entry) => entry !== key), key].slice(-DISMISSED_LIMIT);
  try {
    storage?.setItem(SHELL_NOTICE_DISMISSED_KEY, JSON.stringify(next));
  } catch {
    /* 사생활 모드 등 저장 불가 — 닫힘은 이 화면의 상태로만 남는다. */
  }
  return next;
}

/**
 * 노출 창 안의 공지인가 — 종료 시각이 없거나 아직 지나지 않았다. now가 null이면(서버 렌더) 시각으로 거르지 않는다:
 * 로더가 캐시 시점에 이미 걸렀고, 클라이언트는 첫 페인트 전 스크립트와 하이드레이션에서 다시 거른다.
 * 종료 시각이 숫자가 아니면(종료 없음, 또는 종료 시각을 싣기 전 모양의 캐시 값) 끝나지 않은 것으로 본다.
 */
export function shellNoticeLive(notice: { endsAt: number | null }, now: number | null): boolean {
  return now === null || typeof notice.endsAt !== 'number' || notice.endsAt > now;
}

/**
 * IntersectionObserver 항목이 노출로 셀 만큼(절반 이상) 보이는가. 관찰을 시작할 때나 교차 여부가 바뀔 때는 문턱 아래 비율로도
 * 항목이 오므로 isIntersecting만으로는 1px만 보여도 세게 된다.
 */
export function shellNoticeImpressionVisible(entry: Pick<IntersectionObserverEntry, 'isIntersecting' | 'intersectionRatio'>): boolean {
  return entry.isIntersecting && entry.intersectionRatio >= SHELL_NOTICE_IMPRESSION_RATIO;
}

/** 노출 문턱 — 공지가 화면에 이만큼 보이면 노출로 센다. */
export const SHELL_NOTICE_IMPRESSION_RATIO = 0.5;

/** 운영 순서에서 닫지 않았고 끝나지 않은 첫 공지 바. 하나만 보인다. */
export function firstVisibleNoticeBar(
  bars: readonly ShellNoticeBar[],
  dismissed: readonly string[],
  now: number | null = null,
): ShellNoticeBar | null {
  return bars.find((bar) => !dismissed.includes(bar.key) && shellNoticeLive(bar, now)) ?? null;
}

/** 시드 → 스트립 후보 인덱스. 후보가 없으면 -1. */
export function noticeStripIndex(seed: number, count: number): number {
  if (count < 1) return -1;
  const safe = Number.isFinite(seed) && seed >= 0 && seed < 1 ? seed : 0;
  return Math.min(count - 1, Math.floor(safe * count));
}

/**
 * 보일 스트립 인덱스. 시드로 고른 후보가 끝났으면 그다음(돌아서) 끝나지 않은 후보로 넘긴다 — 다른 후보가 끝나도
 * 보이던 스트립은 그대로다. 모두 끝났으면 -1.
 */
export function visibleNoticeStripIndex(strips: readonly { endsAt: number | null }[], seed: number, now: number | null): number {
  const start = noticeStripIndex(seed, strips.length);
  if (start < 0) return -1;
  for (let step = 0; step < strips.length; step += 1) {
    const index = (start + step) % strips.length;
    if (shellNoticeLive(strips[index], now)) return index;
  }
  return -1;
}

/** now 뒤에 가장 먼저 끝나는 공지의 종료 시각. 없으면 null. */
export function nextShellNoticeEnd(notices: ShellNotices, now: number): number | null {
  let next: number | null = null;
  for (const notice of [...notices.bars, ...notices.strips]) {
    if (typeof notice.endsAt === 'number' && notice.endsAt > now && (next === null || notice.endsAt < next)) next = notice.endsAt;
  }
  return next;
}

/** 종료 시각까지 기다릴 타이머 지연. 지났으면 곧바로, 너무 멀면 타이머 한도까지만 기다렸다 다시 잰다. */
export function shellNoticeTimerDelay(endsAt: number, now: number): number {
  return Math.min(Math.max(endsAt - now, 0) + 50, MAX_TIMER_DELAY);
}

/*
 * 첫 페인트 전에 HTML 파싱 중 동기 실행되는 스크립트(Next 16 가이드 'Preventing Flash Before Hydration').
 * 서버는 공지를 결정적으로 그린다(첫 공지 바·첫 스트립만 보이고 나머지는 hidden). 이 스크립트가 같은 탭의 닫힘 기록,
 * 하드 로드마다 한 번 뽑는 시드, 지금 시각(data-notice-ends가 지난 공지는 숨김 — 오래된 정적 HTML·캐시 대비)으로
 * hidden을 고친 뒤 판정 시각을 남기고, 클라이언트 컴포넌트가 같은 저장소·시드·시각을 읽어 같은 결과로 하이드레이트한다.
 * 스트립 이미지의 loading은 건드리지 않는다: 이 스크립트는 파서 차단 인라인 스크립트라 head 스타일시트가 끝난 뒤(첫 페인트
 * 직전)에야 돌므로, 여기서 고른 후보를 그제야 받기 시작하면 첫 페인트에 늦는다. 그래서 후보는 모두 eager로 그린다(l8a-qa-1).
 * 데이터를 문자열에 끼워 넣지 않는 고정 문자열이라 운영 입력이 스크립트를 깨뜨릴 수 없다.
 */
export const SHELL_NOTICE_SCRIPT = `(function(){try{var w=window,d=document,g=${JSON.stringify(SHELL_NOTICE_SEED_GLOBAL)},now=Date.now();`
  + `if(typeof w[g]!=='number'||!(w[g]>=0&&w[g]<1))w[g]=Math.random();`
  + `w[${JSON.stringify(SHELL_NOTICE_NOW_GLOBAL)}]=now;`
  + `var root=d.getElementById(${JSON.stringify(SHELL_NOTICE_ROOT_ID)});if(!root)return;`
  + `var closed=[];try{var raw=JSON.parse(w.sessionStorage.getItem(${JSON.stringify(SHELL_NOTICE_DISMISSED_KEY)})||'[]');if(raw instanceof Array)closed=raw}catch(e){}`
  + `var live=function(el){var end=el.getAttribute('data-notice-ends');return end===null||Number(end)>now};`
  + `var bars=root.querySelectorAll('[data-notice-bar]'),shown=false,i;`
  + `for(i=0;i<bars.length;i++){var k=bars[i].getAttribute('data-notice-bar');if(shown||closed.indexOf(k)>=0||!live(bars[i])){bars[i].setAttribute('hidden','')}else{bars[i].removeAttribute('hidden');shown=true}}`
  + `var strips=root.querySelectorAll('[data-notice-strip]'),n=strips.length,pick=-1;`
  + `if(n){var start=Math.min(n-1,Math.floor(w[g]*n));for(i=0;i<n&&pick<0;i++){if(live(strips[(start+i)%n]))pick=(start+i)%n}`
  + `for(i=0;i<n;i++){if(i===pick){strips[i].removeAttribute('hidden')}else{strips[i].setAttribute('hidden','')}}}`
  + `}catch(e){}})();`;

/** 클라이언트가 읽는 시드 — 스크립트가 없거나(SSR·차단) 값이 이상하면 0(서버가 그린 첫 스트립). */
export function readShellNoticeSeed(scope: Record<string, unknown> | null): number {
  const value = scope?.[SHELL_NOTICE_SEED_GLOBAL];
  return typeof value === 'number' && value >= 0 && value < 1 ? value : 0;
}

/** 스크립트가 남긴 판정 시각. 없거나 이상하면 null. */
export function readShellNoticeNow(scope: Record<string, unknown> | null): number | null {
  const value = scope?.[SHELL_NOTICE_NOW_GLOBAL];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 컴포넌트의 첫 판정 시각. 서버 렌더(scope 없음)는 null — 시각으로 거르지 않는다. 하이드레이션은 스크립트가 쓴 시각을 그대로
 * 써서 스크립트가 고친 DOM과 같은 결과를 낸다. 스크립트 시각을 쓴 뒤(forgetShellNoticeNow)나 스크립트가 없을 때는 지금 시각이다
 * — 전용 셸 화면을 다녀와 다시 마운트돼도 하드 로드 때 시각으로 끝난 공지를 잠깐 보이지 않는다.
 */
export function initialShellNoticeNow(scope: Record<string, unknown> | null, clock: () => number = Date.now): number | null {
  if (!scope) return null;
  return readShellNoticeNow(scope) ?? clock();
}

/** 하이드레이션이 끝나면 스크립트 시각을 지운다 — 이후 마운트는 지금 시각으로 판정한다. */
export function forgetShellNoticeNow(scope: Record<string, unknown> | null): void {
  if (scope) delete scope[SHELL_NOTICE_NOW_GLOBAL];
}
