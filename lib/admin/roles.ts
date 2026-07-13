export type AdminAssignableRole = 'user' | 'staff' | 'admin';

export interface AdminUserRoleFormValue {
  profileId: string;
  role: AdminAssignableRole;
}

export type AdminUserRoleFormResult =
  | { ok: true; value: AdminUserRoleFormValue }
  | { ok: false; errors: Record<string, string> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

  if (!UUID_PATTERN.test(profileId)) errors.profileId = '사용자를 찾을 수 없습니다.';
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
