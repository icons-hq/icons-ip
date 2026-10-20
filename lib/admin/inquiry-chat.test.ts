import { describe, expect, it } from 'vitest';
import { inquiryChatHref, normalizeInquiryChatFilters, parseInquiryChatContext, parseInquiryChatData } from './inquiry-chat';

const ID = 'a20c0000-0000-4000-8000-000000000201';
const row = { id: ID, reference: 1, title: '합성 배송 문의', category: 'order', status: 'open', buyer_name: '합성 고객',
  assignee_id: null, assignee_name: null, last_message_at: '2026-10-20T01:00:00Z', preview: '배송이 언제 시작되나요?', preview_author: 'user', unread_count: 2 };
const payload = { rows: [row], total: 1, counts: { all: 1, open: 1, answered: 0, closed: 0 }, unreadMessages: 2, staffOptions: [] };

describe('상담 목록의 URL 및 읽기 계약', () => {
  it('기본값은 전체 상태·최근 1주일·최근 대화순이다', () => {
    expect(normalizeInquiryChatFilters({})).toEqual({ status: 'all', assignee: 'all', period: '7d', read: 'all', sort: 'recent', query: '', page: 1 });
  });
  it('필터·검색·페이지를 URL에 남기고 상담 선택에 보존한다', () => {
    const filters = normalizeInquiryChatFilters({ status: 'answered', assignee: 'me', period: 'all', read: 'unread', sort: 'oldest', query: ' 합성 ', page: '3' });
    expect(inquiryChatHref(filters, {}, ID)).toBe(`/admin/cs/chat?status=answered&assignee=me&period=all&read=unread&sort=oldest&query=%ED%95%A9%EC%84%B1&page=3&inquiryId=${ID}`);
    expect(inquiryChatHref(filters, { page: 1, status: 'all' })).not.toContain('page=');
  });
  it('배열·잘못된 담당자·과대 검색·음수 페이지를 거절한다', () => {
    expect(normalizeInquiryChatFilters({ status: ['closed'], assignee: 'external', period: 'today', read: 'yes', sort: 'random', query: 'x'.repeat(101), page: '-1' }))
      .toEqual(normalizeInquiryChatFilters({}));
    expect(inquiryChatHref(normalizeInquiryChatFilters({}), {}, '../private')).toBe('/admin/cs/chat');
  });
  it('서버의 실제 읽음 건수와 표시용 데이터를 변환한다', () => {
    expect(parseInquiryChatData(payload)?.rows[0]).toMatchObject({ id: ID, buyerName: '합성 고객', unreadCount: 2, previewAuthor: 'user' });
  });
  it.each([
    { ...payload, counts: { ...payload.counts, all: 0 } },
    { ...payload, unreadMessages: 1 },
    { ...payload, total: 0 },
    { ...payload, rows: [{ ...row, unread_count: -1 }] },
    { ...payload, rows: [{ ...row, category: 'invalid' }] },
    { ...payload, rows: [{ ...row, last_message_at: 'invalid' }] },
    { ...payload, rows: [{ ...row, assignee_id: 'wrong' }] },
    { ...payload, staffOptions: [{ id: 'not-uuid', name: '운영자' }] },
  ])('깨진 목록·집계를 빈 화면으로 가장하지 않는다: %j', value => {
    expect(parseInquiryChatData(value)).toBeNull();
  });
  it('태그와 이전 대화는 유효한 서버 응답만 표시한다', () => {
    const context = { inquiryId: ID, tags: ['배송대기'], previousCount: 1,
      previous: [{ id: 'a20c0000-0000-4000-8000-000000000202', reference: 2, title: '이전 합성 문의', status: 'closed', lastMessageAt: '2026-10-19T01:00:00Z' }] };
    expect(parseInquiryChatContext(context)).toEqual(context);
    expect(parseInquiryChatContext({ ...context, tags: ['중복', '중복'] })).toBeNull();
    expect(parseInquiryChatContext({ ...context, previousCount: 0 })).toBeNull();
    expect(parseInquiryChatContext({ ...context, previous: [{ ...context.previous[0], id: ID }] })).toBeNull();
  });
});
