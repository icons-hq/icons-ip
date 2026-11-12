import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InquiryWidget, InquiryWidgetPanel, WidgetFaqTopicAnswer, WidgetFaqTopics, WidgetInquiryConversation } from './InquiryWidget';
import { InquiryThread } from './InquiryThread';
import type { InquiryThreadView } from '@/lib/inquiries.server';
vi.mock('@/app/my/inquiries/actions', () => ({ createWidgetInquiryAction: vi.fn(), replyToInquiryAction: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
const mocks = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter:()=>({refresh:vi.fn()}) }));
const entry = (id: string, question: string, answer: string) => ({ id, category: 'order' as const, question, answer, sortOrder: 0, published: true, updatedAt: '2026-11-12T00:00:00Z' });
describe('버튼형 자주 묻는 질문 (0901-044)', () => {
  it('FAQ 첫 화면의 검색 위에 배송 언제 오나요·취소·교환/반품 버튼을 둔다', () => {
    for (const userId of [null, 'customer-a']) {
      const html = renderToStaticMarkup(<InquiryWidgetPanel userId={userId} onClose={() => {}} />);
      const group = html.match(/<div class="wc-inquiry-widget__topic-buttons" role="group"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
      const buttons = [...group.matchAll(/<button type="button" aria-pressed="false"[^>]*>([^<]+)<\/button>/g)].map(([, label]) => label);
      expect(buttons).toEqual(['배송 언제 오나요', '취소', '교환/반품']);
      expect(html.indexOf('배송 언제 오나요')).toBeLessThan(html.indexOf('궁금한 내용 검색'));
      expect(html).toContain('자주 찾는 문의');
    }
  });
  it('고른 버튼만 눌림 상태로 보이고 답 영역을 연결한다', () => {
    const html = renderToStaticMarkup(<WidgetFaqTopics signedIn onNavigate={() => {}} initialTopic="cancel" />);
    expect(html).toMatch(/aria-pressed="true" aria-controls="inquiry-widget-topic-answer"[^>]*>취소<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>배송 언제 오나요<\/button>/);
    expect(html).toContain('id="inquiry-widget-topic-answer" aria-live="polite"');
    expect(html).toContain('답변을 불러오는 중입니다.');
  });
  it('운영자가 지정한 대표 FAQ를 답으로 보이고 로그인 고객에게 내 주문 배송 조회를 연다', () => {
    const html = renderToStaticMarkup(<WidgetFaqTopicAnswer topic="delivery" signedIn onNavigate={() => {}}
      answer={{ topic: 'delivery', entry: entry('faq-1', '배송은 언제 오나요?', '결제 후 영업일 기준\n출고합니다.'), entries: [] }} />);
    expect(html).toContain('<h4>배송은 언제 오나요?</h4>');
    expect(html).toContain('결제 후 영업일 기준\n출고합니다.');
    expect(html).toMatch(/<a class="wc-inquiry-widget__topic-link" href="\/orders">내 주문 배송 조회<\/a>/);
    expect(html).not.toContain('/login');
  });
  it('대표 FAQ가 없으면 그 유형의 공개 FAQ 목록, 그것도 없으면 기본 안내를 보인다', () => {
    const list = renderToStaticMarkup(<WidgetFaqTopicAnswer topic="return" signedIn onNavigate={() => {}}
      answer={{ topic: 'return', entry: null, entries: [entry('faq-2', '교환은 어떻게 하나요?', '주문 상세에서 요청합니다.'), entry('faq-3', '반품 배송비는?', '사유에 따라 다릅니다.')] }} />);
    expect(list).toContain('<summary>교환은 어떻게 하나요?</summary>');
    expect(list).toContain('<summary>반품 배송비는?</summary>');
    const empty = renderToStaticMarkup(<WidgetFaqTopicAnswer topic="return" signedIn onNavigate={() => {}} answer={{ topic: 'return', entry: null, entries: [] }} />);
    expect(empty).toContain('교환·반품은 내 주문의 주문 상세에서 요청할 수 있습니다.');
    expect(empty).toContain('내 주문 배송 조회');
  });
  it('비로그인은 배송 조회 바로가기 대신 로그인 안내를 받는다', () => {
    const html = renderToStaticMarkup(<WidgetFaqTopicAnswer topic="delivery" signedIn={false} onNavigate={() => {}}
      answer={{ topic: 'delivery', entry: null, entries: [] }} />);
    expect(html).not.toContain('href="/orders"');
    expect(html).toContain('내 주문 배송 조회는 로그인 후 이용할 수 있습니다.');
    expect(html).toContain('href="/login?next=%2Forders"');
    expect(html).toContain('주문한 굿즈의 배송 상태는 내 주문에서 확인할 수 있습니다.');
  });
  it('답을 불러오지 못하면 검색·문의로 이어 가게 안내한다', () => {
    const html = renderToStaticMarkup(<WidgetFaqTopicAnswer topic="cancel" signedIn onNavigate={() => {}} error="답변을 불러오지 못했습니다. 아래 FAQ 검색이나 문의를 이용해주세요." />);
    expect(html).toContain('답변을 불러오지 못했습니다.');
    expect(html).toContain('내 주문 배송 조회');
  });
});
describe('FAQ 먼저 여는 상담 위젯', () => {
  it('독립 AOUAD 경험에는 문의 런처를 겹치지 않는다', () => {
    mocks.pathname = '/ip/aouad';
    expect(renderToStaticMarkup(<InquiryWidget />)).toBe('');
    mocks.pathname = '/ip';
    expect(renderToStaticMarkup(<InquiryWidget />)).toContain('FAQ · 문의');
    mocks.pathname = '/';
  });
  it('전역 셸 안의 /login에는 런처를 띄우지 않는다(입력 집중 — 모바일 소셜 버튼을 가림)', () => {
    mocks.pathname = '/login';
    expect(renderToStaticMarkup(<InquiryWidget />)).toBe('');
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
  it('자동 안내는 운영자 답변과 구분하고 FAQ HTTPS 주소만 링크로 표시한다', () => {
    const inquiry:InquiryThreadView = {id:'thread',reference:1,category:'order',categoryLabel:'주문/배송',title:'문의',status:'open',
      orderId:null,goodId:null,createdAt:'2026-09-28T00:00:00Z',lastMessageAt:'2026-09-28T00:00:00Z',answeredAt:null,closedAt:null,messages:[{
      id:'auto',author:'system',authorName:null,body:'FAQ https://iconsip.com/help\n<script>bad</script> javascript:alert(1)',
      imageUrls:[],createdAt:'2026-09-28T00:00:00Z',
    }]};
    const html=renderToStaticMarkup(<WidgetInquiryConversation inquiry={inquiry} onSaved={()=>{}}/>);
    expect(html).toContain('자동 안내');
    expect(html).not.toContain('ICONS 운영자');
    expect(html).toContain('href="https://iconsip.com/help"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('href="javascript:');
  });
  it('내 문의 상세도 자동 안내를 답변 대기 상태에서 구분해 표시한다', () => {
    const inquiry={id:'thread',reference:1,category:'order',categoryLabel:'주문/배송',title:'문의',status:'open',orderId:null,goodId:null,
      createdAt:'2026-09-28T00:00:00Z',lastMessageAt:'2026-09-28T00:00:00Z',answeredAt:null,closedAt:null,
      messages:[{id:'auto',author:'system',authorName:null,body:'FAQ https://iconsip.com/help',imageUrls:[],createdAt:'2026-09-28T00:00:01Z'}],
    } as InquiryThreadView;
    const html=renderToStaticMarkup(<InquiryThread inquiry={inquiry}/>);
    expect(html).toContain('자동 안내');
    expect(html).toContain('답변 대기');
    expect(html).toContain('href="https://iconsip.com/help"');
  });
});
