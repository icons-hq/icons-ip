import { isLoyaltyGrade } from '@/lib/loyalty';
export type AdminMemberRole = 'user' | 'staff' | 'admin';

export interface AdminMemberSummary {
  id: string;
  nickname: string;
  maskedEmail: string;
  role: AdminMemberRole;
  createdAt: string;
  suspendedAt: string | null;
  /** 휴면 — 법정 의무가 아니라 우리 정책의 상태다(2023-09-15 개정으로 법정 휴면 폐지). */
  dormantAt: string | null;
  lastLoginAt: string | null;
  loyaltyGrade: string;
  /** 구매 실적 롤업(`member_purchase_stats`). 주문이 없으면 0이다. */
  orderCount: number;
  grossTotal: number;
  lastOrderAt: string | null;
}

export const MEMBER_STATUS_FILTERS = [
  { value: '', label: '전체' },
  { value: 'active', label: '활동중' },
  { value: 'dormant', label: '휴면' },
  { value: 'suspended', label: '정지' },
] as const;

export interface AdminMemberFilters {
  query: string;
  status: string;
  grade: string;
  minSpend: number | null;
}

function readParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export function normalizeAdminMemberFilters(
  params: Record<string, string | string[] | undefined>,
): AdminMemberFilters {
  const status = readParam(params, 'status');
  const grade = readParam(params, 'grade');
  const minSpend = Number.parseInt(readParam(params, 'minSpend'), 10);
  return {
    query: readParam(params, 'q').trim().slice(0, 100),
    status: MEMBER_STATUS_FILTERS.some((entry) => entry.value === status) ? status : '',
    grade: isLoyaltyGrade(grade) ? grade : '',
    minSpend: Number.isInteger(minSpend) && minSpend > 0 ? minSpend : null,
  };
}

export function adminMembersHref(
  filters: AdminMemberFilters,
  patch: Partial<AdminMemberFilters> = {},
): string {
  const next = { ...filters, ...patch };
  const params = new URLSearchParams();
  if (next.query) params.set('q', next.query);
  if (next.status) params.set('status', next.status);
  if (next.grade) params.set('grade', next.grade);
  if (next.minSpend) params.set('minSpend', String(next.minSpend));
  const query = params.toString();
  return query ? `/admin/community/members?${query}` : '/admin/community/members';
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
  /** 회원 등급(무료 Loyalty). 상세 로드가 profiles 에서 병합한다. */
  loyaltyGrade: string;
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

export function normalizeAdminMemberLoyaltyForm(
  formData: FormData,
): AdminMemberFormResult<{ profileId: string; grade: string; note: string }> {
  const target = normalizeAdminMemberDetailForm(formData);
  const grade = readString(formData, 'grade');
  const note = readString(formData, 'note');
  const errors = target.ok ? {} : { ...target.errors };

  if (!isLoyaltyGrade(grade)) {
    errors.grade = '보정할 등급을 선택해주세요.';
  }
  if (note.length < 1 || note.length > 200) {
    errors.note = '보정 사유는 1자 이상 200자 이하로 입력해주세요.';
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      profileId: target.ok ? target.value.profileId : '',
      grade,
      note,
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
    dormantAt: optionalString(value.dormant_at),
    lastLoginAt: optionalString(value.last_login_at),
    loyaltyGrade: typeof value.loyalty_grade === 'string' ? value.loyalty_grade : 'welcome',
    orderCount: typeof value.order_count === 'number' ? value.order_count : 0,
    grossTotal: typeof value.gross_total === 'number' ? value.gross_total : 0,
    lastOrderAt: optionalString(value.last_order_at),
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
    /* RPC 결과에는 없다 — getAdminMemberDetail 이 profiles 에서 병합해 덮어쓴다. */
    loyaltyGrade: 'welcome',
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
