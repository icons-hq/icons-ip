import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/admin/goods-purchase-cost-actions', () => ({
  listGoodsPurchaseCostsAction: vi.fn(), listGoodsPurchaseCostHistoryAction: vi.fn(), saveGoodsPurchaseCostAction: vi.fn(),
}));

import type { AdminGoodsPurchaseCost } from '@/lib/admin/goods-purchase-costs';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import { CostEditor } from './GoodsPurchaseCostsPanel';

/*
 * 저장된 상품의 공급가(매입단가) 패널. '세금 처리' 칸 이름의 "?"는 등록 화면(GoodWorkspacePurchaseCostsSection)과 같은 글이고,
 * 옵션마다 달면 어수선해 첫 옵션에만 단다(2026-11-25 통합).
 */
const cost = { goodId: 'hw-1', variantId: 'v-1', revision: 1, updatedAt: null, unitCostKrw: 1200, taxBasis: 'included' } as AdminGoodsPurchaseCost;
const variant = { id: 'v-1', goodId: 'hw-1', name: '빨강', code: 'HW-1-01', archivedAt: null } as AdminGoodsVariant;
const render = (taxHelp?: boolean) => renderToStaticMarkup(<CostEditor cost={cost} variant={variant} onSaved={() => {}} taxHelp={taxHelp} />);

describe('공급가(매입단가) 패널의 세금 처리 도움말', () => {
  it('첫 옵션의 세금 처리에는 등록 화면과 같은 "?"를 달고, 칸 이름은 그대로다', () => {
    const html = render(true);
    expect(html).toMatch(/aria-label="세금 처리 도움말"[^>]*data-admin-help=""/);
    expect(html).toMatch(/<label for="purchase-cost-v-1-basis">세금 처리<\/label>/);
  });

  it('다른 옵션에는 "?"를 달지 않는다', () => {
    const html = render(false);
    expect(html).not.toContain('data-admin-help');
    expect(html).toContain('>세금 처리</label>');
    expect(render()).not.toContain('data-admin-help');
  });
});
