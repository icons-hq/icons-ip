import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/goods-bulk-actions', () => ({ previewGoodsBulkAction: vi.fn(), commitGoodsBulkAction: vi.fn(), readGoodsBulkAction: vi.fn() }));
vi.mock('@/app/admin/actions', () => ({ adjustAdminStockAction: vi.fn() }));
vi.mock('@/app/admin/goods-list-inline-actions', () => ({ readGoodsOptionStocksAction: vi.fn() }));
import { goodsBulkError } from '@/lib/admin/goods-bulk';
import type { DiscountStopPricePhase, OptionStockRow } from '@/lib/admin/goods-list-inline';
import { GoodsDiscountStopPriceDialog } from './GoodsDiscountStopPriceDialog';
import { GoodsOptionStockDialog } from './GoodsOptionStockDialog';

const discounts = { count: 2, minPrice: 8000, maxPrice: 8500, startsAt: '2026-11-12T01:00:00Z', endsAt: '2026-11-20T14:59:00Z' };
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(match => match[1]).filter(Boolean);
const disabled = (html: string, label: string) => new RegExp(`<button(?=[^>]*\\bdisabled="")[^>]*>${label}</button>`).test(html);
const discountTarget = { goodId: 'good-a', goodName: '상품 A', goodCode: 'A', basePrice: 10000, hasOptions: true };

function discountDialog(phase: DiscountStopPricePhase, patch: Partial<{ pending: boolean; committing: boolean; inputError: string; seenBasePrice: number }> = {}) {
  return renderToStaticMarkup(<GoodsDiscountStopPriceDialog flow={{ target: discountTarget, phase, seenBasePrice: 10000, input: '12000', inputError: '', pending: false, committing: false,
    setInput: vi.fn(), reload: vi.fn(), close: vi.fn(), submit: vi.fn(), recover: vi.fn(), ...patch }} />);
}

describe('할인 중지 후 판매가 변경 창 (1027T-025)', () => {
  it('확인 전: 멈출 할인을 보이고 "할인을 멈추고 판매가를 바꿉니다"를 밝힌 뒤 한 번에 진행한다', () => {
    const html = discountDialog({ step: 'ready', review: { operationId: 'op', discounts } });
    expect(html).toContain('할인 중지 후 판매가 변경');
    expect(html).toContain('할인을 멈추고 판매가를 바꿉니다.');
    expect(html).toContain('멈출 할인: 할인 2건 · 할인가 8,000원 ~ 8,500원');
    expect(html).toContain('할인 프로모션이 건 할인을 포함해');
    expect(html).toContain('멈춘 할인은 되돌리지 않으니');
    expect(html).toMatch(/현재 판매가 <strong[^>]*>10,000원<\/strong>/);
    expect(html).toContain('할인 전 기본 판매가 · 옵션 추가금 유지');
    expect(buttons(html)).toEqual(['취소', '할인 중지 후 변경']);
  });
  /* TKT-033: 기간 없는 즉시할인(정가 표시) 상품도 같은 창 — 멈출 할인에 그 즉시할인을 적고 판매가(할인 전)로 되돌린다고 밝힌다. */
  it('기간 없는 즉시할인 상품은 그 즉시할인도 멈출 할인으로 보이고, 멈춘 뒤에도 같은 줄로 남긴다', () => {
    const instant = { regularPrice: 12000, salePrice: 9000 };
    const html = discountDialog({ step: 'ready', review: { operationId: 'op', discounts: null, instant } });
    expect(html).toContain('멈출 할인: 기간 없는 즉시할인 · 할인가 9,000원(판매가 12,000원)');
    expect(html).toContain('기간 없는 즉시할인을 멈춰 판매가(할인 전)로 되돌리고, 할인 프로모션이 건 할인을 포함해');
    const both = discountDialog({ step: 'ready', review: { operationId: 'op', discounts, instant } });
    expect(both).toContain('멈출 할인: 기간 없는 즉시할인 · 할인가 9,000원(판매가 12,000원) / 할인 2건 · 할인가 8,000원 ~ 8,500원');
    const failed = discountDialog({ step: 'price', stoppedHere: true, stopped: null, stoppedInstant: instant, error: goodsBulkError('goods_bulk_busy') });
    expect(failed).toContain('멈춘 할인: 기간 없는 즉시할인 · 할인가 9,000원(판매가 12,000원)');
    /* 기간 할인만 있는 상품의 문구는 그대로다. */
    expect(discountDialog({ step: 'ready', review: { operationId: 'op', discounts } })).not.toContain('기간 없는 즉시할인');
  });
  it('판매가 변경이 실패하면 할인이 이미 멈췄다고 밝히고 같은 창에서 판매가만 다시 시도한다(되돌리기 없음)', () => {
    const html = discountDialog({ step: 'price', stoppedHere: true, stopped: discounts, error: goodsBulkError('goods_bulk_busy') });
    expect(html).toContain('할인은 멈췄습니다. 판매가는 바뀌지 않았습니다.');
    expect(html).toContain(goodsBulkError('goods_bulk_busy'));
    expect(html).toContain('멈춘 할인: 할인 2건');
    expect(html).toContain('role="alert"');
    expect(buttons(html)).toEqual(['닫기', '판매가 변경 다시 시도']);
    expect(html).not.toMatch(/되돌리기|다시 켜기|할인 복원/);
    // 새 판매가 입력은 다시 시도할 수 있게 열려 있다.
    expect(html).not.toMatch(/<fieldset[^>]*disabled=""/);
  });
  it('할인을 멈춘 직후 판매가를 바꾸는 동안에는 할인이 이미 멈췄다고 보이고, 확정이 가 있는 동안만 입력을 잠근다', () => {
    const html = discountDialog({ step: 'price', stoppedHere: true, stopped: discounts, error: '' }, { pending: true, committing: true });
    expect(html).toContain('할인을 멈췄습니다. 판매가를 바꾸는 중입니다.');
    expect(disabled(html, '처리 중')).toBe(true);
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
  });
  it('멈출 할인을 읽는 동안과 그 결과가 그려지는 순간에는 입력을 잠그지 않아 입력 칸 포커스가 남는다', () => {
    // 읽기 전환이 끝나기 전(pending) ready가 먼저 그려져도 확정 중(committing)이 아니면 fieldset은 열려 있다.
    for (const phase of [{ step: 'loading' } as const, { step: 'ready', review: { operationId: 'op', discounts } } as const]) {
      const html = discountDialog(phase, { pending: true });
      expect(html).not.toMatch(/<fieldset[^>]*disabled=""/);
      expect(html).toMatch(/<input[^>]*data-dialog-autofocus=""/);
    }
  });
  it('결과를 모르는 동안에는 닫지 못하고 처리 결과 조회·미처리 요청 종료로 끝낸다', () => {
    const stop = discountDialog({ step: 'stop-uncertain', review: { operationId: 'op', discounts }, operationId: 'op', message: '처리 결과가 불명확합니다.' });
    expect(stop).toContain('할인 중지 결과를 확인하지 못했습니다.');
    expect(stop).toContain('판매가 변경은 시작하지 않았습니다.');
    expect(buttons(stop)).toEqual(['미처리 요청 종료', '처리 결과 조회']);
    expect(stop).toMatch(/<button[^>]*aria-label="닫기"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-label="닫기"/);
    const price = discountDialog({ step: 'price-uncertain', stoppedHere: true, stopped: discounts, operationId: 'op2', message: '처리 결과가 불명확합니다.' });
    expect(price).toContain('할인은 멈췄습니다. 판매가 변경 결과를 확인하지 못했습니다.');
    expect(buttons(price)).toEqual(['미처리 요청 종료', '처리 결과 조회']);
  });
  it('아무것도 바뀌지 않은 실패는 그렇다고 밝히고, 멈출 할인이 이미 없으면 판매가만 바꾼다', () => {
    const failed = discountDialog({ step: 'review-failed', message: goodsBulkError('goods_bulk_changed'), retry: true });
    expect(failed).toContain('할인과 판매가는 바뀌지 않았습니다.');
    expect(buttons(failed)).toEqual(['닫기', '다시 확인']);
    expect(buttons(discountDialog({ step: 'review-failed', message: 'stale', retry: false }))).toEqual(['닫기']);
    const none = discountDialog({ step: 'price', stoppedHere: false, stopped: null, error: '' });
    expect(none).toContain('멈출 할인이 이미 없습니다. 판매가만 바꿉니다.');
    expect(buttons(none)).toEqual(['닫기', '판매가 변경']);
  });
  it('입력 오류는 입력 칸에 묶어 알린다', () => {
    const html = discountDialog({ step: 'ready', review: { operationId: 'op', discounts } }, { inputError: '1원 이상의 정수로 입력해주세요.' });
    expect(html).toMatch(/<input[^>]*aria-invalid="true"[^>]*aria-describedby="([^"]+)"/);
    expect(html).toContain('1원 이상의 정수로 입력해주세요.');
  });
});

describe('옵션별 재고 창 (1014-106·107)', () => {
  const target = { goodId: 'good-a', ipId: 'ip-a', goodName: '상품 A', goodCode: 'A', editorHref: '/admin/catalog/goods?goodId=good-a#good-section-variants', options: [] };
  const row = (patch: Partial<OptionStockRow> & Pick<OptionStockRow, 'variantId' | 'name' | 'code'>): OptionStockRow => ({ seen: 0, input: '0', reason: '', requestId: 'r', status: 'idle', message: '', ...patch });
  const rows: OptionStockRow[] = [
    row({ variantId: 'v-blue', name: '블루', code: 'OPT-B', seen: 8, input: '8', status: 'saved' }),
    // 다시 확인 줄은 그 상품을 새로 읽은 현재 수량(2)을 보인다.
    row({ variantId: 'v-red', name: '레드', code: 'OPT-R', seen: 2, input: '9', status: 'recheck', message: '실재고가 변경되었습니다. 최신 수량을 확인한 뒤 다시 시도해주세요.' }),
    row({ variantId: 'v-green', name: '그린', code: 'OPT-G', seen: 3, input: '-1', status: 'invalid', message: '0 이상의 정수로 입력해주세요.' }),
    row({ variantId: 'v-gone', name: '보관 옵션', code: 'OPT-X', seen: null, missing: true, input: '1', status: 'recheck', message: '이 옵션은 지금 사용 중인 옵션에 없습니다. 상품 수정의 옵션에서 확인해주세요.' }),
  ];
  const render = (patch: Partial<{ summary: string; pending: boolean; rows: OptionStockRow[] | null }> = {}) => renderToStaticMarkup(<GoodsOptionStockDialog
    flow={{ target, rows, summary: '', pending: false, settled: 0, change: vi.fn(), close: vi.fn(), save: vi.fn(), ...patch }} />);
  it('옵션마다 현재·새 수량·사유를 두고, 저장한 옵션·다시 확인할 옵션·잘못 입력한 옵션을 줄마다 밝힌다', () => {
    const html = render({ summary: '1개 옵션의 재고수량을 저장했습니다. 1개 옵션은 저장하지 않았습니다. 현재 수량을 다시 확인하고 저장해주세요.' });
    expect(html).toContain('옵션별 재고수량');
    for (const name of ['블루', '레드', '그린']) {
      expect(html).toContain(`aria-label="${name} 새 수량"`);
      expect(html).toContain(`aria-label="${name} 사유"`);
    }
    const tr = (name: string) => html.split('<tr').find(part => part.includes(`aria-label="${name} 새 수량"`))?.split('</tr>')[0] ?? '';
    expect(tr('블루')).toContain('저장됨'); expect(tr('블루')).toContain('8개');
    // 다시 확인 줄의 현재 수량은 새로 읽은 값(2개)이고, 입력한 새 수량(9)은 그대로 둔다.
    expect(tr('레드')).toContain('다시 확인'); expect(tr('레드')).toContain('2개'); expect(tr('레드')).toContain('value="9"');
    expect(tr('레드')).toContain('실재고가 변경되었습니다');
    expect(tr('그린')).toMatch(/aria-invalid="true"/); expect(tr('그린')).toContain('0 이상의 정수로 입력해주세요.');
    // 사용 중인 옵션에서 사라진 옵션은 현재 수량 없이 이유만 보이고 입력할 수 없다.
    expect(tr('보관 옵션')).toContain('확인 필요'); expect(tr('보관 옵션')).toMatch(/aria-label="보관 옵션 새 수량"[^>]*readOnly=""|readOnly=""[^>]*aria-label="보관 옵션 새 수량"/i);
    expect(html).toContain('role="status"');
    expect(html).toMatch(/maxlength="200"/i);
    expect(html).toContain('href="/admin/catalog/goods?goodId=good-a#good-section-variants"');
    expect(buttons(html)).toEqual(['닫기', '저장']);
  });
  it('좁은 폭(모바일)에서는 표 대신 옵션마다 두 줄(옵션명·현재 수량 / 새 수량·사유)로 쌓아 가로로 밀지 않고, 넓은 폭은 표 그대로다', () => {
    const html = render();
    const classes = (pattern: RegExp) => (pattern.exec(html)?.[1] ?? '').split(/\s+/);
    // 표: 좁은 폭에서는 블록(최소 폭 없음), 넓은 폭에서만 30rem 최소 폭.
    expect(classes(/<table class="([^"]*)" data-slot="table">/)).toEqual(expect.arrayContaining(['max-sm:block', 'sm:min-w-[30rem]', 'table-fixed']));
    expect(classes(/<table class="([^"]*)"/)).not.toContain('min-w-[30rem]');
    // 머리글은 좁은 폭에서 숨기고, 입력 위 이름표가 대신 말한다(넓은 폭에서는 화면에서만 숨긴 이름표).
    expect(classes(/<thead data-slot="table-header" class="([^"]*)"/)).toContain('max-sm:hidden');
    const row = classes(/<tr data-slot="table-row" class="([^"]*)" data-option-stock="saved"/);
    expect(row).toEqual(expect.arrayContaining(['max-sm:grid', 'max-sm:grid-cols-2']));
    expect(html.match(/<label class="[^"]*\bsm:sr-only\b[^"]*" for="[^"]+">새 수량<\/label>/g)).toHaveLength(rows.length);
    expect(html.match(/<label class="[^"]*\bsm:sr-only\b[^"]*" for="[^"]+">사유 \(선택\)<\/label>/g)).toHaveLength(rows.length);
    // 칸은 좁은 폭에서 블록·줄바꿈 허용이라 입력이 칸 폭을 넘지 않는다.
    const cells = [...html.matchAll(/<td data-slot="table-cell" class="([^"]*)"/g)].map(match => match[1].split(/\s+/));
    expect(cells.every(cell => ['max-sm:block', 'max-sm:p-0', 'max-sm:whitespace-normal', 'max-sm:min-w-0'].every(name => cell.includes(name)))).toBe(true);
    expect(html).toMatch(/<span class="[^"]*\bsm:sr-only\b[^"]*">현재 <\/span>8개/);
  });
  it('저장하는 동안은 입력·닫기를 잠근다', () => {
    const html = render({ pending: true });
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(disabled(html, '저장 중')).toBe(true);
    expect(disabled(html, '닫기')).toBe(true);
  });
  it('창이 닫혀 있으면 아무것도 그리지 않는다', () => {
    expect(render({ rows: null })).toBe('');
  });
});
