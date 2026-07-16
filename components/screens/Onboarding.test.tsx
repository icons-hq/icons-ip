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

describe('Onboarding nickname contract', () => {
  it('shows the same 1–30 character contract enforced by the shared validator', () => {
    const html = renderToStaticMarkup(
      <Onboarding
        birthDate=""
        email="fan@icons.gg"
        followedIpIds={[]}
        initialMarketing={false}
        isConfigured
        next="/"
        nickname=""
        recommendedIps={[]}
      />,
    );

    expect(html).toContain('placeholder="닉네임 (1–30자)"');
    expect(html).not.toContain('닉네임 (2–12자)');
  });
});
