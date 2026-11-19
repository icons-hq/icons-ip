import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  KAKAO_UNLINK_ACCOUNT_CLOSED_REASONS,
  KAKAO_UNLINK_REASON_LABELS,
  kakaoUnlinkReasonLabel,
  parseKakaoUnlinkQueue,
  parseKakaoUnlinkSummary,
} from './kakao-unlink-withdrawal';

const ENTRY = {
  userId: 'A11C0000-0000-4000-8000-000000000003', nickname: '카카오 회원', maskedEmail: 'k***@example.test',
  reason: 'ACCOUNT_DELETE', eventAt: '2026-11-19T01:00:00.123456+00:00', accountClosed: true, suspended: false,
};

describe('카카오 연결 해제 사유', () => {
  it('카카오 문서의 사유 7종을 운영팀 말로 보이고 모르는 사유는 원래 값을 함께 보인다', () => {
    expect(Object.keys(KAKAO_UNLINK_REASON_LABELS).sort()).toEqual([
      'ACCOUNT_DELETE', 'FORCED_ACCOUNT_DELETE', 'INCOMPLETE_SIGN_UP', 'REVOKE_ACCOUNT_SERVICE_TERMS',
      'UNLINK_FROM_ADMIN', 'UNLINK_FROM_APPS', 'UNLINK_FROM_SERVICE',
    ]);
    expect(kakaoUnlinkReasonLabel('ACCOUNT_DELETE')).toBe('카카오계정 탈퇴');
    expect(kakaoUnlinkReasonLabel('NEW_REASON')).toBe('기타 사유(NEW_REASON)');
    expect(kakaoUnlinkReasonLabel('toString')).toBe('기타 사유(toString)');
  });

  it('알림으로 처리하는 사유는 DB(kakao_unlink_closes_account)와 같은 두 가지다', () => {
    expect([...KAKAO_UNLINK_ACCOUNT_CLOSED_REASONS]).toEqual(['ACCOUNT_DELETE', 'FORCED_ACCOUNT_DELETE']);
    const migration = readFileSync('supabase/migrations/20261119100000_kakao_unlink_withdrawal_processing.sql', 'utf8');
    expect(migration).toContain(`p_reason in (${KAKAO_UNLINK_ACCOUNT_CLOSED_REASONS.map((reason) => `'${reason}'`).join(', ')})`);
  });
});

describe('카카오 연결 해제 응답 검증', () => {
  it('해제 요약은 사유 형식·시각·처리 가능 여부를 확인한다', () => {
    expect(parseKakaoUnlinkSummary({ reason: 'UNLINK_FROM_APPS', eventAt: ENTRY.eventAt, accountClosed: false }))
      .toEqual({ reason: 'UNLINK_FROM_APPS', eventAt: ENTRY.eventAt, accountClosed: false });
    for (const broken of [null, [], { reason: 'unlink', eventAt: ENTRY.eventAt, accountClosed: false },
      { reason: 'ACCOUNT_DELETE', eventAt: 'yesterday', accountClosed: true }, { reason: 'ACCOUNT_DELETE', eventAt: ENTRY.eventAt }]) {
      expect(parseKakaoUnlinkSummary(broken)).toBeNull();
    }
  });

  it('대기 목록은 모든 줄이 맞을 때만 받고 회원 ID를 소문자로 맞춘다', () => {
    expect(parseKakaoUnlinkQueue([])).toEqual([]);
    expect(parseKakaoUnlinkQueue([ENTRY])).toEqual([{ ...ENTRY, userId: ENTRY.userId.toLowerCase() }]);
    for (const broken of [null, {}, [{ ...ENTRY, userId: 'nope' }], [ENTRY, { ...ENTRY, suspended: 'no' }], [{ ...ENTRY, maskedEmail: null }]]) {
      expect(parseKakaoUnlinkQueue(broken)).toBeNull();
    }
  });
});
