/*
 * 문의로 받은 회원 탈퇴의 운영자 처리(원장 CUS-036·CUS-035·OPS-021).
 *
 * 탈퇴 신청 기능(#137 Phase 1)이 꺼져 있는 동안 탈퇴는 1:1 문의로 받고, 고객 상세의 '탈퇴 요청 처리'가 DB
 * `admin_process_member_withdrawal` 한 트랜잭션으로 정지·비법정 개인정보 삭제·로그인 세션 종료·감사를 한다(hard delete 아님).
 * 재로그인 차단은 Supabase Auth 관리 API(ban)로 걸고 `admin_confirm_member_withdrawal_signin_block`이 DB에서 확인·기록한다.
 * 남는 항목과 이유는 docs/account-deletion-retention-policy.md §5.
 */
import { parseAccountDeletionBlockers, type AccountDeletionBlocker, type AccountDeletionBlockerCode } from '@/lib/account-deletion';
import { transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
import type { AdminMemberFormResult } from './members';

export const MEMBER_WITHDRAWAL_NOTE_MIN = 2;
export const MEMBER_WITHDRAWAL_NOTE_MAX = 200;
/** Auth 관리 API ban_duration. 100년 — DB 확인은 50년 이상 남은 차단만 재로그인 차단으로 인정한다. */
export const WITHDRAWN_MEMBER_BAN_DURATION = '876000h';

export interface MemberWithdrawalStatus {
  processed: boolean;
  processedAt: string | null;
  inquiryReference: number | null;
  signinBlocked: boolean;
  signinBlockedAt: string | null;
}

export const MEMBER_WITHDRAWAL_ERASED_KEYS = [
  'addressBookEntries', 'phoneNumbers', 'marketingConsents', 'demographicConsents',
  'activityEvents', 'activityConsents', 'emailChangeRequests', 'restockAlerts',
] as const;
export type MemberWithdrawalErased = Record<(typeof MEMBER_WITHDRAWAL_ERASED_KEYS)[number], number>;

export type MemberWithdrawalOutcome =
  | { status: 'blocked'; blockers: AccountDeletionBlocker[] }
  | { status: 'processed'; withdrawal: MemberWithdrawalStatus; erased: MemberWithdrawalErased; revokedSessions: number }
  | { status: 'already_processed'; withdrawal: MemberWithdrawalStatus; revokedSessions: number };

/** 처리 전 확인창·화면 설명이 함께 쓰는 처리 범위. DB 함수의 처리 순서와 같다. */
export const MEMBER_WITHDRAWAL_EFFECTS = [
  '계정 정지(작성·구매·예매·카드팩 개봉·게임 플레이 차단)',
  '배송지 관리(주소록) 삭제',
  '인증한 휴대폰 번호와 인증 요청·이력 삭제',
  '마케팅 정보 수신 동의 전 수단 철회',
  '성별(고객 통계 동의)·활동 기록 동의와 기록 삭제, 진행 중인 이메일 변경 요청·재입고 알림 신청 삭제',
  '모든 기기의 로그인 세션 종료와 재로그인 차단',
] as const;

/** 지우지 않고 남는 것. 정책(hard delete·법정 snapshot 분리)의 선행 조건이 준비될 때까지 남긴다. */
export const MEMBER_WITHDRAWAL_RETAINED = [
  '주문·결제·환불·티켓 등 거래 기록(전자상거래법에 따른 보관)',
  '회원 프로필(이메일·닉네임·생년월일)과 로그인 계정 — 완전 삭제 절차 준비 전까지 정지 상태로 남습니다',
  '1:1 문의·리뷰·커뮤니티 작성물, 보유 카드·카드팩, 위시·알림함',
] as const;

/** 운영자가 보는 진행 중 의무 이름. 고객 화면 이름과 같은 코드 계약(lib/account-deletion)이다. */
export const MEMBER_WITHDRAWAL_BLOCKER_LABELS: Record<AccountDeletionBlockerCode, string> = {
  active_order: '진행 중인 주문(결제 대기·결제완료·발주확인·배송중·교환 재출고)',
  active_received_gift: '받은 선물의 배송·취소 처리',
  active_shipping_collect: '착불 수납·환급 확인',
  active_claim_fee: '반품·교환 배송비 청구·반환',
  subscription_active: '정기구매 해지',
  subscription_payment_pending: '정기구매 결제 확인',
  billing_registration_pending: '정기결제 카드 등록 확인',
  billing_card_cleanup: '정기결제 카드 해지',
  active_cancellation: '취소 요청·취소 처리',
  active_order_payment: '주문 결제 정합화',
  active_ticket_payment: '티켓 결제 정합화',
  active_payment_attempt: '결제 시도 정합화',
  active_order_refund: '주문 환불·송금 대기',
  active_ticket_refund: '티켓 환급 처리',
  active_refund: '환불·송금 확인',
  active_ticket: '이용 전 티켓·결제 대기 예매',
  active_ticket_cancellation: '티켓 취소·환급 처리',
  staff_handover: '운영 권한(관리자·매니저) — 권한 회수 뒤 처리',
  not_available: '처리 준비',
};

const ERASED_LABELS: Record<keyof MemberWithdrawalErased, string> = {
  addressBookEntries: '배송지',
  phoneNumbers: '휴대폰 번호',
  marketingConsents: '마케팅 수신 동의 철회',
  demographicConsents: '성별 동의 철회',
  activityEvents: '활동 기록',
  activityConsents: '활동 기록 동의 철회',
  emailChangeRequests: '이메일 변경 요청',
  restockAlerts: '재입고 알림 신청',
};

/** 처리 결과 한 줄 요약. 0건은 빼고, 지운 것이 없으면 그렇게 말한다. */
export function memberWithdrawalErasedSummary(erased: MemberWithdrawalErased, revokedSessions: number): string {
  const parts = MEMBER_WITHDRAWAL_ERASED_KEYS.filter((key) => erased[key] > 0).map((key) => `${ERASED_LABELS[key]} ${erased[key]}건`);
  if (revokedSessions > 0) parts.push(`로그인 세션 ${revokedSessions}개 종료`);
  return parts.length ? parts.join(' · ') : '지울 정보가 없었습니다';
}

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/** 문의 번호는 화면 표기(#123)를 붙여 넣어도 받는다. */
export function parseInquiryReference(value: string): number | null {
  const digits = value.trim().replace(/^#/, '');
  if (!/^[1-9][0-9]{0,14}$/.test(digits)) return null;
  const reference = Number(digits);
  return Number.isSafeInteger(reference) ? reference : null;
}

export function normalizeMemberWithdrawalForm(
  formData: FormData,
): AdminMemberFormResult<{ profileId: string; inquiryReference: number; note: string }> {
  const profileId = readString(formData, 'profileId');
  const inquiryReference = parseInquiryReference(readString(formData, 'inquiryReference'));
  const note = readString(formData, 'note');
  const noteLength = [...note].length;
  const errors: Record<string, string> = {};
  if (!isUuid(profileId)) errors.profileId = '회원을 찾을 수 없습니다.';
  if (inquiryReference === null) errors.inquiryReference = '탈퇴를 요청한 1:1 문의 번호(숫자)를 입력해주세요.';
  if (noteLength < MEMBER_WITHDRAWAL_NOTE_MIN || noteLength > MEMBER_WITHDRAWAL_NOTE_MAX || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(note)) {
    errors.note = `처리 메모는 ${MEMBER_WITHDRAWAL_NOTE_MIN}자 이상 ${MEMBER_WITHDRAWAL_NOTE_MAX}자 이하로 입력해주세요.`;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { profileId: profileId.toLowerCase(), inquiryReference: inquiryReference as number, note } };
}

function nullableInstant(value: unknown): value is string | null {
  return value === null || transactionInstant(value);
}

/** 처리 상태 문서 검증. 모양이 다르면 null — 화면은 처리 동작을 그리지 않고 다시 불러오라고 안내한다. */
export function parseMemberWithdrawalStatus(value: unknown): MemberWithdrawalStatus | null {
  if (!transactionRecord(value) || typeof value.processed !== 'boolean' || typeof value.signinBlocked !== 'boolean'
    || !nullableInstant(value.processedAt) || !nullableInstant(value.signinBlockedAt)) return null;
  if (value.processed) {
    if (value.processedAt === null || !transactionInteger(value.inquiryReference, 1)) return null;
    if (value.signinBlocked !== (value.signinBlockedAt !== null)) return null;
  } else if (value.processedAt !== null || value.inquiryReference !== null || value.signinBlocked || value.signinBlockedAt !== null) {
    return null;
  }
  return {
    processed: value.processed,
    processedAt: value.processedAt,
    inquiryReference: value.processed ? value.inquiryReference as number : null,
    signinBlocked: value.signinBlocked,
    signinBlockedAt: value.signinBlockedAt,
  };
}

function parseErased(value: unknown): MemberWithdrawalErased | null {
  if (!transactionRecord(value)) return null;
  const erased = {} as MemberWithdrawalErased;
  for (const key of MEMBER_WITHDRAWAL_ERASED_KEYS) {
    if (!transactionInteger(value[key])) return null;
    erased[key] = value[key];
  }
  return erased;
}

export function parseMemberWithdrawalOutcome(value: unknown): MemberWithdrawalOutcome | null {
  if (!transactionRecord(value)) return null;
  if (value.status === 'blocked') {
    const blockers = parseAccountDeletionBlockers(value.blockers);
    return blockers && blockers.length ? { status: 'blocked', blockers } : null;
  }
  const withdrawal = parseMemberWithdrawalStatus({
    processed: value.processed, processedAt: value.processedAt, inquiryReference: value.inquiryReference,
    signinBlocked: value.signinBlocked, signinBlockedAt: value.signinBlockedAt,
  });
  if (!withdrawal?.processed || !transactionInteger(value.revokedSessions)) return null;
  if (value.status === 'already_processed') return { status: 'already_processed', withdrawal, revokedSessions: value.revokedSessions };
  if (value.status !== 'processed') return null;
  const erased = parseErased(value.erased);
  return erased ? { status: 'processed', withdrawal, erased, revokedSessions: value.revokedSessions } : null;
}

/** RPC 오류를 운영자 문구로. 모르는 오류는 일반 실패로 접는다. */
export function memberWithdrawalRpcError(message: string | null | undefined): string {
  const value = message ?? '';
  if (value.includes('member_withdrawal_inquiry_not_found')) return '이 회원이 쓴 1:1 문의 번호가 아닙니다. 탈퇴를 요청한 문의의 번호를 확인해주세요.';
  if (value.includes('cannot_withdraw_self')) return '본인 계정은 탈퇴 처리할 수 없습니다.';
  if (value.includes('operator_manager_change_required')) return '통합 매니저와 계정 주매니저는 먼저 매니저 관리에서 승계 또는 역할 변경을 진행해주세요.';
  if (value.includes('profile_not_found')) return '회원을 찾을 수 없습니다.';
  if (value.includes('invalid_member_withdrawal')) return '문의 번호와 처리 메모를 다시 확인해주세요.';
  if (value.includes('operator_capability_required') || value.includes('forbidden') || value.includes('auth_required')) {
    return '이 계정을 탈퇴 처리할 권한이 없습니다.';
  }
  return '탈퇴 요청을 처리하지 못했습니다. 최신 상태를 확인한 뒤 다시 시도해주세요.';
}
