import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
import { NO_STAFF_ACCESS, fetchStaffAccess } from './staff-preview.client';
beforeEach(() => { mocks.rpc.mockReset(); });

/* admin_current_operator_access 응답 모양 — 어드민 셸 게이트(getCurrentAdminAuthState)가 읽는 것과 같다. */
const access = (overrides: Record<string, unknown>) => ({
  mode: 'configured', managerRole: 'primary', capabilities: ['home'], revision: 3, setupRequired: false, ...overrides,
});

describe('스태프 진입점 공용 readback', () => {
  it('어드민 콘솔 게이트와 같은 RPC 한 번으로 관리자 페이지와 platform.manage 진입점을 함께 판정한다', async () => {
    mocks.rpc.mockResolvedValue({ data: access({ capabilities: ['home', 'catalog.read', 'platform.manage'] }), error: null });
    await expect(fetchStaffAccess()).resolves.toEqual({ adminConsole: true, platformManage: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_current_operator_access');
  });

  it('platform.manage 가 없는 매니저(부매니저·물류출고관리 등)는 관리자 페이지만 연다', async () => {
    mocks.rpc.mockResolvedValue({ data: access({ managerRole: 'logistics', capabilities: ['home', 'catalog.announcements', 'sales.dispatch'] }), error: null });
    await expect(fetchStaffAccess()).resolves.toEqual({ adminConsole: true, platformManage: false });
  });

  it('권한 전환 전(legacy) 운영자도 같은 규칙으로 연다', async () => {
    mocks.rpc.mockResolvedValue({ data: access({ mode: 'legacy', managerRole: null, capabilities: ['home', 'platform.manage'], setupRequired: true }), error: null });
    await expect(fetchStaffAccess()).resolves.toEqual({ adminConsole: true, platformManage: true });
  });

  it.each([
    /* 일반 회원·정지·강등 — 운영 권한이 없다. */
    { data: access({ mode: 'none', managerRole: null, capabilities: [] }), error: null },
    /* 셸 게이트처럼 home 없는 권한은 콘솔에 못 들어간다 — platform.manage 만으로 진입점을 열지 않는다. */
    { data: access({ capabilities: ['platform.manage'] }), error: null },
    /* 파서가 거절하는 응답(모르는 능력·모양 깨짐)은 셸 게이트에서도 권한 없음이다. */
    { data: access({ capabilities: ['home', 'unknown.cap'] }), error: null },
    { data: true, error: null },
    { data: null, error: null },
    { data: access({ capabilities: ['home', 'platform.manage'] }), error: { message: 'denied' } },
  ])('오류·비권한·비정상 결과는 닫힌다: %o', async (result) => {
    mocks.rpc.mockResolvedValue(result);
    await expect(fetchStaffAccess()).resolves.toEqual(NO_STAFF_ACCESS);
  });

  it('네트워크 실패도 닫힌 상태로 끝난다', async () => {
    mocks.rpc.mockRejectedValue(new Error('network'));
    await expect(fetchStaffAccess()).resolves.toEqual(NO_STAFF_ACCESS);
  });
});
