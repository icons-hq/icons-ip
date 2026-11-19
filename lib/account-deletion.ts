export const ACCOUNT_DELETION_CONFIRMATION = '회원 탈퇴를 신청합니다';

/**
 * 탈퇴 신청 기능이 꺼져 있는 동안 1:1 문의로 받은 탈퇴를 운영자가 처리할 때(admin_process_member_withdrawal) 지우는 것과
 * 남는 것. hard delete가 아니라서 남는 정보가 있다 — 고객 안내(회원 탈퇴 화면)와 어드민 처리 화면이 이 목록 하나를 쓴다.
 * 순서·끝 글자는 고객 문장의 조사('은')에 맞춰 둔다. 범위가 바뀌면 docs/account-deletion-retention-policy.md §5와 함께 바꾼다.
 */
export const INQUIRY_WITHDRAWAL_SCOPE = {
  erased: ['배송지', '인증한 휴대폰 번호', '마케팅 정보 수신 동의', '성별·활동 기록', '재입고 알림 신청', '생년월일·프로필 사진', '성인 인증 기록'],
  /** 닉네임은 지우지 않고 이 이름(+짧은 구분 번호)으로 바꾼다 — 리뷰·커뮤니티 작성물에는 이 이름으로 표시된다. */
  anonymizedName: '탈퇴한 회원',
  retained: ['회원 프로필(이메일)', '1:1 문의·리뷰·커뮤니티 작성물', '보유 카드·카드팩·위시·알림함'],
  transactionRecords: '주문·결제·환불·티켓 거래 기록',
  rejoin: '같은 이메일로는 다시 가입할 수 없어요',
} as const;


const blockerContracts = {
  active_order: '/orders',
  active_received_gift: '/gifts',
  active_shipping_collect: '/orders',
  active_claim_fee: '/orders',
  subscription_active: '/my/subscriptions',
  subscription_payment_pending: '/my/subscriptions',
  billing_registration_pending: '/my/subscriptions',
  billing_card_cleanup: '/my/subscriptions',
  active_cancellation: '/orders',
  active_order_payment: '/orders',
  active_ticket_payment: '/tickets',
  active_payment_attempt: '/settings',
  active_order_refund: '/orders',
  active_ticket_refund: '/tickets',
  active_refund: '/settings',
  active_ticket: '/tickets',
  active_ticket_cancellation: '/tickets',
  staff_handover: '/settings',
  not_available: '/settings',
} as const;

export type AccountDeletionBlockerCode = keyof typeof blockerContracts;

// `code in blockerContracts`는 프로토타입 체인까지 훑는다. 지금은 아래 path 대조가
// 막지만, 코드 허용 판정이 다른 필드의 방어 한 겹에만 기대지 않게 한다.
const ACCOUNT_DELETION_BLOCKER_CODES: readonly string[] = Object.keys(blockerContracts);

export interface AccountDeletionBlocker {
  code: AccountDeletionBlockerCode;
  count: number;
  path: '/orders' | '/tickets' | '/settings' | '/gifts' | '/my/subscriptions';
}

export interface AccountDeletionPreview {
  available: boolean;
  eligible: boolean;
  blockers: AccountDeletionBlocker[];
}

export interface AccountDeletionStatus {
  status: 'not_requested' | 'blocked' | 'processing';
  phase: 'none' | 'fenced' | 'awaiting_notification';
  nextAction: '/orders' | '/tickets' | '/settings' | '/gifts' | '/my/subscriptions' | 'retry_later';
  blockers: AccountDeletionBlocker[];
}

export interface AccountDeletionPresentation {
  preview: AccountDeletionPreview;
  status: AccountDeletionStatus;
}

const unavailablePreview: AccountDeletionPreview = {
  available: false,
  eligible: false,
  blockers: [{ code: 'not_available', count: 1, path: '/settings' }],
};

const notRequestedStatus: AccountDeletionStatus = {
  status: 'not_requested',
  phase: 'none',
  nextAction: '/settings',
  blockers: [],
};

export const UNAVAILABLE_ACCOUNT_DELETION_PRESENTATION: AccountDeletionPresentation = {
  preview: unavailablePreview,
  status: notRequestedStatus,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeBlockers(value: unknown): AccountDeletionBlocker[] | null {
  if (!Array.isArray(value)) return null;

  const blockers: AccountDeletionBlocker[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    const { code, count, path } = candidate;
    if (typeof code !== 'string' || !ACCOUNT_DELETION_BLOCKER_CODES.includes(code)) return null;
    const typedCode = code as AccountDeletionBlockerCode;
    const expectedPath = blockerContracts[typedCode];
    if (!Number.isSafeInteger(count) || (count as number) < 1) return null;
    if (path !== expectedPath) return null;
    blockers.push({ code: typedCode, count: count as number, path: expectedPath });
  }
  return blockers;
}

/** 진행 중 의무 목록 응답 검증. 하나라도 계약(코드·건수·해소 경로)과 다르면 null — 어드민 탈퇴 요청 처리 결과도 같은 모양이다. */
export function parseAccountDeletionBlockers(value: unknown): AccountDeletionBlocker[] | null {
  return normalizeBlockers(value);
}

export function normalizeAccountDeletionPreview(value: unknown): AccountDeletionPreview {
  if (!isRecord(value)) return unavailablePreview;
  const blockers = normalizeBlockers(value.blockers);
  if (
    blockers === null
    || typeof value.available !== 'boolean'
    || typeof value.eligible !== 'boolean'
    || (value.eligible && (!value.available || blockers.length > 0))
  ) {
    return unavailablePreview;
  }

  return {
    available: value.available,
    eligible: value.eligible,
    blockers,
  };
}

export function normalizeAccountDeletionStatus(value: unknown): AccountDeletionStatus {
  if (!isRecord(value)) return notRequestedStatus;
  const blockers = normalizeBlockers(value.blockers);
  if (blockers === null) return notRequestedStatus;

  const status = value.status;
  const phase = value.phase;
  const nextAction = value.nextAction;
  const valid = (
    status === 'not_requested' && phase === 'none' && nextAction === '/settings'
      && blockers.length === 0
  ) || (
    status === 'blocked' && phase === 'fenced'
      && (nextAction === '/orders' || nextAction === '/tickets' || nextAction === '/settings' || nextAction === '/gifts' || nextAction === '/my/subscriptions')
      && blockers.length > 0
  ) || (
    status === 'processing' && phase === 'awaiting_notification'
      && nextAction === 'retry_later' && blockers.length === 0
  );

  if (!valid) return notRequestedStatus;
  return { status, phase, nextAction, blockers };
}
