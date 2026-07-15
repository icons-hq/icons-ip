import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  marketingState: {} as MockActionState,
  marketingSubmit: vi.fn(),
  profileAction: vi.fn(),
  profileState: {} as MockActionState,
  profileSubmit: vi.fn(),
}));

vi.mock('@/app/settings/actions', () => ({
  updateMarketingConsentAction: mocks.marketingAction,
  updateProfileAction: mocks.profileAction,
}));
vi.mock('@/lib/profile', async () => await import('../../lib/profile'));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (action: unknown) => {
      if (action === mocks.profileAction) {
        return [mocks.profileState, mocks.profileSubmit, false];
      }
      if (action === mocks.marketingAction) {
        return [mocks.marketingState, mocks.marketingSubmit, false];
      }
      throw new Error('Unexpected settings action');
    },
  };
});

function render(overrides: Partial<React.ComponentProps<typeof Settings>> = {}) {
  return renderToStaticMarkup(
    <Settings
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
    mocks.marketingState = {};
    mocks.profileState = {};
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders independent profile and marketing forms with an editable signed avatar preview', () => {
    const html = render();

    expect(html.match(/<form /g)).toHaveLength(2);
    expect(html).toContain('action=');
    expect(html).toContain('name="nickname"');
    expect(html).toContain('name="avatar"');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain('프로필 저장');
    expect(html).toContain('변경사항 저장');
    expect(html).toContain('alt="프로필 아바타"');
    expect(html).toContain('src="https://signed.example/avatar.png"');
  });

  it('uses the nickname first grapheme without imposing a different client length limit', () => {
    const html = render({ avatarUrl: null, nickname: '👩‍🎤팬' });

    expect(html).toContain('>👩‍🎤</span>');
    expect(html).not.toContain('alt="프로필 아바타"');
    expect(html).not.toContain('maxLength=');
  });

  it('falls back without rendering failure when Intl.Segmenter is unavailable', () => {
    const intlWithoutSegmenter = Object.create(Intl) as typeof Intl;
    Object.defineProperty(intlWithoutSegmenter, 'Segmenter', { value: undefined });
    vi.stubGlobal('Intl', intlWithoutSegmenter);

    const html = render({ avatarUrl: null, nickname: '👩‍🎤팬' });

    expect(html).toContain('>👩</span>');
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
