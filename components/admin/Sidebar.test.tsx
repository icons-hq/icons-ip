import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

describe('Sidebar', () => {
  it('exposes the card-pool console as a distinct admin section', () => {
    const html = renderToStaticMarkup(
      <Sidebar
        active="pool"
        collapsed={false}
        onCollapsedChange={vi.fn()}
        onSectionChange={vi.fn()}
        showRoles={false}
      />,
    );

    expect(html).toContain('aria-label="카드풀"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('카드풀');
  });
});
