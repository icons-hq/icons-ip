import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 화면을 연 채 기한이 지나면 안내를 닫는지 — jsdom 없이 훅을 얇게 흉내 내 effect·타이머를 손수 돌린다
   (선례: components/shell/CartProvider.release.test.ts). */
const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  index: 0,
  effects: [] as (() => void)[],
  timers: [] as (() => void)[],
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.index++;
      if (!(index in hooks.states)) hooks.states[index] = initial;
      return [hooks.states[index], (next: unknown) => { hooks.states[index] = next; }];
    },
    useEffect: (effect: () => void) => { hooks.effects.push(effect); },
  };
});

import { BankTransferDeadlineGate } from './BankTransferDeadline';
import { bankTransferDeadlinePassed } from '@/lib/payments/bank-transfer';

function Probe({ expiresAt, initiallyPassed }: { expiresAt: string | null; initiallyPassed: boolean }) {
  return BankTransferDeadlineGate({ expiresAt, initiallyPassed, children: <p>계좌 안내</p> });
}

function render(props: { expiresAt: string | null; initiallyPassed: boolean }) {
  hooks.index = 0;
  hooks.effects = [];
  const html = renderToStaticMarkup(Probe(props));
  for (const effect of hooks.effects) effect();
  return html;
}

describe('bankTransferDeadlinePassed', () => {
  it('기한이 지났거나 모르면 입금을 안내하지 않는다', () => {
    const now = Date.parse('2026-10-27T06:00:00.000Z');
    expect(bankTransferDeadlinePassed('2026-10-27T06:00:01.000Z', now)).toBe(false);
    expect(bankTransferDeadlinePassed('2026-10-27T06:00:00.000Z', now)).toBe(true);
    expect(bankTransferDeadlinePassed(null, now)).toBe(true);
    expect(bankTransferDeadlinePassed('not-a-date', now)).toBe(true);
  });
});

describe('BankTransferDeadlineGate', () => {
  beforeEach(() => {
    hooks.states = [];
    hooks.timers = [];
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void) => { hooks.timers.push(callback); return 1; },
      setInterval: (callback: () => void) => { hooks.timers.push(callback); return 2; },
      clearTimeout: () => {},
      clearInterval: () => {},
    });
  });

  it('첫 렌더는 서버 판정을 따르고, 화면을 연 채 기한이 지나면 계좌 안내를 기한 만료 안내로 바꾼다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T05:59:59.000Z'));
    expect(render({ expiresAt: '2026-10-27T06:00:00.000Z', initiallyPassed: false })).toContain('계좌 안내');
    for (const tick of hooks.timers) tick();
    expect(render({ expiresAt: '2026-10-27T06:00:00.000Z', initiallyPassed: false })).toContain('계좌 안내');
    vi.setSystemTime(new Date('2026-10-27T06:00:01.000Z'));
    for (const tick of hooks.timers) tick();
    const html = render({ expiresAt: '2026-10-27T06:00:00.000Z', initiallyPassed: false });
    expect(html).toContain('입금 기한이 지났어요');
    expect(html).not.toContain('계좌 안내');
    vi.useRealTimers();
  });

  it('서버가 이미 기한이 지났다고 판정했으면 첫 렌더부터 계좌를 보이지 않는다', () => {
    expect(render({ expiresAt: '2026-10-27T05:00:00.000Z', initiallyPassed: true })).toContain('입금 기한이 지났어요');
  });
});
