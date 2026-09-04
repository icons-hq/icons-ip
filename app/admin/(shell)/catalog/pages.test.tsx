import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCatalogRecordKind } from '@/lib/admin/catalog.server';

/*
 * 화면별 라우트 계약 테스트.
 *
 * 라우트가 지켜야 하는 것은 두 가지다 — (1) 권한 게이트를 로더보다 먼저 await 하고,
 * (2) 자기 화면이 쓰는 종류만 include 한다. 둘 다 page 하나를 고칠 때 조용히 깨지는
 * 종류의 계약이라 8개 라우트를 한자리에서 고정한다.
 */

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  includes: [] as (readonly AdminCatalogRecordKind[] | undefined)[],
  guard: vi.fn(),
  catalogRecords: vi.fn(),
  catalogSnapshot: vi.fn(),
  drawTicketGrants: vi.fn(),
  goodList: vi.fn(),
  goodRecord: vi.fn(),
  ipOptions: vi.fn(),
  ipList: vi.fn(),
  ipRecord: vi.fn(),
  verticals: vi.fn(),
  variantEditor: vi.fn(),
  screens: {
    good: vi.fn(() => null),
    ip: vi.fn(() => null),
    card: vi.fn(() => null),
    cardPool: vi.fn(() => null),
    rewardPolicy: vi.fn(() => null),
    drawTicketGrant: vi.fn(() => null),
    game: vi.fn(() => null),
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
vi.mock('@/lib/catalog', () => ({
  getCatalogSnapshot: mocks.catalogSnapshot,
}));
/* 굿즈·IP 목록은 전량 로더가 아니라 RPC 페이지 로더를 쓴다(1,000행 절단 회피). */
vi.mock('@/lib/admin/catalog-list.server', () => ({
  getAdminGoodList: mocks.goodList,
  getAdminGoodRecord: mocks.goodRecord,
  getAdminIpOptions: mocks.ipOptions,
  getAdminIpList: mocks.ipList,
  getAdminIpRecord: mocks.ipRecord,
  getAdminVerticals: mocks.verticals,
}));
vi.mock('@/lib/admin/variants.server', () => ({
  getAdminGoodVariantEditorData: mocks.variantEditor,
}));
vi.mock('@/lib/admin/draw-ticket-grants.server', () => ({
  getAdminDrawTicketGrants: mocks.drawTicketGrants,
}));
vi.mock('@/components/admin/screens/GoodScreen', () => ({ GoodScreen: mocks.screens.good }));
vi.mock('@/components/admin/screens/IpScreen', () => ({ IpScreen: mocks.screens.ip }));
vi.mock('@/components/admin/screens/CardScreen', () => ({ CardScreen: mocks.screens.card }));
vi.mock('@/components/admin/screens/CardPoolScreen', () => ({ CardPoolScreen: mocks.screens.cardPool }));
vi.mock('@/components/admin/screens/RewardPolicyScreen', () => ({ RewardPolicyScreen: mocks.screens.rewardPolicy }));
/* 이 화면은 래퍼 없이 섹션을 바로 렌더한다 — 섹션이 회원 검색·발급 상태를
 * 이미 자기 안에 들고 있어 래퍼가 통과만 시키는 중간자였다. */
vi.mock('@/components/admin/sections/DrawTicketGrantSection', () => ({
  DrawTicketGrantSection: mocks.screens.drawTicketGrant,
}));
vi.mock('@/components/admin/screens/GameScreen', () => ({ GameScreen: mocks.screens.game }));
vi.mock('@/components/admin/screens/EventScreen', () => ({ EventScreen: mocks.screens.event }));
vi.mock('@/components/admin/screens/TicketTypeScreen', () => ({ TicketTypeScreen: mocks.screens.ticketType }));

const { default: AdminCatalogGoodsPage } = await import('./goods/page');
const { default: AdminCatalogIpsPage } = await import('./ips/page');
const { default: AdminCatalogCardsPage } = await import('./cards/page');
const { default: AdminCatalogPoolsPage } = await import('./pools/page');
const { default: AdminCatalogPoliciesPage } = await import('./policies/page');
const { default: AdminCatalogGrantsPage } = await import('./grants/page');
const { default: AdminCatalogGamesPage } = await import('./games/page');
const { default: AdminCatalogEventsPage } = await import('./events/page');
const { default: AdminCatalogTicketTypesPage } = await import('./ticket-types/page');

const emptyRecords = {
  ips: [],
  goods: [],
  cards: [],
  cardPools: [],
  rewardPolicies: [],
  games: [],
  events: [],
  ticketTypes: [],
};

function searchParams(query: Record<string, string | string[] | undefined> = {}) {
  return Promise.resolve(query);
}

const emptyGoodList = { rows: [], total: 0, counts: { all: 0, selling: 0, low: 0, soldout: 0, archived: 0 }, page: 1, size: 20 };
const emptyIpList = { rows: [], total: 0, counts: { all: 0, active: 0, archived: 0 }, page: 1, size: 20 };
const goodRecord = { id: 'g100', ipId: 'hwasan', name: '아크릴 스탠드', archivedAt: null };

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
    mocks.catalogSnapshot.mockReset();
    mocks.catalogSnapshot.mockImplementation(async () => {
      mocks.order.push('snapshot');
      return { verticals: [], ips: [] };
    });
    mocks.drawTicketGrants.mockReset();
    mocks.drawTicketGrants.mockImplementation(async () => {
      mocks.order.push('grants');
      return [];
    });
    mocks.goodList.mockReset();
    mocks.goodList.mockImplementation(async () => {
      mocks.order.push('goodList');
      return emptyGoodList;
    });
    mocks.goodRecord.mockReset();
    mocks.goodRecord.mockImplementation(async () => {
      mocks.order.push('goodRecord');
      return null;
    });
    mocks.ipOptions.mockReset();
    mocks.ipOptions.mockResolvedValue([]);
    mocks.ipList.mockReset();
    mocks.ipList.mockImplementation(async () => {
      mocks.order.push('ipList');
      return emptyIpList;
    });
    mocks.ipRecord.mockReset();
    mocks.ipRecord.mockResolvedValue(null);
    mocks.verticals.mockReset();
    mocks.verticals.mockResolvedValue([]);
    mocks.variantEditor.mockReset();
    mocks.variantEditor.mockResolvedValue(null);
  });

  it.each([
    ['/admin/catalog/cards', () => AdminCatalogCardsPage({ searchParams: searchParams() }), ['cards', 'ips', 'cardPools']],
    ['/admin/catalog/pools', () => AdminCatalogPoolsPage(), ['cardPools', 'cards', 'ips']],
    ['/admin/catalog/policies', () => AdminCatalogPoliciesPage(), ['rewardPolicies', 'goods', 'cardPools', 'ips']],
    ['/admin/catalog/grants', () => AdminCatalogGrantsPage(), ['cardPools']],
    ['/admin/catalog/games', () => AdminCatalogGamesPage(), ['games', 'events', 'cardPools']],
    ['/admin/catalog/events', () => AdminCatalogEventsPage(), ['events', 'ips']],
    ['/admin/catalog/ticket-types', () => AdminCatalogTicketTypesPage(), ['ticketTypes', 'events']],
  ])('%s는 권한 게이트를 먼저 통과한 뒤 자기 화면 데이터만 불러온다', async (pathname, render, include) => {
    await render();

    /* 게이트가 첫 await 여야 한다 — 로더가 먼저 돌면 비스태프도 쿼리를 실행시킨다. */
    expect(mocks.order[0]).toBe(`guard:${pathname}`);
    expect(mocks.order.slice(1)).not.toContain(`guard:${pathname}`);
    expect(mocks.includes).toEqual([include]);
  });

  /* 목록은 전량 로더가 아니라 페이지 로더를 부른다 — 전량 select 는 1,000행에서 잘린다. */
  it.each([
    ['/admin/catalog/goods', () => AdminCatalogGoodsPage({ searchParams: searchParams() }), 'goodList'],
    ['/admin/catalog/ips', () => AdminCatalogIpsPage({ searchParams: searchParams() }), 'ipList'],
  ])('%s 목록은 권한 게이트 뒤에 페이지 로더만 부른다', async (pathname, render, loader) => {
    await render();

    expect(mocks.order[0]).toBe(`guard:${pathname}`);
    expect(mocks.order).toContain(loader);
    expect(mocks.catalogRecords).not.toHaveBeenCalled();
    expect(mocks.catalogSnapshot).not.toHaveBeenCalled();
  });

  it('굿즈 목록 화면은 페이지 로더 결과와 재고 조정 멱등 키를 내려준다', async () => {
    const screen = await AdminCatalogGoodsPage({ searchParams: searchParams({ ip: 'hwasan' }) });

    expect(screen.type).toBe(mocks.screens.good);
    expect(mocks.goodList).toHaveBeenCalledWith(expect.objectContaining({ ip: 'hwasan', tab: 'all', page: 1 }));
    /* IP 선택지는 필터 중인 IP 를 항상 포함해서 받는다. */
    expect(mocks.ipOptions).toHaveBeenCalledWith({ selectedId: 'hwasan' });
    expect(screen.props.catalogIps).toEqual([]);
    expect(screen.props.adjustmentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.props.filters).toMatchObject({ tab: 'all', page: 1, selected: null });
    expect(screen.props.list).toBe(emptyGoodList);
    expect(screen.props.records).toEqual([]);
  });

  it('굿즈 편집 화면은 그 레코드 하나와 미리보기 스냅샷만 읽는다', async () => {
    mocks.goodRecord.mockResolvedValue(goodRecord);

    const screen = await AdminCatalogGoodsPage({ searchParams: searchParams({ selected: 'g100' }) });

    expect(mocks.goodRecord).toHaveBeenCalledWith('g100');
    expect(mocks.goodList).not.toHaveBeenCalled();
    expect(mocks.catalogSnapshot).toHaveBeenCalledWith({ previewDefaultSource: 'supabase' });
    expect(mocks.ipOptions).toHaveBeenCalledWith({ selectedId: 'hwasan' });
    expect(screen.props.records).toEqual([goodRecord]);
    expect(screen.props.list).toMatchObject({ rows: [], total: 0 });
    /* 옵션·품목·재고 표는 저장된 굿즈에만 있다. */
    expect(mocks.variantEditor).toHaveBeenCalledWith('g100');
    expect(screen.props.variantBatchId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('낡은 selected 링크는 목록으로 돌아가고, 복사해서 등록은 원본만 읽는다', async () => {
    const stale = await AdminCatalogGoodsPage({ searchParams: searchParams({ selected: 'g999' }) });
    expect(mocks.goodRecord).toHaveBeenCalledWith('g999');
    expect(mocks.goodList).toHaveBeenCalledTimes(1);
    expect(stale.props.records).toEqual([]);
    expect(stale.props.filters.selected).toBe('g999');

    mocks.goodRecord.mockResolvedValue(goodRecord);
    const copying = await AdminCatalogGoodsPage({ searchParams: searchParams({ selected: 'new', copyFrom: 'g100' }) });
    expect(mocks.goodRecord).toHaveBeenLastCalledWith('g100');
    expect(mocks.goodList).toHaveBeenCalledTimes(1);
    expect(copying.props.records).toEqual([goodRecord]);
    expect(mocks.ipOptions).toHaveBeenLastCalledWith({ selectedId: 'hwasan' });
  });

  /* 목록 조건과 편집 대상은 URL이 정한다 — 화면 로컬 상태가 아니다. */
  it('굿즈·IP 화면은 URL의 목록 조건과 편집 대상을 좁혀서 내려준다', async () => {
    mocks.goodRecord.mockResolvedValue(goodRecord);
    const editing = await AdminCatalogGoodsPage({
      searchParams: searchParams({ selected: 'g100', tab: 'soldout', sort: 'price', dir: 'desc', page: '2' }),
    });
    const creating = await AdminCatalogIpsPage({ searchParams: searchParams({ selected: 'new', tab: 'nope' }) });

    expect(editing.props.filters).toMatchObject({ selected: 'g100', tab: 'soldout', sort: 'price', dir: 'desc', page: 2 });
    expect(editing.key).toBe('g100');
    expect(creating.type).toBe(mocks.screens.ip);
    expect(creating.props.filters).toMatchObject({ selected: 'new', tab: 'all' });
    expect(creating.props.list).toMatchObject({ counts: { all: 0, active: 0, archived: 0 } });
    expect(mocks.ipRecord).not.toHaveBeenCalled();
    expect(mocks.ipList).not.toHaveBeenCalled();
    expect(mocks.verticals).toHaveBeenCalledTimes(1);
  });

  /* 카드풀 화면의 "카드 편집" 링크(`?cardId=`)가 도착하는 지점이다. */
  it('카드 화면은 cardId 쿼리를 초기 선택값으로 넘긴다', async () => {
    const selected = await AdminCatalogCardsPage({ searchParams: searchParams({ cardId: 'c100' }) });
    const repeated = await AdminCatalogCardsPage({ searchParams: searchParams({ cardId: ['c100', 'c200'] }) });
    const none = await AdminCatalogCardsPage({ searchParams: searchParams() });

    expect(selected.props.initialSelectedId).toBe('c100');
    /* 중복 쿼리는 배열로 온다 — 어느 한쪽을 임의로 고르지 않고 선택 없이 연다. */
    expect(repeated.props.initialSelectedId).toBeNull();
    expect(none.props.initialSelectedId).toBeNull();
  });

  /*
   * 멱등 키와 draft 기준 시각은 서버 컴포넌트가 요청당 한 번 만든다.
   * 화면 래퍼(클라이언트)에서 만들면 리렌더마다 값이 바뀌어 같은 저장이 두 번 먹힌다.
   */
  it('멱등 키를 서버에서 만들어 화면마다 서로 다른 값으로 내려준다', async () => {
    const pools = await AdminCatalogPoolsPage();
    const policies = await AdminCatalogPoliciesPage();
    const games = await AdminCatalogGamesPage();
    const ticketTypes = await AdminCatalogTicketTypesPage();
    const grants = await AdminCatalogGrantsPage();

    const poolKeys = [pools.props.draftId, pools.props.oddsOperationId, pools.props.operationId];
    expect(new Set(poolKeys).size).toBe(3);
    expect(Number.isNaN(Date.parse(pools.props.draftActiveFrom))).toBe(false);
    expect(new Set([policies.props.draftId, policies.props.operationId]).size).toBe(2);
    expect(new Set([games.props.endOperationId, games.props.operationId]).size).toBe(2);
    expect(new Set([ticketTypes.props.draftId, ticketTypes.props.operationId]).size).toBe(2);
    expect(grants.props.draftOperationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('카드팩 수동 발급 화면은 발급 이력 로더를 함께 부른다', async () => {
    const screen = await AdminCatalogGrantsPage();

    expect(screen.type).toBe(mocks.screens.drawTicketGrant);
    expect(mocks.drawTicketGrants).toHaveBeenCalledTimes(1);
    expect(screen.props.grants).toEqual([]);
  });
});
