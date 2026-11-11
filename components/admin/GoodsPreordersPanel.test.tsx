import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminGoodsPreorder } from '@/lib/admin/goods-preorders';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import { PreorderReceipt, RandomPreorderBulkActions } from './GoodsPreordersPanel';

vi.mock('@/app/admin/goods-preorder-actions', () => ({
  allocateGoodsPreordersAction: vi.fn(), listGoodsPreorderReservationsAction: vi.fn(), listGoodsPreordersAction: vi.fn(),
  saveGoodsPreorderAction: vi.fn(), saveRandomGoodsPreordersAction: vi.fn(), switchToStockSupplyAction: vi.fn(),
}));

const red = '00000000-0000-4000-8000-000000000001', blue = '00000000-0000-4000-8000-000000000002';
const variant = (id: string, name: string): AdminGoodsVariant => ({ id, name, code: `HSQ-${name}`, goodId: 'hsq', price: 12000, stockQty: 0, isDefault: id === red, archivedAt: null });
const variants = [variant(red, '빨강'), variant(blue, '파랑')];
let sequence = 0;
/** 2회차: 지금 선택된 중지 정책과, 이전 회차의 중지된 비선택 정책. */
const policy = (variantId: string, overrides: Partial<AdminGoodsPreorder> = {}): AdminGoodsPreorder => ({
  id: `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`, goodId: 'hsq', variantId, revision: 2, selected: true,
  state: 'stopped', capacityQty: 10, startsAt: '2026-11-20T01:00:00.000Z', endsAt: '2026-11-30T15:00:00.000Z', expectedShipDate: '2026-12-02',
  approvalReference: '협조전-20261110', remainingQty: 10, reservedQty: 0, allocatedQty: 0, createdAt: '2026-11-11T00:00:00.000Z',
  activatedAt: '2026-11-11T00:00:00.000Z', stoppedAt: '2026-11-12T00:00:00.000Z', ...overrides,
});
const stockButton = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? '';

describe('일반 재고 판매 전환 버튼', () => {
  /* 리뷰 #649 — 버튼은 선택 정책의 미할당만 보고 켜졌지만, admin_use_stock_supply는 옵션의 모든 정책(이전 회차 포함)에 남은 미할당 예약을 보고 거절한다. */
  it('랜덤 판매: 이전 회차 정책에 미할당 예약이 남으면 모든 옵션 전환 버튼을 막고 남은 옵션과 수량을 보인다', () => {
    const current = [policy(red), policy(blue)];
    const previous = policy(red, { selected: false, revision: 3, reservedQty: 2, remainingQty: 8 });
    const html = renderToStaticMarkup(<RandomPreorderBulkActions goodId="hsq" variants={variants} policies={[...current, previous]} canActivate onSaved={() => {}} />);
    expect(stockButton(html, '모든 옵션 일반 재고 판매로 전환')).toContain('disabled=""');
    expect(html).toContain('이전 예약 조건에 남은 예약도 포함합니다. 남은 미할당 예약: 빨강 2개');
    expect(html).not.toContain('파랑 0개');

    const clear = renderToStaticMarkup(<RandomPreorderBulkActions goodId="hsq" variants={variants} policies={[...current, { ...previous, reservedQty: 0, allocatedQty: 2 }]} canActivate onSaved={() => {}} />);
    expect(stockButton(clear, '모든 옵션 일반 재고 판매로 전환')).not.toContain('disabled=""');
    expect(clear).not.toContain('data-stock-supply-blocked');
  });

  it('옵션 선택 판매: 같은 옵션의 이전 정책에 남은 미할당 예약도 전환을 막는다', () => {
    const current = policy(red);
    const blocked = renderToStaticMarkup(<PreorderReceipt policy={current} variant={variants[0]} pendingQty={3} canActivate onSaved={() => {}} />);
    expect(stockButton(blocked, '일반 재고 판매로 전환')).toContain('disabled=""');
    expect(blocked).toContain('남은 미할당 예약: 빨강 3개');
    const open = renderToStaticMarkup(<PreorderReceipt policy={current} variant={variants[0]} pendingQty={0} canActivate onSaved={() => {}} />);
    expect(stockButton(open, '일반 재고 판매로 전환')).not.toContain('disabled=""');
    expect(open).not.toContain('data-stock-supply-blocked');
  });
});
