export type AdminMemberRole = 'user' | 'staff' | 'admin';

export interface AdminMemberSummary {
  id: string;
  nickname: string;
  maskedEmail: string;
  role: AdminMemberRole;
  createdAt: string;
  suspendedAt: string | null;
}

export interface AdminMemberDetail {
  id: string;
  nickname: string;
  email: string;
  role: AdminMemberRole;
  createdAt: string;
  consents: {
    terms: boolean;
    privacy: boolean;
    marketing: boolean;
  };
  suspendedAt: string | null;
  suspensionReason: string | null;
  goodsOrderCount: number;
  ticketOrderCount: number;
  submittedReportCount: number;
  receivedReportCount: number;
}

export type AdminMemberFormResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Record<string, string> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMBER_ROLES = new Set<AdminMemberRole>(['user', 'staff', 'admin']);

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeAdminMemberSearchForm(
  formData: FormData,
): AdminMemberFormResult<{ query: string }> {
  const query = readString(formData, 'query');
  if (query.length > 100) {
    return { ok: false, errors: { query: '검색어는 100자 이하로 입력해주세요.' } };
  }
  return { ok: true, value: { query } };
}

export function normalizeAdminMemberDetailForm(
  formData: FormData,
): AdminMemberFormResult<{ profileId: string }> {
  const profileId = readString(formData, 'profileId');
  return UUID_PATTERN.test(profileId)
    ? { ok: true, value: { profileId } }
    : { ok: false, errors: { profileId: '회원을 찾을 수 없습니다.' } };
}

export function normalizeAdminMemberSuspensionForm(
  formData: FormData,
): AdminMemberFormResult<{ profileId: string; reason: string }> {
  const target = normalizeAdminMemberDetailForm(formData);
  const reason = readString(formData, 'reason');
  const errors = target.ok ? {} : { ...target.errors };

  if (reason.length < 1 || reason.length > 200) {
    errors.reason = '내부 사유는 1자 이상 200자 이하로 입력해주세요.';
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      profileId: target.ok ? target.value.profileId : '',
      reason,
    },
  };
}

export function canModerateAdminMember(input: {
  actorId: string;
  actorRole: AdminMemberRole;
  memberId: string;
  memberRole: AdminMemberRole;
}) {
  if (input.actorId === input.memberId || input.memberRole === 'admin') return false;
  return input.actorRole === 'admin' || (input.actorRole === 'staff' && input.memberRole === 'user');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function optionalString(value: unknown) {
  return value === null ? null : requiredString(value);
}

function nonNegativeCount(value: unknown) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function parseAdminMemberSummary(value: unknown): AdminMemberSummary | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.profile_id);
  const nickname = requiredString(value.nickname);
  const maskedEmail = requiredString(value.masked_email);
  const role = value.role;
  const createdAt = requiredString(value.created_at);
  const suspendedAt = optionalString(value.suspended_at);

  if (!id || !UUID_PATTERN.test(id) || !nickname || !maskedEmail || !createdAt) return null;
  if (typeof role !== 'string' || !MEMBER_ROLES.has(role as AdminMemberRole)) return null;
  if (value.suspended_at !== null && !suspendedAt) return null;

  return {
    id,
    nickname,
    maskedEmail,
    role: role as AdminMemberRole,
    createdAt,
    suspendedAt,
  };
}

export function parseAdminMemberDetail(value: unknown): AdminMemberDetail | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.profile_id);
  const nickname = requiredString(value.nickname);
  const email = requiredString(value.email);
  const role = value.role;
  const createdAt = requiredString(value.created_at);
  const suspendedAt = optionalString(value.suspended_at);
  const suspensionReason = optionalString(value.suspension_reason);
  const consents = isRecord(value.consents) ? value.consents : null;
  const goodsOrderCount = nonNegativeCount(value.goods_order_count);
  const ticketOrderCount = nonNegativeCount(value.ticket_order_count);
  const submittedReportCount = nonNegativeCount(value.submitted_report_count);
  const receivedReportCount = nonNegativeCount(value.received_report_count);

  if (
    !id
    || !UUID_PATTERN.test(id)
    || !nickname
    || !email
    || typeof role !== 'string'
    || !MEMBER_ROLES.has(role as AdminMemberRole)
    || !createdAt
    || (value.suspended_at !== null && !suspendedAt)
    || (value.suspension_reason !== null && !suspensionReason)
    || !consents
    || goodsOrderCount === null
    || ticketOrderCount === null
    || submittedReportCount === null
    || receivedReportCount === null
  ) return null;

  return {
    id,
    nickname,
    email,
    role: role as AdminMemberRole,
    createdAt,
    consents: {
      terms: consents.terms === true,
      privacy: consents.privacy === true,
      marketing: consents.marketing === true,
    },
    suspendedAt,
    suspensionReason,
    goodsOrderCount,
    ticketOrderCount,
    submittedReportCount,
    receivedReportCount,
  };
}
