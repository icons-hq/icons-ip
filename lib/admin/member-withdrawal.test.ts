import { describe, expect, it } from 'vitest';
import {
  memberWithdrawalErasedSummary,
  memberWithdrawalRpcError,
  normalizeMemberWithdrawalForm,
  parseInquiryReference,
  parseMemberWithdrawalOutcome,
  parseMemberWithdrawalStatus,
} from './member-withdrawal';

const MEMBER = '00000000-0000-4000-8000-000000000301';
const PROCESSED_AT = '2026-11-18T10:00:00.123456+00:00';
const STATUS = { processed: true, processedAt: PROCESSED_AT, inquiryReference: 1234, signinBlocked: false, signinBlockedAt: null };
const ERASED = { addressBookEntries: 2, phoneNumbers: 1, marketingConsents: 2, demographicConsents: 0, activityEvents: 0,
  activityConsents: 0, emailChangeRequests: 0, restockAlerts: 1 };

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe('탈퇴 요청 처리 입력', () => {
  it('문의 번호는 숫자와 화면 표기(#번호)를 받는다', () => {
    expect(parseInquiryReference('1234')).toBe(1234);
    expect(parseInquiryReference(' #1234 ')).toBe(1234);
    for (const value of ['', '0', '01', '-3', '12a', '1.5', '#', '1234567890123456']) expect(parseInquiryReference(value)).toBeNull();
  });

  it('회원·문의 번호·메모(2~200자, 제어 문자 없음)를 검증하고 앞뒤 공백을 걷는다', () => {
    expect(normalizeMemberWithdrawalForm(form({ profileId: MEMBER.toUpperCase(), inquiryReference: '#77', note: '  고객 요청 확인  ' })))
      .toEqual({ ok: true, value: { profileId: MEMBER, inquiryReference: 77, note: '고객 요청 확인' } });
    const invalid = normalizeMemberWithdrawalForm(form({ profileId: 'nope', inquiryReference: 'x', note: '가' }));
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(Object.keys(invalid.errors).sort()).toEqual(['inquiryReference', 'note', 'profileId']);
    expect(normalizeMemberWithdrawalForm(form({ profileId: MEMBER, inquiryReference: '7', note: '가'.repeat(201) })).ok).toBe(false);
    expect(normalizeMemberWithdrawalForm(form({ profileId: MEMBER, inquiryReference: '7', note: '고객\u0001요청' })).ok).toBe(false);
    expect(normalizeMemberWithdrawalForm(form({ profileId: MEMBER, inquiryReference: '7', note: '고객\n요청' })).ok).toBe(true);
  });
});

describe('탈퇴 처리 응답 검증', () => {
  it('처리 상태 문서는 처리 전·처리 후 모양만 받는다', () => {
    expect(parseMemberWithdrawalStatus({ processed: false, processedAt: null, inquiryReference: null, signinBlocked: false, signinBlockedAt: null }))
      .toEqual({ processed: false, processedAt: null, inquiryReference: null, signinBlocked: false, signinBlockedAt: null });
    expect(parseMemberWithdrawalStatus(STATUS)).toEqual(STATUS);
    expect(parseMemberWithdrawalStatus({ ...STATUS, signinBlocked: true, signinBlockedAt: PROCESSED_AT })).toMatchObject({ signinBlocked: true });
    for (const broken of [
      null, { ...STATUS, inquiryReference: 0 }, { ...STATUS, processedAt: null }, { ...STATUS, signinBlocked: true },
      { processed: false, processedAt: PROCESSED_AT, inquiryReference: null, signinBlocked: false, signinBlockedAt: null },
    ]) expect(parseMemberWithdrawalStatus(broken)).toBeNull();
  });

  it('처리·이미 처리·남은 의무 결과를 구분하고 모양이 다르면 null이다', () => {
    expect(parseMemberWithdrawalOutcome({ ...STATUS, status: 'processed', suspended: true, erased: ERASED, revokedSessions: 2 }))
      .toEqual({ status: 'processed', withdrawal: STATUS, erased: ERASED, revokedSessions: 2 });
    expect(parseMemberWithdrawalOutcome({ ...STATUS, status: 'already_processed', revokedSessions: 0 }))
      .toEqual({ status: 'already_processed', withdrawal: STATUS, revokedSessions: 0 });
    expect(parseMemberWithdrawalOutcome({ status: 'blocked', blockers: [{ code: 'active_order', count: 1, path: '/orders' }] }))
      .toEqual({ status: 'blocked', blockers: [{ code: 'active_order', count: 1, path: '/orders' }] });
    for (const broken of [
      { status: 'blocked', blockers: [] },
      { status: 'blocked', blockers: [{ code: 'active_order', count: 1, path: '/tickets' }] },
      { ...STATUS, status: 'processed', erased: { ...ERASED, restockAlerts: -1 }, revokedSessions: 0 },
      { ...STATUS, status: 'processed', erased: ERASED },
      { ...STATUS, processed: false, status: 'already_processed', revokedSessions: 0 },
      { ...STATUS, status: 'done', revokedSessions: 0 },
    ]) expect(parseMemberWithdrawalOutcome(broken)).toBeNull();
  });

  it('처리 결과 요약은 지운 것만 말한다', () => {
    expect(memberWithdrawalErasedSummary(ERASED, 2)).toBe('배송지 2건 · 휴대폰 번호 1건 · 마케팅 수신 동의 철회 2건 · 대기 중인 재입고 알림 신청 1건 · 로그인 세션 2개 종료');
    expect(memberWithdrawalErasedSummary({ ...ERASED, addressBookEntries: 0, phoneNumbers: 0, marketingConsents: 0, restockAlerts: 0 }, 0))
      .toBe('지울 정보가 없었습니다');
  });

  it('RPC 오류를 운영자 문구로 바꾸고 모르는 오류는 일반 실패로 접는다', () => {
    expect(memberWithdrawalRpcError('member_withdrawal_inquiry_not_found')).toContain('1:1 문의 번호가 아닙니다');
    expect(memberWithdrawalRpcError('cannot_withdraw_self')).toBe('본인 계정은 탈퇴 처리할 수 없습니다.');
    expect(memberWithdrawalRpcError('operator_capability_required')).toBe('이 계정을 탈퇴 처리할 권한이 없습니다.');
    expect(memberWithdrawalRpcError('boom')).toContain('처리하지 못했습니다');
  });
});
