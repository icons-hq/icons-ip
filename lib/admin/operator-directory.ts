import { ADMIN_ASSIGNABLE_ROLES, type AdminAssignableRole } from './roles';
import { MANAGER_ROLES, type ManagerRole } from './access';
import { isUuid } from '@/lib/uuid';

export const OPERATOR_DIRECTORY_PATH = '/admin/community/roles';
export const OPERATOR_DUTIES = [
  { value: 'sales', label: '영업' }, { value: 'marketing', label: '마케팅' },
  { value: 'cs', label: 'CS' }, { value: 'design_content', label: '디자인콘텐츠' },
  { value: 'logistics', label: '물류' }, { value: 'accounting', label: '회계' },
  { value: 'management', label: '총괄' }, { value: 'other', label: '기타' },
] as const;
export type OperatorDuty = typeof OPERATOR_DUTIES[number]['value'];
export type OperatorAssignedDuty = OperatorDuty | 'representative';
export const ASSIGNABLE_MANAGER_ROLES = MANAGER_ROLES.filter(role => role !== 'owner');
export type AssignableManagerRole = Exclude<ManagerRole, 'owner'>;
export type OperatorFilters = { query: string; role: 'operators' | 'all' | 'unassigned' | AdminAssignableRole | ManagerRole; status: 'all' | 'active' | 'suspended'; page: number; pageSize: 20 | 50 | 100 };
export type OperatorRecord = { id: string; nickname: string; maskedEmail: string; role: AdminAssignableRole; managerRole: ManagerRole | null; membershipRevision: number; createdAt: string; suspendedAt: string | null; duty: OperatorAssignedDuty | null; dutyRevision: number };
export type OperatorDirectoryData = { rows: OperatorRecord[]; total: number; filters: OperatorFilters; mode: 'legacy' | 'configured'; revision: number; actorManagerRole: ManagerRole | null; actorMembershipRevision: number; setupCandidates: OperatorRecord[] };
export type OperatorSetupAssignment = { profileId: string; managerRole: ManagerRole | null };
export type OperatorMutationResult = { error: string; uncertain?: boolean } | { revision: number; accessRevision: number };
export const isManagerRole = (value: unknown): value is ManagerRole => MANAGER_ROLES.some(role => role === value);
export const isAssignableManagerRole = (value: unknown): value is AssignableManagerRole => ASSIGNABLE_MANAGER_ROLES.some(role => role === value);
export function normalizeOperatorFilters(input: Record<string, string | string[] | undefined>): OperatorFilters {
  const one = (key: string) => typeof input[key] === 'string' ? input[key] as string : '';
  const role = one('role'); const status = one('status'); const page = Number(one('page')); const size = Number(one('pageSize'));
  return { query: one('query').trim().slice(0, 100), role: ['all', 'operators', 'unassigned', ...ADMIN_ASSIGNABLE_ROLES, ...MANAGER_ROLES].includes(role) ? role as OperatorFilters['role'] : 'operators',
    status: ['active', 'suspended'].includes(status) ? status as OperatorFilters['status'] : 'all',
    page: Number.isSafeInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1, pageSize: size === 50 || size === 100 ? size : 20 };
}
export function operatorDirectoryHref(filters: OperatorFilters, page: number) {
  return `${OPERATOR_DIRECTORY_PATH}?${new URLSearchParams({ query: filters.query, role: filters.role, status: filters.status, pageSize: String(filters.pageSize), page: String(page) })}`;
}
export const isOperatorDuty = (value: unknown): value is OperatorDuty => OPERATOR_DUTIES.some(duty => duty.value === value);
export function canChangeOperator(actorId: string, actorRole: ManagerRole | null, target: OperatorRecord) {
  return (actorRole === 'owner' || actorRole === 'primary') && target.id !== actorId && target.managerRole !== null && target.managerRole !== 'owner';
}
export function canRevokeOperator(actorId: string, actorRole: ManagerRole | null, target: OperatorRecord) {
  return canChangeOperator(actorId, actorRole, target) && (actorRole === 'owner' || target.managerRole !== 'primary');
}
export function validateOperatorSetup(assignments: unknown, candidates: OperatorRecord[], actorId: string): assignments is OperatorSetupAssignment[] {
  if (!Array.isArray(assignments) || assignments.length !== candidates.length || assignments.length > 10000
    || assignments.filter(item => item?.managerRole !== null).length > 1001) return false;
  const rows = new Map(candidates.map(candidate => [candidate.id, candidate]));
  let ownerCount = 0;
  for (const item of assignments) {
    if (!item || typeof item !== 'object' || !isUuid(item.profileId) || !rows.has(item.profileId) || (item.managerRole !== null && !isManagerRole(item.managerRole))) return false;
    const candidate = rows.get(item.profileId)!;
    if (candidate.suspendedAt && item.managerRole !== null) return false;
    if (item.managerRole === 'owner') { if (candidate.role !== 'admin') return false; ownerCount += 1; }
    if (item.profileId === actorId && item.managerRole !== 'owner' && item.managerRole !== 'primary') return false;
    rows.delete(item.profileId);
  }
  return ownerCount === 1 && !rows.size && candidates.some(candidate => candidate.id === actorId && candidate.role === 'admin' && !candidate.suspendedAt);
}
export function parseOperatorDirectory(value: unknown, filters: OperatorFilters): OperatorDirectoryData | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (typeof data.total !== 'number' || !Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.rows)
    || !['legacy', 'configured'].includes(String(data.mode)) || !Number.isSafeInteger(data.revision) || Number(data.revision) < 1
    || (data.actorManagerRole !== null && !isManagerRole(data.actorManagerRole)) || !Number.isSafeInteger(data.actorMembershipRevision) || Number(data.actorMembershipRevision) < 0
    || (data.actorManagerRole === null ? data.actorMembershipRevision !== 0 : Number(data.actorMembershipRevision) < 1) || !Array.isArray(data.setupCandidates)
    || (data.mode === 'configured' && data.setupCandidates.length > 0)) return null;
  const parseRows = (rows: unknown[]): rows is OperatorRecord[] => {
  const ids = new Set<string>();
  for (const item of rows) {
    if (!item || typeof item !== 'object') return false;
    const row = item as OperatorRecord;
    if (typeof row.id !== 'string' || !isUuid(row.id) || ids.has(row.id)
      || typeof row.nickname !== 'string' || typeof row.maskedEmail !== 'string' || !ADMIN_ASSIGNABLE_ROLES.includes(row.role)
      || (row.managerRole !== null && !isManagerRole(row.managerRole)) || !Number.isSafeInteger(row.membershipRevision) || row.membershipRevision < 0
      || (row.managerRole === null ? row.membershipRevision !== 0 : row.membershipRevision < 1)
      || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))
      || (row.suspendedAt !== null && (typeof row.suspendedAt !== 'string' || !Number.isFinite(Date.parse(row.suspendedAt))))
      || (row.managerRole === 'owner' ? row.duty !== 'representative' : row.duty !== null && !isOperatorDuty(row.duty))
      || !Number.isSafeInteger(row.dutyRevision) || row.dutyRevision < 0) return false;
    ids.add(row.id);
  }
  return true;
  };
  if (!parseRows(data.rows) || !parseRows(data.setupCandidates)) return null;
  return { rows: data.rows, total: data.total, filters, mode: data.mode as OperatorDirectoryData['mode'], revision: Number(data.revision), actorManagerRole: data.actorManagerRole as ManagerRole | null, actorMembershipRevision: Number(data.actorMembershipRevision), setupCandidates: data.setupCandidates };
}
