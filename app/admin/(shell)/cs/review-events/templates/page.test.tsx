import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { adminScreenForPath } from '@/lib/admin/navigation';

const mocks = vi.hoisted(() => ({ guard: vi.fn(async () => ({})) }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/components/admin/screens/ReviewEventTemplatesScreen', () => ({ ReviewEventTemplatesScreen: () => null }));
import Page from './page';

/* SHEET-017: 문구 템플릿 화면은 리뷰 이벤트 메뉴의 하위 경로라 같은 화면 게이트(cs.manage)를 쓴다. */
describe('review event templates page', () => {
  it('gates on the review events screen before rendering', async () => {
    const element = await Page() as ReactElement;
    expect(mocks.guard).toHaveBeenCalledExactlyOnceWith('/admin/cs/review-events/templates');
    expect(adminScreenForPath('/admin/cs/review-events/templates')?.id).toBe('review-events');
    expect(element).toBeTruthy();
  });
});
