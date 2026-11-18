import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InquiryComposer } from './InquiryComposer';
import { InquiryThread } from './InquiryThread';

vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useActionState: () => [{}, vi.fn(), false] }));
vi.mock('@/app/my/inquiries/actions', () => ({ createInquiryAction: vi.fn(), replyToInquiryAction: vi.fn() }));
vi.mock('@/components/wc/MypageShell', () => ({ MypageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/screens/FaqSuggestions', () => ({ FaqSuggestions: () => null }));
vi.mock('@/components/screens/InquiryLiveUpdates', () => ({ InquiryLiveUpdates: () => null }));
vi.mock('@/components/screens/InquirySatisfaction', () => ({ InquirySatisfaction: () => null }));

const LINK = { orderId: '00000000-0000-4000-8000-0000000000aa', orderLabel: '20261118000001', goodId: null, goodName: null };

/* 정지·온보딩 미완료 회원은 계정 문의(탈퇴 요청 등)만 쓴다 — 유형 고정·첨부와 주문 연결 없음(원장 CUS-035). */
describe('계정 문의만 쓰는 작성·이어 쓰기 화면', () => {
  it('작성 화면은 유형을 계정으로 고정하고 첨부·주문 연결을 그리지 않는다', () => {
    const html = renderToStaticMarkup(<InquiryComposer defaultCategory="account" link={LINK} restricted />);
    expect(html).toContain('계정 문의(회원 탈퇴 요청 등)만 보낼 수 있어요');
    expect(html).toMatch(/<input[^>]*name="category"[^>]*value="account"|<input[^>]*value="account"[^>]*name="category"/);
    expect(html).not.toContain('<select');
    expect(html).not.toContain('name="images"');
    expect(html).not.toContain('name="orderId"');
    expect(html).not.toContain('정보를 함께 전달');
  });

  it('일반 작성 화면은 지금처럼 유형 선택·첨부·연결을 그린다', () => {
    const html = renderToStaticMarkup(<InquiryComposer defaultCategory="order" link={LINK} />);
    expect(html).toContain('<select');
    expect(html).toContain('name="images"');
    expect(html).toContain('name="orderId"');
  });

  it('이어 쓰기 화면은 제한 회원에게 첨부칸을 그리지 않는다', () => {
    const inquiry = {
      id: '11111111-1111-4111-8111-111111111111', reference: 12, category: 'account' as const, categoryLabel: '계정', title: '회원 탈퇴 요청',
      status: 'open' as const, orderId: null, goodId: null, createdAt: '2026-11-18T01:00:00Z', lastMessageAt: '2026-11-18T01:00:00Z',
      answeredAt: null, closedAt: null, messages: [],
    };
    expect(renderToStaticMarkup(<InquiryThread inquiry={inquiry} restricted />)).not.toContain('name="images"');
    expect(renderToStaticMarkup(<InquiryThread inquiry={inquiry} />)).toContain('name="images"');
  });
});
