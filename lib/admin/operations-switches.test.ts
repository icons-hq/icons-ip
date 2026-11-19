import { describe, expect, it } from 'vitest';
import { adminScreenForPath } from './navigation';
import { canAccessAdminScreen } from './access';
import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from './access.test-fixtures';
import {
  OPERATIONS_SWITCHES_PATH, OPERATIONS_SWITCH_CHECKLISTS, operationsSwitchEvidenceProblem, operationsSwitchesError, parseOperationsSwitches,
} from './operations-switches';

const doc = {
  delayNotice: { revision: 1, enabled: false, smsEnabled: false, evidence: null, changedAt: '2026-11-19T01:00:00Z', updatedBy: null },
  returnFee: { revision: 1, enabled: false, oneWayAmount: null, evidence: null, enabledAt: null, updatedAt: '2026-11-19T01:00:00Z', updatedBy: null, inflightCount: 0 },
  partialCancel: { revision: 1, enabled: false, evidence: null, enabledAt: null, updatedAt: '2026-11-19T01:00:00Z', updatedBy: null },
};

describe('운영 스위치 문서', () => {
  it('DB 문서의 정확한 모양만 통과시킨다', () => {
    expect(parseOperationsSwitches(doc)).toEqual(doc);
    const on = { ...doc, returnFee: { ...doc.returnFee, enabled: true, oneWayAmount: 3000, evidence: 'TEST 근거', enabledAt: '2026-11-19T02:00:00Z', updatedBy: '운영자' } };
    expect(parseOperationsSwitches(on)?.returnFee.oneWayAmount).toBe(3000);
    expect(parseOperationsSwitches({ ...doc, returnFee: { ...doc.returnFee, inflightCount: -1 } })).toBeNull();
    // 코드포인트 1000자(이모지 포함)는 UTF-16으로는 1000을 넘지만 DB·서버 기준으로 유효하다.
    expect(parseOperationsSwitches({ ...doc, partialCancel: { ...doc.partialCancel, evidence: '😀'.repeat(1000) } })).not.toBeNull();
    expect(parseOperationsSwitches({ ...doc, partialCancel: { ...doc.partialCancel, evidence: '😀'.repeat(1001) } })).toBeNull();
    expect(parseOperationsSwitches(null)).toBeNull();
    expect(parseOperationsSwitches({ ...doc, extra: 1 })).toBeNull();
    expect(parseOperationsSwitches({ ...doc, delayNotice: { ...doc.delayNotice, revision: 0 } })).toBeNull();
    expect(parseOperationsSwitches({ ...doc, delayNotice: { ...doc.delayNotice, enabled: 'true' } })).toBeNull();
    expect(parseOperationsSwitches({ ...doc, returnFee: { ...doc.returnFee, oneWayAmount: 0 } })).toBeNull();
    expect(parseOperationsSwitches({ ...doc, returnFee: { ...doc.returnFee, enabledAt: 'x' } })).toBeNull();
    expect(parseOperationsSwitches({ ...doc, partialCancel: { ...doc.partialCancel, extra: 1 } })).toBeNull();
    expect(parseOperationsSwitches({ delayNotice: doc.delayNotice, returnFee: doc.returnFee })).toBeNull();
  });

  it('근거 문구는 공백·길이·제어 문자를 본다', () => {
    expect(operationsSwitchEvidenceProblem('TEST 근거', 500)).toBeNull();
    expect(operationsSwitchEvidenceProblem(' TEST', 500)).not.toBeNull();
    expect(operationsSwitchEvidenceProblem('가', 500)).not.toBeNull();
    expect(operationsSwitchEvidenceProblem('가'.repeat(501), 500)).not.toBeNull();
    expect(operationsSwitchEvidenceProblem('가'.repeat(500), 500)).toBeNull();
    expect(operationsSwitchEvidenceProblem('줄\n바꿈', 500)).not.toBeNull();
  });

  it('오류 코드를 운영자 문구로 바꾼다', () => {
    expect(operationsSwitchesError('PT409')).toContain('다른 관리자');
    expect(operationsSwitchesError('42501')).toContain('권한');
    expect(operationsSwitchesError('22023', 'operations_switch_evidence_required')).toContain('근거');
    expect(operationsSwitchesError('22023', 'invalid_operations_switch')).toContain('올바르지');
    expect(operationsSwitchesError()).toContain('확인하지 못했습니다');
  });

  it('세 스위치 모두 켜기 전 확인 항목이 있다', () => {
    for (const kind of ['delayNotice', 'returnFee', 'partialCancel'] as const) expect(OPERATIONS_SWITCH_CHECKLISTS[kind].length).toBeGreaterThan(2);
  });

  it('화면은 통합·계정 주매니저(platform.manage)만 열고 권한 전환 전에는 admin만 연다', () => {
    const screen = adminScreenForPath(OPERATIONS_SWITCHES_PATH);
    expect(screen).toMatchObject({ id: 'operations-switches', adminOnly: true, navHidden: true });
    expect(canAccessAdminScreen(configuredOperatorAccessFixture('primary'), screen)).toBe(true);
    expect(canAccessAdminScreen(configuredOperatorAccessFixture('owner'), screen)).toBe(true);
    expect(canAccessAdminScreen(configuredOperatorAccessFixture('deputy'), screen)).toBe(false);
    expect(canAccessAdminScreen(configuredOperatorAccessFixture('logistics'), screen)).toBe(false);
    expect(canAccessAdminScreen({ operatorAccess: legacyOperatorAccessFixture('admin'), role: 'admin', isStaff: true }, screen)).toBe(true);
    expect(canAccessAdminScreen({ operatorAccess: legacyOperatorAccessFixture('staff'), role: 'staff', isStaff: true }, screen)).toBe(false);
  });
});
