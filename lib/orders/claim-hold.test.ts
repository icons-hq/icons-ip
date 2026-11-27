import { expect, it } from 'vitest';
import { CLAIM_CHANGE_CONFLICT_MESSAGE, CLAIM_CHANGE_UNKNOWN_MESSAGE } from '@/lib/admin/claim-change-copy';
import {
  CLAIM_HOLD_LABELS, CLAIM_HOLD_NOTE_ERROR, CLAIM_HOLD_NOTE_MAX, CLAIM_HOLD_NOTE_MIN, claimHoldConfirmMessage, claimHoldError, claimHoldReceiptMatches,
  normalizeClaimHoldRequest, parseClaimHoldContext, parseClaimHoldReceipt,
} from './claim-hold';
import { holdContext as context, holdReceipt as receipt, holdRequest as request } from './claim-hold.fixture';

it('보류·해제 이외의 작업이나 금융 필드를 받지 않고 계정·유형·버전을 결속한다', () => {
  expect(normalizeClaimHoldRequest(request)).toEqual(request);
  for (const change of [{ revision: -1 }, { revision: 1.2 }, { claimType: 'refund' }, { actorId: 'invalid' },
    { confirmed: false }, { decision: 'approve' }, { amount: 1000 }, { note: '짧음' }, { note: '합성 보류 사유\n줄바꿈은 불가합니다' }]) {
    expect(normalizeClaimHoldRequest({ ...request, ...change })).toBeNull();
  }
  expect(normalizeClaimHoldRequest({ ...request, decision: 'resume', note: null })).toMatchObject({ decision: 'resume', note: null });
  expect(normalizeClaimHoldRequest({ ...request, decision: 'resume' })).toBeNull();
});

it('다른 계정·유형·본문·처리결과는 같은 요청의 결과로 채택하지 않는다', () => {
  expect(parseClaimHoldContext(context)).toEqual(context);
  expect(parseClaimHoldReceipt(receipt)).toEqual(receipt);
  expect(parseClaimHoldReceipt({ ...receipt, resultRevision: 2 })).toBeNull();
  expect(parseClaimHoldReceipt({ ...receipt, stage: 'completed' })).toBeNull();
  for (const change of [{ actorId: context.orderId }, { claimType: 'exchange' as const }, { note: '다른 합성 보류 본문을 전달합니다' }, { revision: 3 }]) {
    expect(claimHoldReceiptMatches({ ...receipt, ...change }, request)).toBe(false);
  }
});

it('보류 사유는 DB와 같은 10~200자이고 화면 칸의 제한도 그 값이다', () => {
  expect([CLAIM_HOLD_NOTE_MIN, CLAIM_HOLD_NOTE_MAX]).toEqual([10, 200]);
  expect(normalizeClaimHoldRequest({ ...request, note: 'ㄱ'.repeat(CLAIM_HOLD_NOTE_MIN) })).not.toBeNull();
  expect(normalizeClaimHoldRequest({ ...request, note: 'ㄱ'.repeat(CLAIM_HOLD_NOTE_MIN - 1) })).toBeNull();
  expect(normalizeClaimHoldRequest({ ...request, note: 'ㄱ'.repeat(CLAIM_HOLD_NOTE_MAX) })).not.toBeNull();
  expect(normalizeClaimHoldRequest({ ...request, note: 'ㄱ'.repeat(CLAIM_HOLD_NOTE_MAX + 1) })).toBeNull();
  expect(CLAIM_HOLD_NOTE_ERROR).toContain('10~200자');
});

it('오류 문구는 다른 사람이 먼저 바꿨다고 말하고, 결과를 모를 때는 [저장됐는지 확인]으로 이끈다', () => {
  expect(claimHoldError('PT409')).toBe(CLAIM_CHANGE_CONFLICT_MESSAGE);
  expect(claimHoldError('PT409')).toContain('다른 사람이 먼저 바꿨습니다.');
  expect(claimHoldError('PT409')).toContain('[최신 상태 불러오기]');
  expect(claimHoldError(undefined, 'unknown_code')).toBe(CLAIM_CHANGE_UNKNOWN_MESSAGE);
  expect(claimHoldError(undefined, 'unknown_code')).toContain('[저장됐는지 확인]');
  expect(claimHoldError(undefined, 'invalid hold reason')).toBe(CLAIM_HOLD_NOTE_ERROR);
  for (const message of ['claim_not_found', 'invalid_claim_hold', 'invalid hold reason', 'claim_hold_unavailable', 'claim_already_held', 'claim_not_held', 'claim_hold_version_required', 'claim_hold_request_conflict']) {
    const text = claimHoldError(undefined, message);
    expect(text, message).not.toMatch(/같은 요청|요청 결과|해당|확인했습니다/);
  }
});

it('보류·해제 이름은 진입 버튼과 창 제목은 옛 이름 그대로, 확인하는 버튼은 하는 일로 부른다', () => {
  expect(CLAIM_HOLD_LABELS).toEqual({ hold: { title: '보류 설정', action: '보류하기' }, resume: { title: '보류 해제', action: '보류 풀기' } });
});

it('보류 확인창은 고객 알림에 담기는 사유와 멈추는 일을 말하고, 해제 확인창은 돌아가는 단계와 알림을 말한다', () => {
  const hold = claimHoldConfirmMessage({ decision: 'hold', typeLabel: '반품', stageLabel: '수거중', resumeLabel: '수거중', note: request.note });
  expect(hold).toContain('반품 요청을 보류합니다. (지금 단계: 수거중)');
  expect(hold).toContain(`고객에게 보일 보류 사유: ${request.note}`);
  expect(hold).toContain('앱 알림이 고객에게 바로 갑니다'); expect(hold).toContain('선물 주문은 사유 없이');
  expect(hold).toContain('다음 단계 처리를 할 수 없습니다');
  const resume = claimHoldConfirmMessage({ decision: 'resume', typeLabel: '교환', stageLabel: '교환보류', resumeLabel: '입고완료', note: null });
  expect(resume).toContain('교환 요청의 보류를 풉니다. 보류 전 단계(입고완료)로 돌아갑니다.');
  expect(resume).toContain('처리가 다시 시작됐다는 앱 알림이 갑니다'); expect(resume).toContain('선물 주문은'); expect(resume).not.toContain('사유');
});
