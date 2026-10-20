import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { transactionInput, transactionQuote } from '@/test/fixtures/cart-transaction';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, effect: null as null | (() => void | (() => void)), deps: [] as unknown[], cleanup: undefined as undefined | (() => void) }));
const mocks = vi.hoisted(() => ({ quote: vi.fn() }));
vi.mock('react', () => ({ useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.states)) hooks.states[i] = initial; return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? next(hooks.states[i]) : next; }]; }, useEffect: (effect: () => void | (() => void), deps: unknown[]) => { if (deps.length !== hooks.deps.length || deps.some((value, i) => value !== hooks.deps[i])) { hooks.cleanup?.(); hooks.deps = deps; hooks.effect = effect; } } }));
vi.mock('@/app/checkout/transaction-actions', () => ({ quoteCartTransactionAction: mocks.quote }));
import { useCartTransactionQuote as runQuoteHook } from './useCartTransactionQuote';
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function render(input = transactionInput, enabled = true, paused = false) { hooks.index = 0; const result = runQuoteHook(input, enabled, paused); if (hooks.effect) { hooks.cleanup = hooks.effect() || undefined; hooks.effect = null; } return result; }
beforeEach(() => { hooks.states = []; hooks.index = 0; hooks.deps = []; hooks.effect = null; hooks.cleanup = undefined; vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T03:05:00Z')); vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' })); mocks.quote.mockResolvedValue({ ok: true, quote: transactionQuote, offers: [] }); });
afterEach(() => { hooks.cleanup?.(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('배송지 변경 즉시 이전 금액을 숨기며 늦은 이전 응답을 버린다', async () => {
  const first = deferred(), second = deferred(); mocks.quote.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  render(); await vi.advanceTimersByTimeAsync(300);
  const changed = { ...transactionInput, address: { ...transactionInput.address, address1: '새 주소' } };
  expect(render(changed).result).toBeNull(); await vi.advanceTimersByTimeAsync(300);
  second.resolve({ ok: true, quote: transactionQuote, offers: [] }); await Promise.resolve();
  expect(render(changed).result?.ok).toBe(true);
  first.resolve({ ok: false, error: 'unavailable' }); await Promise.resolve(); expect(render(changed).result?.ok).toBe(true);
});
it('복구·전송 중에는 자동 견적 발급을 멈추고 계정 차단 시 기존 결과를 숨긴다', async () => {
  render(); await vi.advanceTimersByTimeAsync(300); expect(render().result?.ok).toBe(true);
  render(transactionInput, true, true); await vi.advanceTimersByTimeAsync(60000); expect(mocks.quote).toHaveBeenCalledTimes(1);
  expect(render(transactionInput, false, true).result).toBeNull();
});
it('백그라운드에 있는 동안 만료되는 견적은 재사용하지 않는다', async () => {
  render(); await vi.advanceTimersByTimeAsync(300); expect(render().result?.ok).toBe(true);
  Object.assign(document, { visibilityState: 'hidden' }); await vi.advanceTimersByTimeAsync(60000); expect(render().result).toBeNull();
  Object.assign(document, { visibilityState: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); expect(render().result?.ok).toBe(true);
});
