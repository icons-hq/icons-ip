import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from './Settings';

interface MockActionState {
  errors?: {
    nickname?: string;
    avatar?: string;
    form?: string;
  };
  message?: string;
}

const mocks = vi.hoisted(() => ({
  deletionAction: vi.fn(),
  deletionPending: false,
  deletionState: {} as { error?: string; message?: string },
  deletionSubmit: vi.fn(),
  marketingAction: vi.fn(),
  marketingPending: false,
  marketingState: {} as MockActionState,
  marketingSubmit: vi.fn(),
  profileAction: vi.fn(),
  profilePending: false,
  profileState: {} as MockActionState,
  profileSubmit: vi.fn(),
  uploadProfileAvatar: vi.fn(),
}));

vi.mock('@/app/settings/actions', () => ({
  requestAccountDeletionAction: mocks.deletionAction,
  updateMarketingConsentAction: mocks.marketingAction,
  updateProfileAction: mocks.profileAction,
}));
vi.mock('@/lib/profile-upload.client', () => ({
  uploadProfileAvatar: mocks.uploadProfileAvatar,
}));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (action: unknown) => {
      if (action === mocks.profileAction) {
        return [mocks.profileState, mocks.profileSubmit, mocks.profilePending];
      }
      if (action === mocks.marketingAction) {
        return [mocks.marketingState, mocks.marketingSubmit, mocks.marketingPending];
      }
      if (action === mocks.deletionAction) {
        return [mocks.deletionState, mocks.deletionSubmit, mocks.deletionPending];
      }
      throw new Error('Unexpected settings action');
    },
  };
});

function render(overrides: Partial<React.ComponentProps<typeof Settings>> = {}) {
  return renderToStaticMarkup(
    <Settings
      accountDeletion={{
        preview: {
          available: false,
          eligible: false,
          blockers: [{ code: 'not_available', count: 1, path: '/settings' }],
        },
        status: { status: 'not_requested', phase: 'none', nextAction: '/settings', blockers: [] },
      }}
      accountDeletionRequestKey="123e4567-e89b-42d3-a456-426614174000"
      avatarInitial="아"
      avatarUrl="https://signed.example/avatar.png"
      email="fan@icons.gg"
      initialMarketing={false}
      isConfigured
      nickname="아이콘즈 팬"
      {...overrides}
    />,
  );
}

function statusMarkup(html: string, label: string) {
  const start = html.indexOf(`aria-label="${label}"`);
  const end = html.indexOf('<button', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe('Settings', () => {
  beforeEach(() => {
    mocks.deletionPending = false;
    mocks.deletionState = {};
    mocks.marketingPending = false;
    mocks.marketingState = {};
    mocks.profilePending = false;
    mocks.profileState = {};
    mocks.uploadProfileAvatar.mockReset();
  });

  it('keeps the destructive request default-off and explains unfinished phases', () => {
    const html = render();

    expect(html).toContain('아직 탈퇴 신청을 받지 않습니다');
    expect(html).toContain('실제 Storage·DB·Auth 삭제');
    expect(html).not.toContain('name="confirmation"');
  });

  it('requires the exact confirmation while exposing no target user identifier', () => {
    const html = render({
      accountDeletion: {
        preview: { available: true, eligible: true, blockers: [] },
        status: { status: 'not_requested', phase: 'none', nextAction: '/settings', blockers: [] },
      },
    });

    expect(html).toContain('회원 탈퇴를 신청합니다');
    expect(html).toContain('name="confirmation"');
    expect(html).toContain('name="idempotencyKey"');
    expect(html).not.toContain('name="userId"');
    expect(html.match(/<form /g)).toHaveLength(3);
  });

  it('shows only blocker counts and recovery paths after a fenced request', () => {
    const html = render({
      accountDeletion: {
        preview: {
          available: true,
          eligible: false,
          blockers: [{ code: 'active_order', count: 2, path: '/orders' }],
        },
        status: {
          status: 'blocked',
          phase: 'fenced',
          nextAction: '/orders',
          blockers: [{ code: 'active_order', count: 2, path: '/orders' }],
        },
      },
    });

    expect(html).toContain('진행 중인 의무');
    expect(html).toContain('해결할 항목 2건 확인');
    expect(html).toContain('href="/orders"');
    expect(html).not.toContain('name="confirmation"');
  });

  it('shows current opaque blockers before the first request', () => {
    const html = render({
      accountDeletion: {
        preview: {
          available: true,
          eligible: false,
          blockers: [{ code: 'active_order', count: 2, path: '/orders' }],
        },
        status: { status: 'not_requested', phase: 'none', nextAction: '/settings', blockers: [] },
      },
    });

    expect(html).toContain('신청 전에 진행 중인 의무');
    expect(html).toContain('신청 전 해결할 항목 2건 확인');
    expect(html).toContain('href="/orders"');
    expect(html).toContain('name="confirmation"');
  });

  it('renders independent profile and marketing forms with an editable signed avatar preview', () => {
    const html = render();

    expect(html.match(/<form /g)).toHaveLength(2);
    expect(html).toContain('action=');
    expect(html).toContain('name="nickname"');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain('프로필 저장');
    expect(html).toContain('변경사항 저장');
    expect(html).toContain('alt="프로필 아바타"');
    expect(html).toContain('src="https://signed.example/avatar.png"');

    const fileInput = html.match(/<input[^>]*id="settings-avatar"[^>]*>/)?.[0];
    expect(fileInput).toBeDefined();
    expect(fileInput).not.toContain('name=');
  });

  it('renders only the server-computed avatar initial, including the empty fallback', () => {
    const emojiHtml = render({ avatarInitial: '👩‍🎤', avatarUrl: null, nickname: 'ignored' });
    const emptyHtml = render({ avatarInitial: 'I', avatarUrl: null, nickname: '' });

    expect(emojiHtml).toContain('>👩‍🎤</span>');
    expect(emojiHtml).not.toContain('ignored</span>');
    expect(emptyHtml).toContain('>I</span>');
    expect(emptyHtml).not.toContain('alt="프로필 아바타"');
  });

  it('adds explicit focus-visible hooks to every editable settings control', () => {
    const html = render();

    expect(html).toContain('settings-nickname-control');
    expect(html).toContain('settings-avatar-input');
    expect(html).toContain('settings-profile-submit');
    expect(html).toContain('settings-marketing-input');
    expect(html).toContain('settings-marketing-proxy');
    expect(html).toContain('settings-marketing-submit');
    expect(html).not.toContain('outline:none');
  });

  it('keeps profile and marketing action pending states independent', () => {
    mocks.profilePending = true;
    const profileHtml = render();
    expect(profileHtml).toContain('저장 중');
    expect(profileHtml).toContain('settings-profile-submit" disabled=""');
    expect(profileHtml).not.toContain('settings-marketing-submit" disabled=""');

    mocks.profilePending = false;
    mocks.marketingPending = true;
    const marketingHtml = render();
    expect(marketingHtml).toContain('settings-marketing-submit" disabled=""');
    expect(marketingHtml).not.toContain('settings-profile-submit" disabled=""');
  });

  it('hides a stale profile success message while the next profile save is pending', () => {
    mocks.profileState = { message: '이전 프로필 저장 성공' };
    mocks.profilePending = true;

    const html = render();
    const profileStatus = statusMarkup(html, '프로필 저장 상태');

    expect(profileStatus).not.toContain('이전 프로필 저장 성공');
    expect(html).toContain('저장 중');
  });

  it('keeps profile and marketing feedback inside their own status regions', () => {
    mocks.profileState = {
      errors: {
        avatar: '프로필 이미지 오류',
        form: '프로필 저장 오류',
        nickname: '닉네임 오류',
      },
      message: '프로필 저장 성공',
    };
    mocks.marketingState = {
      errors: { form: '마케팅 저장 오류' },
      message: '마케팅 저장 성공',
    };

    const html = render();
    const profileStatus = statusMarkup(html, '프로필 저장 상태');
    const marketingStatus = statusMarkup(html, '마케팅 동의 저장 상태');

    expect(profileStatus).toContain('닉네임 오류');
    expect(profileStatus).toContain('프로필 이미지 오류');
    expect(profileStatus).toContain('프로필 저장 오류');
    expect(profileStatus).toContain('프로필 저장 성공');
    expect(profileStatus).not.toContain('마케팅 저장 오류');
    expect(profileStatus).not.toContain('마케팅 저장 성공');

    expect(marketingStatus).toContain('마케팅 저장 오류');
    expect(marketingStatus).toContain('마케팅 저장 성공');
    expect(marketingStatus).not.toContain('프로필 저장 오류');
    expect(marketingStatus).not.toContain('프로필 저장 성공');
  });
});
