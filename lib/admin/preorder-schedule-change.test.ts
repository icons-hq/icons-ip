import { describe, expect, it } from 'vitest';
import {
  PREORDER_SCHEDULE_BODY_MAX, defaultPreorderScheduleCopy, parsePreorderScheduleChange, parsePreorderScheduleChangeSummaries,
  parsePreorderSchedulePreview, preorderScheduleDateLine, preorderScheduleError, preorderScheduleSelection,
} from './preorder-schedule-change';
import { scheduleChange, scheduleIds, schedulePreview, scheduleTarget } from './preorder-schedule-change.fixture';
import { ORDER_DELAY_NOTICE_MAX_TARGETS, parseOrderDelayNotice } from './order-delay-notices';

const json = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('예약 일정 일괄 변경 미리보기 응답', () => {
  it('완전한 응답만 확정 화면을 연다', () => {
    const preview = schedulePreview();
    expect(parsePreorderSchedulePreview(json(preview))).toEqual(preview);
  });
  it.each([
    ['지문 형식', { fingerprint: 'not-a-digest' }],
    ['대상 수와 줄 수 불일치', { targetShipments: 4 }],
    ['주문 수 불일치', { targetOrders: 1 }],
    ['모르는 제외 사유', { excluded: [{ ...schedulePreview().excluded[0], reason: 'mystery' }] }],
    ['모르는 제외 집계', { excludedCounts: { mystery: 1 } }],
    ['같은 날짜로 바꾸는 대상', { targets: [scheduleTarget({ newDate: '2026-12-02' })], targetShipments: 1, targetOrders: 1 }],
    ['잘못된 새 날짜', { targets: [scheduleTarget({ newDate: '2026-02-30' })], targetShipments: 1, targetOrders: 1 }],
  ])('%s면 거절한다(fail closed)', (_label, overrides) => {
    expect(parsePreorderSchedulePreview(json({ ...schedulePreview(), ...overrides }))).toBeNull();
  });
  it('고객 이메일·이름 칸이 없는 서버 응답을 그대로 쓴다', () => {
    const text = JSON.stringify(schedulePreview());
    expect(text).not.toMatch(/@|buyerName|recipientEmail|phone/);
  });
});

describe('운영자가 뺀 배송 건', () => {
  it('확정 건수와 서버에 보내는 제외 목록을 같은 계산으로 만든다', () => {
    const preview = schedulePreview();
    const all = preorderScheduleSelection(preview, new Set());
    expect(all).toMatchObject({ shipments: 3, orders: 3, excludedShipmentIds: [] });
    const without = preorderScheduleSelection(preview, new Set([scheduleIds.shipment3, scheduleIds.shipment2]));
    expect(without.shipments).toBe(1);
    expect(without.orders).toBe(1);
    expect(without.excludedShipmentIds).toEqual([scheduleIds.shipment2, scheduleIds.shipment3]);
  });
});

describe('고객 안내 문구', () => {
  it('기본 문구는 굿즈명을 쓰고 운영 어휘(상품)를 넣지 않으며 길이 한도 안이다', () => {
    const copy = defaultPreorderScheduleCopy(' 홍실 2차 랜덤 포토카드 ');
    expect(copy.body).toContain("'홍실 2차 랜덤 포토카드'");
    expect(`${copy.title}${copy.body}`).not.toContain('상품');
    expect(copy.body.length).toBeLessThanOrEqual(PREORDER_SCHEDULE_BODY_MAX);
    expect(defaultPreorderScheduleCopy('가'.repeat(400)).body).toHaveLength(PREORDER_SCHEDULE_BODY_MAX);
  });
  it('날짜 줄은 DB 안내 문구와 같은 규칙이다', () => {
    expect(preorderScheduleDateLine(['2026-12-02'], ['2026-12-09'])).toBe('발송 예정일: 2026-12-02 → 2026-12-09');
    expect(preorderScheduleDateLine(['2026-12-02', '2026-12-05'], ['2026-12-09'])).toBe('변경된 발송 예정일: 2026-12-09');
    expect(preorderScheduleDateLine(['2026-12-02'], ['2026-12-20', '2026-12-09'])).toBe('변경된 발송 예정일: 2026-12-09 ~ 2026-12-20');
  });
  it('서버 오류 코드를 운영자 문장으로 바꾸고 모르는 코드는 결과 확인을 권한다', () => {
    expect(preorderScheduleError('preorder_schedule_stale')).toContain('다시 미리 본 뒤');
    expect(preorderScheduleError('delay_notice_delivery_disabled')).toContain('이메일 발송 설정이 꺼져');
    expect(preorderScheduleError('preorder_schedule_random_whole_good')).toContain('랜덤 판매');
    expect(preorderScheduleError('unexpected')).toContain('같은 요청의 결과를 확인');
  });
});

describe('확정 영수증', () => {
  it('완전한 영수증을 읽고 주문 수가 맞지 않거나 대상이 비면 거절한다', () => {
    const change = scheduleChange();
    expect(parsePreorderScheduleChange(json(change))).toEqual(change);
    expect(parsePreorderScheduleChange(json({ ...change, orderCount: 3 }))).toBeNull();
    expect(parsePreorderScheduleChange(json({ ...change, targets: [] }))).toBeNull();
    expect(parsePreorderScheduleChange(json({ ...change, targets: [{ ...change.targets[0], smsStatus: 'teleported' }] }))).toBeNull();
    expect(parsePreorderScheduleChange(json({ ...change, targets: [{ ...change.targets[0], shipments: [] }] }))).toBeNull();
  });
  it('최근 기록 목록은 20건까지 읽는다', () => {
    const row = { id: scheduleIds.change, expectedShipDate: '2026-12-09', variantName: null, createdAt: '2026-11-25T01:00:00.000Z', actorName: '운영자', shipmentCount: 2, orderCount: 2, requestedAt: '2026-11-25T01:00:00.000Z' };
    expect(parsePreorderScheduleChangeSummaries([row])).toEqual([row]);
    expect(parsePreorderScheduleChangeSummaries(Array.from({ length: 21 }, () => row))).toBeNull();
    expect(parsePreorderScheduleChangeSummaries([{ ...row, shipmentCount: -1 }])).toBeNull();
  });
});

describe('지연 안내 원장 읽기 한도', () => {
  it('같은 원장의 큰 일정 변경 안내도 지연 탭 이력에서 읽는다', () => {
    const target = { id: scheduleIds.target1, orderId: scheduleIds.order1, buyerName: '구매자', recipientEmail: null, shipmentIds: [scheduleIds.shipment1], shipmentLabels: ['김포 · 2026111230000001'],
      messageBody: '안내', inAppStatus: 'sent', emailStatus: 'suppressed', emailProviderState: null, errorCode: 'recipient_missing', retryable: false, attempts: 0 };
    const notice = { id: scheduleIds.notice, title: '안내', customerBody: '안내', expectedShipDate: '2026-12-09', createdAt: '2026-11-25T01:00:00.000Z', expiresAt: '2026-11-25T02:00:00.000Z',
      requestedAt: '2026-11-25T01:00:00.000Z', emailEnabled: true };
    expect(parseOrderDelayNotice({ ...notice, targets: Array.from({ length: 201 }, () => target) })).not.toBeNull();
    expect(parseOrderDelayNotice({ ...notice, targets: Array.from({ length: ORDER_DELAY_NOTICE_MAX_TARGETS + 1 }, () => target) })).toBeNull();
  });
});
