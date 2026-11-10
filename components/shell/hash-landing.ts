/* 해시 착지 — 순수 판정만 둔다. HashLanding 이 DOM 에서 읽은 수치를 넘기고, 결과는 다시 세울지 말지로만 돌아간다.

   해시 대상의 머리는 화면 위 고정 크롬(html scroll-padding-top, globals.css)과 대상 자신의 scroll-margin-top 을
   더한 선에 선다. 브라우저 기본 해시 이동이 그 선에 세우지만 이 앱에서는 세 경우에 놓친다(2026-10-23 실측).
   - 새로 진입: 본문이 루트 loading 경계(app/loading.tsx) 뒤에서 스트리밍되고 React 19 가 경계 드러내기를 묶어
     늦춘다. 그 전에 load 가 끝나면 Chrome 은 숨은 대상을 찾은 채 해시 이동을 그만둬 맨 위에 머문다.
   - 늦게 드러난 블록: 이동한 뒤 대상 위쪽 경계가 드러나면 그만큼 대상이 밀려 내려간다(클라이언트 이동 포함).
   - 데스크톱 헤더 접힘·펼침: 즉시 이동(동작 줄이기)은 스크롤 앵커링이 크롬 변화(54)를 되돌려 그만큼 어긋난다.
   그래서 해시 이동 뒤 잠시 지켜보다가, 사용자가 스크롤을 넘겨받지 않았고 스크롤이 멈췄는데 대상이 선에 없으면
   다시 세운다. */

/** 반올림·서브픽셀 배치를 흡수하는 허용치(px). */
export const HASH_LANDING_TOLERANCE = 1;
/** 마지막 scroll 이벤트 뒤 이만큼 조용해야 판정한다 — 진행 중인 이동(브라우저·앱·사용자)을 끊지 않는다. */
export const HASH_LANDING_QUIET_MS = 150;
/** 대상이 그려지기(스트리밍 경계가 드러나기)를 기다리는 최대 시간. */
export const HASH_LANDING_REVEAL_MS = 10_000;
/** 대상이 처음 그려진 뒤 늦게 드러나는 블록·헤더 전환을 지켜보는 시간. */
export const HASH_LANDING_WATCH_MS = 2_500;
/** 한 번 지켜보는 동안 다시 세우는 최대 횟수 — 선에 세울 수 없는 대상(고정 배치 등)에서 되풀이하지 않는다. */
export const HASH_LANDING_MAX_MOVES = 3;

/**
 * 주소 해시가 가리킬 수 있는 요소 id 후보(원문, 디코드한 값 순 — HTML 의 indicated part 와 같은 순서).
 * 비었거나 '#top'(문서 맨 위 — 브라우저 몫)이거나 값을 실은 조각(key=value — 초대·선물 토큰)이면 비운다.
 */
export function hashTargetIds(hash: string): string[] {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw || raw.includes('=')) return [];
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* 깨진 퍼센트 인코딩은 원문으로만 찾는다. */
  }
  if (decoded.toLowerCase() === 'top') return [];
  return decoded === raw ? [raw] : [raw, decoded];
}

/** 계산된 길이 값(px). 'auto'·백분율 등 px 가 아닌 값은 0 — 이 앱은 px 로만 정한다. */
export function cssPixels(value: string): number {
  const trimmed = value.trim();
  if (!trimmed.endsWith('px')) return 0;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 대상 머리가 설 화면 위치(px) — html scroll-padding-top + 대상 scroll-margin-top(계산값). */
export function hashLandingLine(scrollPaddingTop: string, scrollMarginTop: string): number {
  return cssPixels(scrollPaddingTop) + cssPixels(scrollMarginTop);
}

/**
 * 대상이 착지선에 섰는가. 선 ±허용치 안이거나, 더 움직일 수 없어 선까지 못 가는 경우(문서 끝에 막혀 선 아래에
 * 남거나, 문서 맨 위라 선 위에 남는 경우)도 선 것으로 본다.
 */
export function isHashLanded(state: { targetTop: number; line: number; scrollY: number; maxScrollY: number }): boolean {
  const offset = state.targetTop - state.line;
  if (Math.abs(offset) <= HASH_LANDING_TOLERANCE) return true;
  if (offset > 0) return state.scrollY >= state.maxScrollY - HASH_LANDING_TOLERANCE;
  return state.scrollY <= HASH_LANDING_TOLERANCE;
}

export type HashLandingStep = 'landed' | 'move' | 'leave';

/**
 * 조용해진 뒤 한 번의 판정. 선에 섰으면 landed. 아니면 다시 세우는데(move), 앞서 선에 선 것을 본 뒤로 스크롤 위치가
 * 바뀌었다면 앱이 옮긴 것이 아니다 — 휠·터치·키 없이 스크롤바를 끌거나 자동 스크롤한 사용자이므로 놓아준다(leave).
 * 늦게 드러난 블록에 밀린 대상은 스크롤 위치는 그대로라 다시 세운다. 앱이 다시 세우면 기준점(lastLandedScrollY)은
 * 지운다 — 그 이동 자체를 사용자의 스크롤로 오인하지 않게.
 */
export function nextHashLandingStep(state: { landed: boolean; scrollY: number; lastLandedScrollY: number | null }): HashLandingStep {
  if (state.landed) return 'landed';
  if (state.lastLandedScrollY !== null && Math.abs(state.scrollY - state.lastLandedScrollY) > HASH_LANDING_TOLERANCE) return 'leave';
  return 'move';
}

/**
 * 문서를 처음 열 때 해시를 맞출지. 새 이동은 맞추고, 뒤로·앞으로 가기는 브라우저의 스크롤 복원에 맡긴다.
 * 새로고침도 복원에 맡기되, 페이지가 복원을 끄고 다시 연 경우(scrollRestoration = 'manual' — 리뷰 링크)는 맞춘다.
 */
export function shouldLandOnLoad(navigationType: string | undefined, scrollRestoration: string): boolean {
  if (navigationType === 'back_forward') return false;
  if (navigationType === 'reload') return scrollRestoration === 'manual';
  return true;
}

export interface HashLandingLocation {
  pathname: string;
  hash: string;
}

/**
 * 클라이언트 이동(Link·router.push) 뒤 해시를 맞출지 — 해시가 있고 경로가 바뀌었거나 해시가 새로 붙거나 바뀐 이동만.
 * 같은 경로·같은 해시에서 검색어만 바뀐 경우(옵션 선택이 주소를 바꾸는 replaceState, 같은 목록 안 페이지 이동)는
 * 사용자가 읽던 자리를 지킨다 — 그런 이동의 해시 스크롤은 Next 가 맡는다.
 * 뒤로·앞으로 가기(popstate)로 온 경우는 브라우저 스크롤 복원에 맡긴다 — 문서를 열 때의 back_forward 와 같다.
 */
export function shouldLandAfterNavigation(
  previous: HashLandingLocation,
  next: HashLandingLocation,
  { traversal = false }: { traversal?: boolean } = {},
): boolean {
  if (traversal || !hashTargetIds(next.hash).length) return false;
  return previous.pathname !== next.pathname || previous.hash !== next.hash;
}

/**
 * 같은 문서 안 해시 이동(hashchange) 뒤 맞출지 — 새 해시가 착지 대상이면 맞춘다. 뒤로·앞으로 가기로 바뀐 해시도
 * 같다: Chrome 은 같은 문서 기록 이동에서 저장된 자리 대신 해시 위치로 다시 옮기므로(2026-10-22 실측) 같은 선에
 * 세울 뿐이다. 해시가 비었거나 착지 대상이 아니면 맞추지 않는다 — 어느 경우든 앞선 감시는 먼저 끊는다(HashLanding).
 */
export function shouldLandOnHashChange(hash: string): boolean {
  return hashTargetIds(hash).length > 0;
}
