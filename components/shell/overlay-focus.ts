/*
 * 모달 오버레이 Tab 순환(useOverlayA11y)의 순수 판정.
 *
 * 선택자에 걸리는 포커서블이 모두 Tab 이 닿는 요소는 아니다 — 숨김(hidden·display none·visibility hidden·접힌 details 안)·
 * inert 안·tabIndex 음수 요소는 순서에서 빠진다. 그런 요소가 순환의 처음·끝 후보가 되면 활성 요소가 끝 후보와 같아지는 순간이
 * 오지 않아 되감지 못하고, Tab 이 대화상자 밖으로 샌다. 그래서 실제로 닿는 요소만 경계로 삼는다.
 */

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* DOM 중 쓰는 면만 받는다 — 테스트는 가짜 요소로 돌린다. */
export interface FocusCandidate {
  readonly tabIndex: number;
  closest(selectors: string): unknown;
  checkVisibility?(options?: CheckVisibilityOptions): boolean;
}

export function isTabbable(element: FocusCandidate): boolean {
  if (element.tabIndex < 0) return false;
  if (element.closest('[inert], [hidden]')) return false;
  /* 상자 없음(조상 포함 display none·접힌 details 안)과 visibility hidden 을 거른다. 두 옵션 이름은 구·신 표기다.
     지원하지 않는 브라우저는 앞의 판정만 쓴다. */
  return element.checkVisibility?.({ checkVisibilityCSS: true, visibilityProperty: true }) ?? true;
}

export function tabbableIn<T extends FocusCandidate>(panel: { querySelectorAll(selectors: string): ArrayLike<T> } | null | undefined): T[] {
  return panel ? Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isTabbable) : [];
}

/**
 * Tab·Shift+Tab 을 가로챌 때 옮길 곳. null 이면 브라우저 기본 이동에 맡긴다.
 * - 끝 후보에서 Tab → 처음, 처음 후보에서 Shift+Tab → 끝.
 * - 포커스가 패널 밖에 있으면(배경 클릭으로 body 등) 방향에 맞는 경계로 되돌린다.
 * - 패널 자신(tabIndex -1 상자)에서 Shift+Tab 은 패널 앞, 곧 밖으로 가므로 끝으로 보낸다.
 */
export function trapFocusTarget<T>(
  items: readonly T[],
  active: unknown,
  { backward, inside, onPanel }: { backward: boolean; inside: boolean; onPanel: boolean },
): T | null {
  if (items.length === 0) return null;
  const first = items[0];
  const last = items[items.length - 1];
  if (backward) return !inside || onPanel || active === first ? last : null;
  return !inside || active === last ? first : null;
}
