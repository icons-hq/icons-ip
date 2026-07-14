import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import { GoodSection } from './GoodSection';

vi.mock('@/app/admin/actions', () => ({
  adjustAdminStockAction: vi.fn(),
}));
vi.mock('@/components/ui/Icon', () => ({
  Icon: () => null,
}));

const good: AdminGoodRecord = {
  id: 'g100',
  ipId: 'hwasan',
  name: '화산강림 아크릴 스탠드',
  type: '아크릴 스탠드',
  price: 22000,
  badge: '신상',
  stock: 'low',
  stockQty: 12,
  bg: null,
  imagePath: null,
};

function renderGoodSection(selected: AdminGoodRecord | null) {
  return renderToStaticMarkup(
    <GoodSection
      action={vi.fn()}
      adjustmentId="11111111-1111-4111-8111-111111111111"
      ipOptions={[{ id: 'hwasan', title: '화산강림' }]}
      onSelect={vi.fn()}
      pending={false}
      records={[good]}
      selected={selected}
      state={{}}
    />,
  );
}

describe('GoodSection', () => {
  it('shows current inventory and a separate delta form for an existing good', () => {
    const html = renderGoodSection(good);

    expect(html).toContain('현재 실재고');
    expect(html).toContain('12개');
    expect(html).toContain('유효 표시 상태');
    expect(html).toContain('low');
    expect(html).toContain('name="delta"');
    expect(html).toContain('name="reason"');
    expect(html).toContain('class="admin-field-control"');
    expect(html).toContain('required=""');
    expect(html).toContain('maxLength="200"');
    expect(html).toContain('name="adjustmentId"');
    expect(html).toContain('name="expectedStockQty"');
    expect(html).toContain('재고 조정');
    expect(html.match(/<form/g)).toHaveLength(2);
  });

  it('derives soldout for zero quantity without changing the raw stock label', () => {
    const html = renderGoodSection({ ...good, stock: 'ok', stockQty: 0 });

    expect(html).toContain('운영 상태 ok');
    expect(html).toContain('유효 표시 상태 soldout');
  });

  it('does not expose inventory adjustment controls while creating a new good', () => {
    const html = renderGoodSection(null);

    expect(html).not.toContain('현재 실재고');
    expect(html).not.toContain('name="delta"');
    expect(html).not.toContain('name="reason"');
    expect(html).not.toContain('재고 조정');
    expect(html.match(/<form/g)).toHaveLength(1);
  });
});
