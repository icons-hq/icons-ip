import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@/components/admin/kit/ui/sidebar';

const captured = vi.hoisted(() => ({
  flyouts: [] as { children: unknown; finalFocus?: () => boolean; 'data-admin-nav-flyout'?: string }[],
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/cs/inquiries' }));
vi.mock('@/components/admin/kit/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  PopoverContent: (props: { children: ReactNode; finalFocus?: () => boolean; 'data-admin-nav-flyout'?: string }) => {
    captured.flyouts.push(props);
    return <div>{props.children}</div>;
  },
}));

import { AdminSidebar } from './AdminSidebar';

type ListProps = { children?: ReactNode; onClick?: (event: unknown) => void };

/* 플라이아웃 안의 ul을 찾는다(모의 PopoverContent가 받은 children에서). */
function findList(node: unknown): ReactElement<ListProps> | null {
  if (Array.isArray(node)) { for (const item of node) { const found = findList(item); if (found) return found; } return null; }
  if (!isValidElement<ListProps>(node)) return null;
  return node.type === 'ul' ? node : findList(node.props.children);
}

beforeEach(() => {
  captured.flyouts = [];
});

/* 키보드로 링크를 고르면 포커스가 아이콘으로 돌아와 말풍선이 새 화면 위에 남았다. */
it('플라이아웃 링크로 이동해 닫힐 때만 아이콘으로 포커스를 되돌리지 않는다', () => {
  renderToStaticMarkup(<SidebarProvider defaultOpen={false}><AdminSidebar accountId="operator-a" role="admin" /></SidebarProvider>);
  const sales = captured.flyouts.find((flyout) => flyout['data-admin-nav-flyout'] === 'sales')!;
  const claims = captured.flyouts.find((flyout) => flyout['data-admin-nav-flyout'] === 'claims')!;

  expect(sales.finalFocus!()).toBe(true); // Esc·바깥 클릭으로 닫으면 되돌린다.
  const list = findList(sales.children)!;
  list.props.onClick!({ target: { closest: () => null } });
  expect(sales.finalFocus!()).toBe(true); // 링크 밖을 누른 것은 이동이 아니다.
  const onLink = { closest: (selector: string) => (selector === 'a[href]' ? {} : null) };
  list.props.onClick!({ target: onLink, metaKey: true });
  expect(sales.finalFocus!()).toBe(true); // 새 탭으로 여는 클릭은 이 화면에 머문다.
  list.props.onClick!({ target: onLink });
  expect(sales.finalFocus!()).toBe(false);
  expect(claims.finalFocus!()).toBe(true); // 다른 그룹에는 영향이 없다.
});
