import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ refresh: vi.fn(), effect: null as (() => (() => void)) | null }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: (effect: () => () => void) => { mock.effect = effect; } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mock.refresh }) }));
import { GoodsSalePeriodRefresh } from './GoodsSalePeriodRefresh';
import { ProductDetailRefresh } from './ProductDetailRefresh';
const period = (nextChangeAt: string) => ({ state: 'scheduled' as const, startsAt: nextChangeAt, endsAt: '2026-10-16T00:00:00Z', calculatedAt: '2026-10-13T00:00:00Z', nextChangeAt });
let listeners: Record<string, () => void>;
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T00:00:00Z')); listeners = {};
  vi.stubGlobal('window', { addEventListener: (type: string, listener: () => void) => { listeners[type] = listener; }, removeEventListener: vi.fn() });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: (type: string, listener: () => void) => { listeners[type] = listener; }, removeEventListener: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('sale period refresh boundaries', () => {
  it('chooses one earliest instant across a complete screen, without requiring stock options', () => {
    const tree = GoodsSalePeriodRefresh({ goods: [{ salePeriod: period('2026-10-14T10:00:00+09:00') }, {}, { salePeriod: period('2026-10-14T00:00:00Z') }] });
    expect(tree?.props.nextChangeAt).toBe('2026-10-14T00:00:00.000Z'); expect(GoodsSalePeriodRefresh({ goods: [{}] })).toBeNull();
  });
  it('refreshes server props once at the boundary and cleans the timer/listeners', () => {
    ProductDetailRefresh({ nextChangeAt: '2026-10-13T00:00:01Z' }); const cleanup = mock.effect!();
    vi.advanceTimersByTime(999); expect(mock.refresh).not.toHaveBeenCalled(); vi.advanceTimersByTime(51); expect(mock.refresh).toHaveBeenCalledOnce();
    listeners.focus(); listeners.visibilitychange(); expect(mock.refresh).toHaveBeenCalledOnce(); cleanup(); expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for visibility and can refresh a client-fetched collection instead of stale server props', () => {
    Object.assign(document, { visibilityState: 'hidden' }); const reload = vi.fn(); ProductDetailRefresh({ nextChangeAt: '2026-10-13T00:00:01Z', onRefresh: reload }); const cleanup = mock.effect!();
    vi.advanceTimersByTime(1100); expect(reload).not.toHaveBeenCalled(); Object.assign(document, { visibilityState: 'visible' }); listeners.visibilitychange(); expect(reload).toHaveBeenCalledOnce(); expect(mock.refresh).not.toHaveBeenCalled(); cleanup();
  });
});
