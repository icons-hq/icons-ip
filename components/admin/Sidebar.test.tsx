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

  it('티 운영 영역에 공지 발송 콘솔을 노출한다', () => {
    const html = renderToStaticMarkup(
      <Sidebar
        active="notifications"
        collapsed={false}
        onCollapsedChange={vi.fn()}
        onSectionChange={vi.fn()}
        showRoles={false}
      />,
    );

    expect(html).toContain('aria-label="공지 발송"');
    expect(html).toContain('aria-current="true"');
    expect(html.indexOf('aria-label="티켓 회차"')).toBeLessThan(html.indexOf('aria-label="공지 발송"'));
    expect(html.indexOf('aria-label="공지 발송"')).toBeLessThan(html.indexOf('aria-label="모더레이션"'));
    expect(html).toContain('aria-label="회원"');
    expect(html.indexOf('aria-label="모더레이션"')).toBeLessThan(html.indexOf('aria-label="회원"'));
  });

  it('회원 조회·제재는 staff에게도 보이고 역할 관리는 admin에게만 보인다', () => {
    const staff = renderToStaticMarkup(
      <Sidebar
        active="members"
        collapsed={false}
        onCollapsedChange={vi.fn()}
        onSectionChange={vi.fn()}
        showRoles={false}
      />,
    );
    expect(staff).toContain('aria-label="회원"');
    expect(staff).not.toContain('aria-label="역할"');

    const admin = renderToStaticMarkup(
      <Sidebar
        active="roles"
        collapsed={false}
        onCollapsedChange={vi.fn()}
        onSectionChange={vi.fn()}
        showRoles
      />,
    );
    expect(admin).toContain('aria-label="회원"');
    expect(admin).toContain('aria-label="역할"');
  });
});
