import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/goods-bulk-actions', () => ({ previewGoodsBulkAction: vi.fn(), commitGoodsBulkAction: vi.fn(), readGoodsBulkAction: vi.fn() }));
vi.mock('@/app/admin/actions', () => ({ adjustAdminStockAction: vi.fn() }));
import { goodsBulkError } from '@/lib/admin/goods-bulk';
import type { DiscountStopPricePhase, GoodsListOptionStock, OptionStockRow } from '@/lib/admin/goods-list-inline';
import { GoodsDiscountStopPriceDialog } from './GoodsDiscountStopPriceDialog';
import { GoodsOptionStockDialog } from './GoodsOptionStockDialog';

const discounts = { count: 2, minPrice: 8000, maxPrice: 8500, startsAt: '2026-11-12T01:00:00Z', endsAt: '2026-11-20T14:59:00Z' };
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(match => match[1]).filter(Boolean);
const disabled = (html: string, label: string) => new RegExp(`<button(?=[^>]*\\bdisabled="")[^>]*>${label}</button>`).test(html);

function discountDialog(phase: DiscountStopPricePhase, patch: Partial<{ pending: boolean; inputError: string; seenBasePrice: number }> = {}) {
  return renderToStaticMarkup(<GoodsDiscountStopPriceDialog goodName="상품 A" goodCode="A" hasOptions flow={{ phase, seenBasePrice: 10000, input: '12000', inputError: '', pending: false,
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
  it('할인을 멈춘 직후 판매가를 바꾸는 동안에는 할인이 이미 멈췄다고 보인다', () => {
    const html = discountDialog({ step: 'price', stoppedHere: true, stopped: discounts, error: '' }, { pending: true });
    expect(html).toContain('할인을 멈췄습니다. 판매가를 바꾸는 중입니다.');
    expect(disabled(html, '처리 중')).toBe(true);
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
  const live: GoodsListOptionStock[] = [
    { variantId: 'v-blue', name: '블루', code: 'OPT-B', stockQty: 8 }, { variantId: 'v-red', name: '레드', code: 'OPT-R', stockQty: 2 }, { variantId: 'v-green', name: '그린', code: 'OPT-G', stockQty: 3 },
  ];
  const row = (patch: Partial<OptionStockRow> & Pick<OptionStockRow, 'variantId' | 'name' | 'code'>): OptionStockRow => ({ seen: 0, input: '0', reason: '', requestId: 'r', status: 'idle', message: '', ...patch });
  const rows: OptionStockRow[] = [
    row({ variantId: 'v-blue', name: '블루', code: 'OPT-B', seen: 8, input: '8', status: 'saved' }),
    row({ variantId: 'v-red', name: '레드', code: 'OPT-R', seen: null, input: '9', status: 'recheck', message: '실재고가 변경되었습니다. 최신 수량을 확인한 뒤 다시 시도해주세요.' }),
    row({ variantId: 'v-green', name: '그린', code: 'OPT-G', seen: 3, input: '-1', status: 'invalid', message: '0 이상의 정수로 입력해주세요.' }),
  ];
  const render = (patch: Partial<{ summary: string; pending: boolean }> = {}) => renderToStaticMarkup(<GoodsOptionStockDialog goodName="상품 A" goodCode="A" live={live}
    editorHref="/admin/catalog/goods?goodId=good-a#good-section-variants" flow={{ rows, summary: '', pending: false, change: vi.fn(), close: vi.fn(), save: vi.fn(), ...patch }} />);
  it('옵션마다 현재·새 수량·사유를 두고, 저장한 옵션·다시 확인할 옵션·잘못 입력한 옵션을 줄마다 밝힌다', () => {
    const html = render({ summary: '1개 옵션의 재고수량을 저장했습니다. 1개 옵션은 저장하지 않았습니다. 현재 수량을 다시 확인하고 저장해주세요.' });
    expect(html).toContain('옵션별 재고수량');
    for (const name of ['블루', '레드', '그린']) {
      expect(html).toContain(`aria-label="${name} 새 수량"`);
      expect(html).toContain(`aria-label="${name} 사유"`);
    }
    const tr = (name: string) => html.split('<tr').find(part => part.includes(`aria-label="${name} 새 수량"`))?.split('</tr>')[0] ?? '';
    expect(tr('블루')).toContain('저장됨'); expect(tr('블루')).toContain('8개');
    // 다시 확인 줄의 현재 수량은 목록이 새로 읽은 값(2개)이고, 입력한 새 수량(9)은 그대로 둔다.
    expect(tr('레드')).toContain('다시 확인'); expect(tr('레드')).toContain('2개'); expect(tr('레드')).toContain('value="9"');
    expect(tr('레드')).toContain('실재고가 변경되었습니다');
    expect(tr('그린')).toMatch(/aria-invalid="true"/); expect(tr('그린')).toContain('0 이상의 정수로 입력해주세요.');
    expect(html).toContain('role="status"');
    expect(html).toMatch(/maxlength="200"/i);
    expect(html).toContain('href="/admin/catalog/goods?goodId=good-a#good-section-variants"');
    expect(buttons(html)).toEqual(['닫기', '저장']);
  });
  it('저장하는 동안은 입력·닫기를 잠근다', () => {
    const html = render({ pending: true });
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(disabled(html, '저장 중')).toBe(true);
    expect(disabled(html, '닫기')).toBe(true);
  });
  it('창이 닫혀 있으면 아무것도 그리지 않는다', () => {
    expect(renderToStaticMarkup(<GoodsOptionStockDialog goodName="상품 A" goodCode="A" live={live} editorHref="/x" flow={{ rows: null, summary: '', pending: false, change: vi.fn(), close: vi.fn(), save: vi.fn() }} />)).toBe('');
  });
});
