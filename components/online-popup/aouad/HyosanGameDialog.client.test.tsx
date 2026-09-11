import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HyosanGameDialog } from './HyosanGameDialog.client';

const hooks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  refIndex: 0,
  state: [] as unknown[],
  stateIndex: 0,
  effects: [] as (() => void | (() => void))[],
}));

vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++;
    hooks.refs[index] ??= { current: initial };
    return hooks.refs[index];
  },
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => {
      hooks.state[index] = typeof next === 'function'
        ? (next as (value: unknown) => unknown)(hooks.state[index]) : next;
    }];
  },
}));

function findElement(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement | null {
  if (isValidElement(node)) {
    if (predicate(node)) return node;
    const children = (node.props as { children?: ReactNode }).children;
    for (const child of Array.isArray(children) ? children : [children]) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

function gameDocument(ready = true) {
  const listeners = new Set<EventListener>();
  const document = {
    ready,
    activeElement: null as unknown,
    querySelector: vi.fn(() => document.ready ? {} : null),
    addEventListener: vi.fn((_type: string, listener: EventListener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: EventListener) => listeners.delete(listener)),
  };
  const menu = { ownerDocument: document, querySelectorAll: () => buttons };
  const buttons = Array.from({ length: 3 }, () => ({ closest: () => menu }));
  return {
    document, menu, buttons, listeners,
    key(key: string, active: unknown, shiftKey = false, altKey = false) {
      document.activeElement = active;
      const event = { key, target: active, shiftKey, altKey, ctrlKey: false, metaKey: false,
        preventDefault: vi.fn(), stopPropagation: vi.fn() };
      for (const listener of listeners) listener(event as unknown as Event);
      return event;
    },
  };
}

function mountDialog(game = gameDocument()) {
  const onClose = vi.fn();
  hooks.refIndex = 0; hooks.stateIndex = 0; hooks.effects = [];
  const tree = HyosanGameDialog({ onClose });
  const frame = findElement(tree, element => element.type === 'iframe')!.props as {
    ref: { current: unknown }; onLoad: () => void;
  };
  const returnButton = findElement(tree, element => element.type === 'button')!.props as {
    ref?: { current: unknown }; onClick: () => void;
  };
  const focus = vi.fn();
  if (returnButton.ref) returnButton.ref.current = { focus };
  frame.ref.current = { contentDocument: game.document };
  const cleanups = hooks.effects.map(effect => effect());
  return { game, frame, focus, onClose, returnButton,
    unmount: () => { for (const cleanup of cleanups) cleanup?.(); } };
}

beforeEach(() => {
  hooks.refs = []; hooks.state = [];
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval });
});

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Hyosan iframe readiness and keyboard return', () => {
  it('leaves no polling interval or timeout when the renderer is ready at load', () => {
    const dialog = mountDialog();
    expect(vi.getTimerCount()).toBe(1);
    dialog.frame.onLoad();
    expect(vi.getTimerCount()).toBe(0);
    dialog.unmount();
  });

  it('stops both pending checks once a renderer appears after the load event', () => {
    const dialog = mountDialog(gameDocument(false));
    dialog.frame.onLoad();
    expect(vi.getTimerCount()).toBe(2);
    dialog.game.document.ready = true;
    vi.advanceTimersByTime(100);
    expect(vi.getTimerCount()).toBe(0);
    dialog.unmount();
  });

  it.each([
    { index: 0, shift: true, alt: false }, { index: 2, shift: false, alt: false },
    { index: 0, shift: true, alt: true }, { index: 2, shift: false, alt: true },
  ])(
    'moves menu boundary Tab to the host return button: %j', ({ index, shift, alt }) => {
      const dialog = mountDialog();
      dialog.frame.onLoad();
      expect(dialog.game.document.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
      const event = dialog.game.key('Tab', dialog.game.buttons[index], shift, alt);
      expect(dialog.focus).toHaveBeenCalledOnce();
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopPropagation).toHaveBeenCalledOnce();
      expect(dialog.onClose).not.toHaveBeenCalled();
      dialog.returnButton.onClick();
      expect(dialog.onClose).toHaveBeenCalledOnce();
      dialog.unmount();
    },
  );

  it('preserves in-menu Tab, ordinary Escape and controls outside a game menu', () => {
    const dialog = mountDialog();
    dialog.frame.onLoad();
    const events = [
      dialog.game.key('Tab', dialog.game.buttons[0]),
      dialog.game.key('Tab', dialog.game.buttons[2], true),
      dialog.game.key('Escape', dialog.game.buttons[0]),
      dialog.game.key('Tab', { closest: () => null }),
    ];
    for (const event of events) {
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
    }
    expect(dialog.focus).not.toHaveBeenCalled();
    expect(dialog.onClose).not.toHaveBeenCalled();
    dialog.unmount();
  });

  it('replaces the document listener on navigation and removes it on unmount', () => {
    const dialog = mountDialog();
    dialog.frame.onLoad();
    const replacement = gameDocument();
    dialog.frame.ref.current = { contentDocument: replacement.document };
    dialog.frame.onLoad();
    expect(dialog.game.listeners.size).toBe(0);
    expect(replacement.listeners.size).toBe(1);
    dialog.unmount();
    expect(replacement.listeners.size).toBe(0);
    replacement.key('Tab', replacement.buttons[0], true);
    expect(dialog.focus).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
