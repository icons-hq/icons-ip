import { safeNextPath } from '@/lib/auth/onboarding';
import { MANAGER_ROLES, type ManagerRole } from './access';

/**
 * 운영자 2단계 인증(TOTP, 원장 OPS-006). 스위치는 DB `private.operator_mfa_policy`가 진실원이고 기본 꺼짐이다.
 * 켜지면 DB 권한 판정이 지금 세션의 aal2를 요구하고, 앱 가드는 aal2가 아닌 운영자를 인증 화면으로 보낸다.
 */
export const ADMIN_MFA_PATH = '/admin/mfa';
/** 운영자 누구나 쓰는 본인 인증 앱 등록·확인 화면. 스위치를 켜기 전에도 미리 등록한다. */
export const ADMIN_MY_SECURITY_PATH = '/admin/settings/security';
/** 스위치·운영자별 등록 현황·기기 분실 초기화(매니저 관리 권한, 초기화는 통합 매니저). */
export const OPERATOR_MFA_POLICY_PATH = '/admin/settings/mfa';

export interface OperatorMfaState {
  /** 스위치가 켜졌고 이 사람이 운영자다. */
  required: boolean;
  /** 지금 세션이 기준(aal2 + 살아 있는 세션)을 만족한다. */
  satisfied: boolean;
}

export const OPERATOR_MFA_NOT_REQUIRED: OperatorMfaState = { required: false, satisfied: true };

/**
 * 본인 권한 응답의 `mfa`. 키가 없으면 MFA를 모르는 옛 DB라 요구하지 않는다(그 DB도 강제하지 않는다).
 * 모양이 틀리면 운영자 화면을 열지 않는다(fail-closed).
 */
export function parseOperatorMfa(value: unknown): OperatorMfaState {
  if (value === undefined) return OPERATOR_MFA_NOT_REQUIRED;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { required: true, satisfied: false };
  const row = value as Record<string, unknown>;
  if (typeof row.required !== 'boolean' || typeof row.satisfied !== 'boolean') return { required: true, satisfied: false };
  return { required: row.required, satisfied: row.satisfied };
}

/** 인증 뒤 돌아갈 곳은 어드민 화면만. 인증 화면 자신·바깥 주소는 어드민 홈으로 바꾼다. */
export function safeAdminNextPath(value: string | null | undefined): string {
  const next = safeNextPath(value ?? '');
  const path = next.split(/[?#]/, 1)[0];
  if ((path !== '/admin' && !path.startsWith('/admin/')) || path === ADMIN_MFA_PATH || path.startsWith(`${ADMIN_MFA_PATH}/`)) return '/admin';
  return next;
}

export function adminMfaPath(next: string): string {
  return `${ADMIN_MFA_PATH}?next=${encodeURIComponent(safeAdminNextPath(next))}`;
}

export interface OperatorMfaRow {
  id: string;
  nickname: string;
  maskedEmail: string;
  managerRole: ManagerRole | null;
  verifiedFactors: number;
  unverifiedFactors: number;
  verifiedAt: string | null;
}

export interface OperatorMfaPolicy {
  required: boolean;
  revision: number;
  updatedAt: string;
  updatedBy: string | null;
  unenrolledCount: number;
  operators: OperatorMfaRow[];
}

const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const instant = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));

function parseRow(value: unknown): OperatorMfaRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.nickname !== 'string' || typeof row.maskedEmail !== 'string'
    || !(row.managerRole === null || MANAGER_ROLES.includes(row.managerRole as ManagerRole))
    || !count(row.verifiedFactors) || !count(row.unverifiedFactors) || !(row.verifiedAt === null || instant(row.verifiedAt))) return null;
  return { id: row.id, nickname: row.nickname, maskedEmail: row.maskedEmail, managerRole: row.managerRole as ManagerRole | null,
    verifiedFactors: row.verifiedFactors, unverifiedFactors: row.unverifiedFactors, verifiedAt: row.verifiedAt as string | null };
}

/** DB 문서를 그대로 믿지 않고 화면이 쓰는 모양만 통과시킨다. */
export function parseOperatorMfaPolicy(value: unknown): OperatorMfaPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const doc = value as Record<string, unknown>;
  if (typeof doc.required !== 'boolean' || !Number.isSafeInteger(doc.revision) || Number(doc.revision) < 1 || !instant(doc.updatedAt)
    || !(doc.updatedBy === null || typeof doc.updatedBy === 'string') || !count(doc.unenrolledCount) || !Array.isArray(doc.operators)) return null;
  const operators = doc.operators.map(parseRow);
  if (operators.some((row) => row === null)) return null;
  return { required: doc.required, revision: Number(doc.revision), updatedAt: doc.updatedAt, updatedBy: doc.updatedBy as string | null,
    unenrolledCount: doc.unenrolledCount, operators: operators as OperatorMfaRow[] };
}

export interface OperatorMfaPolicyReceipt { required: boolean; revision: number; updatedAt: string }

export function parseOperatorMfaPolicyReceipt(value: unknown): OperatorMfaPolicyReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.required !== 'boolean' || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 || !instant(row.updatedAt)) return null;
  return { required: row.required, revision: Number(row.revision), updatedAt: row.updatedAt };
}

export interface OperatorMfaResetReceipt { profileId: string; factorCount: number; sessionsRevoked: number }

export function parseOperatorMfaResetReceipt(value: unknown): OperatorMfaResetReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.profileId !== 'string' || !count(row.factorCount) || !count(row.sessionsRevoked)) return null;
  return { profileId: row.profileId, factorCount: row.factorCount, sessionsRevoked: row.sessionsRevoked };
}

/** DB 거절 사유 → 운영자 문구. 모르는 실패는 같은 요청으로 다시 확인하게 한다. */
export function operatorMfaError(code?: string | null, message?: string | null): string {
  const text = message ?? '';
  if (text.includes('operator_mfa_self_required')) {
    return '켜려면 먼저 내 보안 설정에서 인증 앱을 등록하고, 지금 로그인을 인증 앱 코드로 확인해야 합니다.';
  }
  if (text.includes('operator_mfa_unenrolled')) return '아직 인증 앱을 등록하지 않은 운영자가 있어 켤 수 없습니다. 아래 목록의 미등록 운영자가 먼저 등록하거나, 쓰지 않는 계정은 매니저 관리에서 권한을 회수하세요.';
  if (text.includes('operator_mfa_reset_owner_only')) return '2단계 인증 초기화는 통합 매니저만 할 수 있습니다.';
  if (text.includes('operator_self_change_denied')) return '본인의 인증 앱은 내 보안 설정에서 직접 바꿉니다.';
  if (text.includes('operator_mfa_reset_target_invalid')) return '운영자 계정만 초기화할 수 있습니다. 목록을 새로고침해 주세요.';
  if (text.includes('operator_mfa_required')) return '이 작업은 인증 앱 코드까지 확인한 로그인에서만 할 수 있습니다. 새로고침해 인증 앱 코드를 입력해 주세요.';
  if (code === 'PT409' || text.includes('operator_mfa_policy_changed')) return '다른 관리자가 먼저 설정을 바꿨습니다. 새로고침해 현재 설정을 확인해 주세요.';
  if (code === '23505' || text.includes('operation_conflict')) return '이 요청은 이미 다른 내용으로 처리됐습니다. 새로고침해 현재 설정을 확인한 뒤 다시 시도해 주세요.';
  if (['42501', '28000'].includes(code ?? '') || text.includes('operator_capability_required') || text.includes('auth_required')) {
    return '현재 로그인 계정과 관리자 권한을 확인해 주세요.';
  }
  if (code === '22023') return '저장할 값이 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.';
  return '처리 결과를 확인하지 못했습니다. 이미 처리됐을 수 있으니 결과 확인 버튼을 눌러 주세요. 여러 번 눌러도 한 번만 처리됩니다.';
}

/** GoTrue MFA 오류 → 운영자 문구(인증 화면·내 보안 설정 공용). */
export function totpErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  const code = error?.code ?? '';
  if (code === 'mfa_verification_failed' || code === 'mfa_challenge_expired' || /invalid totp code/i.test(error?.message ?? '')) {
    return '인증 코드가 맞지 않습니다. 인증 앱의 지금 코드를 다시 입력해 주세요.';
  }
  if (code === 'mfa_totp_enroll_not_enabled' || code === 'mfa_totp_verify_not_enabled') return '인증 앱 사용이 꺼져 있어 등록·확인할 수 없습니다. 개발팀에 Supabase 인증 설정에서 인증 앱(TOTP)을 켜 달라고 요청해 주세요.';
  if (code === 'too_many_enrolled_mfa_factors') return '등록한 인증 앱이 너무 많습니다. 쓰지 않는 인증 앱을 지운 뒤 다시 등록해 주세요.';
  if (code === 'insufficient_aal') return '먼저 등록한 인증 앱의 코드로 지금 로그인을 확인해 주세요.';
  if (code === 'over_request_rate_limit' || code === 'mfa_verification_rejected') return '잠시 뒤 다시 시도해 주세요.';
  return '인증 앱 처리에 실패했습니다. 잠시 뒤 다시 시도해 주세요.';
}

export const TOTP_CODE_PATTERN = /^\d{6}$/;
