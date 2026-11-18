import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown,
  composer: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  links: vi.fn(),
}));

vi.mock('@/components/screens/InquiryComposer', () => ({ InquiryComposer: mocks.composer }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
vi.mock('@/lib/inquiries.server', () => ({ resolveInquiryLinkTargets: mocks.links }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); } }));

const USER = { id: '00000000-0000-4000-8000-000000000301', email: 'fan@example.test' };
const ONBOARDED = {
  email: 'fan@example.test', nickname: '팬', birth_date: '1990-01-01', onboarded_at: '2026-01-01T00:00:00Z',
  consents: { terms: true, privacy: true }, suspended_at: null,
};
const run = (query: Record<string, string>) => Page({ searchParams: Promise.resolve(query) });
const props = (element: unknown) => (element as { props: Record<string, unknown> }).props;

describe('/my/inquiries/new — 계정 문의 예외(원장 CUS-035)', () => {
  beforeEach(() => {
    mocks.composer.mockClear();
    mocks.links.mockReset();
    mocks.links.mockResolvedValue({ orderId: null, orderLabel: null, goodId: null, goodName: null });
    mocks.auth = { isConfigured: true, user: USER, profile: ONBOARDED, isStaff: false };
  });

  it('로그인 전에는 유형·연결 대상을 실은 작성 경로로 돌아오게 한다', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(run({ category: 'account' })).rejects.toThrow(`NEXT_REDIRECT:/login?next=${encodeURIComponent('/my/inquiries/new?category=account')}`);
  });

  it('정지 회원은 어느 진입점이든 계정 문의만 쓰는 작성 화면을 연다', async () => {
    mocks.auth = { isConfigured: true, user: USER, profile: { ...ONBOARDED, suspended_at: '2026-11-18T00:00:00Z' }, isStaff: false };
    expect(props(await run({ category: 'order', orderId: '00000000-0000-4000-8000-0000000000aa' }))).toMatchObject({ defaultCategory: 'account', restricted: true });
    expect(mocks.links).not.toHaveBeenCalled();
  });

  it('온보딩 미완료 회원은 계정 문의로 들어오면 바로 쓰고, 다른 유형은 경로를 보존해 온보딩으로 간다', async () => {
    mocks.auth = { isConfigured: true, user: USER, profile: { ...ONBOARDED, onboarded_at: null }, isStaff: false };
    expect(props(await run({ category: 'account' }))).toMatchObject({ defaultCategory: 'account', restricted: true });
    await expect(run({ category: 'order', orderId: 'x1' })).rejects.toThrow(
      `NEXT_REDIRECT:/onboarding?next=${encodeURIComponent('/my/inquiries/new?category=order&orderId=x1')}`,
    );
  });

  it('일반 회원은 지금처럼 고른 유형과 연결 대상으로 연다', async () => {
    expect(props(await run({ category: 'good' }))).toMatchObject({ defaultCategory: 'good' });
    expect(props(await run({}))).not.toHaveProperty('restricted');
  });
});
