import { describe, expect, it } from 'vitest';
import { INQUIRY_WITHDRAWAL_SCOPE } from '@/lib/account-deletion';
import {
  kakaoUnlinkWithdrawalConfirmMessage,
  MEMBER_WITHDRAWAL_EFFECTS,
  MEMBER_WITHDRAWAL_RETAINED,
  memberWithdrawalBasisLabel,
  normalizeKakaoUnlinkWithdrawalForm,
  MEMBER_WITHDRAWAL_UNCONFIRMED,
  memberWithdrawalConfirmMessage,
  memberWithdrawalErasedSummary,
  memberWithdrawalRpcError,
  normalizeMemberWithdrawalForm,
  parseInquiryReference,
  parseMemberWithdrawalInquiry,
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
    expect(normalizeMemberWithdrawalForm(form({ profileId: MEMBER.toUpperCase(), inquiryReference: '#77', confirmedInquiryReference: '77', note: '  고객 요청 확인  ' })))
      .toEqual({ ok: true, value: { profileId: MEMBER, inquiryReference: 77, note: '고객 요청 확인' } });
    const invalid = normalizeMemberWithdrawalForm(form({ profileId: 'nope', inquiryReference: 'x', note: '가' }));
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(Object.keys(invalid.errors).sort()).toEqual(['inquiryReference', 'note', 'profileId']);
    expect(normalizeMemberWithdrawalForm(form({ profileId: MEMBER, inquiryReference: '7', note: '가'.repeat(201) })).ok).toBe(false);
    expect(normalizeMemberWithdrawalForm(form({ profileId: MEMBER, inquiryReference: '7', note: '고객\u0001요청' })).ok).toBe(false);
    expect(normalizeMemberWithdrawalForm(form({ profileId: MEMBER, inquiryReference: '7', confirmedInquiryReference: '7', note: '고객\n요청' })).ok).toBe(true);
  });

  it('확인창에서 대조한 번호와 다르거나 대조를 거치지 않은 제출은 받지 않는다', () => {
    for (const confirmed of [undefined, '', '8', 'abc']) {
      const entries: Record<string, string> = { profileId: MEMBER, inquiryReference: '7', note: '고객 요청' };
      if (confirmed !== undefined) entries.confirmedInquiryReference = confirmed;
      const result = normalizeMemberWithdrawalForm(form(entries));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.inquiryReference).toBe(MEMBER_WITHDRAWAL_UNCONFIRMED);
    }
    expect(normalizeMemberWithdrawalForm(form({ profileId: MEMBER, inquiryReference: '#7', confirmedInquiryReference: '7', note: '고객 요청' })).ok).toBe(true);
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

describe('처리 전 문의 대조', () => {
  const INQUIRY = { reference: 1234, category: 'account', title: '회원 탈퇴 요청합니다', createdAt: '2026-11-18T01:00:00+00:00' };

  it('문의 요약을 검증하고, 그 회원의 문의가 아니면 null·모양이 다르면 undefined다', () => {
    expect(parseMemberWithdrawalInquiry({ ...INQUIRY, status: 'open' })).toEqual(INQUIRY);
    expect(parseMemberWithdrawalInquiry(null)).toBeNull();
    expect(parseMemberWithdrawalInquiry({ ...INQUIRY, reference: 0 })).toBeUndefined();
    expect(parseMemberWithdrawalInquiry({ ...INQUIRY, createdAt: 'yesterday' })).toBeUndefined();
  });

  it('확인 문구는 유형·제목·접수 시각을 보이고 계정 유형이 아니면 경고를 앞에 둔다', () => {
    const account = memberWithdrawalConfirmMessage(INQUIRY);
    expect(account).toMatch(/^문의 #1234 · 계정 · 회원 탈퇴 요청합니다 · 2026\. 11\. 18\./);
    expect(account).toContain('되돌릴 수 없고');
    const order = memberWithdrawalConfirmMessage({ ...INQUIRY, category: 'order', title: '배송 문의' });
    expect(order).toMatch(/^주의: 이 문의는 '계정' 유형이 아닙니다\(주문\/배송\)/);
  });
});

describe('남는 정보 고지의 원천', () => {
  it('어드민 처리 화면은 고객 안내와 같은 목록(INQUIRY_WITHDRAWAL_SCOPE)에서 남는 항목을 만든다', () => {
    const text = MEMBER_WITHDRAWAL_RETAINED.join('\n');
    for (const item of INQUIRY_WITHDRAWAL_SCOPE.retained) expect(text).toContain(item);
    expect(text).toContain(INQUIRY_WITHDRAWAL_SCOPE.transactionRecords);
    expect(text).toContain('같은 이메일로 다시 가입할 수 없습니다');
  });
});

describe('카카오 알림 근거', () => {
  const UNLINK = { reason: 'ACCOUNT_DELETE', eventAt: '2026-11-19T01:00:00.5+00:00', accountClosed: true };
  const PENDING = { processed: false, processedAt: null, inquiryReference: null, signinBlocked: false, signinBlockedAt: null };
  const KAKAO = { ...STATUS, inquiryReference: null, basis: 'kakao_unlink', kakaoUnlink: UNLINK };

  it('처리 전 대기 중이면 해제를, 카카오 알림으로 처리했으면 근거를 함께 받는다', () => {
    expect(parseMemberWithdrawalStatus({ ...PENDING, kakaoUnlink: { ...UNLINK, accountClosed: false } }))
      .toEqual({ ...PENDING, kakaoUnlink: { ...UNLINK, accountClosed: false } });
    expect(parseMemberWithdrawalStatus(KAKAO)).toEqual(KAKAO);
    for (const broken of [
      { ...KAKAO, inquiryReference: 1234 }, { ...KAKAO, kakaoUnlink: undefined }, { ...KAKAO, basis: 'email' },
      { ...STATUS, kakaoUnlink: UNLINK }, { ...PENDING, basis: 'kakao_unlink' }, { ...PENDING, kakaoUnlink: { reason: 'x' } },
    ]) expect(parseMemberWithdrawalStatus(broken)).toBeNull();
  });

  it('카카오 알림 처리 결과는 카카오 연결 삭제 수를 갖고, 문의 처리 결과에는 없어야 한다', () => {
    const erased = { ...ERASED, kakaoIdentities: 1 };
    expect(parseMemberWithdrawalOutcome({ ...KAKAO, status: 'processed', suspended: true, erased, revokedSessions: 1 }))
      .toEqual({ status: 'processed', withdrawal: KAKAO, erased, revokedSessions: 1 });
    expect(parseMemberWithdrawalOutcome({ ...KAKAO, status: 'processed', erased: ERASED, revokedSessions: 1 })).toBeNull();
    expect(parseMemberWithdrawalOutcome({ ...STATUS, status: 'processed', erased, revokedSessions: 1 })).toBeNull();
    expect(memberWithdrawalErasedSummary({ ...ERASED, addressBookEntries: 0, phoneNumbers: 0, marketingConsents: 0, restockAlerts: 0, kakaoIdentities: 1 }, 0))
      .toBe('카카오 로그인 연결 1건');
  });

  it('근거 표시는 문의 번호 또는 카카오 해제 사유다', () => {
    expect(memberWithdrawalBasisLabel(STATUS)).toBe('문의 #1234');
    expect(memberWithdrawalBasisLabel(KAKAO as never)).toBe('카카오 알림 · 카카오계정 탈퇴');
  });

  it('입력은 회원과 메모뿐이고 확인 문구는 사유·수신 시각·되돌릴 수 없음을 말한다', () => {
    expect(normalizeKakaoUnlinkWithdrawalForm(form({ profileId: MEMBER.toUpperCase(), note: '  카카오 알림 확인  ' })))
      .toEqual({ ok: true, value: { profileId: MEMBER, note: '카카오 알림 확인' } });
    const invalid = normalizeKakaoUnlinkWithdrawalForm(form({ profileId: 'nope', note: '가' }));
    expect(invalid.ok ? [] : Object.keys(invalid.errors).sort()).toEqual(['note', 'profileId']);
    const message = kakaoUnlinkWithdrawalConfirmMessage(UNLINK);
    expect(message).toMatch(/^카카오 연결 해제 알림 · 카카오계정 탈퇴 · 2026\. 11\. 19\./);
    expect(message).toContain('카카오 로그인 연결');
    expect(message).toContain('되돌릴 수 없고');
  });

  it('카카오 처리 거절 사유를 운영자 문구로 바꾼다', () => {
    expect(memberWithdrawalRpcError('kakao_unlink_member_request_required', 'kakao_unlink')).toContain('확인 연락 뒤');
    expect(memberWithdrawalRpcError('kakao_unlink_withdrawal_not_queued', 'kakao_unlink')).toContain('탈퇴 검토 대기 회원이 아닙니다');
    expect(memberWithdrawalRpcError('invalid_member_withdrawal', 'kakao_unlink')).toBe('처리 메모를 다시 확인해주세요.');
    expect(memberWithdrawalRpcError('invalid_member_withdrawal')).toBe('문의 번호와 처리 메모를 다시 확인해주세요.');
  });
});

describe('프로필 익명화 계약(2026-11-19)', () => {
  it('처리 상태는 지울 프로필 사진 여부를 조건부로 받는다. 처리 전에는 true일 수 없다', () => {
    expect(parseMemberWithdrawalStatus({ ...STATUS, avatarErasePending: true })).toEqual({ ...STATUS, avatarErasePending: true });
    expect(parseMemberWithdrawalStatus({ ...STATUS, avatarErasePending: false })).toMatchObject({ avatarErasePending: false });
    expect(parseMemberWithdrawalStatus(STATUS)).not.toHaveProperty('avatarErasePending');
    expect(parseMemberWithdrawalStatus({ ...STATUS, avatarErasePending: 'yes' })).toBeNull();
    expect(parseMemberWithdrawalStatus({ processed: false, processedAt: null, inquiryReference: null, signinBlocked: false, signinBlockedAt: null, avatarErasePending: true })).toBeNull();
  });

  it('처리 결과는 익명화한 칸 이름을 받고 모르는 이름은 거절하며 옛 응답(칸 없음)도 받는다', () => {
    const base = { ...STATUS, status: 'processed', suspended: true, revokedSessions: 0 };
    const parsed = parseMemberWithdrawalOutcome({ ...base, avatarErasePending: true, erased: { ...ERASED, profileFields: ['nickname', 'avatar'], adultVerifications: 2 } });
    expect(parsed).toMatchObject({ status: 'processed', withdrawal: { avatarErasePending: true }, erased: { profileFields: ['nickname', 'avatar'] } });
    expect(parseMemberWithdrawalOutcome({ ...base, erased: { ...ERASED, profileFields: ['email'] } })).toBeNull();
    expect(parseMemberWithdrawalOutcome({ ...base, erased: { ...ERASED, adultVerifications: -1 } })).toBeNull();
    expect(parseMemberWithdrawalOutcome({ ...base, erased: ERASED })).toMatchObject({ status: 'processed' });
    if (parsed?.status !== 'processed') throw new Error('processed expected');
    expect(memberWithdrawalErasedSummary(parsed.erased, 0)).toContain('프로필 익명화(닉네임·프로필 사진)');
    expect(memberWithdrawalErasedSummary(parsed.erased, 0)).toContain('성인 인증 기록 2건');
  });

  it('고객 안내와 어드민 범위가 같은 원천에서 닉네임 익명화·생년월일·사진 삭제를 말한다', () => {
    expect(INQUIRY_WITHDRAWAL_SCOPE.erased.join(' ')).toContain('생년월일·프로필 사진');
    expect(INQUIRY_WITHDRAWAL_SCOPE.erased).toContain('성인 인증 기록');
    expect(MEMBER_WITHDRAWAL_EFFECTS.join('\n')).toContain('성인 인증 기록');
    expect(INQUIRY_WITHDRAWAL_SCOPE.retained.join(' ')).not.toMatch(/닉네임|생년월일|프로필 사진/);
    expect(MEMBER_WITHDRAWAL_EFFECTS.join('\n')).toContain(`닉네임은 '${INQUIRY_WITHDRAWAL_SCOPE.anonymizedName}'과 구분 번호로 바뀌고 생년월일·프로필 사진 파일은 삭제`);
    expect(memberWithdrawalConfirmMessage({ reference: 1, category: 'account', title: 't', createdAt: PROCESSED_AT })).toContain('닉네임·생년월일·프로필 사진을 익명화하고 성인 인증 기록을 지운');
  });
});
