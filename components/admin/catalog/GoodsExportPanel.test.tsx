import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminExportTemplate } from '@/lib/admin/exports';
import { GoodsExportPanel } from './GoodsExportPanel';

const template = (over: Partial<AdminExportTemplate>): AdminExportTemplate => ({
  id: 'id', key: null, name: '양식', description: null, target: 'goods', columns: [],
  sort: [], defaultFilters: {}, securityLevel: 'normal', fileFormat: 'xlsx', isSystem: false, archivedAt: null,
  ...over,
});

describe('GoodsExportPanel', () => {
  it('ERP 양식이 기본으로 잡히고, 보고 있는 IP 를 조건으로 물려받는다', () => {
    const html = renderToStaticMarkup(
      <GoodsExportPanel
        ipId="rilakkuma"
        templates={[
          template({ id: 'a', key: 'goods_catalog', name: '굿즈 목록 (일괄 수정용)' }),
          template({ id: 'b', key: 'erp_goods', name: 'ERP 품목 등록 양식' }),
        ]}
      />,
    );
    expect(html).toContain('ERP 등록용 내려받기');
    expect(html.indexOf('ERP 품목 등록 양식')).toBeLessThan(html.indexOf('굿즈 목록 (일괄 수정용)'));
    expect(html).toContain('name="ipId" value="rilakkuma"');
    expect(html).toContain('/admin/settings/exports?source=b');
  });

  it('굿즈 양식이 없으면 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <GoodsExportPanel ipId={null} templates={[template({ id: 'o', target: 'order_items' })]} />,
    );
    expect(html).toBe('');
  });
});
