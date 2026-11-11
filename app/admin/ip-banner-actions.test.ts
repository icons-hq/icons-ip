const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAdminIpHallBannerAction } from './ip-banner-actions';

const PC = 'public-media/catalog/ip/97510000-0000-4000-8000-000000000001.webp';
const MO = 'public-media/catalog/ip/97510000-0000-4000-8000-000000000002.png';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as { isConfigured: boolean; user: { id: string } | null; isStaff: boolean; operatorAccess?: unknown },
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: async () => mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); } }));

function form(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

describe('saveAdminIpHallBannerAction (IP-06)', () => {
  beforeEach(() => {
    mocks.auth = { isConfigured: true, user: { id: 'staff-1' }, isStaff: true, operatorAccess: legacyOperatorAccessFixture() };
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: '2026-10-27T00:00:00Z', error: null });
    mocks.revalidatePath.mockReset();
  });

  it('trims both paths and calls the audited RPC, then revalidates the hall and admin pages', async () => {
    await expect(saveAdminIpHallBannerAction({}, form({ ipId: ' hwasan ', hallBannerImagePath: ` ${PC} `, hallBannerMobileImagePath: MO })))
      .resolves.toEqual({ message: 'IP관 배너를 저장했습니다. 공개 IP관에 바로 반영됩니다.' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_ip_hall_banner', { target_ip_id: 'hwasan', target_image_path: PC, target_mobile_image_path: MO });
    expect(mocks.revalidatePath.mock.calls).toEqual([['/ip/[id]', 'page'], ['/admin/catalog/ips'], ['/admin/catalog/ips/hwasan']]);
  });

  it('empty fields clear the banner (key art fallback)', async () => {
    await expect(saveAdminIpHallBannerAction({}, form({ ipId: 'hwasan', hallBannerImagePath: '', hallBannerMobileImagePath: '' })))
      .resolves.toEqual({ message: 'IP관 배너를 비웠습니다. IP관은 키아트를 배경으로 씁니다.' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_ip_hall_banner', { target_ip_id: 'hwasan', target_image_path: null, target_mobile_image_path: null });
  });

  it('rejects static or non-IP artwork paths and bad ids before auth or RPC', async () => {
    expect(await saveAdminIpHallBannerAction({}, form({ ipId: 'hwasan', hallBannerImagePath: '/generated/ip/banner.webp' })))
      .toEqual({ errors: { imagePath: '검증된 IP 이미지를 업로드해주세요.' } });
    expect(await saveAdminIpHallBannerAction({}, form({ ipId: 'hwasan', hallBannerMobileImagePath: 'public-media/catalog/curation/97510000-0000-4000-8000-000000000001.webp' })))
      .toEqual({ errors: { mobileImagePath: '검증된 IP 이미지를 업로드해주세요.' } });
    expect(await saveAdminIpHallBannerAction({}, form({ ipId: 'Bad Id' }))).toEqual({ errors: { form: '올바른 IP ID가 필요합니다.' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('requires platform.manage and redirects signed-out users', async () => {
    mocks.auth = { isConfigured: true, user: { id: 'user-1' }, isStaff: false };
    expect(await saveAdminIpHallBannerAction({}, form({ ipId: 'hwasan' }))).toEqual({ errors: { form: '관리자 권한이 필요합니다.' } });
    mocks.auth = { isConfigured: true, user: null, isStaff: false };
    await expect(saveAdminIpHallBannerAction({}, form({ ipId: 'hwasan' }))).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['unverified_artwork', '업로드 확인이 끝나지 않았거나 만료된 이미지입니다. 이미지를 다시 업로드해주세요.'],
    ['catalog_record_missing', 'IP를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해주세요.'],
    ['operator_capability_required', '관리자 권한이 필요합니다.'],
    ['boom', 'IP관 배너를 저장하지 못했습니다. 다시 시도해주세요.'],
  ])('maps the RPC rejection %s to a form message', async (message, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });
    expect(await saveAdminIpHallBannerAction({}, form({ ipId: 'hwasan', hallBannerImagePath: PC }))).toEqual({ errors: { form: expected } });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
