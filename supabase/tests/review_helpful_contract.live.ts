import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseGoodsGroupReviewHelpfulPage, parseReviewHelpfulState } from '../../lib/review-helpful';
import { parseTypedReviewPage } from '../../lib/review-types';
import { loadGoodReviewSection } from '../../lib/reviews.server';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), sign: vi.fn(), disclosures: vi.fn() }));
vi.mock('../../lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('../../lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc, storage: { from: () => ({ createSignedUrl: mocks.sign }) } }) }));
vi.mock('@/lib/review-events.server', () => ({ loadReviewEventDisclosures: mocks.disclosures }));
const file = process.env.REVIEW_HELPFUL_DTO_FILE;
if (!file) throw new Error('REVIEW_HELPFUL_DTO_FILE must name the owned-clone actual SQL capture');
const captures: { kind: string; value: unknown }[] = JSON.parse(readFileSync(file, 'utf8'));
const kinds = ['authenticated', 'guest', 'suspended', 'expired'];
const pages = captures.filter(c => kinds.includes(c.kind));
const typedPages = captures.filter(c => kinds.some(kind => c.kind === `typed_${kind}`));
const options = { sort: 'helpful_desc' as const, photoOnly: false, page: 1 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.disclosures.mockResolvedValue(new Map());
  mocks.sign.mockImplementation(async (path: string) => ({ error: null, data: { signedUrl: `https://example.test/${path}` } }));
});
describe('actual owned-clone SQL DTO to production helpful contract', () => {
  it('captures every required identity variant for both public contracts', () => {
    expect(pages.map(p => p.kind).sort()).toEqual([...kinds].sort());
    expect(typedPages.map(p => p.kind).sort()).toEqual(kinds.map(kind => `typed_${kind}`).sort());
  });
  for (const capture of pages) {
    it(`strict page parser accepts ${capture.kind} actual SQL JSON`, () => {
      expect(parseGoodsGroupReviewHelpfulPage(capture.value)).toEqual(capture.value);
    });
  }
  for (const capture of typedPages) {
    it(`typed page parser accepts ${capture.kind} actual v3 SQL JSON`, () => {
      expect(parseTypedReviewPage(capture.value)).toEqual(capture.value);
    });
    it(`production loader preserves ${capture.kind} SQL metrics`, async () => {
      mocks.rpc.mockImplementation(async (name: string) => name === 'get_good_group_reviews_v3'
        ? { error: null, data: capture.value }
        : { error: new Error(`Unexpected RPC: ${name}`), data: null });
      const result = await loadGoodReviewSection('helpful-a', options);
      const page = parseTypedReviewPage(capture.value)!;
      expect(result.unavailable).toBeUndefined();
      expect(result).toMatchObject({ grouped: page.grouped, summary: page.summary, total: page.total, viewerAuthenticated: page.viewerAuthenticated });
      expect(result.reviews.map(({ id, helpfulCount, helpfulByMe, canMarkHelpful, isMine, kind, repeatPurchase }) => ({ id, helpfulCount, helpfulByMe, canMarkHelpful, isMine, kind, repeatPurchase })))
        .toEqual(page.reviews.map(({ id, helpfulCount, helpfulByMe, canMarkHelpful, isMine, kind, repeatPurchase }) => ({ id, helpfulCount, helpfulByMe, canMarkHelpful, isMine, kind, repeatPurchase })));
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(mocks.rpc).toHaveBeenCalledWith('get_good_group_reviews_v3', { p_good_id: 'helpful-a', p_kind: 'all', p_repeat: 'all', p_limit: 10, p_offset: 0, p_photo_only: false, p_sort: 'helpful_desc' });
    });
  }
  it('strict write parser accepts actual SQL receipt', () => {
    const value = captures.find(c => c.kind === 'marked')?.value;
    expect(parseReviewHelpfulState(value)).toEqual(value);
  });
});
