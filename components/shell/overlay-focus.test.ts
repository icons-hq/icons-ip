import { describe, expect, it, vi } from 'vitest';
import { FOCUSABLE_SELECTOR, isTabbable, tabbableIn, trapFocusTarget, type FocusCandidate } from './overlay-focus';

/* 모달 오버레이 Tab 순환(useOverlayA11y)의 경계 후보. 셸 QA(2026-10-27) — 시트의 처음·끝에 숨은 버튼이 있으면 Tab 60회 중 13회가
   대화상자 밖(배경의 선택 방문 통계 버튼)으로 샜다. jsdom 없이 쓰는 면만 흉내 낸다. */

type Fake = FocusCandidate & { name: string };
function el(name: string, { tabIndex = 0, inert = false, hidden = false, visible = true, noCheck = false } = {}): Fake {
  return {
    name,
    tabIndex,
    closest: (selectors: string) => ((inert && selectors.includes('[inert]')) || (hidden && selectors.includes('[hidden]')) ? {} : null),
    ...(noCheck ? {} : { checkVisibility: () => visible }),
  };
}

describe('Tab 이 닿는 요소', () => {
  it('보이고 순서에 든 요소만 남긴다', () => {
    expect(isTabbable(el('plain'))).toBe(true);
    expect(isTabbable(el('positive', { tabIndex: 3 }))).toBe(true);
    /* [tabindex="-1"] 만 선택자에서 빠진다 — 그 밖의 음수와 tabindex -1 을 단 링크·버튼은 여기서 거른다. */
    expect(isTabbable(el('negative', { tabIndex: -2 }))).toBe(false);
    expect(isTabbable(el('minus-one-button', { tabIndex: -1 }))).toBe(false);
    expect(isTabbable(el('inert', { inert: true }))).toBe(false);
    expect(isTabbable(el('hidden', { hidden: true }))).toBe(false);
    /* display none 조상·visibility hidden·접힌 details 안 — 렌더 판정은 checkVisibility 에 맡긴다. */
    expect(isTabbable(el('css-hidden', { visible: false }))).toBe(false);
  });

  it('렌더 판정에 visibility 까지 묻고, 지원하지 않는 브라우저는 속성 판정만 쓴다', () => {
    const checkVisibility = vi.fn(() => true);
    isTabbable({ tabIndex: 0, closest: () => null, checkVisibility });
    expect(checkVisibility).toHaveBeenCalledWith({ checkVisibilityCSS: true, visibilityProperty: true });
    expect(isTabbable(el('old-browser', { noCheck: true }))).toBe(true);
    expect(isTabbable(el('old-browser-hidden', { noCheck: true, hidden: true }))).toBe(false);
  });

  it('패널 안 후보를 선택자로 모아 DOM 순서대로 거른다', () => {
    const items = [el('hidden-first', { hidden: true }), el('close'), el('display-none', { visible: false }), el('last-tile'), el('inert-last', { inert: true })];
    const querySelectorAll = vi.fn(() => items);
    expect(tabbableIn({ querySelectorAll }).map((item) => item.name)).toEqual(['close', 'last-tile']);
    expect(querySelectorAll).toHaveBeenCalledWith(FOCUSABLE_SELECTOR);
    expect(tabbableIn(null)).toEqual([]);
    expect(FOCUSABLE_SELECTOR).toContain('input:not([disabled]):not([type="hidden"])');
  });
});

describe('Tab 순환 경계', () => {
  const [first, middle, last] = ['close', 'link', 'tile'];
  const items = [first, middle, last];

  it('끝에서 Tab 은 처음으로, 처음에서 Shift+Tab 은 끝으로 되감고 그 사이는 브라우저에 맡긴다', () => {
    expect(trapFocusTarget(items, last, { backward: false, inside: true, onPanel: false })).toBe(first);
    expect(trapFocusTarget(items, first, { backward: true, inside: true, onPanel: false })).toBe(last);
    expect(trapFocusTarget(items, middle, { backward: false, inside: true, onPanel: false })).toBeNull();
    expect(trapFocusTarget(items, middle, { backward: true, inside: true, onPanel: false })).toBeNull();
  });

  it('포커스가 패널 밖이면 방향에 맞는 경계로 되돌린다', () => {
    expect(trapFocusTarget(items, 'body', { backward: false, inside: false, onPanel: false })).toBe(first);
    expect(trapFocusTarget(items, 'body', { backward: true, inside: false, onPanel: false })).toBe(last);
  });

  it('패널 상자 자신에서 Shift+Tab 은 밖으로 가지 않고 끝으로 간다(Tab 은 첫 후보로 가는 기본 이동 그대로)', () => {
    expect(trapFocusTarget(items, 'panel', { backward: true, inside: true, onPanel: true })).toBe(last);
    expect(trapFocusTarget(items, 'panel', { backward: false, inside: true, onPanel: true })).toBeNull();
  });

  it('숨은 요소가 DOM 의 처음·끝에 있어도 경계는 보이는 요소다', () => {
    const tabbable = tabbableIn({ querySelectorAll: () => [el('qa-hidden', { hidden: true }), el('close'), el('tile'), el('qa-hidden-end', { visible: false })] });
    const names = tabbable.map((item) => item.name);
    expect(trapFocusTarget(names, 'tile', { backward: false, inside: true, onPanel: false })).toBe('close');
    expect(trapFocusTarget(names, 'close', { backward: true, inside: true, onPanel: false })).toBe('tile');
  });

  it('후보가 없으면 옮길 곳이 없다', () => {
    expect(trapFocusTarget([], 'body', { backward: false, inside: false, onPanel: false })).toBeNull();
  });
});
