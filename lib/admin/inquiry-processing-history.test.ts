import { describe, expect, it } from 'vitest';
import { inquiryProcessingEventSummary, parseInquiryProcessingHistory } from './inquiry-processing-history';

const INQUIRY = 'a1050000-0000-4000-8000-000000000101';
const event = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({ id, at: '2026-11-12T01:00:00.5+00:00', kind,
  actorName: '상담원 가', fromName: null, toName: null, reason: null, ...extra });

describe('문의 처리 이력 응답 계약(1014-105)', () => {
  it('담당 지정·변경·답변·완료·자동 종결을 시간순 그대로 읽는다', () => {
    const parsed = parseInquiryProcessingHistory({ inquiryId: INQUIRY, total: 5, limit: 100, events: [
      event('1', 'assigned', { toName: '상담원 가' }), event('2', 'answered'),
      event('3', 'reassigned', { actorName: '매니저 나', fromName: '상담원 가', toName: '상담원 다', reason: '휴가 인계' }),
      event('4', 'closed', { actorName: '상담원 다' }), event('auto-close:x', 'auto_closed', { actorName: null }),
    ] });
    expect(parsed?.events.map(item => item.kind)).toEqual(['assigned', 'answered', 'reassigned', 'closed', 'auto_closed']);
    expect(parsed?.events[2]).toMatchObject({ reason: '휴가 인계', fromName: '상담원 가', toName: '상담원 다' });
  });

  it('계약과 다른 응답은 빈 이력이 아니라 읽기 실패다', () => {
    const base = { inquiryId: INQUIRY, total: 1, limit: 100, events: [event('1', 'answered')] };
    expect(parseInquiryProcessingHistory(base)).not.toBeNull();
    expect(parseInquiryProcessingHistory({ ...base, inquiryId: 'x' })).toBeNull();
    expect(parseInquiryProcessingHistory({ ...base, events: [event('1', 'deleted')] })).toBeNull();
    expect(parseInquiryProcessingHistory({ ...base, events: [event('1', 'answered'), event('1', 'closed')], total: 2 })).toBeNull();
    expect(parseInquiryProcessingHistory({ ...base, total: 0 })).toBeNull();
    expect(parseInquiryProcessingHistory({ ...base, events: [event('1', 'answered', { at: 'soon' })] })).toBeNull();
  });

  it('한 줄 요약은 담당 변경의 이전·이후 담당자를 미배정까지 말한다', () => {
    expect(inquiryProcessingEventSummary({ kind: 'reassigned', fromName: null, toName: '상담원 가' })).toBe('담당 변경 · 미배정 → 상담원 가');
    expect(inquiryProcessingEventSummary({ kind: 'reassigned', fromName: '상담원 가', toName: null })).toBe('담당 변경 · 상담원 가 → 미배정');
    expect(inquiryProcessingEventSummary({ kind: 'assigned', fromName: null, toName: '상담원 가' })).toBe('첫 답변으로 담당 지정 · 상담원 가');
    expect(inquiryProcessingEventSummary({ kind: 'auto_closed', fromName: null, toName: null })).toBe('자동 종결');
  });
});
