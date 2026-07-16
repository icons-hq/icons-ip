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
  updateMarketingConsentAction: mocks.marketingAction,
  updateProfileAction: mocks.profileAction,
}));
vi.mock('@/lib/profile', async () => await import('../../lib/profile'));
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
      throw new Error('Unexpected settings action');
    },
  };
});

function render(overrides: Partial<React.ComponentProps<typeof Settings>> = {}) {
  return renderToStaticMarkup(
    <Settings
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
    mocks.marketingPending = false;
    mocks.marketingState = {};
    mocks.profilePending = false;
    mocks.profileState = {};
    mocks.uploadProfileAvatar.mockReset();
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
