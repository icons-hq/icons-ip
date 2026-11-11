import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pathname: '/admin/sales/orders', search: '' }));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useSearchParams: () => new URLSearchParams(mocks.search) }));
vi.mock('next/link', () => ({
  /* prefetch 값이 HTML에 드러나게 한다. */
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean | null }) => <a data-prefetch={String(prefetch)} {...props} />,
}));
vi.mock('./AdminInquiryNotifier', () => ({ AdminInquiryNotifier: () => null }));
vi.mock('./AdminNumberWheelGuard', () => ({ AdminNumberWheelGuard: () => null }));

import { AdminShell } from './AdminShell';

const admin = { id: 'admin-1', email: 'ops@example.test', role: 'staff', operatorAccess: legacyOperatorAccessFixture('staff') };

describe('사이드바·상단 막대 프리페치', () => {
  beforeEach(() => {
    mocks.pathname = '/admin/sales/orders';
    mocks.search = '';
  });

  /* 메뉴 링크마다 프리페치가 나가면 화면을 열 때마다 수십 개의 요청이 권한 조회를 돌고, 실제 이동이 그 뒤로 밀린다. */
  it('모든 Link가 prefetch={false}다', () => {
    const html = renderToStaticMarkup(<AdminShell admin={admin}><p>본문</p></AdminShell>);
    const anchors = html.match(/<a\b[^>]*data-prefetch="[^"]*"[^>]*>/g) ?? [];
    expect(anchors.length).toBeGreaterThan(40);
    expect(anchors.filter((tag) => !tag.includes('data-prefetch="false"'))).toEqual([]);
  });
});
