/*
 * 문의로 받은 회원 탈퇴의 운영자 처리(원장 CUS-036·CUS-035·OPS-021).
 *
 * 탈퇴 신청 기능(#137 Phase 1)이 꺼져 있는 동안 탈퇴는 1:1 문의로 받고, 고객 상세의 '탈퇴 요청 처리'가 DB
 * `admin_process_member_withdrawal` 한 트랜잭션으로 정지·비법정 개인정보 삭제·로그인 세션 종료·감사를 한다(hard delete 아님).
 * 카카오로만 가입한 회원이 카카오계정을 탈퇴했다는 알림을 받으면 같은 처리를 그 알림을 근거로 한다
 * (`admin_process_kakao_unlink_withdrawal`, 카카오 identity 삭제를 더함 — lib/admin/kakao-unlink-withdrawal.ts).
 * 재로그인 차단은 Supabase Auth 관리 API(ban)로 걸고 `admin_confirm_member_withdrawal_signin_block`이 DB에서 확인·기록한다.
 * 남는 항목과 이유는 docs/account-deletion-retention-policy.md §5.
 */
import { INQUIRY_WITHDRAWAL_SCOPE, parseAccountDeletionBlockers, type AccountDeletionBlocker, type AccountDeletionBlockerCode } from '@/lib/account-deletion';
import { transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { formatInquiryDateTime, inquiryCategoryLabel, isRestrictedMemberInquiryCategory } from '@/lib/inquiries';
import { isUuid } from '@/lib/uuid';
import { kakaoUnlinkReasonLabel, parseKakaoUnlinkSummary, type KakaoUnlinkSummary } from './kakao-unlink-withdrawal';
import type { AdminMemberFormResult } from './members';

export const MEMBER_WITHDRAWAL_NOTE_MIN = 2;
export const MEMBER_WITHDRAWAL_UNCONFIRMED = '확인창에서 대조한 문의 번호와 입력한 번호가 다릅니다. 다시 눌러 문의를 확인해주세요.';
export const MEMBER_WITHDRAWAL_NOTE_MAX = 200;
/** Auth 관리 API ban_duration. 100년 — DB 확인은 50년 이상 남은 차단만 재로그인 차단으로 인정한다. */
export const WITHDRAWN_MEMBER_BAN_DURATION = '876000h';

export interface MemberWithdrawalStatus {
  processed: boolean;
  processedAt: string | null;
  /** 문의로 처리했을 때의 문의 번호. 카카오 알림으로 처리했거나 처리 전이면 null. */
  inquiryReference: number | null;
  signinBlocked: boolean;
  signinBlockedAt: string | null;
  /** 카카오계정 탈퇴 알림으로 처리했으면 'kakao_unlink'. 문의로 처리했거나 처리 전이면 없다(DB 문서와 같은 조건부 키). */
  basis?: 'kakao_unlink';
  /** 처리 전이면 대기 중인 카카오 연결 해제, 카카오 알림으로 처리했으면 그 근거. 없으면 키가 없다. */
  kakaoUnlink?: KakaoUnlinkSummary;
}

export const MEMBER_WITHDRAWAL_ERASED_KEYS = [
  'addressBookEntries', 'phoneNumbers', 'marketingConsents', 'demographicConsents',
  'activityEvents', 'activityConsents', 'emailChangeRequests', 'restockAlerts',
] as const;
export type MemberWithdrawalErased = Record<(typeof MEMBER_WITHDRAWAL_ERASED_KEYS)[number], number> & {
  /** 카카오 알림으로 처리했을 때만 — 지운 카카오 로그인 연결(identity) 수. */
  kakaoIdentities?: number;
};

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
  '성별(고객 통계 동의)·활동 기록 동의와 기록 삭제, 진행 중인 이메일 변경 요청·대기 중인 재입고 알림 신청 삭제',
  '모든 기기 로그아웃과 재로그인 차단',
] as const;

/** 카카오 알림으로 처리할 때 위 범위에 더하는 것. 카카오계정이 없어져 카카오 로그인이라는 목적이 영구히 끝났다. */
export const KAKAO_UNLINK_WITHDRAWAL_EXTRA_EFFECT = '카카오 로그인 연결 삭제(카카오 회원번호·카카오 닉네임·프로필 사진 주소)';

/** 지우지 않고 남는 것(고객 안내와 같은 원천 INQUIRY_WITHDRAWAL_SCOPE). 정책(hard delete·법정 snapshot 분리)의 선행 조건이 준비될 때까지 남긴다. */
export const MEMBER_WITHDRAWAL_RETAINED: readonly string[] = [
  `${INQUIRY_WITHDRAWAL_SCOPE.transactionRecords}(전자상거래법에 따른 보관)`,
  `${INQUIRY_WITHDRAWAL_SCOPE.retained[0]}과 로그인 계정 — 완전 삭제 절차 준비 전까지 정지 상태로 남고, 같은 이메일로 다시 가입할 수 없습니다`,
  ...INQUIRY_WITHDRAWAL_SCOPE.retained.slice(1),
];

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
  active_order_payment: '결과가 확정되지 않은 주문 결제(결제 중·결제사 확인 필요)',
  active_ticket_payment: '결과가 확정되지 않은 티켓 결제(결제 중·결제사 확인 필요)',
  active_payment_attempt: '결과가 확정되지 않은 기타 결제(결제 중·결제사 확인 필요)',
  active_order_refund: '주문 환불·송금 대기',
  active_ticket_refund: '티켓 환급 처리',
  active_refund: '환불·송금 확인',
  active_ticket: '이용 전 티켓·결제 대기 예매',
  active_ticket_cancellation: '티켓 취소·환급 처리',
  staff_handover: '운영 권한(관리자·매니저) — 권한 회수 뒤 처리',
  not_available: '처리할 수 있는지 확인하지 못함(잠시 뒤 다시 시도)',
};

const ERASED_LABELS: Record<(typeof MEMBER_WITHDRAWAL_ERASED_KEYS)[number], string> = {
  addressBookEntries: '배송지',
  phoneNumbers: '휴대폰 번호',
  marketingConsents: '마케팅 수신 동의 철회',
  demographicConsents: '성별 동의 철회',
  activityEvents: '활동 기록',
  activityConsents: '활동 기록 동의 철회',
  emailChangeRequests: '이메일 변경 요청',
  restockAlerts: '대기 중인 재입고 알림 신청',
};

/** 처리 근거 한 줄(결과 문구·처리 기록 표시). */
export function memberWithdrawalBasisLabel(status: Pick<MemberWithdrawalStatus, 'basis' | 'inquiryReference' | 'kakaoUnlink'>): string {
  if (status.basis === 'kakao_unlink') {
    return status.kakaoUnlink ? `카카오 알림 · ${kakaoUnlinkReasonLabel(status.kakaoUnlink.reason)}` : '카카오 알림';
  }
  return `문의 #${status.inquiryReference}`;
}

/** 처리 결과 한 줄 요약. 0건은 빼고, 지운 것이 없으면 그렇게 말한다. */
export function memberWithdrawalErasedSummary(erased: MemberWithdrawalErased, revokedSessions: number): string {
  const parts = MEMBER_WITHDRAWAL_ERASED_KEYS.filter((key) => erased[key] > 0).map((key) => `${ERASED_LABELS[key]} ${erased[key]}건`);
  if (erased.kakaoIdentities) parts.push(`카카오 로그인 연결 ${erased.kakaoIdentities}건`);
  if (revokedSessions > 0) parts.push(`로그인 ${revokedSessions}건 종료`);
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

/** 처리 메모(정지 사유로 남는 내부 기록) 검증 — DB와 같은 2~200자, 줄바꿈·탭 말고는 제어 문자 없음. */
function memberWithdrawalNoteError(note: string): string | null {
  const length = [...note].length;
  return length < MEMBER_WITHDRAWAL_NOTE_MIN || length > MEMBER_WITHDRAWAL_NOTE_MAX || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(note)
    ? `처리 메모는 ${MEMBER_WITHDRAWAL_NOTE_MIN}자 이상 ${MEMBER_WITHDRAWAL_NOTE_MAX}자 이하로 입력해주세요.`
    : null;
}

export function normalizeMemberWithdrawalForm(
  formData: FormData,
): AdminMemberFormResult<{ profileId: string; inquiryReference: number; note: string }> {
  const profileId = readString(formData, 'profileId');
  const inquiryReference = parseInquiryReference(readString(formData, 'inquiryReference'));
  const note = readString(formData, 'note');
  /* 확인창에서 대조한 문의 번호. 대조 뒤 입력이 바뀌었거나 확인을 거치지 않은 제출은 처리하지 않는다. */
  const confirmedReference = parseInquiryReference(readString(formData, 'confirmedInquiryReference'));
  const errors: Record<string, string> = {};
  if (!isUuid(profileId)) errors.profileId = '회원을 찾을 수 없습니다.';
  if (inquiryReference === null) errors.inquiryReference = '탈퇴를 요청한 1:1 문의 번호(숫자)를 입력해주세요.';
  else if (confirmedReference !== inquiryReference) errors.inquiryReference = MEMBER_WITHDRAWAL_UNCONFIRMED;
  const noteError = memberWithdrawalNoteError(note);
  if (noteError) errors.note = noteError;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { profileId: profileId.toLowerCase(), inquiryReference: inquiryReference as number, note } };
}

function nullableInstant(value: unknown): value is string | null {
  return value === null || transactionInstant(value);
}

/**
 * 처리 상태 문서 검증. 모양이 다르면 null — 화면은 처리 동작을 그리지 않고 다시 불러오라고 안내한다.
 * 문의로 처리한 회원은 문의 번호가, 카카오 알림으로 처리한 회원은 basis와 근거 해제가 있어야 한다. 처리 전 회원의 kakaoUnlink는
 * 대기 목록에 있을 때만 온다.
 */
export function parseMemberWithdrawalStatus(value: unknown): MemberWithdrawalStatus | null {
  if (!transactionRecord(value) || typeof value.processed !== 'boolean' || typeof value.signinBlocked !== 'boolean'
    || !nullableInstant(value.processedAt) || !nullableInstant(value.signinBlockedAt)) return null;
  const kakaoUnlink = value.kakaoUnlink === undefined ? undefined : parseKakaoUnlinkSummary(value.kakaoUnlink);
  if (kakaoUnlink === null) return null;
  const kakaoBasis = value.basis === 'kakao_unlink';
  if (value.basis !== undefined && !kakaoBasis) return null;
  if (value.processed) {
    if (value.processedAt === null || value.signinBlocked !== (value.signinBlockedAt !== null)) return null;
    if (kakaoBasis ? value.inquiryReference !== null || !kakaoUnlink : !transactionInteger(value.inquiryReference, 1) || kakaoUnlink) return null;
  } else if (value.processedAt !== null || value.inquiryReference !== null || value.signinBlocked || value.signinBlockedAt !== null || kakaoBasis) {
    return null;
  }
  return {
    processed: value.processed,
    processedAt: value.processedAt,
    inquiryReference: value.processed && !kakaoBasis ? value.inquiryReference as number : null,
    signinBlocked: value.signinBlocked,
    signinBlockedAt: value.signinBlockedAt,
    ...(kakaoBasis ? { basis: 'kakao_unlink' as const } : {}),
    ...(kakaoUnlink ? { kakaoUnlink } : {}),
  };
}

function parseErased(value: unknown, kakaoBasis: boolean): MemberWithdrawalErased | null {
  if (!transactionRecord(value)) return null;
  const erased = {} as MemberWithdrawalErased;
  for (const key of MEMBER_WITHDRAWAL_ERASED_KEYS) {
    if (!transactionInteger(value[key])) return null;
    erased[key] = value[key];
  }
  /* 카카오 알림 처리만 카카오 identity 삭제 수를 돌려준다. */
  if (kakaoBasis) {
    if (!transactionInteger(value.kakaoIdentities)) return null;
    erased.kakaoIdentities = value.kakaoIdentities;
  } else if (value.kakaoIdentities !== undefined) {
    return null;
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
    ...(value.basis !== undefined ? { basis: value.basis } : {}),
    ...(value.kakaoUnlink !== undefined ? { kakaoUnlink: value.kakaoUnlink } : {}),
  });
  if (!withdrawal?.processed || !transactionInteger(value.revokedSessions)) return null;
  if (value.status === 'already_processed') return { status: 'already_processed', withdrawal, revokedSessions: value.revokedSessions };
  if (value.status !== 'processed') return null;
  const erased = parseErased(value.erased, withdrawal.basis === 'kakao_unlink');
  return erased ? { status: 'processed', withdrawal, erased, revokedSessions: value.revokedSessions } : null;
}

/** 처리 전 확인창이 보여주는 문의 요약(admin_member_withdrawal_inquiry). 운영자가 탈퇴를 요청한 문의가 맞는지 대조한다. */
export interface MemberWithdrawalInquiry {
  reference: number;
  category: string;
  title: string;
  createdAt: string;
}

/** 그 회원의 문의가 아니면 null(RPC가 null), 모양이 다르면 undefined. */
export function parseMemberWithdrawalInquiry(value: unknown): MemberWithdrawalInquiry | null | undefined {
  if (value === null) return null;
  if (!transactionRecord(value) || !transactionInteger(value.reference, 1) || typeof value.category !== 'string'
    || typeof value.title !== 'string' || !transactionInstant(value.createdAt)) return undefined;
  return { reference: value.reference, category: value.category, title: value.title, createdAt: value.createdAt };
}

/** 되돌릴 수 없는 처리 직전의 확인 문구. 계정 유형이 아닌 문의면 경고를 앞에 둔다. */
export function memberWithdrawalConfirmMessage(inquiry: MemberWithdrawalInquiry): string {
  const summary = `문의 #${inquiry.reference} · ${inquiryCategoryLabel(inquiry.category)} · ${inquiry.title} · ${formatInquiryDateTime(inquiry.createdAt)} 접수`;
  const warning = isRestrictedMemberInquiryCategory(inquiry.category)
    ? ''
    : `주의: 이 문의는 '계정' 유형이 아닙니다(${inquiryCategoryLabel(inquiry.category)}). 탈퇴를 요청한 문의가 맞는지 다시 확인해주세요.\n\n`;
  return `${warning}${summary}\n\n이 고객을 정지하고 배송지·휴대폰 번호·마케팅 수신 동의 등을 지운 뒤 모든 로그인을 끊고 재로그인을 막습니다. 지운 정보는 되돌릴 수 없고, 처리한 계정은 정지를 해제할 수 없습니다. 위 문의의 탈퇴 요청을 처리할까요?`;
}

/** 카카오 알림으로 처리하기 직전의 확인 문구. */
export function kakaoUnlinkWithdrawalConfirmMessage(unlink: KakaoUnlinkSummary): string {
  return `카카오 연결 해제 알림 · ${kakaoUnlinkReasonLabel(unlink.reason)} · ${formatInquiryDateTime(unlink.eventAt)} 수신\n\n`
    + '이 회원은 카카오로만 가입해 다시 로그인할 수 없습니다. 이 알림을 근거로 고객을 정지하고 배송지·휴대폰 번호·마케팅 수신 동의·카카오 로그인 연결 등을 지운 뒤 '
    + '모든 로그인을 끊고 재로그인을 막습니다. 지운 정보는 되돌릴 수 없고, 처리한 계정은 정지를 해제할 수 없습니다. 탈퇴를 처리할까요?';
}

/** RPC 오류를 운영자 문구로. 모르는 오류는 일반 실패로 접는다. 카카오 알림 처리는 입력이 메모뿐이라 입력 오류 문구가 다르다. */
export function memberWithdrawalRpcError(message: string | null | undefined, basis: 'inquiry' | 'kakao_unlink' = 'inquiry'): string {
  const value = message ?? '';
  if (value.includes('kakao_unlink_member_request_required')) {
    return '카카오 연결만 끊은 회원은 다시 로그인할 수 있어 회원 확인이 필요합니다. 확인 연락 뒤 회원이 쓴 1:1 문의 번호로 처리해주세요.';
  }
  if (value.includes('kakao_unlink_withdrawal_not_queued')) {
    return '카카오 연결 해제 탈퇴 검토 대기 회원이 아닙니다(다시 로그인했거나 해제 기록이 없습니다). 화면을 새로고침해 상태를 확인해주세요.';
  }
  if (value.includes('member_withdrawal_inquiry_not_found')) return '이 회원이 쓴 1:1 문의 번호가 아닙니다. 탈퇴를 요청한 문의의 번호를 확인해주세요.';
  if (value.includes('cannot_withdraw_self')) return '본인 계정은 탈퇴 처리할 수 없습니다.';
  if (value.includes('operator_manager_change_required')) return '통합 매니저와 계정 주매니저는 먼저 매니저 관리에서 승계 또는 역할 변경을 진행해주세요.';
  if (value.includes('profile_not_found')) return '회원을 찾을 수 없습니다.';
  if (value.includes('invalid_member_withdrawal')) return basis === 'kakao_unlink' ? `처리 메모를 ${MEMBER_WITHDRAWAL_NOTE_MIN}~${MEMBER_WITHDRAWAL_NOTE_MAX}자로 다시 적어주세요.` : `문의 번호(숫자)와 처리 메모(${MEMBER_WITHDRAWAL_NOTE_MIN}~${MEMBER_WITHDRAWAL_NOTE_MAX}자)를 다시 확인해주세요.`;
  if (value.includes('operator_capability_required') || value.includes('forbidden') || value.includes('auth_required')) {
    return '이 계정을 탈퇴 처리할 권한이 없습니다.';
  }
  return '탈퇴 요청을 처리하지 못했습니다. 화면을 새로고침해 처리됐는지와 남은 일을 확인한 뒤 다시 시도해주세요.';
}

/** 카카오 알림 처리 입력: 회원과 처리 메모(문의 탈퇴와 같은 2~200자, 제어 문자 없음). */
export function normalizeKakaoUnlinkWithdrawalForm(formData: FormData): AdminMemberFormResult<{ profileId: string; note: string }> {
  const profileId = readString(formData, 'profileId');
  const note = readString(formData, 'note');
  const errors: Record<string, string> = {};
  if (!isUuid(profileId)) errors.profileId = '회원을 찾을 수 없습니다.';
  const noteError = memberWithdrawalNoteError(note);
  if (noteError) errors.note = noteError;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { profileId: profileId.toLowerCase(), note } };
}
