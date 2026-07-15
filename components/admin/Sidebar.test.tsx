import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

describe('Sidebar', () => {
  it('exposes the reward-policy and game consoles in the card-operations group', () => {
    const html = renderToStaticMarkup(
      <Sidebar
        active="policy"
        collapsed={false}
        onCollapsedChange={vi.fn()}
        onSectionChange={vi.fn()}
        showRoles={false}
      />,
    );

    expect(html).toContain('aria-label="카드풀"');
    expect(html).toContain('aria-label="발급 정책"');
    expect(html).toContain('aria-label="게임"');
    expect(html).toContain('aria-current="true"');
    expect(html.indexOf('aria-label="카드풀"')).toBeLessThan(html.indexOf('aria-label="발급 정책"'));
    expect(html.indexOf('aria-label="발급 정책"')).toBeLessThan(html.indexOf('aria-label="게임"'));
    expect(html.indexOf('aria-label="게임"')).toBeLessThan(html.indexOf('aria-label="이벤트"'));
  });
});
