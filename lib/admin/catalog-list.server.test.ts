import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminGoodListFilters, AdminIpListFilters } from './catalog-list';
import {
  adminGoodCountArgs,
  adminGoodSearchArgs,
  adminIpSearchArgs,
  clampAdminListPage,
  getAdminGoodList,
  getAdminGoodRecord,
  getAdminIpList,
  getAdminIpOptions,
  getAdminVerticals,
} from './catalog-list.server';

const mocks = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@/lib/supabase/server', () => ({ createClient: () => mocks.client }));

type Row = Record<string, unknown>;

interface RpcCall {
  name: string;
  args: Row;
}

/**
 * RPC 는 이름별 응답을 큐로 준다 — 같은 RPC 가 두 번 불리는 경로(페이지 클램프 재조회)를
 * 첫 응답·둘째 응답으로 구분해 검증한다. 큐가 비면 마지막 응답을 되풀이한다.
 */
function createClient({
  calls,
  rpcErrors = {},
  rpcQueues = {},
  rows = {},
}: {
  calls: RpcCall[];
  rpcErrors?: Record<string, string>;
  rpcQueues?: Record<string, Row[][]>;
  rows?: Record<string, Row | null>;
}) {
  const queues = Object.fromEntries(Object.entries(rpcQueues).map(([name, queue]) => [name, [...queue]]));
  return {
    rpc(name: string, args: Row) {
      calls.push({ name, args });
      const queue = queues[name] ?? [];
      const data = queue.length > 1 ? queue.shift() : queue[0];
      return Promise.resolve({
        data: data ?? [],
        error: rpcErrors[name] ? { message: rpcErrors[name] } : null,
      });
    },
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        maybeSingle: () => Promise.resolve({ data: rows[table] ?? null, error: null }),
        then<T>(onfulfilled: (value: { data: Row[]; error: null }) => T) {
          return Promise.resolve({ data: rows[table] ? [rows[table]] : [], error: null }).then(onfulfilled);
        },
      };
      return query;
    },
    storage: {
      from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }) }),
    },
  };
}

function goodFilters(overrides: Partial<AdminGoodListFilters> = {}): AdminGoodListFilters {
  return {
    tab: 'all',
    ip: '',
    type: '',
    stock: 'all',
    field: 'all',
    query: '',
    sort: null,
    dir: 'asc',
    page: 1,
    size: 20,
    selected: null,
    copyFrom: null,
    ...overrides,
  };
}

function ipFilters(overrides: Partial<AdminIpListFilters> = {}): AdminIpListFilters {
  return { tab: 'all', vertical: '', query: '', sort: null, dir: 'asc', page: 1, size: 20, selected: null, ...overrides };
}

const goodRow = {
  id: 'g9',
  archived_at: null,
  ip_id: 'hwasan',
  ip_title: '화산귀환',
  name: '아크릴 스탠드',
  type: '아크릴',
  price: 12000,
  compare_at_price: null,
  badge: null,
  stock: 'low',
  stock_qty: 3,
  allow_bank_transfer: null,
  bg: "url('/media/g9.png')",
  image_path: null,
  notice_maker: null,
  notice_origin: null,
  notice_material: null,
  notice_size: null,
  notice_made_on: null,
  notice_as_manager: null,
  notice_as_contact: null,
  description: null,
  gallery_paths: ['goods/g9-1.png'],
  detail_image_path: null,
  list_status: 'low',
  updated_at: '2026-09-04T00:00:00Z',
  total_count: 45,
};

const goodCounts = { all_count: 45, selling_count: 30, low_count: 10, soldout_count: 3, archived_count: 2 };

describe('adminGoodSearchArgs', () => {
  it('URL 필터를 RPC 인자로 옮긴다 — 정렬 키 stockQty 는 stock_qty, 페이지는 offset', () => {
    expect(adminGoodSearchArgs(goodFilters({
      tab: 'low', field: 'name', query: '키링', ip: 'hwasan', stock: 'zero', sort: 'stockQty', dir: 'desc', page: 3, size: 50,
    }))).toEqual({
      p_tab: 'low',
      p_field: 'name',
      p_query: '키링',
      p_ip_id: 'hwasan',
      p_type: null,
      p_stock: 'zero',
      p_sort: 'stock_qty',
      p_dir: 'desc',
      p_limit: 50,
      p_offset: 100,
    });
  });

  it('정렬이 없으면 id 오름차순이고, 탭 건수 인자에는 탭·정렬·페이지가 없다', () => {
    expect(adminGoodSearchArgs(goodFilters({ dir: 'desc' }))).toMatchObject({ p_sort: 'id', p_dir: 'asc', p_offset: 0 });
    expect(adminGoodCountArgs(goodFilters({ tab: 'soldout', query: 'a', type: '키링', page: 4 }))).toEqual({
      p_field: 'all', p_query: 'a', p_ip_id: null, p_type: '키링', p_stock: 'all',
    });
    expect(adminIpSearchArgs(ipFilters({ sort: 'fans', dir: 'desc', vertical: 'blgl', page: 2 }))).toEqual({
      p_tab: 'all', p_query: null, p_vertical: 'blgl', p_sort: 'fans', p_dir: 'desc', p_limit: 20, p_offset: 20,
    });
  });

  it('총 건수 밖의 페이지는 마지막 페이지로 당긴다', () => {
    expect(clampAdminListPage(9, 45, 20)).toBe(3);
    expect(clampAdminListPage(2, 45, 20)).toBe(2);
    expect(clampAdminListPage(5, 0, 20)).toBe(1);
  });
});

describe('getAdminGoodList', () => {
  let calls: RpcCall[];

  beforeEach(() => {
    calls = [];
  });

  it('검색 RPC 와 탭 건수 RPC 를 같은 조건으로 부르고 기존 목록 모양으로 조립한다', async () => {
    mocks.client = createClient({
      calls,
      rpcQueues: { admin_search_goods: [[goodRow]], admin_goods_tab_counts: [[goodCounts]] },
    });

    const list = await getAdminGoodList(goodFilters({ tab: 'low', query: '스탠드' }));

    expect(calls.map((call) => call.name)).toEqual(['admin_search_goods', 'admin_goods_tab_counts']);
    expect(calls[0].args).toMatchObject({ p_tab: 'low', p_query: '스탠드' });
    expect(calls[1].args).toEqual({ p_field: 'all', p_query: '스탠드', p_ip_id: null, p_type: null, p_stock: 'all' });
    expect(list.counts).toEqual({ all: 45, selling: 30, low: 10, soldout: 3, archived: 2 });
    /* 총 건수는 현재 탭의 건수다(검색 안에서). */
    expect(list.total).toBe(10);
    expect(list.page).toBe(1);
    expect(list.size).toBe(20);
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0].tab).toBe('low');
    expect(list.rows[0].ipTitle).toBe('화산귀환');
    expect(list.rows[0].good).toMatchObject({
      id: 'g9',
      ipId: 'hwasan',
      stockQty: 3,
      allowBankTransfer: true,
      imageUrl: '/media/g9.png',
      galleryUrls: ['https://cdn.test/goods/g9-1.png'],
    });
  });

  it('총 건수 밖의 페이지를 열면 마지막 페이지를 다시 읽는다', async () => {
    mocks.client = createClient({
      calls,
      rpcQueues: { admin_search_goods: [[], [goodRow]], admin_goods_tab_counts: [[goodCounts]] },
    });

    const list = await getAdminGoodList(goodFilters({ page: 9 }));

    const searches = calls.filter((call) => call.name === 'admin_search_goods');
    expect(searches.map((call) => call.args.p_offset)).toEqual([160, 40]);
    expect(list.page).toBe(3);
    expect(list.rows).toHaveLength(1);
  });

  it('빈 결과는 다시 읽지 않는다', async () => {
    mocks.client = createClient({
      calls,
      rpcQueues: { admin_goods_tab_counts: [[{ ...goodCounts, all_count: 0, selling_count: 0, low_count: 0, soldout_count: 0, archived_count: 0 }]] },
    });

    const list = await getAdminGoodList(goodFilters({ page: 4 }));

    expect(calls.filter((call) => call.name === 'admin_search_goods')).toHaveLength(1);
    /* 메모리 구현 paginate 와 같다 — 빈 목록은 1페이지다. */
    expect(list).toMatchObject({ rows: [], total: 0, page: 1 });
  });

  it('RPC 오류는 메시지를 남기고 던진다', async () => {
    mocks.client = createClient({ calls, rpcErrors: { admin_goods_tab_counts: 'staff required' } });

    await expect(getAdminGoodList(goodFilters())).rejects.toThrow('Failed to load admin goods counts: staff required');
  });
});

describe('getAdminIpList · getAdminIpOptions · 단건 로더', () => {
  let calls: RpcCall[];

  beforeEach(() => {
    calls = [];
  });

  it('IP 목록은 굿즈 수·버티컬 라벨·상태 탭을 RPC 행에서 읽는다', async () => {
    mocks.client = createClient({
      calls,
      rpcQueues: {
        admin_search_ips: [[{
          id: 'hwasan', archived_at: '2026-09-01T00:00:00Z', title: '화산귀환', sub: null, vertical_key: 'rofan',
          vertical_label: '로판', tagline: null, synopsis: null, glyph: null, bg: null, image_path: 'ips/hwasan.png',
          featured: true, fans_count: 12, goods_count: 8, active_goods_count: 7, total_count: 1,
        }]],
        admin_ips_tab_counts: [[{ all_count: 6, active_count: 5, archived_count: 1 }]],
      },
    });

    const list = await getAdminIpList(ipFilters({ tab: 'archived', sort: 'goods', dir: 'desc' }));

    expect(calls[0].args).toMatchObject({ p_tab: 'archived', p_sort: 'goods', p_dir: 'desc' });
    expect(list.counts).toEqual({ all: 6, active: 5, archived: 1 });
    expect(list.total).toBe(1);
    expect(list.rows[0]).toMatchObject({
      tab: 'archived',
      verticalLabel: '로판',
      goodsCount: 8,
      activeGoodsCount: 7,
      ip: { id: 'hwasan', fansCount: 12, imageUrl: 'https://cdn.test/ips/hwasan.png' },
    });
  });

  it('IP 선택지는 선택된 IP 를 끼워 상위 50개를 받는다', async () => {
    mocks.client = createClient({
      calls,
      rpcQueues: { admin_pick_ips: [[{ id: 'old', title: '보관 IP', vertical_key: 'blgl', archived_at: '2026-01-01T00:00:00Z', fans_count: 0, rank: 0 }]] },
    });

    const options = await getAdminIpOptions({ selectedId: 'old' });

    expect(calls[0]).toEqual({ name: 'admin_pick_ips', args: { p_query: null, p_selected_id: 'old', p_limit: 50 } });
    expect(options).toEqual([{ id: 'old', title: '보관 IP', archivedAt: '2026-01-01T00:00:00Z' }]);
  });

  it('단건 로더는 없는 id 에 null, 있으면 레코드 하나를 준다', async () => {
    mocks.client = createClient({ calls, rows: { goods: goodRow, verticals: { key: 'blgl', label: 'BL·GL', color: '#000' } } });

    expect(await getAdminGoodRecord('g9')).toMatchObject({ id: 'g9', stock: 'low', notice: { maker: null } });
    expect(await getAdminVerticals()).toEqual([{ key: 'blgl', label: 'BL·GL', color: '#000' }]);

    mocks.client = createClient({ calls });
    expect(await getAdminGoodRecord('g999')).toBeNull();
  });
});
