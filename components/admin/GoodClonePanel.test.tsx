import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GoodClonePanel } from './GoodClonePanel';

describe('GoodClonePanel', () => {
  it('shows the source and the approved copy matrix without exposing a second sale flow', () => {
    const html = renderToStaticMarkup(<GoodClonePanel operationId="00000000-0000-4000-8000-000000047901" goodId="source-good" goodName="원본 상품" goodCode="SRC-0001" />);
    expect(html).toContain('상품 복사');
    expect(html).toContain('원본 상품');
    expect(html).toContain('새 상품 자동코드');
    /* 새 상품 자동코드도 기본으로 잠그고 자동 생성임을 보인다(ADR-0048). */
    expect(html).toMatch(/<input(?=[^>]*name="newCode")(?=[^>]*readOnly)[^>]*placeholder="저장 시 자동 생성"/);
    expect(html).toContain('자동 생성 · 입력할 필요 없음');
    expect(html).toContain('할당 재고 0');
    expect(html).toContain('ERP·바코드·공급가(매입단가)');
    expect(html).toContain('value="00000000-0000-4000-8000-000000047901"');
    expect(html).toContain('새 초안으로 복사');
  });
});
