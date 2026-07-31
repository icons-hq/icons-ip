import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationRow } from './notifications';
import { loadNotifications } from './notifications.server';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  eq: vi.fn(),
  firstOrder: vi.fn(),
  from: vi.fn(),
  limit: vi.fn(),
  secondOrder: vi.fn(),
  select: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

const USER_ID = '00000000-0000-4000-8000-000000001401';
const row: NotificationRow = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'drop_published',
  title: '새 드롭이 열렸어요',
  body: '팔로우한 IP의 새 굿즈를 확인해보세요.',
  link_path: '/shop',
  read_at: null,
  created_at: '2026-07-16T01:02:03.000Z',
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();

  mocks.limit.mockResolvedValue({ data: [row], error: null });
  mocks.secondOrder.mockReturnValue({ limit: mocks.limit });
  mocks.firstOrder.mockReturnValue({ order: mocks.secondOrder });
  mocks.eq.mockReturnValue({ order: mocks.firstOrder });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.createClient.mockResolvedValue({ from: mocks.from });
});

describe('loadNotifications', () => {
  it('loads only the owner latest 50 rows in stable descending order', async () => {
    await expect(loadNotifications(USER_ID)).resolves.toEqual([
      {
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        linkPath: '/shop',
        readAt: null,
        createdAt: row.created_at,
        isUnread: true,
      },
    ]);

    expect(mocks.from).toHaveBeenCalledWith('notifications');
    expect(mocks.select).toHaveBeenCalledWith(
      'id,type,title,body,link_path,read_at,created_at',
    );
    expect(mocks.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(mocks.firstOrder).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(mocks.secondOrder).toHaveBeenCalledWith('id', { ascending: false });
    expect(mocks.limit).toHaveBeenCalledWith(50);
  });

  it('does not disguise a database failure as an empty inbox', async () => {
    mocks.limit.mockResolvedValue({
      data: null,
      error: { message: 'private database detail' },
    });

    await expect(loadNotifications(USER_ID)).rejects.toThrow('Failed to load notifications');
  });
});
