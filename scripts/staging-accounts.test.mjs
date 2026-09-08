import { describe, expect, it, vi } from 'vitest';
import { STAGING_OPERATORS, ensureStagingOperators } from './staging-accounts.mjs';

function fixture(existing = []) {
  const admin = {
    listUsers: vi.fn(async () => ({ data: { users: existing } })),
    createUser: vi.fn(async (input) => ({ data: { user: { id: input.email, ...input } } })),
    updateUserById: vi.fn(async () => ({})),
  };
  const upsert = vi.fn(async () => ({}));
  return { client: { auth: { admin }, from: () => ({ upsert }) }, admin, upsert };
}
const vault = Object.fromEntries(STAGING_OPERATORS.map((operator) => [operator.email, 'random-test-password-32-characters']));

describe('generated staging operators', () => {
  it('creates five confirmed synthetic operators and documents identifiers without passwords', async () => {
    const f = fixture();
    const result = await ensureStagingOperators(f.client, vault);
    expect(f.admin.createUser).toHaveBeenCalledTimes(5);
    expect(f.upsert.mock.calls.map(([profile]) => profile.role)).toEqual(['admin', 'staff', 'staff', 'staff', 'staff']);
    expect(f.admin.createUser.mock.calls.every(([user]) => user.email_confirm === true)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(vault[STAGING_OPERATORS[0].email]);
  });

  it('never resets credentials or operator-edited profiles on rerun', async () => {
    const existing = STAGING_OPERATORS.map(({ email }) => ({ id: email, email,
      app_metadata: { staging_fixture: 'admin-ops-v1', staging_bootstrap_complete: true } }));
    const f = fixture(existing);
    const result = await ensureStagingOperators(f.client, vault);
    expect(f.admin.createUser).not.toHaveBeenCalled();
    expect(f.upsert).not.toHaveBeenCalled();
    expect(result.every((row) => row.created === false)).toBe(true);
  });

  it('rejects an email collision before granting staff or admin', async () => {
    const f = fixture([{ id: 'someone', email: STAGING_OPERATORS[0].email, app_metadata: {} }]);
    await expect(ensureStagingOperators(f.client, vault)).rejects.toThrow('unmarked');
    expect(f.upsert).not.toHaveBeenCalled();
  });

  it('rejects missing passwords and surfaces profile setup failures', async () => {
    await expect(ensureStagingOperators(fixture().client, {})).rejects.toThrow('password');
    const f = fixture();
    f.upsert.mockResolvedValue({ error: { message: 'unavailable' } });
    await expect(ensureStagingOperators(f.client, vault)).rejects.toThrow('profile');
  });
});
