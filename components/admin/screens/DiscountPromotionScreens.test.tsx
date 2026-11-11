import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/admin/discount-promotion-actions', () => ({
  previewDiscountPromotionAction: vi.fn(), commitDiscountPromotionAction: vi.fn(), readDiscountPromotionAction: vi.fn(), stopDiscountPromotionAction: vi.fn(),
}));
vi.mock('@/app/admin/category-display-actions', () => ({ searchCategoryDisplayGoodsAction: vi.fn(() => new Promise(() => {})) }));

import { DiscountPromotionDetailScreen } from './DiscountPromotionDetailScreen';
import { DiscountPromotionEditorScreen } from './DiscountPromotionEditorScreen';
import { DiscountPromotionListScreen } from './DiscountPromotionListScreen';
import type { DiscountPromotionDetail, DiscountPromotionSummary } from '@/lib/admin/discount-promotions';

const ID = '6f1c2a9e-3d4b-4c5d-8e6f-7a8b9c0d1e2f';
const identity = { actorId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222' };
const summary: DiscountPromotionSummary = {
  id: ID, name: '홍실 오픈 기획전 10%', state: 'active', startsAt: '2026-11-20T00:00:00+00:00', endsAt: '2026-11-30T00:00:00+00:00',
  target: { kind: 'campaign', id: 'hongsil-open', label: '홍실 오픈 기획전' }, rule: { mode: 'rate', value: 10 },
  goodsCount: 3, appliedCount: 2, exceptionCount: 1, discounts: { active: 3, ended: 0, disabled: 0 }, revision: 1,
  createdAt: '2026-11-11T09:00:00+00:00', createdByName: '운영자', stoppedAt: null, stoppedByName: null,
};
const detail: DiscountPromotionDetail = { ...summary, checkedAt: '2026-11-21T00:00:00+00:00', stopReceipt: null, goods: [
  { id: 'hongsil-card', name: '홍실 카드', code: 'GC-0001', archived: false, rule: { source: 'default', mode: 'rate', value: 10 }, skip: null,
    priceMin: 10000, priceMax: 10000, discounts: { active: 1, ended: 0, disabled: 0, minPrice: 9000, maxPrice: 9000 } },
  { id: 'hongsil-acrylic', name: '홍실 아크릴', code: 'GC-0002', archived: false, rule: { source: 'exception', mode: 'rate', value: 20 }, skip: null,
    priceMin: 20000, priceMax: 25000, discounts: { active: 2, ended: 0, disabled: 0, minPrice: 16000, maxPrice: 20000 } },
  { id: 'hongsil-keyring', name: '홍실 키링', code: 'GC-0003', archived: false, rule: { source: 'default', mode: 'rate', value: 10 }, skip: 'price_period_overlap',
    priceMin: 10000, priceMax: 10000, discounts: { active: 0, ended: 0, disabled: 0, minPrice: null, maxPrice: null } },
] };

describe('할인 프로모션 목록', () => {
  it('묶음마다 상태·기간·대상·할인·적용 수를 보이고 상세로 이어진다', () => {
    const html = renderToStaticMarkup(<DiscountPromotionListScreen campaign={null} canManage data={{ checkedAt: '2026-11-25T00:00:00+00:00', total: 1, rows: [summary] }} page={1} />);
    expect(html).toContain(`href="/admin/sales/discount-promotions/${ID}"`);
    expect(html).toContain('진행 중');
    expect(html).toContain('기획전(캠페인) 상품 · 홍실 오픈 기획전');
    expect(html).toContain('10% 할인');
    expect(html).toContain('예외 1개');
    expect(html).toContain('2 / 3개');
    expect(html).toContain('href="/admin/sales/discount-promotions/new"');
  });
  it('기획전으로 거르면 그 기획전 할인만 본다고 말하고, 조회만 가능하면 새로 만들기를 감춘다', () => {
    const html = renderToStaticMarkup(<DiscountPromotionListScreen campaign="hongsil-open" canManage={false} data={{ checkedAt: '2026-11-25T00:00:00+00:00', total: 0, rows: [] }} page={1} />);
    expect(html).toContain('기획전 hongsil-open의 할인만 보고 있습니다');
    expect(html).toContain('이 기획전으로 만든 할인 프로모션이 없습니다.');
    expect(html).not.toContain('새 할인 프로모션');
  });
});

describe('새 할인 프로모션', () => {
  it('기획전에서 넘어오면 그 기획전을 대상으로 고른 채 연다', () => {
    const html = renderToStaticMarkup(<DiscountPromotionEditorScreen identity={identity}
      initial={{ kind: 'campaign', campaignId: 'hongsil-open', ipId: null, name: '홍실 오픈 기획전 할인' }}
      options={{ campaigns: [{ id: 'hongsil-open', title: '홍실 오픈 기획전', status: 'published', startsAt: summary.startsAt, endsAt: summary.endsAt, goodsCount: 8 }], ips: [{ id: 'maple', title: '메이플스토리', goodsCount: 120 }] }} />);
    expect(html).toContain('value="홍실 오픈 기획전 할인"');
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="campaign"/);
    expect(html).toMatch(/<option[^>]*selected=""[^>]*value="hongsil-open"|<option[^>]*value="hongsil-open"[^>]*selected=""/);
    expect(html).toContain('정률 할인 (%)');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>대상·할인 확인<\/button>/);
  });
});

describe('할인 프로모션 상세', () => {
  it('상품마다 규칙·할인가·상태와 건너뛴 이유를 보이고, 진행 중이면 중지를 연다', () => {
    const html = renderToStaticMarkup(<DiscountPromotionDetailScreen canManage identity={identity} promotion={detail} />);
    expect(html).toContain('20% 할인');
    expect(html).toContain('상품별 예외');
    expect(html).toContain('16,000원 ~ 20,000원');
    expect(html).toContain('건너뜀');
    expect(html).toContain('기간이 겹치는 즉시할인이 이미 있음');
    expect(html).toMatch(/<button[^>]*>프로모션 중지<\/button>/);
    expect(html).toContain('href="/admin/sales/discount-promotions?campaign=hongsil-open"');
  });
  it('중지한 프로모션은 중지 기록을 보이고 다시 중지할 수 없다', () => {
    const stopped: DiscountPromotionDetail = { ...detail, state: 'stopped', stoppedAt: '2026-11-21T00:00:00+00:00', stoppedByName: '운영자',
      stopReceipt: { state: 'completed', operationId: ID, promotionId: ID, disabledCount: 3, goodsCount: 2, stoppedAt: '2026-11-21T00:00:00+00:00' } };
    const html = renderToStaticMarkup(<DiscountPromotionDetailScreen canManage identity={identity} promotion={stopped} />);
    expect(html).toContain('할인 3건을 껐습니다');
    expect(html).not.toMatch(/<button[^>]*>프로모션 중지<\/button>/);
  });
});
