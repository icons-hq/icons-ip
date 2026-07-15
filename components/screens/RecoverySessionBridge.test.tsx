import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RecoverySessionBridge } from './RecoverySessionBridge';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useEffect: (effect: () => void) => effect(),
  };
});
vi.mock('@/lib/auth/onboarding', async () => await import('../../lib/auth/onboarding'));

describe('RecoverySessionBridge', () => {
  it('performs a full navigation without preserving the one-time ready marker', () => {
    vi.stubGlobal('window', { location: { replace: mocks.replace } });

    const html = renderToStaticMarkup(
      <RecoverySessionBridge next="/community?sort=hot" />,
    );

    expect(mocks.replace).toHaveBeenCalledWith('/update-password?next=%2Fcommunity%3Fsort%3Dhot');
    expect(html).toContain('재설정 세션을 확인하고 있습니다');

    vi.unstubAllGlobals();
  });
});
