import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GoodsOptionEditor } from './GoodsOptionEditor';

const savedA = '11111111-1111-4111-8111-111111111111';
const savedB = '22222222-2222-4222-8222-222222222222';

describe('상품 옵션 ERP 식별자 입력', () => {
  it('renders separate ERP fields and carries their values in the option payload', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}}
      rows={[{
        id: savedA, name: '기본 옵션', code: 'OWN-01', attributes: {},
        extraPrice: 0, stockQty: 2, erpCode: '0000123', erpName: 'ERP 품명', barcode: '0007',
        externalUpdatedAt: '2026-09-10T07:00:00.000Z',
      }]}
      baseline={[savedA]}
      basePrice={1000}
    />);
    for (const label of ['ERP 코드', 'ERP 품명', '바코드', '0000123', 'ERP 품명', '0007']) expect(html).toContain(label);
    expect(html).toContain('aria-label="옵션 1 ERP 품명"');
    expect(html).toContain('&quot;erpCode&quot;:&quot;0000123&quot;');
    expect(html).toContain('&quot;externalUpdatedAt&quot;:&quot;2026-09-10T07:00:00.000Z&quot;');
  });

  it('옵션 미사용 상품은 재고수량 입력 하나와 관리코드만 보이고 옵션은 설정안함이다', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}}
      rows={[{
        id: savedA, name: '기본 옵션', code: 'GOOD-0001', attributes: {},
        extraPrice: 0, stockQty: 8, lowStockThreshold: 2, isActive: true,
        erpCode: '0000123', erpName: 'ERP 품명', barcode: '0007',
      }]}
      baseline={[savedA]}
      basePrice={10000}
    />);

    expect(html).toContain('data-option-mode="single"');
    expect(html).toContain('<label class="wc-admin-kit__field-label" for="goods-single-stock">재고수량</label>');
    expect(html).toContain('ICONS에서 판매할 수량이며 주문하면 차감됩니다. 안전재고는 부족 알림 기준입니다.');
    expect(html).toMatch(/<input type="radio" name="optionUsage" checked="" value="off"\/>설정안함/);
    expect(html).toContain('aria-label="기본 옵션명"');
    expect(html).toContain('GOOD-0001');
    expect(html).not.toContain('기본 옵션 옵션가');
    expect(html).not.toContain('기본 옵션 사용여부');
    expect(html).not.toContain('aria-label="옵션목록 편집표"');
    for (const legacy of ['기준 판매가', '추가금액', '옵션 판매가', '할당 재고', '조합 생성']) expect(html).not.toContain(legacy);
  });

  /* 2026-10-07 리뷰: 중지된 기본 옵션만 남은 상품은 옵션 미사용 화면에서 사용여부를 되돌릴 칸이 없었다. */
  it('사용 중지된 기본 옵션은 옵션 미사용 화면에서도 사용여부를 바꿀 수 있다', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}}
      rows={[{ id: savedA, name: '기본 옵션', code: 'GOOD-0001', attributes: {}, extraPrice: 0, stockQty: 8, isActive: false }]}
      baseline={[savedA]} basePrice={10000} />);
    expect(html).toContain('for="goods-single-active">기본 옵션 사용여부</label>');
    expect(html).toMatch(/<select id="goods-single-active"[^>]*>/);
    expect(html).toContain('<option value="stopped" selected="">중지</option>');
    expect(html).toContain('모든 옵션이 사용 중지되어 고객이 구매할 수 없습니다.');
  });

  it('옵션가가 남아 있는 기본 옵션은 그 금액과 판매 금액을 함께 보여준다', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}}
      rows={[{ id: savedA, name: '기본 옵션', code: 'GOOD-0001', attributes: {}, extraPrice: 1500, stockQty: 8 }]}
      baseline={[savedA]} basePrice={10000} />);
    expect(html).toContain('기본 옵션 옵션가');
    expect(html).toContain('판매 11,500원');
  });

  it('옵션목록은 스마트스토어 순서의 열과 금액 열 하나, 선택목록 일괄수정을 둔다', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}}
      rows={[
        { id: savedA, name: '빨강', code: 'GOOD-01', attributes: { 색상: '빨강' }, extraPrice: 0, stockQty: 4, isActive: true },
        { id: savedB, name: '파랑', code: 'GOOD-02', attributes: { 색상: '파랑' }, extraPrice: 1000, stockQty: 5, isActive: false },
      ]}
      baseline={[savedA, savedB]}
      basePrice={10000}
    />);

    expect(html).toContain('data-option-mode="multiple"');
    expect(html).toMatch(/<input type="radio" name="optionUsage" checked="" value="on"\/>설정함/);
    expect(html).toContain('옵션목록 (총 2개)');
    const table = html.slice(html.indexOf('aria-label="옵션목록 편집표"'));
    const headers = [...table.slice(0, table.indexOf('</thead>')).matchAll(/<th scope="col">(.*?)<\/th>/g)].map((match) => match[1].replace(/<[^>]+>/g, ''));
    expect(headers).toEqual(['선택', '옵션명', '옵션가', '재고수량', '사용여부', '관리코드', '순서', '삭제']);
    expect(html).toContain('판매 10,000원');
    expect(html).toContain('판매 11,000원');
    expect(html).toContain('옵션 재고수량 합계');
    expect(html).toContain('9개');
    expect(html).toContain('사용 중 옵션 4개');
    for (const label of ['선택목록 일괄수정', '선택삭제']) expect(html).toMatch(new RegExp(`<button type="button" class="btn btn-ghost" disabled="">${label}</button>`));
    expect(html.indexOf('옵션목록 편집표')).toBeLessThan(html.indexOf('옵션 상세 정보 · ERP 품명·ERP 코드·바코드·안전재고'));
    expect(html).toContain('GOOD-01');
    expect(html).toContain(savedB);
    for (const legacy of ['기준 판매가', '추가금액', '옵션 판매가', '할당 재고', '조합 생성']) expect(html).not.toContain(legacy);
  });

  it('옵션 입력은 기존 폼 이름을 유지하고, 적용 전 설정함 상태를 복구한다', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}}
      rows={[{ name: '기본 옵션', code: '', attributes: {}, extraPrice: 0, stockQty: 0 }]}
      baseline={[]} basePrice={0}
      axisValues={{ optionUsage: 'on', optionAxisName0: '색상', optionAxisValues0: '빨강, 파랑', optionAxisName1: '', optionAxisValues1: '' }}
    />);
    expect(html).toMatch(/<input type="radio" name="optionUsage" checked="" value="on"\/>설정함/);
    expect(html).toContain('name="optionAxisName0" value="색상"');
    expect(html).toContain('name="optionAxisValues0" value="빨강, 파랑"');
    expect(html).toContain('옵션목록으로 적용');
    expect(html).toContain('옵션목록 (총 0개)');
    expect(html).not.toMatch(/<section class="goods-option-inputs"[^>]*hidden/);
  });
});
