import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OperatorDirectoryScreen } from './OperatorDirectoryScreen';
import { normalizeOperatorFilters, type OperatorDirectoryData, type OperatorRecord } from '@/lib/admin/operator-directory';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/operator-directory-actions', () => ({ activateOperatorAccessAction: vi.fn(), changeOperatorRoleAction: vi.fn(), saveOperatorDutyAction: vi.fn(), transferOperatorOwnerAction: vi.fn() }));
const id = (n: number) => `83000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const profile = (n: number, managerRole: OperatorRecord['managerRole']): OperatorRecord => ({ id: id(n), nickname: `매니저${n}`, maskedEmail: 'm***@example.test', role: 'staff', managerRole, membershipRevision: managerRole ? 1 : 0, duty: managerRole === 'owner' ? 'representative' : 'cs', dutyRevision: 1, suspendedAt: null, createdAt: '2026-10-13T00:00:00Z' });
const data: OperatorDirectoryData = { rows: [profile(1, 'primary'), profile(2, 'owner'), profile(3, 'primary'), profile(4, 'deputy')], total: 4, mode: 'configured', revision: 2, actorManagerRole: 'primary', actorMembershipRevision: 1, filters: normalizeOperatorFilters({}), setupCandidates: [] };
describe('manager directory controls', () => {
  it('offers peer role changes, blocks primary peer revocation and keeps owner representative read only', () => {
    const html = renderToStaticMarkup(createElement(OperatorDirectoryScreen, { data, adminId: id(1) }));
    expect(html).toContain('aria-label="매니저3 권한 변경"');
    expect(html).not.toContain('aria-label="매니저3 권한 회수"');
    expect(html).toContain('aria-label="매니저4 권한 회수"');
    expect(html).not.toContain('aria-label="매니저1 권한 변경"');
    expect(html).not.toContain('aria-label="매니저2 담당업무 변경"');
    expect(html).toContain('aria-label="매니저1 담당업무 변경"');
    expect(html).toContain('대표');
    expect(html).not.toContain('name="role" aria-label="매니저3 권한"');
  });
  it('offers ownership transfer only for active primary targets', () => {
    const ownerData: OperatorDirectoryData = { ...data, actorManagerRole: 'owner' };
    const html = renderToStaticMarkup(createElement(OperatorDirectoryScreen, { data: ownerData, adminId: id(2) }));
    expect(html).toContain('aria-label="매니저3 통합 매니저 승계"');
    expect(html).not.toContain('aria-label="매니저4 통합 매니저 승계"');
    const suspended = { ...ownerData, rows: ownerData.rows.map(row => row.id === id(3) ? { ...row, suspendedAt: '2026-10-13T00:00:00Z' } : row) };
    expect(renderToStaticMarkup(createElement(OperatorDirectoryScreen, { data: suspended, adminId: id(2) }))).not.toContain('aria-label="매니저3 통합 매니저 승계"');
  });
  it('leaves every legacy setup assignment unselected instead of automatically choosing an owner', () => {
    const candidate = { ...profile(1, null), role: 'admin' as const };
    const html = renderToStaticMarkup(createElement(OperatorDirectoryScreen, { data: { ...data, mode: 'legacy', actorManagerRole: null, actorMembershipRevision: 0, setupCandidates: [candidate], rows: [candidate] }, adminId: id(1) }));
    expect(html).toContain('value="" selected=""');
    expect(html).toContain('통합 매니저');
    expect(html).toContain('미선택');
    expect(html).not.toContain('value="owner" selected');
  });
});
