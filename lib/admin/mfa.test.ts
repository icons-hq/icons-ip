import { describe, expect, it } from 'vitest';
import {
  adminMfaPath, operatorMfaError, parseOperatorMfa, parseOperatorMfaPolicy, parseOperatorMfaPolicyReceipt,
  parseOperatorMfaResetReceipt, safeAdminNextPath, totpErrorMessage,
} from './mfa';

describe('운영자 MFA 상태 해석', () => {
  it('키가 없으면 옛 DB라 요구하지 않고, 모양이 틀리면 막는다', () => {
    expect(parseOperatorMfa(undefined)).toEqual({ required: false, satisfied: true });
    expect(parseOperatorMfa({ required: true, satisfied: true })).toEqual({ required: true, satisfied: true });
    expect(parseOperatorMfa({ required: false, satisfied: true })).toEqual({ required: false, satisfied: true });
    for (const broken of [null, 'aal2', [], { required: 'yes', satisfied: true }, { required: true }]) {
      expect(parseOperatorMfa(broken)).toEqual({ required: true, satisfied: false });
    }
  });
});

describe('인증 뒤 복귀 경로', () => {
  it('어드민 화면만 돌려보내고 인증 화면 자신·바깥 주소·스킴 상대 주소는 어드민 홈으로 바꾼다', () => {
    expect(safeAdminNextPath('/admin/sales/orders?status=paid')).toBe('/admin/sales/orders?status=paid');
    expect(safeAdminNextPath('/admin')).toBe('/admin');
    for (const value of [null, '', '/', '/my', '//evil.example/admin', 'https://evil.example/admin', '/admin/mfa?next=/admin', '/administrator', '/admin/../my']) {
      expect(safeAdminNextPath(value), String(value)).toBe('/admin');
    }
    expect(adminMfaPath('/admin/settings/store')).toBe('/admin/mfa?next=%2Fadmin%2Fsettings%2Fstore');
    expect(adminMfaPath('https://evil.example')).toBe('/admin/mfa?next=%2Fadmin');
  });
});

describe('관리 문서 해석', () => {
  const row = { id: 'p1', nickname: '운영자', maskedEmail: 'o***@example.com', managerRole: 'deputy', verifiedFactors: 1, unverifiedFactors: 0, verifiedAt: '2026-11-18T01:00:00Z',
    role: 'staff', duty: null };
  const doc = { required: false, revision: 2, updatedAt: '2026-11-18T01:00:00Z', updatedBy: null, unenrolledCount: 0, operators: [row] };

  it('화면이 쓰는 모양만 통과시킨다', () => {
    expect(parseOperatorMfaPolicy(doc)).toEqual({ ...doc, operators: [{ id: 'p1', nickname: '운영자', maskedEmail: 'o***@example.com', managerRole: 'deputy',
      verifiedFactors: 1, unverifiedFactors: 0, verifiedAt: '2026-11-18T01:00:00Z' }] });
    expect(parseOperatorMfaPolicy({ ...doc, operators: [{ ...row, managerRole: 'boss' }] })).toBeNull();
    expect(parseOperatorMfaPolicy({ ...doc, revision: 0 })).toBeNull();
    expect(parseOperatorMfaPolicy({ ...doc, unenrolledCount: -1 })).toBeNull();
    expect(parseOperatorMfaPolicyReceipt({ required: true, revision: 3, updatedAt: '2026-11-18T01:00:00Z' })).toEqual({ required: true, revision: 3, updatedAt: '2026-11-18T01:00:00Z' });
    expect(parseOperatorMfaPolicyReceipt({ required: 'true', revision: 3, updatedAt: '2026-11-18T01:00:00Z' })).toBeNull();
    expect(parseOperatorMfaResetReceipt({ profileId: 'p1', factorCount: 1, sessionsRevoked: 2 })).toEqual({ profileId: 'p1', factorCount: 1, sessionsRevoked: 2 });
    expect(parseOperatorMfaResetReceipt({ profileId: 'p1', factorCount: 1 })).toBeNull();
  });
});

describe('거절 사유 문구', () => {
  it('DB 사유마다 운영자가 할 일을 알린다', () => {
    expect(operatorMfaError('42501', 'operator_mfa_self_required')).toContain('내 보안 설정');
    expect(operatorMfaError('22023', 'operator_mfa_unenrolled')).toContain('미등록 운영자');
    expect(operatorMfaError('42501', 'operator_mfa_reset_owner_only')).toContain('통합 매니저만');
    expect(operatorMfaError('42501', 'operator_mfa_required')).toContain('인증 앱 코드까지 확인한 로그인');
    expect(operatorMfaError('PT409', 'operator_mfa_policy_changed')).toContain('먼저 설정을 바꿨습니다');
    expect(operatorMfaError('42501', 'operator_capability_required')).toContain('관리자 권한');
    expect(operatorMfaError()).toContain('결과 확인 버튼을 눌러');
    expect(totpErrorMessage({ code: 'mfa_verification_failed' })).toContain('인증 코드가 맞지 않습니다');
    expect(totpErrorMessage({ code: 'mfa_totp_enroll_not_enabled' })).toContain('인증 앱 사용이 꺼져 있어');
    expect(totpErrorMessage(null)).toContain('실패했습니다');
  });
});
