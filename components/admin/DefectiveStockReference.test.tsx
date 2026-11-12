import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DefectiveStockReference } from './DefectiveStockReference';

vi.mock('@/app/admin/defective-stock-actions', () => ({ readDefectiveQtyForVariantsAction: vi.fn(async () => ({})) }));

describe('재고 대조 참고 칸 — 반품 불량 재고', () => {
  it('서버 렌더에서는 아무것도 그리지 않는다(불량 수량은 브라우저에서 읽는다)', () => {
    expect(renderToStaticMarkup(<DefectiveStockReference items={[{ variantId: 'v1', label: '키링 / 파랑' }]} />)).toBe('');
    expect(renderToStaticMarkup(<DefectiveStockReference items={[]} />)).toBe('');
  });
});
