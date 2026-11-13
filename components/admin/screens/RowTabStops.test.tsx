import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InquiryPreviewLink } from './InquiryPreviewLink';
import { OrderPreviewLink, OrderPreviewNewTabLink } from './OrderPreview';

/* ADM-016 #8: 한 행에서 같은 목적지로 가는 중복 링크는 Tab에서 빠지고, 마우스·화면 낭독기 이름은 그대로다. */
describe('행 안 중복 링크의 Tab 정지', () => {
  it('주문 새 탭 아이콘은 항상 Tab에서 빠지고 이름과 새 탭 속성은 그대로다', () => {
    const html = renderToStaticMarkup(<OrderPreviewNewTabLink href="/admin/sales/orders/o1" label="주문 1 상세 열기 (새 탭)" />);
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-label="주문 1 상세 열기 (새 탭)"');
    expect(html).toContain('target="_blank"');
  });

  it('주문 상세 팝업 링크는 기본이 Tab 정지이고 tabStop=false로만 뺀다', () => {
    const base = renderToStaticMarkup(<OrderPreviewLink href="/admin/sales/orders?orderId=o1" label="주문 1">1</OrderPreviewLink>);
    const dup = renderToStaticMarkup(<OrderPreviewLink href="/admin/sales/orders?orderId=o1" label="주문 1" tabStop={false}>1</OrderPreviewLink>);
    expect(base).not.toContain('tabindex');
    expect(dup).toContain('tabindex="-1"');
  });

  it('문의 미리보기 링크도 같다', () => {
    const base = renderToStaticMarkup(<InquiryPreviewLink href="/admin/cs/inquiries?inquiryId=i1">제목</InquiryPreviewLink>);
    const dup = renderToStaticMarkup(<InquiryPreviewLink button href="/admin/cs/inquiries?inquiryId=i1" tabStop={false}>답변 처리</InquiryPreviewLink>);
    expect(base).not.toContain('tabindex');
    expect(dup).toContain('tabindex="-1"');
    expect(dup).toContain('답변 처리');
  });
});
