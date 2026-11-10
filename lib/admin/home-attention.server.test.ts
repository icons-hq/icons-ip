import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ inquiries: vi.fn(), questions: vi.fn(), reviews: vi.fn(), chats: vi.fn(), insights: vi.fn() }));
vi.mock('./inquiries.server', () => ({ getAdminInquiryConsoleData: mocks.inquiries }));
vi.mock('./product-questions.server', () => ({ getAdminProductQuestionConsoleData: mocks.questions }));
vi.mock('./reviews.server', () => ({ getAdminReviewConsoleData: mocks.reviews }));
vi.mock('./inquiry-chat.server', () => ({ loadInquiryChatData: mocks.chats }));
vi.mock('./review-insights.server', () => ({ getAdminReviewInsights: mocks.insights }));
import { loadAdminHomeAttention } from './home-attention.server';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.inquiries.mockResolvedValue({ total: 0, rows: [] });
  mocks.questions.mockResolvedValue({ total: 0, rows: [] });
  mocks.reviews.mockResolvedValue({ total: 0, rows: [] });
  mocks.chats.mockResolvedValue({ total: 0, rows: [], counts: { all: 0, open: 0, answered: 0, closed: 0 }, unreadMessages: 0 });
  mocks.insights.mockResolvedValue({ asOf: '2026-10-20', counts: { all: 0, photo: 0, coverage: 0, rating: 0, unanswered: 0 } });
});
describe('홈 문의·리뷰 현황', () => {
  it('콘솔과 같은 미답변·공개 저평점·미답글 조건으로 최신 5건만 표시한다', async () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({ id: String(index) }));
    mocks.inquiries.mockResolvedValue({ total: 42, rows }); mocks.questions.mockResolvedValue({ total: 8, rows }); mocks.reviews.mockResolvedValue({ total: 70, rows });
    const result = await loadAdminHomeAttention();
    expect(result.inquiries).toEqual({ total: 42, rows: rows.slice(0, 5) });
    expect(mocks.inquiries).toHaveBeenCalledWith(expect.objectContaining({ status: 'open' }));
    expect(mocks.questions).toHaveBeenCalledWith(expect.objectContaining({ status: 'unanswered' }));
    expect(mocks.reviews).toHaveBeenCalledWith(expect.objectContaining({ lowRating: true, status: 'visible' }));
    expect(mocks.reviews).toHaveBeenCalledWith(expect.objectContaining({ reply: 'without', status: 'visible' }));
  });
  it('한 목록 오류를 다른 목록이나 0건으로 전파하지 않는다', async () => {
    mocks.inquiries.mockRejectedValue(new Error('offline')); mocks.questions.mockResolvedValue({ total: 0, rows: [] }); mocks.reviews.mockResolvedValue({ total: 0, rows: [] });
    const result = await loadAdminHomeAttention(); expect(result.inquiries).toBeNull(); expect(result.questions).toEqual({ total: 0, rows: [] });
  });
  it('읽지 않은 메시지 수를 대화 수로 오인하지 않고 전체 기간의 최신 다섯 대화와 상태 집계를 보존한다', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ id: String(index) }));
    const counts = { all: 100, open: 35, answered: 40, closed: 25 };
    mocks.chats.mockResolvedValue({ total: 42, unreadMessages: 115, rows, counts });
    mocks.insights.mockResolvedValue({ asOf: '2026-10-19', counts: { all: 100, photo: 22, coverage: 30, rating: 6, unanswered: 13 }, rows: [{ id: 'excluded' }] });
    const data = await loadAdminHomeAttention();
    expect(mocks.chats).toHaveBeenCalledWith(expect.objectContaining({ read: 'unread', status: 'all', period: 'all', page: 1, sort: 'recent' }));
    expect(data.unreadChats).toEqual({ total: 42, rows: rows.slice(0, 5), counts });
    expect(data.reviewInsights).toEqual({ asOf: '2026-10-19', counts: { all: 100, photo: 22, coverage: 30, rating: 6, unanswered: 13 } });
  });
  it('상담이나 리뷰 분석 오류도 각각 확인 실패로 보존한다', async () => {
    mocks.chats.mockRejectedValue(new Error('reader unavailable'));
    mocks.insights.mockRejectedValue(new Error('reader unavailable'));
    mocks.inquiries.mockResolvedValue({ total: 0, rows: [] });
    const data = await loadAdminHomeAttention();
    expect(data.unreadChats).toBeNull();
    expect(data.reviewInsights).toBeNull();
    expect(data.inquiries).toEqual({ total: 0, rows: [] });
  });
});
