import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminField, AdminPageHeader, AdminSectionCard, AdminSidePanel, AdminStatusBadge } from './AdminKit';

describe('admin screen kit', () => {
  it('labels work sections, fields, status and a non-modal side panel', () => {
    const html = renderToStaticMarkup(<>
      <AdminPageHeader title="상품 관리" description="초안을 이어 작성하세요." actions={<button>등록</button>} />
      <AdminSectionCard title="기본정보">
        <AdminField label="상품명" inputId="goods-name" hint="운영팀에서 검색할 이름" error="이름을 입력하세요.">
          <input id="goods-name" aria-invalid="true" aria-describedby="goods-name-hint goods-name-error" />
        </AdminField>
      </AdminSectionCard>
      <AdminStatusBadge tone="warning">초안</AdminStatusBadge>
      <AdminSidePanel title="주문 요약" actions={<a href="/admin">닫기</a>}>주문 이력</AdminSidePanel>
    </>);
    expect(html).toContain('for="goods-name"');
    expect(html).toContain('id="goods-name-hint"');
    expect(html).toContain('id="goods-name-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-label="주문 요약"');
    expect(html).not.toContain('aria-modal');
    expect(html).toContain('초안을 이어 작성하세요.');
    expect(html).toContain('data-tone="warning"');
  });
});
