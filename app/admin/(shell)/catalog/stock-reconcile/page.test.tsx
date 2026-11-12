import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configuredOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  workspace: vi.fn(), origins: vi.fn(), digest: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: vi.fn(async () => mocks.auth) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/lib/admin/stock-reconcile.server', () => ({ loadStockReconcileWorkspace: mocks.workspace }));
vi.mock('@/lib/admin/fulfillment-origins.server', () => ({ loadGoodsFulfillmentOptions: mocks.origins }));
vi.mock('@/lib/admin/stock-safety-digest.server', () => ({ loadStockSafetyDigest: mocks.digest }));
vi.mock('@/app/admin/stock-reconcile-actions', () => ({ readStockReconcileFileAction: vi.fn(), previewStockReconcileAction: vi.fn(), applyStockReconcileAction: vi.fn() }));
vi.mock('@/app/admin/stock-safety-digest-actions', () => ({ saveStockSafetyDigestAction: vi.fn() }));

const staff = (role: Parameters<typeof configuredOperatorAccessFixture>[0]) => ({
  isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff', operatorAccess: configuredOperatorAccessFixture(role),
});
const digest = {
  revision: 1, enabled: false, sendTime: '09:00', operatorRecipients: [], enabledAt: null, updatedAt: '2031-05-01T00:00:00Z', updatedByName: null,
  nextSendAt: null, lowStockCount: 4, origins: [{ originId: 'o1', originCode: 'namyangju', originName: '남양주', active: true, revision: 0, recipients: [] }], runs: [],
};

beforeEach(() => {
  mocks.auth = staff('primary');
  mocks.workspace.mockReset().mockResolvedValue({ history: [], snapshot: null });
  mocks.origins.mockReset().mockResolvedValue([{ id: 'o1', name: '남양주', active: true, defaultCarrier: null, baseFee: 0, freeThreshold: null, returnAddress: '' }]);
  mocks.digest.mockReset().mockResolvedValue(digest);
});

describe('재고 대조 라우트', () => {
  it('미로그인·일반 회원·재고 권한 없는 매니저에게는 로더를 실행하지 않는다', async () => {
    mocks.auth = { isConfigured: true, user: null, isStaff: false, role: null };
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin%2Fcatalog%2Fstock-reconcile');
    mocks.auth = staff('logistics');
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(mocks.digest).not.toHaveBeenCalled();
  });

  it('계정 주매니저는 대조·요약 메일 설정을 함께 본다', async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ snapshot: '60000000-0000-4000-8000-000000000001' }) }));
    expect(mocks.workspace).toHaveBeenCalledWith('60000000-0000-4000-8000-000000000001');
    expect(mocks.digest).toHaveBeenCalledOnce();
    expect(html).toContain('재고 파일 대조');
    expect(html).toContain('하루 1회 요약 메일 보내기');
    expect(html).toContain('지금 안전재고 기준 이하 옵션 4개');
    expect(html).toContain('출고지 구분 없이 대조');
  });

  it('부매니저는 재고를 대조하지만 요약 메일 설정은 읽지도 보이지도 않는다', async () => {
    mocks.auth = staff('deputy');
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(mocks.digest).not.toHaveBeenCalled();
    expect(html).toContain('재고 파일 대조');
    expect(html).toContain('요약 메일 설정은 계정 주매니저 이상만 볼 수 있습니다');
    expect(html).not.toContain('하루 1회 요약 메일 보내기');
  });
});
