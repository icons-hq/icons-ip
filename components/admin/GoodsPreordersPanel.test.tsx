import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminGoodsPreorder } from '@/lib/admin/goods-preorders';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import { PREORDER_DRAFT_NOTE, PREORDER_STAFF_DRAFT_NOTE } from '@/lib/admin/goods-preorders';
import { PreorderEditor, PreorderReceipt, RandomPreorderBulkActions, RandomPreorderEditor } from './GoodsPreordersPanel';

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

/* 2026-11-19 사고: 저장 방식 기본값('초안')으로 저장한 예약이 판매에 적용되지 않았다. 적용 권한이 있으면 적용이 주 버튼이고 임시저장은 보조다. */
describe('예약 저장 버튼', () => {
  const buttons = (html: string) => [...html.matchAll(/<button[^>]*data-preorder-save-mode="(\w+)"[^>]*>([^<]+)<\/button>/g)].map((match) => [match[1], match[2]]);
  it('적용 권한이 있으면 [예약판매 적용]이 주 버튼, [임시저장]이 보조 버튼이고 저장 방식 선택·초안 문구가 없다', () => {
    const html = renderToStaticMarkup(<PreorderEditor goodId="hsq" variants={variants} canActivate onSaved={() => {}} />);
    expect(buttons(html)).toEqual([['active', '예약판매 적용'], ['draft', '임시저장']]);
    expect(html).toMatch(/<button class="[^"]*\bbg-primary\b[^"]*"[^>]*data-preorder-save-mode="active"/);
    expect(html).toMatch(/<button class="[^"]*\bborder-border\b[^"]*"[^>]*data-preorder-save-mode="draft"/);
    expect(html).toContain(PREORDER_DRAFT_NOTE);
    expect(html).not.toContain('저장 방식');
    expect(html).not.toContain('초안');
    expect(html.match(/ · 적용 필수/g)).toHaveLength(5);
    /* 적용을 누르기 전에는 칸 오류를 그리지 않는다. */
    expect(html).not.toContain('data-preorder-field-problem');
    expect(html).not.toContain('aria-invalid="true"');
  });
  it('적용 권한이 없으면 임시저장만 하고, 판매에 반영되지 않는다는 문구를 버튼 옆에 둔다', () => {
    const html = renderToStaticMarkup(<PreorderEditor goodId="hsq" variants={variants} canActivate={false} onSaved={() => {}} />);
    expect(buttons(html)).toEqual([['draft', '예약 조건 임시저장']]);
    expect(html).toContain(PREORDER_STAFF_DRAFT_NOTE);
    expect(html).not.toContain('예약판매 적용</button>');
    expect(html).not.toContain('적용 필수');
  });
  it('랜덤 판매 예약도 [모든 옵션에 예약판매 적용]이 주 버튼이고, 권한이 없으면 임시저장만 한다', () => {
    const admin = renderToStaticMarkup(<RandomPreorderEditor goodId="hsq" variants={variants} policies={[]} canActivate onSaved={() => {}} />);
    expect(buttons(admin)).toEqual([['active', '모든 옵션에 예약판매 적용'], ['draft', '임시저장']]);
    expect(admin).not.toContain('저장 방식');
    expect(admin.match(/data-preorder-field="capacity:/g)).toHaveLength(2);
    const staff = renderToStaticMarkup(<RandomPreorderEditor goodId="hsq" variants={variants} policies={[]} canActivate={false} onSaved={() => {}} />);
    expect(buttons(staff)).toEqual([['draft', '예약 조건 임시저장']]);
    expect(staff).toContain(PREORDER_STAFF_DRAFT_NOTE);
  });
  it('적용 중인 예약 조건은 "예약판매 적용됨"으로 보인다', () => {
    const html = renderToStaticMarkup(<PreorderReceipt policy={policy(red, { state: 'active', stoppedAt: null })} variant={variants[0]} pendingQty={0} canActivate onSaved={() => {}} />);
    expect(html).toContain('빨강 · 예약판매 적용됨');
  });
});
