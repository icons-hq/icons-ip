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
});
