import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminCurations, getAdminCurationStatus } from './curations.server';

type AdminAuthState = {
  isConfigured: boolean;
  user: { id: string; email: string | null } | null;
  role: 'user' | 'staff' | 'admin' | null;
  isStaff: boolean;
};

const mocks = vi.hoisted(() => ({
  auth: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.test' },
    role: 'staff',
    isStaff: true,
  } as AdminAuthState,
  from: vi.fn(),
  getPublicUrl: vi.fn(),
  order: vi.fn(),
  select: vi.fn(),
  storageFrom: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: () => mocks.auth }));
vi.mock('@/lib/admin/artwork', async () => await import('./artwork'));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: mocks.from,
    storage: { from: mocks.storageFrom },
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

function configureRows(data: unknown[], error: unknown = null) {
  const query: {
    order: ReturnType<typeof vi.fn>;
    then: (resolve: (result: { data: unknown[]; error: unknown }) => unknown) => unknown;
  } = {
    order: mocks.order,
    then: (resolve) => resolve({ data, error }),
  };
  mocks.order.mockImplementation(() => query);
  mocks.select.mockReturnValue(query);
  mocks.from.mockReturnValue({ select: mocks.select });
}

describe('admin curation loader', () => {
  beforeEach(() => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'staff-1', email: 'staff@icons.test' },
      role: 'staff',
      isStaff: true,
    };
    mocks.from.mockReset();
    mocks.getPublicUrl.mockReset();
    mocks.order.mockReset();
    mocks.select.mockReset();
    mocks.storageFrom.mockReset();
    mocks.storageFrom.mockReturnValue({ getPublicUrl: mocks.getPublicUrl });
    mocks.getPublicUrl.mockImplementation((path: string) => ({
      data: { publicUrl: `https://storage.example/public-media/${path}` },
    }));
    configureRows([]);
  });

  it('loads every staff-visible row in deterministic kind, order, start, and id order', async () => {
    configureRows([
      {
        id: '11111111-1111-4111-8111-111111111111',
        kind: 'hero',
        ip_id: null,
        title: '홈 히어로',
        image_path: 'public-media/catalog/curation/33333333-3333-4333-8333-333333333333.webp',
        link_path: '/ip/hwasan',
        display_order: 1,
        active_from: '2026-07-21T01:30:00.000Z',
        active_to: '2026-07-21T02:30:00.000Z',
        enabled: true,
        created_at: '2026-07-20T00:00:00.000Z',
        updated_at: '2026-07-20T01:00:00.000Z',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        kind: 'announcement',
        ip_id: null,
        title: '지난 공지',
        image_path: null,
        link_path: '/notice/ended',
        display_order: 0,
        active_from: '2026-07-20T00:00:00.000Z',
        active_to: '2026-07-21T01:30:00.000Z',
        enabled: true,
        created_at: '2026-07-19T00:00:00.000Z',
        updated_at: '2026-07-20T01:00:00.000Z',
      },
    ]);

    await expect(getAdminCurations(Date.parse('2026-07-21T01:30:00.000Z'))).resolves.toEqual([
      expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
        imageUrl: 'https://storage.example/public-media/catalog/curation/33333333-3333-4333-8333-333333333333.webp',
        status: 'active',
      }),
      expect.objectContaining({
        id: '22222222-2222-4222-8222-222222222222',
        imageUrl: null,
        status: 'ended',
      }),
    ]);

    expect(mocks.from).toHaveBeenCalledWith('home_curations');
    expect(mocks.select).toHaveBeenCalledWith(
      'id,kind,ip_id,title,image_path,link_path,display_order,active_from,active_to,enabled,created_at,updated_at',
    );
    expect(mocks.order.mock.calls).toEqual([
      ['kind', { ascending: true }],
      ['display_order', { ascending: true }],
      ['active_from', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(mocks.storageFrom).toHaveBeenCalledWith('public-media');
    expect(mocks.getPublicUrl).toHaveBeenCalledWith(
      'catalog/curation/33333333-3333-4333-8333-333333333333.webp',
    );
  });

  it('calculates disabled, scheduled, active, and ended states at half-open boundaries', () => {
    const now = Date.parse('2026-07-21T01:30:00.000Z');
    expect(getAdminCurationStatus(false, '2026-07-20T00:00:00.000Z', null, now)).toBe('inactive');
    expect(getAdminCurationStatus(true, '2026-07-21T01:31:00.000Z', null, now)).toBe('scheduled');
    expect(getAdminCurationStatus(true, '2026-07-21T01:30:00.000Z', null, now)).toBe('active');
    expect(getAdminCurationStatus(
      true,
      '2026-07-20T00:00:00.000Z',
      '2026-07-21T01:30:00.000Z',
      now,
    )).toBe('ended');
  });

  it('blocks unauthenticated and non-staff requests before reading rows or Storage', async () => {
    mocks.auth = { isConfigured: true, user: null, role: null, isStaff: false };
    await expect(getAdminCurations()).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin');

    mocks.auth = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.test' },
      role: 'user',
      isStaff: false,
    };
    await expect(getAdminCurations()).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.storageFrom).not.toHaveBeenCalled();
  });

  it('fails with a safe loader error without exposing database details', async () => {
    configureRows([], { message: 'private database detail' });

    const promise = getAdminCurations();
    await expect(promise).rejects.toThrow('Failed to load admin curations');
    await expect(promise).rejects.not.toThrow('private');
    expect(mocks.getPublicUrl).not.toHaveBeenCalled();
  });
});
