import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Onboarding } from './Onboarding';

vi.mock('@/app/onboarding/actions', () => ({
  completeOnboardingAction: vi.fn(),
}));
vi.mock('@/lib/ip-display', () => ({ ipAccent: () => '#2DE2FF' }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: () => [{}, vi.fn(), false],
  };
});

function render(overrides: Partial<React.ComponentProps<typeof Onboarding>> = {}) {
  return renderToStaticMarkup(
    <Onboarding
      birthDate=""
      email="fan@icons.gg"
      followedIpIds={[]}
      initialMarketing={false}
      isConfigured
      next="/"
      nickname=""
      recommendedIps={[]}
      {...overrides}
    />,
  );
}

function source() {
  return readFileSync(new URL('./Onboarding.tsx', import.meta.url), 'utf8');
}

describe('Onboarding form contracts', () => {
  it('shows the same 1–30 character nickname contract enforced by the shared validator', () => {
    const html = render();

    expect(html).toContain('placeholder="닉네임 (1–30자)"');
    expect(html).not.toContain('닉네임 (2–12자)');
  });

  it('submits through a prevented client event so validation errors cannot reset entered values', () => {
    const component = source();

    expect(component).toMatch(/function handleSubmit\(event: FormEvent<HTMLFormElement>\)[\s\S]*event\.preventDefault\(\);[\s\S]*new FormData\(event\.currentTarget\)[\s\S]*startTransition\(\(\) => action\(payload\)\)/);
    expect(component).toMatch(/<form[^>]*action=\{action\}[^>]*onSubmit=\{handleSubmit\}/);
  });

  it('uses grouped numeric birth-date fields with browser autofill hints', () => {
    const html = render({ birthDate: '2000-01-31' });
    const component = source();

    expect(html).toContain('<fieldset');
    expect(html).toContain('name="birthYear"');
    expect(html).toContain('name="birthMonth"');
    expect(html).toContain('name="birthDay"');
    expect(component).toContain('autoComplete="bday-year"');
    expect(component).toContain('autoComplete="bday-month"');
    expect(component).toContain('autoComplete="bday-day"');
    expect(html).not.toContain('type="date"');
  });

  it('keeps onboarding checkmarks flat and presents IP names without a dark image filter', () => {
    const component = source();
    const html = render({
      followedIpIds: ['ip-one'],
      recommendedIps: [{
        bg: 'url("/generated/ip/ip-one.webp") center / cover no-repeat',
        color: '#2DE2FF',
        fans: 10,
        id: 'ip-one',
        sub: 'IP ONE',
        tagline: 'tagline',
        title: '아이피 원',
      }],
    });

    expect(component).not.toContain("background: checked ? 'var(--holo)'");
    expect(component).not.toContain('linear-gradient(180deg');
    expect(html).toContain('class="onboarding-ip-tile"');
    expect(html).toContain('class="onboarding-ip-title"');
  });

  it('필수 동의 항목에서 동의 대상 문서를 바로 열 수 있다', () => {
    const html = render();

    expect(html).toContain('href="/legal/terms"');
    expect(html).toContain('href="/legal/privacy"');
    /* 새 탭으로 열어 작성 중인 온보딩 입력값을 잃지 않게 한다. */
    expect(html).toMatch(/href="\/legal\/terms"[^>]*target="_blank"/);
  });

  it('선택 동의 항목에는 문서 링크를 붙이지 않는다', () => {
    const html = render();

    expect(html.match(/전문 보기/g)).toHaveLength(2);
  });
});
