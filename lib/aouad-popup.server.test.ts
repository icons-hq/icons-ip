import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  AOUAD_POPUP_ENABLED: true,
  AOUAD_POPUP_PUBLIC: false,
  auth: vi.fn(),
}));

vi.mock('./aouad-popup', () => mocks);
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));

import { canViewAouadPopup, isAouadLocalPreviewEnabled } from './aouad-popup.server';

beforeEach(() => {
  mocks.AOUAD_POPUP_ENABLED = true;
  mocks.AOUAD_POPUP_PUBLIC = false;
  mocks.auth.mockReset().mockResolvedValue({ isStaff: false });
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('ICONS_AOUAD_LOCAL_PREVIEW', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('AOUAD 프레젠테이션 서버 권한', () => {
  it('공개되지 않은 시연은 staff/admin만 열 수 있다', async () => {
    await expect(canViewAouadPopup()).resolves.toBe(false);
    mocks.auth.mockResolvedValue({ isStaff: true });
    await expect(canViewAouadPopup()).resolves.toBe(true);
  });

  it('production에서는 로컬 QA 환경 변수가 설정되어도 권한을 우회하지 않는다', async () => {
    vi.stubEnv('ICONS_AOUAD_LOCAL_PREVIEW', '1');
    expect(isAouadLocalPreviewEnabled()).toBe(false);
    await expect(canViewAouadPopup()).resolves.toBe(false);
    expect(mocks.auth).toHaveBeenCalledOnce();
  });

  it('development에서도 명시적인 로컬 QA 환경 변수가 있어야 우회한다', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(isAouadLocalPreviewEnabled()).toBe(false);
    await expect(canViewAouadPopup()).resolves.toBe(false);
    vi.stubEnv('ICONS_AOUAD_LOCAL_PREVIEW', '1');
    expect(isAouadLocalPreviewEnabled()).toBe(true);
    await expect(canViewAouadPopup()).resolves.toBe(true);
  });

  it('공개 스위치가 켜지면 비로그인으로 체험을 열 수 있다', async () => {
    mocks.AOUAD_POPUP_PUBLIC = true;
    await expect(canViewAouadPopup()).resolves.toBe(true);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it('킬스위치는 공개·로컬 QA 설정보다 우선한다', async () => {
    mocks.AOUAD_POPUP_ENABLED = false;
    mocks.AOUAD_POPUP_PUBLIC = true;
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ICONS_AOUAD_LOCAL_PREVIEW', '1');
    await expect(canViewAouadPopup()).resolves.toBe(false);
    expect(mocks.auth).not.toHaveBeenCalled();
  });
});
