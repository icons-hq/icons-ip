import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ShippingNoticeTemplatesScreen } from './ShippingNoticeTemplatesScreen';
import { ShippingNoticeTemplateForm } from './ShippingNoticeTemplateForm';

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
        shippingNotice: '배송 안내', returnExchangeNotice: '교환·반품 안내', remoteAreaNotice: '제주·도서산간은 1~2일 더 걸립니다.', csName: '아이콘스 CS',
        csPhone: '02-000-0000', csEmail: 'help@example.com', confirmationEvidence: '', status: 'draft',
        confirmedBy: null, confirmedAt: null, createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T01:00:00Z',
      }],
      impactGoods: [{ id: 'good-1', name: '아크릴', templateId: null, templateVersion: null, publishedAt: null, updatedAt: '2026-09-10T00:00:00Z' }],
    }} />);
    for (const name of ['code', 'version', 'name', 'shippingNotice', 'remoteAreaNotice', 'returnExchangeNotice', 'csName', 'csPhone', 'csEmail', 'confirmationEvidence']) {
      expect(html).toContain(`name="${name}"`);
    }
    /* 도서산간 안내(S36-038)는 선택 칸이며 공개 미리보기에도 보인다. */
    expect(html).toContain('도서산간 안내');
    expect(html).toContain('제주·도서산간은 1~2일 더 걸립니다.');
    expect(html).toContain('고객 공개 미리보기');
    expect(html).toContain('활성화');
    expect(html).toContain('상품 찾기');
    expect(html).toContain('/admin/settings/shipping-notices');
    /* kit 버튼의 기본 type은 button이다 — 초안 저장·활성화는 제출 버튼이어야 한다. */
    const submit = (label: string) => new RegExp(`<button[^>]*type="submit"[^>]*>(?:(?!</button>)[\\s\\S])*${label}</button>`);
    expect(html).toMatch(submit('초안 수정 저장'));
    expect(html).toMatch(submit('활성화'));
    /* 새 초안 등록은 화면 머리 오른쪽 버튼이 여는 팝업이다(템플릿 화면군 공통 위치). 팝업의 폼은 기본 버전 1로 시작한다. */
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>(?:<svg[\s\S]*?<\/svg>)?새 배송 안내 템플릿 등록<\/button>/);
    const create = renderToStaticMarkup(<ShippingNoticeTemplateForm />);
    expect(create).toContain('value="1"');
    expect(create).toMatch(submit('새 초안 저장'));
  });

  it('활성 템플릿은 적용 대상에 적용 버튼을 노출한다', () => {
    const html = renderToStaticMarkup(<ShippingNoticeTemplatesScreen data={{
      total: 1, filters: { query: '', goodQuery: 'good-1', page: 1 }, templates: [{
        id: 'template-1', code: 'basic-v2', version: 2, name: '기본', shippingNotice: '배송', returnExchangeNotice: '반품', remoteAreaNotice: '',
        csName: 'CS', csPhone: '02', csEmail: '', confirmationEvidence: '문서', status: 'active',
        confirmedBy: 'staff', confirmedAt: '2026-09-10T00:00:00Z', createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z',
      }], impactGoods: [{ id: 'good-1', name: '아크릴', templateId: null, templateVersion: null, publishedAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T01:00:00Z' }],
    }} />);
    expect(html).toContain('이 템플릿 적용');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>이 템플릿 적용<\/button>/);
    expect(html).toContain('동시에 수정된 상품에는 적용하지 않습니다.');
    expect(html).toContain('입력하지 않았습니다(선택).');
  });
  it('방금 저장한 초안(focus)은 열린 채 강조되고 활성화를 안내한다(QA2b)', () => {
    const template = {
      id: 'b9000000-0000-4000-8000-000000000001', code: 'basic-v3', version: 3, name: '새 초안', shippingNotice: '배송', returnExchangeNotice: '반품', remoteAreaNotice: '',
      csName: 'CS', csPhone: '02', csEmail: '', confirmationEvidence: '', status: 'draft' as const,
      confirmedBy: null, confirmedAt: null, createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T01:00:00Z',
    };
    const data = { total: 1, filters: { query: '새 초안', goodQuery: '', page: 1 }, templates: [template], impactGoods: [] };
    const focused = renderToStaticMarkup(<ShippingNoticeTemplatesScreen data={data} focusId={template.id} />);
    expect(focused).toContain(`id="shipping-notice-template-${template.id}"`);
    expect(focused).toMatch(/<details[^>]*open=""[^>]*data-focused/);
    expect(focused).toContain('확인 근거를 입력하고 [활성화]를 눌러주세요.');
    const plain = renderToStaticMarkup(<ShippingNoticeTemplatesScreen data={data} />);
    expect(plain).not.toContain('data-focused');
    expect(plain).not.toContain('초안을 저장했습니다');
  });
});
