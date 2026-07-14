import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Atmos } from './Atmos';
import { SiteFooter } from './SiteFooter';

const mocks = vi.hoisted(() => ({ pathname: '/events' }));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('@/lib/routes', async () => await import('../../lib/routes'));

beforeEach(() => {
  mocks.pathname = '/events';
});

describe('ticket shell entrypoints', () => {
  it('links to my tickets from the footer', () => {
    const html = renderToStaticMarkup(<SiteFooter />);
    expect(html).toContain('href="/tickets"');
    expect(html).toContain('내 티켓');
  });

  it('uses the event atmosphere on ticket list and detail routes', () => {
    mocks.pathname = '/tickets/5cbcbfed-202d-4676-821a-7706398e57c0';
    const html = renderToStaticMarkup(<Atmos />);
    expect(html).toContain('bg-atmos--events');
  });
});
