import { describe, expect, it } from 'vitest';
import { ASSIGNABLE_MANAGER_ROLES, canChangeOperator, canRevokeOperator, normalizeOperatorFilters, operatorDirectoryHref, parseOperatorDirectory, validateOperatorSetup, type OperatorRecord } from './operator-directory';
import { MANAGER_ROLE_LABELS } from './access';
import { normalizeOperatorInvitationInput } from './operator-invitations';
const actorId = '81000000-0000-4000-8000-000000000001';
const targetId = '81000000-0000-4000-8000-000000000002';
const row: OperatorRecord = { id: actorId, nickname: '운영자', maskedEmail: 'q***@example.test', role: 'admin', managerRole: null, membershipRevision: 0, createdAt: '2026-10-13T00:00:00Z', suspendedAt: null, duty: 'cs', dutyRevision: 1 };
const envelope = { mode: 'legacy', revision: 1, actorManagerRole: null, actorMembershipRevision: 0, setupCandidates: [] };
describe('operator directory', () => {
  it('defaults to operators and bounds URL filters', () => {
    expect(normalizeOperatorFilters({ role: 'invalid', page: '-1', pageSize: '7' })).toEqual({ query: '', role: 'operators', status: 'all', page: 1, pageSize: 20 });
    const filters = normalizeOperatorFilters({ query: ' old@example.test ', role: 'all', status: 'suspended', page: '2', pageSize: '50' });
    expect(operatorDirectoryHref(filters, 3)).toContain('query=old%40example.test&role=all&status=suspended&pageSize=50&page=3');
  });
  it('distinguishes empty results from unreadable or duplicate data', () => {
    const filters = normalizeOperatorFilters({});
    expect(parseOperatorDirectory({ ...envelope, rows: [], total: 0 }, filters)?.total).toBe(0);
    expect(parseOperatorDirectory(null, filters)).toBeNull();
    expect(parseOperatorDirectory({ ...envelope, rows: [row], total: 1 }, filters)?.rows).toEqual([row]);
    expect(parseOperatorDirectory({ ...envelope, rows: [row, row], total: 2 }, filters)).toBeNull();
    expect(parseOperatorDirectory({ rows: [row], total: 1 }, filters)).toBeNull();
    expect(parseOperatorDirectory({ ...envelope, rows: [{ ...row, managerRole: 'owner', membershipRevision: 1, duty: 'cs' }], total: 1 }, filters)).toBeNull();
    expect(parseOperatorDirectory({ ...envelope, rows: [{ ...row, managerRole: 'owner', membershipRevision: 1, duty: 'representative' }], total: 1 }, filters)?.rows[0].duty).toBe('representative');
  });
  it('requires an explicit complete setup, one active admin owner and retained actor management', () => {
    const candidates = [row, { ...row, id: targetId }];
    const assignments = [{ profileId: actorId, managerRole: 'primary' }, { profileId: targetId, managerRole: 'owner' }];
    expect(validateOperatorSetup(assignments, candidates, actorId)).toBe(true);
    expect(validateOperatorSetup(assignments.slice(1), candidates, actorId)).toBe(false);
    expect(validateOperatorSetup([...assignments.slice(0, 1), assignments[0]], candidates, actorId)).toBe(false);
    expect(validateOperatorSetup([{ profileId: actorId, managerRole: null }, assignments[1]], candidates, actorId)).toBe(false);
    expect(validateOperatorSetup(assignments, [row, { ...candidates[1], role: 'staff' }], actorId)).toBe(false);
    expect(validateOperatorSetup(assignments, [row, { ...candidates[1], suspendedAt: '2026-10-13T00:00:00Z' }], actorId)).toBe(false);
    expect(validateOperatorSetup([{ profileId: actorId, managerRole: 'owner' }, { profileId: targetId, managerRole: null }], [row, { ...candidates[1], suspendedAt: '2026-10-13T00:00:00Z' }], actorId)).toBe(true);
  });
  it('separates primary peer changes from revocation and protects self and owner', () => {
    const target: OperatorRecord = { ...row, id: targetId, managerRole: 'primary', membershipRevision: 1 };
    expect(canChangeOperator(actorId, 'primary', target)).toBe(true);
    expect(canRevokeOperator(actorId, 'primary', target)).toBe(false);
    expect(canRevokeOperator(actorId, 'owner', target)).toBe(true);
    expect(canRevokeOperator(actorId, 'primary', { ...target, managerRole: 'deputy' })).toBe(true);
    expect(canChangeOperator(actorId, 'owner', { ...target, id: actorId })).toBe(false);
    expect(canChangeOperator(actorId, 'primary', { ...target, managerRole: 'owner' })).toBe(false);
    expect(canChangeOperator(actorId, 'agency', target)).toBe(false);
  });
  it('매니저 초대·역할 변경에서 물류출고관리를 고를 수 있다 (1014-084)', () => {
    expect(ASSIGNABLE_MANAGER_ROLES).toContain('logistics');
    expect(MANAGER_ROLE_LABELS.logistics).toBe('물류출고관리');
    expect(normalizeOperatorInvitationInput({ id: '85000000-0000-4000-8000-000000000001', email: ' Warehouse@Example.test ', name: '물류 담당', managerRole: 'logistics', duty: 'logistics' }))
      .toEqual({ id: '85000000-0000-4000-8000-000000000001', email: 'warehouse@example.test', name: '물류 담당', managerRole: 'logistics', duty: 'logistics' });
  });
});
