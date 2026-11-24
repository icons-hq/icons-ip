import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCatalogRecordKind } from '@/lib/admin/catalog.server';

/*
 * 화면별 라우트 계약 테스트.
 *
 * 라우트가 지켜야 하는 것은 두 가지다 — (1) 권한 게이트를 로더보다 먼저 await 하고,
 * (2) 자기 화면이 쓰는 종류만 include 한다. 둘 다 page 하나를 고칠 때 조용히 깨지는
 * 종류의 계약이라 라우트를 한자리에서 고정한다. 카드·카드풀·발급 정책·카드팩 수동 발급·게임
 * 라우트는 2026-11-24 일반 쇼핑몰 전환으로 지웠다(ADR-0052).
 */

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  includes: [] as (readonly AdminCatalogRecordKind[] | undefined)[],
  guard: vi.fn(),
  catalogRecords: vi.fn(),
  screens: {
    event: vi.fn(() => null),
    ticketType: vi.fn(() => null),
  },
}));

vi.mock('@/lib/admin/guard.server', () => ({
  requireAdminScreenAccess: mocks.guard,
}));
vi.mock('@/lib/admin/catalog.server', () => ({
  getAdminCatalogRecords: mocks.catalogRecords,
}));
vi.mock('@/components/admin/screens/EventScreen', () => ({ EventScreen: mocks.screens.event }));
vi.mock('@/components/admin/screens/TicketTypeScreen', () => ({ TicketTypeScreen: mocks.screens.ticketType }));

const { default: AdminCatalogEventsPage } = await import('./events/page');
const { default: AdminCatalogTicketTypesPage } = await import('./ticket-types/page');

const emptyRecords = {
  ips: [],
  goods: [],
  events: [],
  ticketTypes: [],
};

describe('어드민 카탈로그 라우트', () => {
  beforeEach(() => {
    mocks.order = [];
    mocks.includes = [];
    mocks.guard.mockReset();
    mocks.guard.mockImplementation(async (pathname: string) => {
      mocks.order.push(`guard:${pathname}`);
      return { user: { id: 'staff', email: 'staff@icons.gg' }, role: 'staff', isStaff: true };
    });
    mocks.catalogRecords.mockReset();
    mocks.catalogRecords.mockImplementation(
      async (options: { include?: readonly AdminCatalogRecordKind[] } = {}) => {
        mocks.order.push('records');
        mocks.includes.push(options.include);
        return emptyRecords;
      },
    );
  });

  it.each([
    ['/admin/catalog/events', () => AdminCatalogEventsPage(), ['events', 'ips']],
    ['/admin/catalog/ticket-types', () => AdminCatalogTicketTypesPage(), ['ticketTypes', 'events']],
  ])('%s는 권한 게이트를 먼저 통과한 뒤 자기 화면 데이터만 불러온다', async (pathname, render, include) => {
    await render();

    /* 게이트가 첫 await 여야 한다 — 로더가 먼저 돌면 비스태프도 쿼리를 실행시킨다. */
    expect(mocks.order[0]).toBe(`guard:${pathname}`);
    expect(mocks.order.slice(1)).not.toContain(`guard:${pathname}`);
    expect(mocks.includes).toEqual([include]);
  });

  /*
   * 멱등 키와 draft 기준 시각은 서버 컴포넌트가 요청당 한 번 만든다.
   * 화면 래퍼(클라이언트)에서 만들면 리렌더마다 값이 바뀌어 같은 저장이 두 번 먹힌다.
   */
  it('멱등 키를 서버에서 만들어 화면마다 서로 다른 값으로 내려준다', async () => {
    const ticketTypes = await AdminCatalogTicketTypesPage();

    expect(new Set([ticketTypes.props.draftId, ticketTypes.props.operationId]).size).toBe(2);
  });
});
