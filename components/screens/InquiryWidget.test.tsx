import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InquiryWidget, InquiryWidgetPanel, WidgetInquiryConversation } from './InquiryWidget';
import type { InquiryThreadView } from '@/lib/inquiries.server';
vi.mock('@/app/my/inquiries/actions', () => ({ createWidgetInquiryAction: vi.fn(), replyToInquiryAction: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
const mocks = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
describe('FAQ 먼저 여는 상담 위젯', () => {
  it('독립 AOUAD 경험에는 문의 런처를 겹치지 않는다', () => {
    mocks.pathname = '/ip/aouad';
    expect(renderToStaticMarkup(<InquiryWidget />)).toBe('');
    mocks.pathname = '/ip';
    expect(renderToStaticMarkup(<InquiryWidget />)).toContain('FAQ · 문의');
    mocks.pathname = '/';
  });
  it('비로그인은 FAQ와 로그인 유도를 보고 문의 작성 폼을 받지 않는다', () => {
    const html = renderToStaticMarkup(<InquiryWidgetPanel userId={null} onClose={() => {}} />);
    expect(html).toContain('role="dialog"'); expect(html).toContain('aria-modal="true"');
    expect(html).toContain('자주 묻는 질문'); expect(html).toContain('로그인하고 문의하기');
    expect(html).not.toContain('name="body"'); expect(html).toContain('상담 닫기');
  });
  it('로그인해도 첫 화면은 FAQ이고 내 문의와 새 문의를 선택할 수 있다', () => {
    const html = renderToStaticMarkup(<InquiryWidgetPanel userId="customer-a" onClose={() => {}} />);
    expect(html).toContain('내 문의'); expect(html).toContain('새 문의');
    expect(html).toContain('aria-pressed="true">FAQ'); expect(html).not.toContain('name="body"');
  });
  it('대화는 서명된 첨부와 실제 답변자명을 표시하고 종결 후에는 입력을 닫는다', () => {
    const inquiry = { id: 'thread', title: '배송 문의', status: 'closed', messages: [{ id: 'reply', author: 'staff',
      authorName: '수민', body: '오늘 출고했습니다.', imageUrls: ['https://example.test/signed-image'], createdAt: '2026-09-08T00:00:00Z' }] } as InquiryThreadView;
    const html = renderToStaticMarkup(<WidgetInquiryConversation inquiry={inquiry} onSaved={() => {}} />);
    expect(html).toContain('수민'); expect(html).toContain('오늘 출고했습니다.'); expect(html).toContain('signed-image');
    expect(html).toContain('종결된 문의'); expect(html).not.toContain('name="body"');
  });
});
