import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GoodsOptionEditor } from './GoodsOptionEditor';

describe('상품 옵션 ERP 식별자 입력', () => {
  it('renders separate ERP fields and carries their values in the option payload', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor
      initialRows={[{
        id: '11111111-1111-4111-8111-111111111111', name: '기본 옵션', code: 'OWN-01', attributes: {},
        extraPrice: 0, stockQty: 2, erpCode: '0000123', erpName: 'ERP 품명', barcode: '0007',
        externalUpdatedAt: '2026-09-10T07:00:00.000Z',
      }]}
      baseline={['11111111-1111-4111-8111-111111111111']}
      basePrice={1000}
    />);
    for (const label of ['ERP 코드', 'ERP 품명', '바코드', '0000123', 'ERP 품명', '0007']) expect(html).toContain(label);
    expect(html).toContain('&quot;erpCode&quot;:&quot;0000123&quot;');
    expect(html).toContain('&quot;externalUpdatedAt&quot;:&quot;2026-09-10T07:00:00.000Z&quot;');
  });

  it('renders a single default option as a compact price and allocated-stock input', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor
      initialRows={[{
        id: '11111111-1111-4111-8111-111111111111', name: '기본 옵션', code: 'GOOD-0001', attributes: {},
        extraPrice: 1500, stockQty: 8, lowStockThreshold: 2, isActive: true,
        erpCode: '0000123', erpName: 'ERP 품명', barcode: '0007',
      }]}
      baseline={['11111111-1111-4111-8111-111111111111']}
      basePrice={10000}
    />);

    expect(html).toContain('data-option-mode="single"');
    expect(html).toContain('기준 판매가');
    expect(html).toContain('옵션 판매가');
    expect(html).toContain('11,500원');
    expect(html).toContain('기본 옵션 할당 재고');
    expect(html).toContain('옵션 ID·코드·재고·주문 참조는 보존');
    expect(html).toContain('GOOD-0001');
    expect(html).toContain('0000123');
    expect(html).toContain('0007');
    expect(html).not.toContain('aria-label="핵심 옵션 편집표"');
  });

  it('puts price and allocated stock before collapsed external identity details for multiple options', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor
      initialRows={[
        { id: '11111111-1111-4111-8111-111111111111', name: '빨강', code: 'GOOD-01', attributes: { 색상: '빨강' }, extraPrice: 0, stockQty: 4, isActive: true },
        { id: '22222222-2222-4222-8222-222222222222', name: '파랑', code: 'GOOD-02', attributes: { 색상: '파랑' }, extraPrice: 1000, stockQty: 5, isActive: true },
      ]}
      baseline={['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']}
      basePrice={10000}
    />);

    expect(html).toContain('data-option-mode="multiple"');
    expect(html.indexOf('옵션명')).toBeLessThan(html.indexOf('옵션 상세 정보 · 코드·ERP·바코드·안전재고'));
    expect(html.indexOf('옵션 판매가')).toBeLessThan(html.indexOf('옵션 상세 정보 · 코드·ERP·바코드·안전재고'));
    expect(html.indexOf('할당 재고')).toBeLessThan(html.indexOf('옵션 상세 정보 · 코드·ERP·바코드·안전재고'));
    expect(html).toContain('GOOD-01');
    expect(html).toContain('22222222-2222-4222-8222-222222222222');
  });
});
