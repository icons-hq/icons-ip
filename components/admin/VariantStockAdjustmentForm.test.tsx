import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { VariantStockAdjustmentForm } from './VariantStockAdjustmentForm';
vi.mock('@/app/admin/actions', () => ({ adjustAdminStockAction: vi.fn() }));
const variant = { id: '00000000-0000-4000-8000-000000044010', code: 'A-01', goodId: 'good', name: '파랑', price: 10000, stockQty: 3, isDefault: true, archivedAt: null };
describe('옵션 실재고 조정', () => {
  it('옵션 하나면 자동 선택하고 합계가 아닌 그 옵션 수량으로 잠근다', () => {
    const html = renderToStaticMarkup(<VariantStockAdjustmentForm adjustmentId="operation" good={{ id: 'good', ipId: 'ip', stockQty: 99 }} variants={[variant]} />);
    expect(html).toContain('name="variantId"'); expect(html).toContain(variant.id);
    expect(html).toContain('name="expectedStockQty" value="3"');
    expect(html).not.toContain('<select'); expect(html).toContain('조정 사유');
  });
  it('여러 옵션은 선택기를 제공하고 보관 옵션은 새 조정 대상에서 뺀다', () => {
    const html = renderToStaticMarkup(<VariantStockAdjustmentForm adjustmentId="operation" good={{ id: 'good', ipId: 'ip', stockQty: 99 }} variants={[variant,
      { ...variant, id: 'red', name: '빨강', isDefault: false }, { ...variant, id: 'archived', name: '숨김', archivedAt: '2026-01-01' }]} />);
    expect(html).toContain('<select'); expect(html).toContain('빨강'); expect(html).not.toContain('숨김');
  });
});
