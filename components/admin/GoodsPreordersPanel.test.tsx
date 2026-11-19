import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminGoodsPreorder } from '@/lib/admin/goods-preorders';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import { PreorderEditor, PreorderReceipt, RandomPreorderBulkActions, RandomPreorderEditor, stockSwitchConfirmMessage } from './GoodsPreordersPanel';

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
    const html = renderToStaticMarkup(<RandomPreorderBulkActions goodId="hsq" variants={variants} policies={[...current, previous]} onSaved={() => {}} />);
    expect(stockButton(html, '모든 옵션 일반 재고 판매로 전환')).toContain('disabled=""');
    expect(html).toContain('이전 예약 조건에 남은 예약도 포함합니다. 남은 미할당 예약: 빨강 2개');
    expect(html).not.toContain('파랑 0개');

    const clear = renderToStaticMarkup(<RandomPreorderBulkActions goodId="hsq" variants={variants} policies={[...current, { ...previous, reservedQty: 0, allocatedQty: 2 }]} onSaved={() => {}} />);
    expect(stockButton(clear, '모든 옵션 일반 재고 판매로 전환')).not.toContain('disabled=""');
    expect(clear).not.toContain('data-stock-supply-blocked');
  });

  it('옵션 선택 판매: 같은 옵션의 이전 정책에 남은 미할당 예약도 전환을 막는다', () => {
    const current = policy(red);
    const blocked = renderToStaticMarkup(<PreorderReceipt policy={current} variant={variants[0]} pendingQty={3} onSaved={() => {}} />);
    expect(stockButton(blocked, '일반 재고 판매로 전환')).toContain('disabled=""');
    expect(blocked).toContain('남은 미할당 예약: 빨강 3개');
    const open = renderToStaticMarkup(<PreorderReceipt policy={current} variant={variants[0]} pendingQty={0} onSaved={() => {}} />);
    expect(stockButton(open, '일반 재고 판매로 전환')).not.toContain('disabled=""');
    expect(open).not.toContain('data-stock-supply-blocked');
  });
});

/* 2026-11-19 사용자·MD 결정: 예약판매는 저장하면 적용된다. 임시저장·승인 근거·적용 권한 구분·확인창이 없다. */
describe('예약 저장 버튼', () => {
  const saveButtons = (html: string) => [...html.matchAll(/<button[^>]*data-preorder-save=""[^>]*>([^<]+)<\/button>/g)].map((match) => match[1]);
  it('저장 버튼은 [예약판매 저장] 하나이고 임시저장·승인 근거·적용 필수 표시가 없다', () => {
    const html = renderToStaticMarkup(<PreorderEditor goodId="hsq" variants={variants} onSaved={() => {}} />);
    expect(saveButtons(html)).toEqual(['예약판매 저장']);
    expect(html).toMatch(/<button class="[^"]*\bbg-primary\b[^"]*"[^>]*data-preorder-save=""/);
    for (const gone of ['임시저장', '승인', '적용 필수', '저장 방식', '초안']) expect(html).not.toContain(gone);
    expect(html).toContain('저장하면 바로 예약판매가 적용됩니다.');
    /* 저장을 누르기 전에는 칸 오류를 그리지 않는다. */
    expect(html).not.toContain('data-preorder-field-problem');
    expect(html).not.toContain('aria-invalid="true"');
  });
  it('랜덤 판매 예약도 [모든 옵션 예약판매 저장] 하나다', () => {
    const html = renderToStaticMarkup(<RandomPreorderEditor goodId="hsq" variants={variants} onSaved={() => {}} />);
    expect(saveButtons(html)).toEqual(['모든 옵션 예약판매 저장']);
    for (const gone of ['임시저장', '승인', '적용 필수']) expect(html).not.toContain(gone);
    expect(html.match(/data-preorder-field="capacity:/g)).toHaveLength(2);
  });
  it('저장한 예약 조건은 "예약판매 중"으로 보이고, 메모는 있을 때만 보인다', () => {
    const html = renderToStaticMarkup(<PreorderReceipt policy={policy(red, { state: 'active', stoppedAt: null, approvalReference: null })} variant={variants[0]} pendingQty={0} onSaved={() => {}} />);
    expect(html).toContain('빨강 · 예약판매 중');
    expect(html).not.toContain('메모:');
    expect(html).not.toContain('승인');
    expect(renderToStaticMarkup(<PreorderReceipt policy={policy(red)} variant={variants[0]} pendingQty={0} onSaved={() => {}} />)).toContain('메모: 협조전-20261110');
  });
  it('접수 중인 조건도 미할당 예약이 없으면 [일반 재고 판매로 전환]을 바로 누를 수 있다(접수 중지는 서버가 함께 한다)', () => {
    const active = policy(red, { state: 'active', stoppedAt: null });
    const html = renderToStaticMarkup(<PreorderReceipt policy={active} variant={variants[0]} pendingQty={0} onSaved={() => {}} />);
    expect(html).toContain('새 예약 접수 중지</button>');
    expect(stockButton(html, '일반 재고 판매로 전환')).not.toContain('disabled=""');
    expect(html).toContain('일반 재고 판매로 전환하면 접수를 중지하고 지금 재고수량으로 바로 판매합니다.');
    expect(stockButton(renderToStaticMarkup(<PreorderReceipt policy={active} variant={variants[0]} pendingQty={1} onSaved={() => {}} />), '일반 재고 판매로 전환')).toContain('disabled=""');
    /* 선택되지 않은 이전 회차·랜덤 판매(묶음 버튼)는 옵션별 전환 버튼이 없다. */
    expect(renderToStaticMarkup(<PreorderReceipt policy={{ ...active, selected: false }} variant={variants[0]} pendingQty={0} onSaved={() => {}} />)).not.toContain('일반 재고 판매로 전환</button>');
    expect(renderToStaticMarkup(<PreorderReceipt policy={active} variant={variants[0]} pendingQty={0} onSaved={() => {}} randomSale />)).not.toContain('일반 재고 판매로 전환</button>');
  });
  /* 리뷰: 접수 중 예약의 전환은 접수 중지(되돌릴 수 없음)와 즉시 일반 판매라, 판매될 재고수량을 보여 주고 한 번 묻는다. */
  it('접수 중 예약을 일반 재고로 바꿀 때의 확인 문구는 판매될 옵션별 재고수량을 보인다', () => {
    const message = stockSwitchConfirmMessage([['빨강', 500], ['파랑', 1000]]);
    expect(message).toContain('빨강 500개 · 파랑 1,000개');
    expect(message).toContain('다시 열 수 없습니다');
    expect(message).toContain('아직 물건이 들어오지 않았다면 취소');
  });
  it('랜덤 판매: 접수 중이어도 모든 옵션 일반 재고 전환 버튼을 보인다', () => {
    const html = renderToStaticMarkup(<RandomPreorderBulkActions goodId="hsq" variants={variants} policies={[policy(red, { state: 'active', stoppedAt: null }), policy(blue, { state: 'active', stoppedAt: null })]} onSaved={() => {}} />);
    expect(html).toContain('모든 옵션 새 예약 접수 중지</button>');
    expect(stockButton(html, '모든 옵션 일반 재고 판매로 전환')).not.toContain('disabled=""');
  });
});

/* 11/19 예약 물량 = 재고수량 — 예약 물량 칸은 옵션 재고수량을 따라가고, 다르면 경고만 한다. */
describe('예약 물량 기본값', () => {
  const stocked = [{ ...variants[0], stockQty: 500 }, { ...variants[1], stockQty: 1000 }];
  const input = (html: string, field: string) => html.match(new RegExp(`<input[^>]*data-preorder-field="${field}"[^>]*>`))?.[0] ?? '';
  it('새 예약 조건은 옵션 재고수량을 물량으로 보이고 따라간다고 알린다', () => {
    const html = renderToStaticMarkup(<PreorderEditor goodId="hsq" variants={stocked} onSaved={() => {}} />);
    expect(input(html, 'capacityQty')).toContain('value="500"');
    expect(html).toContain('재고수량 500개를 예약 물량으로 씁니다. 재고수량을 바꾸면 따라 바뀝니다.');
  });
  it('랜덤 판매 예약 표는 옵션 재고수량 열을 보이고 물량 기본값으로 쓴다', () => {
    const html = renderToStaticMarkup(<RandomPreorderEditor goodId="hsq" variants={stocked} onSaved={() => {}} />);
    expect(html).toContain('>재고수량</th>');
    expect(input(html, `capacity:${red}`)).toContain('value="500"');
    expect(input(html, `capacity:${blue}`)).toContain('value="1000"');
    expect(html).toContain('합계 1,500개');
  });
});
