import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/lib/cart';
import type { GoodsSalesPrecheckoutQuote } from '@/lib/goods-sales';
import type { GoodsSalesPrecheckoutQuoteActionResult } from '@/app/cart/sales-actions';
import { goodsSalesPrecheckoutQuote } from '@/test/fixtures/goods-sales-precheckout';

const hooks = vi.hoisted(() => ({ states: [] as unknown[], stateIndex: 0, effects: [] as (() => void | (() => void))[] }));
const mocks = vi.hoisted(() => ({ legacy: vi.fn(), precheckout: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (next: unknown) => {
      hooks.states[index] = typeof next === 'function' ? (next as (old: unknown) => unknown)(hooks.states[index]) : next;
    }];
  },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
vi.mock('@/app/cart/sales-actions', () => ({ quoteGoodsSalesAction: mocks.legacy, quoteGoodsSalesPrecheckoutAction: mocks.precheckout }));
import { useGoodsSalesPrecheckoutQuote, useShippingQuote } from './useShippingQuote';

const items: CartItem[] = goodsSalesPrecheckoutQuote.lines.map(({ goodId, variantId, qty }) => ({ goodId, variantId, qty }));
let listeners: Record<string, () => void>;
function PrecheckoutHookHarness(input = items, enabled = true) {
  hooks.stateIndex = 0; hooks.effects = [];
  return useGoodsSalesPrecheckoutQuote(input, enabled);
}
async function flush() { await Promise.resolve(); await Promise.resolve(); }
function deferred() {
  let resolve!: (value: GoodsSalesPrecheckoutQuoteActionResult) => void;
  const promise = new Promise<GoodsSalesPrecheckoutQuoteActionResult>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date(goodsSalesPrecheckoutQuote.calculatedAt));
  hooks.states = []; hooks.stateIndex = 0; hooks.effects = []; listeners = {};
  vi.stubGlobal('window', { addEventListener: (name: string, listener: () => void) => { listeners[name] = listener; }, removeEventListener: vi.fn() });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: (name: string, listener: () => void) => { listeners[name] = listener; }, removeEventListener: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('cart quote polling contracts', () => {
  it('runs only the enabled product action and aggregates variant quantities without a destination', async () => {
    mocks.precheckout.mockResolvedValue({ ok: true, quote: goodsSalesPrecheckoutQuote });
    const duplicates = [{ ...items[0], qty: 1 }, { ...items[0], qty: 1 }];
    hooks.stateIndex = 0;
    const legacy = useShippingQuote(duplicates, false);
    useGoodsSalesPrecheckoutQuote(duplicates, true);
    const cleanups = hooks.effects.map((effect) => effect()); await flush();
    expect(mocks.legacy).not.toHaveBeenCalled(); expect(legacy.quote).toBeNull();
    expect(mocks.precheckout).toHaveBeenCalledExactlyOnceWith(items);
    cleanups.forEach((cleanup) => cleanup?.());
    expect(vi.getTimerCount()).toBe(0);
  });
  it('refreshes at product nextChangeAt while deferred shipping has no timestamp or fee', async () => {
    const initial = { ...goodsSalesPrecheckoutQuote, nextChangeAt: '2026-10-15T00:00:01Z' };
    mocks.precheckout.mockResolvedValueOnce({ ok: true, quote: initial })
      .mockResolvedValue({ ok: true, quote: { ...goodsSalesPrecheckoutQuote, nextChangeAt: null } });
    expect(PrecheckoutHookHarness().loading).toBe(true);
    const cleanup = hooks.effects[0](); await flush();
    expect(PrecheckoutHookHarness().sales?.shipping).toEqual({ status: 'checkout_required' });
    await vi.advanceTimersByTimeAsync(1024); expect(mocks.precheckout).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(mocks.precheckout).toHaveBeenCalledTimes(2);
    expect(PrecheckoutHookHarness().error).toBeNull(); cleanup?.();
  });
  it('discards older focus requests and hides a cached quote after the hook is disabled', async () => {
    const first = deferred(), latest = deferred();
    mocks.precheckout.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise);
    PrecheckoutHookHarness(); const cleanup = hooks.effects[0]();
    listeners.focus();
    const updated: GoodsSalesPrecheckoutQuote = { ...goodsSalesPrecheckoutQuote, subtotal: 14000,
      lines: [{ ...goodsSalesPrecheckoutQuote.lines[0], effectivePrice: 7000 }] };
    latest.resolve({ ok: true, quote: updated }); await flush();
    first.resolve({ ok: true, quote: goodsSalesPrecheckoutQuote }); await flush();
    expect(PrecheckoutHookHarness().sales?.subtotal).toBe(14000);
    expect(PrecheckoutHookHarness(items, false)).toMatchObject({ sales: null, loading: false, error: null });
    cleanup?.();
  });
  it('drops a response after the cart changes and never exposes a failed quote as a free shipment', async () => {
    const pending = deferred(); mocks.precheckout.mockReturnValueOnce(pending.promise);
    PrecheckoutHookHarness(); const cleanup = hooks.effects[0](); cleanup?.();
    pending.resolve({ ok: true, quote: goodsSalesPrecheckoutQuote }); await flush();
    expect(PrecheckoutHookHarness().sales).toBeNull();
    mocks.precheckout.mockResolvedValueOnce({ ok: false, error: '상품 조건 조회 실패' });
    const nextCleanup = hooks.effects[0](); await flush();
    expect(PrecheckoutHookHarness()).toMatchObject({ sales: null, error: '상품 조건 조회 실패', loading: false });
    expect(mocks.legacy).not.toHaveBeenCalled(); nextCleanup?.();
  });
  it('preserves legacy address forwarding and the earlier shipping refresh boundary', async () => {
    const destination = { postalCode: '01234', address1: '서울 합성로 1' };
    const legacyQuote = { ...goodsSalesPrecheckoutQuote, nextChangeAt: '2026-10-15T00:00:20Z',
      shipping: { totalFee: 0, groups: [], checkoutAllowed: true, finalTotalFee: 0, destination, nextChangeAt: '2026-10-15T00:00:01Z' } };
    mocks.legacy.mockResolvedValueOnce({ ok: true, quote: legacyQuote }).mockResolvedValue({ ok: true, quote: {
      ...legacyQuote, nextChangeAt: null, shipping: { ...legacyQuote.shipping, nextChangeAt: null },
    } });
    useShippingQuote(items, true, 'coupon-selection', destination);
    const cleanup = hooks.effects[0](); await flush();
    expect(mocks.legacy).toHaveBeenCalledExactlyOnceWith(items, destination);
    expect(mocks.precheckout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1025); expect(mocks.legacy).toHaveBeenCalledTimes(2);
    cleanup?.();
  });
});
