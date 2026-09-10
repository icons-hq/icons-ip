import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GoodClonePanel } from './GoodClonePanel';

describe('GoodClonePanel', () => {
  it('shows the source and the approved copy matrix without exposing a second sale flow', () => {
    const html = renderToStaticMarkup(<GoodClonePanel operationId="00000000-0000-4000-8000-000000047901" goodId="source-good" goodName="원본 상품" goodCode="SRC-0001" />);
    expect(html).toContain('상품 복사');
    expect(html).toContain('원본 상품');
    expect(html).toContain('새 상품코드');
    expect(html).toContain('할당 재고 0');
    expect(html).toContain('ERP·바코드·매입단가');
    expect(html).toContain('value="00000000-0000-4000-8000-000000047901"');
    expect(html).toContain('새 초안으로 복사');
  });
});
