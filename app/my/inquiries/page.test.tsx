import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown,
  list: vi.fn(),
  view: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('@/components/screens/Inquiries', () => ({ Inquiries: mocks.view }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
vi.mock('@/lib/inquiries.server', () => ({ loadMyInquiries: mocks.list }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); } }));

const USER = { id: '00000000-0000-4000-8000-000000000301', email: 'fan@example.test' };
const PROFILE = {
  email: 'fan@example.test', nickname: '팬', birth_date: '1990-01-01', onboarded_at: null,
  consents: { terms: true, privacy: true }, suspended_at: null,
};
const props = (element: unknown) => (element as { props: Record<string, unknown> }).props;

describe('/my/inquiries — 정지·온보딩 미완료 회원(원장 CUS-035)', () => {
  beforeEach(() => {
    mocks.auth = { isConfigured: true, user: USER, profile: PROFILE, isStaff: false };
  });

  it('계정 문의만 보여주고, 계정 문의가 없으면 지금처럼 온보딩으로 보낸다', async () => {
    mocks.list.mockResolvedValue([{ id: 'a', category: 'account' }, { id: 'b', category: 'order' }]);
    expect(props(await Page())).toEqual({ inquiries: [{ id: 'a', category: 'account' }] });
    mocks.list.mockResolvedValue([{ id: 'b', category: 'order' }]);
    await expect(Page()).rejects.toThrow(`NEXT_REDIRECT:/onboarding?next=${encodeURIComponent('/my/inquiries')}`);
  });

  it('정지 회원은 계정 문의만 보고, 없으면 빈 목록에서 새 계정 문의를 쓴다', async () => {
    const suspended = { ...PROFILE, onboarded_at: '2026-01-01T00:00:00Z', suspended_at: '2026-11-18T00:00:00Z' };
    mocks.auth = { isConfigured: true, user: USER, profile: suspended, isStaff: false };
    mocks.list.mockResolvedValue([{ id: 'a', category: 'account' }, { id: 'b', category: 'order' }]);
    expect(props(await Page())).toEqual({ inquiries: [{ id: 'a', category: 'account' }] });
    mocks.list.mockResolvedValue([{ id: 'b', category: 'order' }]);
    expect(props(await Page())).toEqual({ inquiries: [] });
  });

  it('온보딩을 마친 회원은 전체 목록을 본다', async () => {
    mocks.auth = { isConfigured: true, user: USER, profile: { ...PROFILE, onboarded_at: '2026-01-01T00:00:00Z' }, isStaff: false };
    mocks.list.mockResolvedValue([{ id: 'a', category: 'account' }, { id: 'b', category: 'order' }]);
    expect((props(await Page()).inquiries as unknown[]).length).toBe(2);
  });
});
