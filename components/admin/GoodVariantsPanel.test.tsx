import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GoodVariantsPanel } from './GoodVariantsPanel';

describe('상품 옵션 확인', () => {
  it('선택한 상품의 실제 재고·부족 경보와 사용 중지·복원을 함께 제공한다', () => {
    const html = renderToStaticMarkup(<GoodVariantsPanel goodId="good-1" basePrice={12000} variants={[
      { id: 'variant-1', code:'GOOD-1-01', goodId: 'good-1', name: '기본 옵션', price: 12000, stockQty: 3, lowStockThreshold: 3, erpCode: '000123', erpName: 'ERP 기본 품명', barcode: '0007', isDefault: true, archivedAt: null },
      { id: 'variant-stopped', code:'GOOD-1-02', goodId: 'good-1', name: '중지된 옵션', price: 13000, stockQty: 10, lowStockThreshold: null, isDefault: false, archivedAt: '2026-09-10' },
      { id: 'variant-2', code:'GOOD-2-01', goodId: 'good-2', name: '다른 상품 옵션', price: 5000, stockQty: 9, isDefault: true, archivedAt: null },
    ]} />);
    for (const text of ['옵션 목록', '기본 옵션', 'ERP 코드', 'ERP 품명', '바코드', '000123', 'ERP 기본 품명', '0007', '미설정', '12,000원', '3개', '할당 재고', '재고 부족', '사용 중지', '복원 판매가', '중지된 옵션', '10개']) expect(html).toContain(text);
    expect(html).not.toContain('다른 상품 옵션');
    expect(html).toContain('name="active" value="false"');
    expect(html).toContain('name="active" value="true"');
  });

  it('백필이 없는 상품을 빈 목록으로 숨기지 않고 알린다', () => {
    const html = renderToStaticMarkup(<GoodVariantsPanel goodId="missing" basePrice={0} variants={[]} />);
    expect(html).toContain('등록된 옵션이 없습니다.');
  });
});
