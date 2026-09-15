import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAdminGoodsReadiness, parseGoodsReadiness } from './goods-readiness.server';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
const ready = { state: 'ready', checkedAt: '2026-09-15T03:00:00.000Z', publication: 'published', operation: 'active',
  availableQty: 11, publicReview: 'current', saleSettings: 'ready', reviewRequired: false, reasonCodes: [], blockingCodes: [] };
beforeEach(() => vi.clearAllMocks());
describe('server goods readiness projection', () => {
  it('retains server supply and the distinct current review/publication axes', () => {
    expect(parseGoodsReadiness(ready)).toMatchObject({ state: 'ready', availableQty: 11, publicReview: 'current', publication: 'published', reasons: [] });
    const legacy = parseGoodsReadiness({ ...ready, state: 'review_required', publicReview: 'legacy_unrecorded', reviewRequired: true, reasonCodes: ['kc_legacy_unrecorded'] });
    expect(legacy.saleSettings).toBe('ready');
    expect(legacy.reasons[0]).toMatchObject({ label: '기존 공개 · KC 미기록', target: 'kc', kind: 'review' });
  });
  it('turns unsupported, missing and failed reads into actionable unknown, never ready/zero', async () => {
    for (const raw of [null, {}, { ...ready, availableQty: undefined }, { ...ready, state: 'future' }, { ...ready, reasonCodes: ['new_unknown_policy'] }]) {
      expect(parseGoodsReadiness(raw)).toMatchObject({ state: 'unknown', availableQty: null, reviewRequired: true });
    }
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private diagnostic' } });
    expect(await loadAdminGoodsReadiness('item')).toMatchObject({ state: 'unknown', checkedAt: null });
    mocks.rpc.mockResolvedValue({ data: ready, error: null });
    expect(await loadAdminGoodsReadiness('item')).toMatchObject({ state: 'ready' });
  });
  it('links server reasons to the correct existing work areas', () => {
    const blocked = parseGoodsReadiness({ ...ready, state: 'blocked', saleSettings: 'blocked', reviewRequired: true,
      reasonCodes: ['notice_missing', 'stock_unavailable', 'payment_disabled', 'stopped'], blockingCodes: ['notice_missing', 'stock_unavailable', 'payment_disabled', 'stopped'] });
    expect(blocked.reasons.map(reason => reason.target)).toEqual(['notice', 'variants', 'sale', 'basic']);
    expect(blocked.reasons.every(reason => reason.kind === 'blocking')).toBe(true);
  });
});
