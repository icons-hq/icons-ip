import { describe, expect, it } from 'vitest';
import { normalizeAdminUserRoleForm } from './roles';

const profileId = '11111111-1111-4111-8111-111111111111';

function roleForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set('profileId', profileId);
  formData.set('role', 'staff');
  for (const [key, value] of Object.entries(overrides)) {
    formData.set(key, value);
  }
  return formData;
}

describe('normalizeAdminUserRoleForm', () => {
  it('유효한 uuid와 역할을 통과시킨다', () => {
    const result = normalizeAdminUserRoleForm(roleForm());

    expect(result).toEqual({ ok: true, value: { profileId, role: 'staff' } });
  });

  it.each(['user', 'staff', 'admin'])('부여 가능한 역할 %s를 허용한다', (role) => {
    const result = normalizeAdminUserRoleForm(roleForm({ role }));

    expect(result.ok).toBe(true);
  });

  it('uuid 형식이 아니면 거른다', () => {
    const result = normalizeAdminUserRoleForm(roleForm({ profileId: 'not-a-uuid' }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.profileId).toBeTruthy();
  });

  it('허용 목록 밖 역할을 거른다', () => {
    const result = normalizeAdminUserRoleForm(roleForm({ role: 'superadmin' }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.role).toBeTruthy();
  });
});
