import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminGuideTopicPage from './page';

const mocks = vi.hoisted(() => ({
  authState: {
    isConfigured: true,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
  },
  topicScreen: vi.fn(() => null),
}));

vi.mock('@/components/admin/screens/AdminGuideTopicScreen', () => ({
  AdminGuideTopicScreen: mocks.topicScreen,
}));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: vi.fn(async () => mocks.authState),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

function pageProps(topic: string) {
  return { params: Promise.resolve({ topic }) };
}

describe('AdminGuideTopicPage', () => {
  beforeEach(() => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.topicScreen.mockClear();
  });

  it('미로그인이면 실제 주제 경로를 next로 실어 로그인으로 보낸다', async () => {
    mocks.authState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(AdminGuideTopicPage(pageProps('claims'))).rejects.toThrow(
      `NEXT_REDIRECT:/login?next=${encodeURIComponent('/admin/guide/claims')}`,
    );
    expect(mocks.topicScreen).not.toHaveBeenCalled();
  });

  it('일반 사용자에게는 주제를 렌더하기 전에 화면을 감춘다', async () => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '44444444-4444-4444-8444-444444444444', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(AdminGuideTopicPage(pageProps('claims'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.topicScreen).not.toHaveBeenCalled();
  });

  it('모르는 슬러그는 404다', async () => {
    await expect(AdminGuideTopicPage(pageProps('unknown-topic'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.topicScreen).not.toHaveBeenCalled();
  });

  it('아는 슬러그는 해당 주제를 렌더러에 넘긴다', async () => {
    const screen = await AdminGuideTopicPage(pageProps('goods-sales'));

    expect(screen.type).toBe(mocks.topicScreen);
    expect(screen.props.topic.slug).toBe('goods-sales');
  });
});
