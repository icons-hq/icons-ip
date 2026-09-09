import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
import { fetchStaffPreviewVisible } from './staff-preview.client';
beforeEach(() => { mocks.rpc.mockReset(); });

describe('스태프 진입점 공용 readback', () => {
  it('is_staff의 true 성공 결과만 진입점을 연다', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    await expect(fetchStaffPreviewVisible()).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('is_staff');
  });

  it.each([
    { data: false, error: null },
    { data: null, error: null },
    { data: 'true', error: null },
    { data: true, error: { message: 'denied' } },
  ])('오류·비권한·비정상 결과는 닫힌다: %o', async (result) => {
    mocks.rpc.mockResolvedValue(result);
    await expect(fetchStaffPreviewVisible()).resolves.toBe(false);
  });

  it('네트워크 실패도 닫힌 상태로 끝난다', async () => {
    mocks.rpc.mockRejectedValue(new Error('network'));
    await expect(fetchStaffPreviewVisible()).resolves.toBe(false);
  });
});
