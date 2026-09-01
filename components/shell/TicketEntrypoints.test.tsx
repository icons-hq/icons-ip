import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteFooter } from './SiteFooter';

const mocks = vi.hoisted(() => ({ pathname: '/offline-popups' }));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));

beforeEach(() => {
  mocks.pathname = '/offline-popups';
});

describe('ticket shell entrypoints', () => {
  it('links to my tickets from the footer', () => {
    const html = renderToStaticMarkup(<SiteFooter />);
    expect(html).toContain('href="/tickets"');
    expect(html).toContain('내 티켓');
  });
});
