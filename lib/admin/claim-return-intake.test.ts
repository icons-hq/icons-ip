import { describe, expect, it } from 'vitest';
import {
  mapReturnIntakeTable,
  normalizeReturnIntakeDate,
  parseReturnIntakeColumns,
  parseReturnIntakeConfirmResult,
  parseReturnIntakePreview,
  returnIntakeErrorText,
  type ReturnIntakeColumns,
} from './claim-return-intake';
import { CLAIM_RETURN_OPERATIONS_OFF, parseAdminReturnPickup, parseClaimReturnOperations, returnPickupErrorLabel, returnPickupRetryable } from './claim-return-pickup';

const columns: ReturnIntakeColumns = {
  trackingNumber: ['회수송장번호', '송장번호'], orderNumber: ['주문번호'], phone: ['연락처', '전화번호'], receivedOn: ['입고일', '입고일자'],
};

describe('반품입고 회신 열 이름 대응표', () => {
  it('네 칸 모두 별칭이 있어야 읽는다', () => {
    expect(parseReturnIntakeColumns({ ...columns, extra: ['x'] })).toEqual(columns);
    expect(parseReturnIntakeColumns({ ...columns, phone: [] })).toBeNull();
    expect(parseReturnIntakeColumns({ trackingNumber: ['송장'] })).toBeNull();
  });
  it('입고일은 여러 표기를 달력에 있는 날로만 읽는다', () => {
    expect(normalizeReturnIntakeDate('2026-11-12')).toBe('2026-11-12');
    expect(normalizeReturnIntakeDate('2026.11.2')).toBe('2026-11-02');
    expect(normalizeReturnIntakeDate('2026/11/12 14:30')).toBe('2026-11-12');
    expect(normalizeReturnIntakeDate('20261112')).toBe('2026-11-12');
    expect(normalizeReturnIntakeDate('2026년 11월 12일')).toBe('2026-11-12');
    expect(normalizeReturnIntakeDate('2026-02-30')).toBeNull();
    expect(normalizeReturnIntakeDate('11/12')).toBeNull();
  });
  it('머리글 줄을 찾아 네 칸만 읽고 줄 번호를 파일 줄로 남긴다(이름·주소 칸은 읽지 않는다)', () => {
    const table = [
      ['반품입고 회신 2026-11-12'],
      ['받는분', '주소', ' 회수 송장번호 ', '주문번호', '전화 번호', '입고 일자'],
      ['홍길동', '서울시 합성구', 'rp-0001', '', '', '2026.11.11'],
      ['', '', '', '', '', ''],
      ['김합성', '부산시', '', '2026111210000003', '010-1234-0003', '2026-11-12'],
      ['이합성', '대구시', 'X', '', '', '모름'],
      ['수식', '', 'Y', '', '', '2026-11-12'],
    ];
    const mapped = mapReturnIntakeTable(table, { ...columns, phone: ['전화번호'] }, { 7: '수식은 사용할 수 없습니다.' });
    expect(mapped).toEqual({
      headerLine: 2, found: ['trackingNumber', 'orderNumber', 'phone', 'receivedOn'],
      rows: [
        { rowNumber: 3, trackingNumber: 'rp-0001', orderNumber: null, phone: null, receivedOn: '2026-11-11' },
        { rowNumber: 5, trackingNumber: null, orderNumber: '2026111210000003', phone: '010-1234-0003', receivedOn: '2026-11-12' },
        { rowNumber: 6, trackingNumber: 'X', orderNumber: null, phone: null, receivedOn: '' },
      ],
      issues: [{ line: 7, reason: '수식은 사용할 수 없습니다.' }],
    });
    expect(JSON.stringify(mapped)).not.toContain('홍길동');
    expect(JSON.stringify(mapped)).not.toContain('서울시');
  });
  it('입고일과 회수 송장 또는 주문번호 열이 없으면 대응표를 보여 주며 거절한다', () => {
    const missing = mapReturnIntakeTable([['송장번호', '받는분']], columns);
    expect(missing).toHaveProperty('error');
    expect('error' in missing && missing.error).toContain('입고일(입고일·입고일자)');
  });
  it('줄이 너무 많거나 칸이 너무 길면 거절한다', () => {
    const many = [['송장번호', '입고일'], ...Array.from({ length: 1001 }, (_, index) => [`RP${index}`, '2026-11-12'])];
    expect(mapReturnIntakeTable(many, columns)).toHaveProperty('error');
    const long = mapReturnIntakeTable([['송장번호', '입고일'], ['X'.repeat(61), '2026-11-12']], columns);
    expect('issues' in long && long.issues).toEqual([{ line: 2, reason: '회수 운송장·주문번호·연락처 칸의 내용이 너무 깁니다.' }]);
  });
  it('미리보기·확정 결과는 DB 모양 그대로만 받는다', () => {
    const preview = { rows: [{ rowNumber: 3, status: 'matched', matchedBy: 'tracking', claimId: '00000000-0000-4000-8000-000000000001', claimType: 'return',
      claimReference: 12, bundleId: '00000000-0000-4000-8000-000000000002', receivedOn: '2026-11-11' }], counts: { matched: 1 } };
    expect(parseReturnIntakePreview(preview)).toEqual(preview);
    expect(parseReturnIntakePreview({ rows: [{ rowNumber: 1, status: 'matched', bundleId: 'x' }], counts: {} })).toBeNull();
    const result = { operationId: '00000000-0000-4000-8000-000000000003', recorded: 1, changed: 0, failed: 0, skipped: 2, replayed: false,
      rows: [{ rowNumber: 3, outcome: 'recorded' }] };
    expect(parseReturnIntakeConfirmResult(result)).toEqual(result);
    expect(parseReturnIntakeConfirmResult({ ...result, recorded: 'x' })).toBeNull();
    expect(returnIntakeErrorText('claim_collection_conflict')).toContain('이미 다른 근거');
  });
});

describe('반품 자동 회수 접수 운영 표시', () => {
  it('스위치가 꺼져 있으면 꺼짐으로만 읽고, 모양이 틀리면 읽지 않는다', () => {
    expect(parseClaimReturnOperations({ pickup: { enabled: false }, intake: { enabled: false } })).toEqual(CLAIM_RETURN_OPERATIONS_OFF);
    expect(parseClaimReturnOperations({ pickup: { enabled: true }, intake: { enabled: false } })).toBeNull();
    expect(parseClaimReturnOperations({ pickup: { enabled: false }, intake: { enabled: true, columns: {} } })).toBeNull();
    expect(parseClaimReturnOperations({ pickup: { enabled: true, failed: 1, pending: 0, items: [{ claimId: 'c', claimType: 'return', reference: 3, orderNumber: null,
      bundleId: 'b', state: 'failed', lastErrorCode: 'pickup_timeout', attempts: 2, updatedAt: '2026-11-12T00:00:00Z' }] }, intake: { enabled: true, columns } }))
      .toEqual({ pickup: { enabled: true, failed: 1, pending: 0, items: [expect.objectContaining({ claimId: 'c', state: 'failed', attempts: 2 })] }, intake: { enabled: true, columns } });
  });
  it('자동 수거 실패만 다시 접수할 수 있고, 보내는 중이면 기다린다', () => {
    const pickup = parseAdminReturnPickup({ pickupId: 'p', state: 'failed', carrier: 'hanjin', carrierLabel: '한진택배', attempts: 3, autoAttempts: 3, maxAttempts: 5, inProgress: false });
    expect(pickup && returnPickupRetryable(pickup)).toBe(true);
    expect(pickup && returnPickupRetryable({ ...pickup, inProgress: true })).toBe(false);
    expect(pickup && returnPickupRetryable({ ...pickup, state: 'requested' })).toBe(false);
    expect(parseAdminReturnPickup({ pickupId: 'p', state: 'teleported', carrier: 'hanjin' })).toBeNull();
    expect(returnPickupErrorLabel('pickup_address_unavailable')).toContain('회수지');
    expect(returnPickupErrorLabel('carrier_closed')).toBe('택배사 응답 carrier_closed');
  });
});
