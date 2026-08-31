import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Atmos } from './Atmos';
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

  it('uses the event atmosphere on ticket list and detail routes', () => {
    mocks.pathname = '/tickets/5cbcbfed-202d-4676-821a-7706398e57c0';
    const html = renderToStaticMarkup(<Atmos />);
    expect(html).toContain('bg-atmos--events');
  });

  /* 예매 도메인이 /offline-popups로 이사한 뒤에도 목록·상세가 같은 분위기를 쓴다. */
  it('keeps the event atmosphere on the offline pop-up booking routes', () => {
    mocks.pathname = '/offline-popups';
    expect(renderToStaticMarkup(<Atmos />)).toContain('bg-atmos--events');

    mocks.pathname = '/offline-popups/e100';
    expect(renderToStaticMarkup(<Atmos />)).toContain('bg-atmos--events');
  });
});
