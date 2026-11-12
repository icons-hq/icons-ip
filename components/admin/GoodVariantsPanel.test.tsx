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
    for (const text of ['옵션 목록', '기본 옵션', '12,000원', '3개', '재고수량', '재고 부족', '사용 중지', '복원 판매가', '중지된 옵션', '10개']) expect(html).toContain(text);
    expect(html).not.toContain('다른 상품 옵션');
    /* ADM-004 #313: 편집기 옵션 상세 정보 표와 겹치는 읽기 전용 '옵션 상세 정보' 표는 없다(안전재고 부족 경보는 재고수량 칸에 남는다). */
    for (const text of ['<details', 'data-good-variant-details', '옵션 상세 정보 · 코드·ERP·바코드·안전재고', 'ERP 품명', '000123', '0007']) expect(html).not.toContain(text);
    expect(html).toMatch(/3개\s*<strong[^>]*data-tone="warning"[^>]*>재고 부족<\/strong>/);
    expect(html).toContain('name="active" value="false"');
    expect(html).toContain('name="active" value="true"');
    /* kit Button은 type을 빼면 type="button"이 된다 — 사용 중지·복원은 폼을 제출해야 한다. */
    const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
    expect(forms.length).toBeGreaterThanOrEqual(2);
    for (const form of forms) expect(form).toMatch(/<button[^>]*type="submit"[^>]*>(?:사용 중지|복원)<\/button>/);
  });

  it('백필이 없는 상품을 빈 목록으로 숨기지 않고 알린다', () => {
    const html = renderToStaticMarkup(<GoodVariantsPanel goodId="missing" basePrice={0} variants={[]} />);
    expect(html).toContain('등록된 옵션이 없습니다.');
  });
});
