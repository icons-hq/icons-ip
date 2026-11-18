import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown,
  thread: vi.fn(),
  satisfaction: vi.fn(),
  view: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('@/components/screens/InquiryThread', () => ({ InquiryThread: mocks.view }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
vi.mock('@/lib/inquiries.server', () => ({ loadMyInquiryThread: mocks.thread }));
vi.mock('@/lib/inquiry-satisfaction.server', () => ({ loadMyInquirySatisfaction: mocks.satisfaction }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

const INQUIRY = '11111111-1111-4111-8111-111111111111';
const USER = { id: '00000000-0000-4000-8000-000000000301', email: 'fan@example.test' };
const ONBOARDED = {
  email: 'fan@example.test', nickname: '팬', birth_date: '1990-01-01', onboarded_at: '2026-01-01T00:00:00Z',
  consents: { terms: true, privacy: true }, suspended_at: null,
};
const run = () => Page({ params: Promise.resolve({ inquiryId: INQUIRY }) } as never);
const props = (element: unknown) => (element as { props: Record<string, unknown> }).props;

describe('/my/inquiries/[inquiryId] — 계정 문의 예외(원장 CUS-035)', () => {
  beforeEach(() => {
    mocks.thread.mockReset();
    mocks.satisfaction.mockResolvedValue(null);
    mocks.auth = { isConfigured: true, user: USER, profile: ONBOARDED, isStaff: false };
  });

  it('온보딩 미완료 회원은 자기 계정 문의를 이어 쓰기(첨부 없이)로 열고, 다른 문의는 온보딩으로 보낸다', async () => {
    mocks.auth = { isConfigured: true, user: USER, profile: { ...ONBOARDED, onboarded_at: null }, isStaff: false };
    mocks.thread.mockResolvedValue({ id: INQUIRY, category: 'account' });
    expect(props(await run())).toMatchObject({ restricted: true });
    mocks.thread.mockResolvedValue({ id: INQUIRY, category: 'order' });
    await expect(run()).rejects.toThrow(`NEXT_REDIRECT:/onboarding?next=${encodeURIComponent(`/my/inquiries/${INQUIRY}`)}`);
  });

  it('정지 회원은 지금처럼 문의를 열람하고 첨부 없이 이어 쓴다(계정 문의가 아니면 DB·액션이 거절)', async () => {
    mocks.auth = { isConfigured: true, user: USER, profile: { ...ONBOARDED, suspended_at: '2026-11-18T00:00:00Z' }, isStaff: false };
    mocks.thread.mockResolvedValue({ id: INQUIRY, category: 'order' });
    expect(props(await run())).toMatchObject({ restricted: true });
  });

  it('일반 회원은 제한 없이 연다', async () => {
    mocks.thread.mockResolvedValue({ id: INQUIRY, category: 'order' });
    expect(props(await run())).toMatchObject({ restricted: false });
  });
});
