import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 효과를 바로 돌리고 정리 함수를 모아 둔다 — 겹친 오버레이의 키 처리만 본다(배경 inert·포커스 이동은 다른 시험이 본다). */
const hooks = vi.hoisted(() => ({ cleanups: [] as (() => void)[] }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => void | (() => void)) => { const cleanup = effect(); if (cleanup) hooks.cleanups.push(cleanup); },
}));

import { useOverlayA11y } from './useOverlayA11y';

type Listener = (event: { key: string; shiftKey?: boolean; preventDefault(): void }) => void;
const listeners = new Set<Listener>();
const fakeDocument = {
  activeElement: null,
  body: { style: { overflow: '', setProperty: vi.fn() } },
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
  removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
};
const panel = () => ({ current: { ownerDocument: fakeDocument, contains: () => false } as unknown as HTMLElement });
const focusTarget = () => ({ current: { focus: vi.fn() } as unknown as HTMLElement });
const press = (key: string) => { for (const listener of [...listeners]) listener({ key, preventDefault: vi.fn() }); };

beforeEach(() => {
  for (const cleanup of hooks.cleanups.splice(0)) cleanup();
  listeners.clear();
});

/* 주문서 배송지 시트 위에 공동주택 확인창이 뜨는 것처럼 오버레이가 겹치면, 키는 가장 나중에 열린 오버레이만 받는다. */
describe('useOverlayA11y — 겹친 오버레이', () => {
  it('Escape 는 위 오버레이만 닫고, 위가 닫히면 아래 오버레이가 다시 받는다', () => {
    const closeSheet = vi.fn();
    const closeConfirm = vi.fn();
    useOverlayA11y({ open: true, onClose: closeSheet, panelRef: panel(), initialFocusRef: focusTarget() });
    useOverlayA11y({ open: true, onClose: closeConfirm, panelRef: panel(), initialFocusRef: focusTarget() });

    press('Escape');
    expect(closeConfirm).toHaveBeenCalledTimes(1);
    expect(closeSheet).not.toHaveBeenCalled();

    hooks.cleanups.pop()!();
    press('Escape');
    expect(closeSheet).toHaveBeenCalledTimes(1);
    expect(closeConfirm).toHaveBeenCalledTimes(1);
  });
});
