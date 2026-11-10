import { describe, expect, it } from 'vitest';
import { autoOrderConfirmationError, isAutoOrderRunTime, parseAutoOrderConfirmation } from './auto-order-confirmation';

const doc = {
  revision: 3, enabled: true, runTime: '16:30', enabledAt: '2026-10-27T00:57:35.245761+00:00', updatedAt: '2026-10-27T00:57:35.245761+00:00',
  nextRunAt: '2026-10-27T07:30:00+00:00',
  lastRun: { runDate: '2026-10-26', cutoffAt: '2026-10-26T07:30:00+00:00', startedAt: '2026-10-26T07:31:00+00:00', finishedAt: '2026-10-26T07:31:01+00:00', confirmedCount: 12, excludedCount: 1 },
  lastExclusions: [{ orderId: 'a0c00000-0000-4001-8000-000000000005', orderNumber: '2026102610000005', outcome: 'cancellation_in_progress' }],
};

describe('자동 발주확인 문서', () => {
  it('DB 문서를 화면 모양 그대로 통과시킨다', () => {
    expect(parseAutoOrderConfirmation(doc)).toEqual(doc);
    expect(parseAutoOrderConfirmation({ ...doc, lastRun: null, lastExclusions: [] })).toMatchObject({ lastRun: null, lastExclusions: [] });
    expect(parseAutoOrderConfirmation({ ...doc, enabled: false, nextRunAt: null })).toMatchObject({ enabled: false, nextRunAt: null });
  });
  it('켜짐인데 켠 시각·다음 실행이 없거나, 모르는 제외 사유·키가 있으면 거절한다', () => {
    expect(parseAutoOrderConfirmation({ ...doc, enabledAt: null })).toBeNull();
    expect(parseAutoOrderConfirmation({ ...doc, nextRunAt: null })).toBeNull();
    expect(parseAutoOrderConfirmation({ ...doc, enabled: false })).toBeNull();
    expect(parseAutoOrderConfirmation({ ...doc, runTime: '24:00' })).toBeNull();
    expect(parseAutoOrderConfirmation({ ...doc, extra: true })).toBeNull();
    expect(parseAutoOrderConfirmation({ ...doc, lastExclusions: [{ ...doc.lastExclusions[0], outcome: 'confirmed' }] })).toBeNull();
    expect(parseAutoOrderConfirmation({ ...doc, lastRun: { ...doc.lastRun, confirmedCount: -1 } })).toBeNull();
  });
  it('실행 시각은 HH:MM 24시간제만 받는다', () => {
    for (const ok of ['00:00', '09:05', '16:30', '23:59']) expect(isAutoOrderRunTime(ok)).toBe(true);
    for (const bad of ['24:00', '9:00', '16:30:00', '16:60', '', null]) expect(isAutoOrderRunTime(bad)).toBe(false);
  });
  it('충돌·권한·입력 오류를 운영자 문구로 바꾼다', () => {
    expect(autoOrderConfirmationError('PT409')).toContain('다른 담당자');
    expect(autoOrderConfirmationError('42501')).toContain('권한');
    expect(autoOrderConfirmationError('22023')).toContain('00:00~23:59');
    expect(autoOrderConfirmationError()).toContain('같은 요청');
  });
});
