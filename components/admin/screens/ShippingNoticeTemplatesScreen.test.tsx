import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ShippingNoticeTemplatesScreen } from './ShippingNoticeTemplatesScreen';

vi.mock('@/app/admin/shipping-notice-template-actions', () => ({
  saveShippingNoticeTemplateAction: vi.fn(),
  activateShippingNoticeTemplateAction: vi.fn(),
  applyShippingNoticeTemplateAction: vi.fn(),
}));

describe('배송정보 템플릿 관리 화면', () => {
  it('초안의 편집·활성화·미리보기와 상품 찾기를 제공한다', () => {
    const html = renderToStaticMarkup(<ShippingNoticeTemplatesScreen data={{
      total: 1, filters: { query: '', goodQuery: 'acrylic', page: 1 },
      templates: [{
        id: 'template-1', code: 'basic-v2', version: 2, name: '기본 배송 안내',
        shippingNotice: '배송 안내', returnExchangeNotice: '교환·반품 안내', csName: '아이콘스 CS',
        csPhone: '02-000-0000', csEmail: 'help@example.com', confirmationEvidence: '', status: 'draft',
        confirmedBy: null, confirmedAt: null, createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T01:00:00Z',
      }],
      impactGoods: [{ id: 'good-1', name: '아크릴', templateId: null, templateVersion: null, publishedAt: null, updatedAt: '2026-09-10T00:00:00Z' }],
    }} />);
    for (const name of ['code', 'version', 'name', 'shippingNotice', 'returnExchangeNotice', 'csName', 'csPhone', 'csEmail', 'confirmationEvidence']) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain('고객 공개 미리보기');
    expect(html).toContain('활성화');
    expect(html).toContain('상품 찾기');
    expect(html).toContain('value="1"');
    expect(html).toContain('/admin/settings/shipping-notices');
  });

  it('활성 템플릿은 적용 대상에 적용 버튼을 노출한다', () => {
    const html = renderToStaticMarkup(<ShippingNoticeTemplatesScreen data={{
      total: 1, filters: { query: '', goodQuery: 'good-1', page: 1 }, templates: [{
        id: 'template-1', code: 'basic-v2', version: 2, name: '기본', shippingNotice: '배송', returnExchangeNotice: '반품',
        csName: 'CS', csPhone: '02', csEmail: '', confirmationEvidence: '문서', status: 'active',
        confirmedBy: 'staff', confirmedAt: '2026-09-10T00:00:00Z', createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z',
      }], impactGoods: [{ id: 'good-1', name: '아크릴', templateId: null, templateVersion: null, publishedAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T01:00:00Z' }],
    }} />);
    expect(html).toContain('이 템플릿 적용');
    expect(html).toContain('동시에 수정된 상품에는 적용하지 않습니다.');
  });
});
