import { isCardRewardDestination, isCommunityDestination, type NoticeStrip } from './home-catalog';
import { isGoodDetailPath } from './routes';

/*
 * 전역 셸 공지(텍스트 공지 바 · 이미지 스트립)의 공용 계약.
 * 로더(lib/notice-strip.server.ts)는 쿠키 없는 캐시 읽기로 유효한 공지 전체를 내려보내고(#325 — 법적 문서 SSG 유지),
 * 대상 화면 판정·같은 탭 닫힘·스트립 무작위 선택은 클라이언트(components/shell/ShellNotices.tsx)가 이 모듈로 한다.
 * 첫 페인트 전에 도는 인라인 스크립트(SHELL_NOTICE_SCRIPT)도 같은 규칙을 따른다 — 둘이 어긋나면 하이드레이션이 깨진다.
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
}

export interface ShellNoticeStrip extends NoticeStrip {
  /** null = 대상을 지정하지 않은 기존 스트립(모든 셸 화면). */
  pageTypes: readonly ShellNoticePageType[] | null;
}

export interface ShellNotices {
  bars: ShellNoticeBar[];
  strips: ShellNoticeStrip[];
}

export const EMPTY_SHELL_NOTICES: ShellNotices = { bars: [], strips: [] };

export const SHELL_NOTICE_ROOT_ID = 'wc-shell-notices';
export const SHELL_NOTICE_DISMISSED_KEY = 'icons:notice-dismissed:v1';
/** 인라인 스크립트가 하드 로드마다 한 번 뽑는 스트립 선택 시드(0 이상 1 미만). */
export const SHELL_NOTICE_SEED_GLOBAL = '__iconsShellNoticeSeed';
const DISMISSED_LIMIT = 50;

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
export function rememberDismissedNotice(storage: Pick<Storage, 'getItem' | 'setItem'> | null, key: string): string[] {
  const next = [...readDismissedNoticeKeys(storage).filter((entry) => entry !== key), key].slice(-DISMISSED_LIMIT);
  try {
    storage?.setItem(SHELL_NOTICE_DISMISSED_KEY, JSON.stringify(next));
  } catch {
    /* 사생활 모드 등 저장 불가 — 닫힘은 이 화면의 상태로만 남는다. */
  }
  return next;
}

/** 운영 순서에서 닫지 않은 첫 공지 바. 하나만 보인다. */
export function firstVisibleNoticeBar(bars: readonly ShellNoticeBar[], dismissed: readonly string[]): ShellNoticeBar | null {
  return bars.find((bar) => !dismissed.includes(bar.key)) ?? null;
}

/** 시드 → 스트립 후보 인덱스. 후보가 없으면 -1. */
export function noticeStripIndex(seed: number, count: number): number {
  if (count < 1) return -1;
  const safe = Number.isFinite(seed) && seed >= 0 && seed < 1 ? seed : 0;
  return Math.min(count - 1, Math.floor(safe * count));
}

/*
 * 첫 페인트 전에 HTML 파싱 중 동기 실행되는 스크립트(Next 16 가이드 'Preventing Flash Before Hydration').
 * 서버는 공지를 결정적으로 그린다(첫 공지 바·첫 스트립만 보이고 나머지는 hidden). 이 스크립트가 같은 탭의 닫힘 기록과
 * 하드 로드마다 한 번 뽑는 시드로 hidden을 고친 뒤, 클라이언트 컴포넌트가 같은 저장소·시드를 읽어 같은 결과로 하이드레이트한다.
 * 데이터를 문자열에 끼워 넣지 않는 고정 문자열이라 운영 입력이 스크립트를 깨뜨릴 수 없다.
 */
export const SHELL_NOTICE_SCRIPT = `(function(){try{var w=window,d=document,g=${JSON.stringify(SHELL_NOTICE_SEED_GLOBAL)};`
  + `if(typeof w[g]!=='number'||!(w[g]>=0&&w[g]<1))w[g]=Math.random();`
  + `var root=d.getElementById(${JSON.stringify(SHELL_NOTICE_ROOT_ID)});if(!root)return;`
  + `var closed=[];try{var raw=JSON.parse(w.sessionStorage.getItem(${JSON.stringify(SHELL_NOTICE_DISMISSED_KEY)})||'[]');if(raw instanceof Array)closed=raw}catch(e){}`
  + `var bars=root.querySelectorAll('[data-notice-bar]'),shown=false,i;`
  + `for(i=0;i<bars.length;i++){var k=bars[i].getAttribute('data-notice-bar');if(shown||closed.indexOf(k)>=0){bars[i].setAttribute('hidden','')}else{bars[i].removeAttribute('hidden');shown=true}}`
  + `var strips=root.querySelectorAll('[data-notice-strip]');`
  + `if(strips.length){var pick=Math.min(strips.length-1,Math.floor(w[g]*strips.length));`
  + `for(i=0;i<strips.length;i++){if(i===pick){strips[i].removeAttribute('hidden')}else{strips[i].setAttribute('hidden','')}}}`
  + `}catch(e){}})();`;

/** 클라이언트가 읽는 시드 — 스크립트가 없거나(SSR·차단) 값이 이상하면 0(서버가 그린 첫 스트립). */
export function readShellNoticeSeed(scope: Record<string, unknown> | null): number {
  const value = scope?.[SHELL_NOTICE_SEED_GLOBAL];
  return typeof value === 'number' && value >= 0 && value < 1 ? value : 0;
}
