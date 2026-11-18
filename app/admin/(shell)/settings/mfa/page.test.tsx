import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/mfa.server', () => ({ loadOperatorMfaPolicy: mocks.load }));
vi.mock('@/app/admin/operator-mfa-actions', () => ({ saveOperatorMfaPolicyAction: vi.fn(), resetOperatorMfaAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import Page from './page';

const operators = [
  { id: 'owner', nickname: '대표', maskedEmail: 'o***@icons.gg', managerRole: 'owner', verifiedFactors: 1, unverifiedFactors: 0, verifiedAt: '2026-11-18T01:00:00Z' },
  { id: 'deputy', nickname: '부매니저', maskedEmail: 'd***@icons.gg', managerRole: 'deputy', verifiedFactors: 1, unverifiedFactors: 0, verifiedAt: '2026-11-18T02:00:00Z' },
  { id: 'agency', nickname: '대행사', maskedEmail: 'a***@icons.gg', managerRole: 'agency', verifiedFactors: 0, unverifiedFactors: 0, verifiedAt: null },
];
const policy = { required: false, revision: 1, updatedAt: '2026-11-18T00:00:00Z', updatedBy: null, unenrolledCount: 1, operators };
const owner = { user: { id: 'owner' }, role: 'admin', operatorAccess: configuredOperatorAccessFixture('owner') };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue(owner);
  mocks.load.mockResolvedValue(policy);
});

it('매니저 관리 권한(관리자 전용)을 확인한 뒤에만 설정을 읽는다', async () => {
  mocks.guard.mockRejectedValue(new Error('denied'));
  await expect(Page()).rejects.toThrow('denied');
  expect(mocks.load).not.toHaveBeenCalled();
  mocks.guard.mockResolvedValue(owner);
  await Page();
  expect(mocks.guard).toHaveBeenCalledWith('/admin/settings/mfa', { adminOnly: true });
});

it('스위치 상태·운영자별 등록 현황을 보이고, 통합 매니저에게만 다른 운영자의 초기화 버튼을 준다', async () => {
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('꺼짐');
  expect(html).toContain('2단계 인증 요구 켜기');
  expect(html).toContain('미등록 1명');
  for (const name of ['대표', '부매니저', '대행사']) expect(html).toContain(name);
  /* 본인(대표)과 등록이 없는 대행사에는 초기화가 없다. */
  expect(html.match(/>초기화</g)).toHaveLength(1);

  mocks.guard.mockResolvedValue({ ...owner, user: { id: 'primary' }, operatorAccess: configuredOperatorAccessFixture('primary') });
  expect(renderToStaticMarkup(await Page())).not.toContain('>초기화<');
  /* 전환 전에는 admin 역할이 최고 관리자다. */
  mocks.guard.mockResolvedValue({ user: { id: 'legacy' }, role: 'admin', operatorAccess: legacyOperatorAccessFixture() });
  expect(renderToStaticMarkup(await Page()).match(/>초기화</g)).toHaveLength(2);
});

it('설정을 읽지 못하면 스위치 없이 안내만 한다', async () => {
  mocks.load.mockResolvedValue(null);
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('현재 설정을 불러오지 못했습니다');
  expect(html).not.toContain('2단계 인증 요구 켜기');
});
