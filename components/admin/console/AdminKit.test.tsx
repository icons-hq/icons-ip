import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminField, AdminPageHeader, AdminSectionCard, AdminSidePanel, AdminStatusBadge } from './AdminKit';
import { AdminShellTitleProvider } from './admin-shell-title';

describe('화면 머리와 셸 제목', () => {
  it('셸 h1과 같은 이름의 화면 머리 h2는 화면에서 감추고 스크린리더에는 남긴다', () => {
    const html = renderToStaticMarkup(<AdminShellTitleProvider title="상품 조회/수정">
      <AdminPageHeader title="상품 조회 / 수정" description="조건으로 상품을 찾습니다." />
    </AdminShellTitleProvider>);
    expect(html).toMatch(/<h2 class="sr-only print:not-sr-only[^"]*" data-shell-duplicate="true">상품 조회 \/ 수정<\/h2>/);
    expect(html).toContain('조건으로 상품을 찾습니다.');
  });

  it('이름이 다르거나 셸 밖(홈·상담·미리보기)이면 h2를 그대로 보인다', () => {
    const different = renderToStaticMarkup(<AdminShellTitleProvider title="상품 조회/수정">
      <AdminPageHeader title="상품 엑셀 내보내기" />
    </AdminShellTitleProvider>);
    const outside = renderToStaticMarkup(<AdminPageHeader title="상품 조회/수정" />);
    for (const html of [different, outside]) {
      expect(html).not.toContain('sr-only');
      expect(html).not.toContain('data-shell-duplicate');
    }
  });

  it('상태색은 배지 바탕이 아니라 테두리 배지의 색 점으로 싣는다', () => {
    const success = renderToStaticMarkup(<AdminStatusBadge tone="success">공개</AdminStatusBadge>);
    const neutral = renderToStaticMarkup(<AdminStatusBadge>초안</AdminStatusBadge>);
    expect(success).toContain('border-border'); // outline 배지
    expect(success).not.toContain('bg-secondary');
    expect(success).toContain('bg-[var(--wc-success)]');
    expect(success).toContain('aria-hidden="true"');
    expect(success).not.toMatch(/color-mix\(in_oklab,var\(--wc-success\)/);
    expect(neutral).toContain('bg-secondary');
    expect(neutral).not.toContain('aria-hidden="true"');
  });
});

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
