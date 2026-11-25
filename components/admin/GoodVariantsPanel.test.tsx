import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GoodVariantsPanel } from './GoodVariantsPanel';

describe('상품 옵션 확인', () => {
  it('선택한 상품의 실제 재고·부족 경보와 사용 중지·다시 사용을 함께 제공한다', () => {
    const html = renderToStaticMarkup(<GoodVariantsPanel goodId="good-1" basePrice={12000} variants={[
      { id: 'variant-1', code:'GOOD-1-01', goodId: 'good-1', name: '기본 옵션', price: 12000, stockQty: 3, lowStockThreshold: 3, erpCode: '000123', erpName: 'ERP 기본 품명', barcode: '0007', isDefault: true, archivedAt: null },
      { id: 'variant-stopped', code:'GOOD-1-02', goodId: 'good-1', name: '중지된 옵션', price: 13000, stockQty: 10, lowStockThreshold: null, isDefault: false, archivedAt: '2026-09-10' },
      { id: 'variant-2', code:'GOOD-2-01', goodId: 'good-2', name: '다른 상품 옵션', price: 5000, stockQty: 9, isDefault: true, archivedAt: null },
    ]} />);
    for (const text of ['저장된 옵션', '12,000원', '3개', '재고수량', '재고 부족', '사용 중지', '다시 사용할 판매가', '중지된 옵션', '10개']) expect(html).toContain(text);
    expect(html).not.toContain('다른 상품 옵션');
    /* 화면 규칙 4: 편집 표 '옵션목록'과 이름이 겹치지 않고, 옵션의 상태는 '사용 중지'·'다시 사용'이다('옵션 목록'·'보관'·'복원'으로 부르지 않는다). */
    for (const mixed of ['옵션 목록', '옵션명', '보관', '복원']) expect(html, mixed).not.toContain(mixed);
    /* 옵션 없이 파는 상품의 한 줄(옵션값 없음·저장된 이름 그대로)은 '옵션 없음'으로 보인다. */
    expect(html).toMatch(/<td[^>]*>옵션 없음<\/td>/);
    expect(html).not.toContain('기본 옵션');
    /* 긴 설명 문단 대신: 바로 반영된다는 한 줄과, 사용 중·사용 중지로 나눈 재고. */
    expect(html).toContain('[사용 중지]·[다시 사용]은 누르면 바로 반영됩니다.');
    expect(html).toMatch(/사용 중 옵션<\/span><strong[^>]*>1개 · 재고수량 3개<\/strong>/);
    expect(html).toMatch(/사용 중지 옵션<\/span><strong[^>]*>1개 · 남은 재고수량 10개<\/strong>/);
    expect(html).not.toContain('전체 옵션 합계에는');
    /* ADM-004 #313: 편집기 옵션 상세 정보 표와 겹치는 읽기 전용 '옵션 상세 정보' 표는 없다(안전재고 부족 경보는 재고수량 칸에 남는다). */
    for (const text of ['<details', 'data-good-variant-details', '옵션 상세 정보 · 코드·ERP·바코드·안전재고', 'ERP 품명', '000123', '0007']) expect(html).not.toContain(text);
    expect(html).toMatch(/3개\s*<strong[^>]*data-tone="warning"[^>]*>재고 부족<\/strong>/);
    expect(html).toContain('name="active" value="false"');
    expect(html).toContain('name="active" value="true"');
    /* kit Button은 type을 빼면 type="button"이 된다 — 사용 중지·복원은 폼을 제출해야 한다. */
    const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
    expect(forms.length).toBeGreaterThanOrEqual(2);
    for (const form of forms) expect(form).toMatch(/<button[^>]*type="submit"[^>]*>(?:사용 중지|다시 사용)<\/button>/);
    expect(html.match(/>다시 사용<\/button>/g)).toHaveLength(1);
  });

  it('사용 중지 옵션만 옵션 자동코드·ERP 코드·바코드를 작게 남긴다', () => {
    const html = renderToStaticMarkup(<GoodVariantsPanel goodId="good-1" basePrice={12000} variants={[
      { id: 'variant-1', code: 'GOOD-1-01', goodId: 'good-1', name: '사용 중 옵션', price: 12000, stockQty: 3, erpCode: '000123', barcode: '0007', isDefault: true, archivedAt: null },
      { id: 'variant-stopped', code: 'GOOD-1-02', goodId: 'good-1', name: '중지된 옵션', price: 13000, stockQty: 10, erpCode: 'ERP-STOP', barcode: '88001', isDefault: false, archivedAt: '2026-09-10' },
    ]} />);
    const stopped = html.match(/<small[^>]*data-variant-identifiers[^>]*>[\s\S]*?<\/small>/g) ?? [];
    expect(stopped).toHaveLength(1);
    for (const text of ['옵션 자동코드 GOOD-1-02', 'ERP 코드 ERP-STOP', '바코드 88001']) expect(stopped[0]).toContain(text);
    for (const text of ['GOOD-1-01', '000123', '0007']) expect(html).not.toContain(text);
  });

  it('백필이 없는 상품을 빈 목록으로 숨기지 않고 알린다', () => {
    const html = renderToStaticMarkup(<GoodVariantsPanel goodId="missing" basePrice={0} variants={[]} />);
    expect(html).toContain('등록된 옵션이 없습니다.');
  });
});
