import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminProfileRecords } from './roles.server';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));

describe('getAdminProfileRecords', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('direct profiles 조회 대신 최소 회원 목록 RPC를 재사용한다', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        profile_id: '11111111-1111-4111-8111-111111111111',
        nickname: '운영 대상',
        role: 'user',
        created_at: '2026-07-17T00:00:00.000Z',
      }],
      error: null,
    });

    await expect(getAdminProfileRecords()).resolves.toEqual([{
      id: '11111111-1111-4111-8111-111111111111',
      nickname: '운영 대상',
      role: 'user',
      createdAt: '2026-07-17T00:00:00.000Z',
    }]);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_members', {
      target_limit: 50,
      target_offset: 0,
      target_query: null,
    });
  });
});
