import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));

import { readGoodsDisplayVisibility, resolveGoodReferences } from './good-references.server';

const at = '2026-11-12T00:00:00Z';
const variant = { price: 1000, pricing: { regularPrice: 1000, effectivePrice: 1000, pricePeriodId: null, startsAt: null, endsAt: null, calculatedAt: at, nextChangeAt: null },
  supply: { mode: 'stock', state: 'stock', availableQty: 5, policyId: null, policyRevision: null, startsAt: null, endsAt: null, expectedShipDate: null, calculatedAt: at, nextChangeAt: null } };
const candidate = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `QA ${id}`, code: id.toUpperCase(), price: 1000, compareAtPrice: null, showDiscountRate: false,
  badge: null, imagePath: null, bg: '#eee', stock: 'ok', archived: false, published: true, visibility: 'public', variants: [variant],
  reviewCount: 0, ratingAverage: null, wishCount: 0, salesQuantity: 0, freeShipping: false, discounted: false, saleType: 'stock', ...extra });
const found = (ref: string, extra: Record<string, unknown> = {}) => ({ ref, status: 'found', matchedBy: 'id', id: ref, name: `QA ${ref}`, code: ref.toUpperCase(),
  archived: false, published: true, candidate: candidate(ref), ...extra });

beforeEach(() => { vi.clearAllMocks(); });

/* QA1 MD 후속: 여러 줄 추가 결과는 후보 행이 싣는 이유로, 저장된 구성 다시 열기는 가벼운 읽기의 이유로 고객 화면 노출을 나눈다. */
describe('전시 상품 조회의 고객 화면 노출 이유', () => {
  it('여러 줄 추가 결과는 후보 행의 이유를 쓰고, 보관·못 찾음·이유 없는 옛 응답은 지어내지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: null, data: [
      found('qa-pr1'),
      found('qa-pr9', { published: false, candidate: candidate('qa-pr9', { published: false, visibility: 'draft' }) }),
      found('qa-old', { archived: true, published: false, candidate: null }),
      { ref: 'nope', status: 'not_found', matchedBy: null, id: null, name: null, code: null, archived: false, published: false, candidate: null },
      found('qa-legacy', { published: false, candidate: candidate('qa-legacy', { published: false, visibility: undefined }) }),
    ] });
    const matches = await resolveGoodReferences(['qa-pr1', 'qa-pr9', 'qa-old', 'nope', 'qa-legacy']);
    expect(matches.map(match => match.visibility)).toEqual(['public', 'draft', 'archived', 'missing', 'hidden']);
  });
  it('가벼운 읽기는 이름·판매자상품코드·이유만 받고, 묻지 않은 상품번호나 모르는 이유는 실패로 본다', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: null, data: [{ id: 'qa-pr1', name: 'QA 1', code: 'QA-PR1', visibility: 'public' }, { id: 'qa-ip', name: 'QA IP', code: null, visibility: 'ip_draft' }] });
    expect(await readGoodsDisplayVisibility(['qa-pr1', 'qa-ip', 'qa-gone'])).toEqual([
      { id: 'qa-pr1', name: 'QA 1', code: 'QA-PR1', visibility: 'public' }, { id: 'qa-ip', name: 'QA IP', code: null, visibility: 'ip_draft' }]);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_goods_display_visibility', { p_ids: ['qa-pr1', 'qa-ip', 'qa-gone'] });
    mocks.rpc.mockResolvedValueOnce({ error: null, data: [{ id: 'other', name: 'X', code: null, visibility: 'public' }] });
    await expect(readGoodsDisplayVisibility(['qa-pr1'])).rejects.toThrow('상품을 확인하지 못했습니다');
    mocks.rpc.mockResolvedValueOnce({ error: null, data: [{ id: 'qa-pr1', name: 'X', code: null, visibility: 'unpublished' }] });
    await expect(readGoodsDisplayVisibility(['qa-pr1'])).rejects.toThrow('상품을 확인하지 못했습니다');
    await expect(readGoodsDisplayVisibility(['qa-pr1', 'qa-pr1'])).rejects.toThrow('조회할 상품 URL');
  });
});
