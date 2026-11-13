import { isUuid } from '@/lib/uuid';
export type AdminAssignableRole = 'user' | 'staff' | 'admin';

export interface AdminUserRoleFormValue {
  profileId: string;
  role: AdminAssignableRole;
}

export type AdminUserRoleFormResult =
  | { ok: true; value: AdminUserRoleFormValue }
  | { ok: false; errors: Record<string, string> };

export const ADMIN_ASSIGNABLE_ROLES: AdminAssignableRole[] = ['user', 'staff', 'admin'];
const ASSIGNABLE_ROLE_SET = new Set<string>(ADMIN_ASSIGNABLE_ROLES);

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeAdminUserRoleForm(formData: FormData): AdminUserRoleFormResult {
  const profileId = readString(formData, 'profileId');
  const role = readString(formData, 'role');
  const errors: Record<string, string> = {};

  if (!isUuid(profileId)) errors.profileId = '사용자를 찾을 수 없습니다.';
  if (!ASSIGNABLE_ROLE_SET.has(role)) errors.role = '역할을 선택해주세요.';

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      profileId,
      role: role as AdminAssignableRole,
    },
  };
}
