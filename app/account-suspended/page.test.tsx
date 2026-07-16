import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Page from './page';

const mocks = vi.hoisted(() => ({ rendered: false }));

vi.mock('@/components/screens/AccountSuspended', () => ({
  AccountSuspended: () => {
    mocks.rendered = true;
    return null;
  },
}));

describe('/account-suspended page', () => {
  beforeEach(() => { mocks.rendered = false; });

  it('screen component에 route를 연결한다', () => {
    renderToStaticMarkup(<Page />);
    expect(mocks.rendered).toBe(true);
  });
});
