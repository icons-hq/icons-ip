export const ACCOUNT_DELETION_CONFIRMATION = '회원 탈퇴를 신청합니다';

const blockerContracts = {
  active_order: '/orders',
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

export interface AccountDeletionBlocker {
  code: AccountDeletionBlockerCode;
  count: number;
  path: '/orders' | '/tickets' | '/settings';
}

export interface AccountDeletionPreview {
  available: boolean;
  eligible: boolean;
  blockers: AccountDeletionBlocker[];
}

export interface AccountDeletionStatus {
  status: 'not_requested' | 'blocked' | 'processing';
  phase: 'none' | 'fenced' | 'awaiting_notification';
  nextAction: '/orders' | '/tickets' | '/settings' | 'retry_later';
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
    if (typeof code !== 'string' || !(code in blockerContracts)) return null;
    const typedCode = code as AccountDeletionBlockerCode;
    const expectedPath = blockerContracts[typedCode];
    if (!Number.isSafeInteger(count) || (count as number) < 1) return null;
    if (path !== expectedPath) return null;
    blockers.push({ code: typedCode, count: count as number, path: expectedPath });
  }
  return blockers;
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
      && (nextAction === '/orders' || nextAction === '/tickets' || nextAction === '/settings')
      && blockers.length > 0
  ) || (
    status === 'processing' && phase === 'awaiting_notification'
      && nextAction === 'retry_later' && blockers.length === 0
  );

  if (!valid) return notRequestedStatus;
  return { status, phase, nextAction, blockers };
}
