import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminCatalogRecords } from './catalog.server';

const mocks = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@/lib/supabase/server', () => ({ createClient: () => mocks.client }));

type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: { message: string } | null };

interface QueryRecord {
  table: string;
  select: string | null;
  order: Array<[string, { ascending?: boolean } | undefined]>;
  limit: Array<[number, { referencedTable?: string } | undefined]>;
}

function createClient({
  errors = {},
  records,
  rpcErrors = {},
  rpcRecords = [],
  rpcRows = {},
  rows = {},
}: {
  errors?: Record<string, string>;
  records: QueryRecord[];
  rpcErrors?: Record<string, string>;
  rpcRecords?: string[];
  rpcRows?: Record<string, Row[]>;
  rows?: Record<string, Row[]>;
}) {
  return {
    from(table: string) {
      const record: QueryRecord = { table, select: null, order: [], limit: [] };
      records.push(record);
      let selectedId: string | undefined;
      const resolve = (): Result => ({
        data: selectedId ? (rows[table] ?? []).filter((row) => row.id === selectedId) : rows[table] ?? [],
        error: errors[table] ? { message: errors[table] } : null,
      });
      const query = {
        eq(column: string, value: string) {
          if (column === 'id') selectedId = value;
          return query;
        },
        select(columns: string) {
          record.select = columns;
          return query;
        },
        order(column: string, options?: { ascending?: boolean }) {
          record.order.push([column, options]);
          return query;
        },
        limit(count: number, options?: { referencedTable?: string }) {
          record.limit.push([count, options]);
          return query;
        },
        then<TResult1 = Result, TResult2 = never>(
          onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return Promise.resolve(resolve()).then(onfulfilled, onrejected);
        },
      };
      return query;
    },
    rpc(name: string) {
      rpcRecords.push(name);
      return Promise.resolve({
        data: rpcRows[name] ?? [],
        error: rpcErrors[name] ? { message: rpcErrors[name] } : null,
      });
    },
    storage: {
      from(bucket: string) {
        if (bucket !== 'public-media') throw new Error(`Unexpected bucket ${bucket}`);
        return {
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://cdn.example/public-media/${path}` } };
          },
        };
      },
    },
  };
}

describe('getAdminCatalogRecords', () => {
  beforeEach(() => {
    mocks.client = null;
  });

  it('preserves stored artwork paths and exposes their public preview URLs', async () => {
    mocks.client = createClient({
      records: [],
      rows: {
        ips: [{
          id: 'hwasan',
          title: '화산강림',
          sub: null,
          vertical_key: 'rofan',
          tagline: null,
          synopsis: null,
          glyph: null,
          bg: null,
          image_path: 'public-media/catalog/ip/11111111-1111-4111-8111-111111111111.webp',
          featured: true,
          fans_count: 0,
        }],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(result.ips[0]).toMatchObject({
      imagePath: 'public-media/catalog/ip/11111111-1111-4111-8111-111111111111.webp',
      imageUrl: 'https://cdn.example/public-media/catalog/ip/11111111-1111-4111-8111-111111111111.webp',
    });
  });

  /*
   * 아트워크를 Storage에 올리기 전 레코드는 이미지가 `bg` 안에만 있다.
   * 공개 화면은 그 값을 그대로 그리는데 어드민만 빈 칸이면 운영자가 레코드를 식별할 수 없다.
   */
  it('아트워크 경로가 없으면 bg 안의 이미지로 미리보기를 채운다', async () => {
    mocks.client = createClient({
      records: [],
      rows: {
        ips: [{
          id: 'rilakkuma',
          bg: 'url("/generated/ip/rilakkuma.png") center / cover no-repeat, linear-gradient(150deg, #5a3517, #D68A2D 55%, #FFD84D)',
          image_path: null,
        }],
        goods: [{
          id: 'g1',
          bg: 'url("/generated/goods/g1.png") center / cover no-repeat, linear-gradient(150deg, #5a3517, #D68A2D 55%, #FFD84D)',
          image_path: null,
        }],
        events: [{
          id: 'e1',
          bg: 'url("/generated/events/e1.png") center / cover no-repeat, linear-gradient(150deg, #5a3517, #D68A2D 55%, #FFD84D)',
          image_path: null,
        }],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(result.ips[0]).toMatchObject({ imagePath: null, imageUrl: '/generated/ip/rilakkuma.png' });
    expect(result.goods[0]).toMatchObject({ imagePath: null, imageUrl: '/generated/goods/g1.png' });
    expect(result.events[0]).toMatchObject({ imagePath: null, imageUrl: '/generated/events/e1.png' });
  });

  /* gradient만 담은 bg는 이미지가 아니다 — 없는 아트워크를 있는 것처럼 만들지 않는다. */
  it('bg가 gradient뿐이면 미리보기를 만들지 않는다', async () => {
    mocks.client = createClient({
      records: [],
      rows: {
        ips: [{ id: 'no-art', bg: 'linear-gradient(150deg, #2A2440, #4A3F73)', image_path: null }],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(result.ips[0]).toMatchObject({ imagePath: null, imageUrl: null });
  });

  it('loads active and archived catalog records with their archived timestamps', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        ips: [
          {
            id: 'active-ip',
            title: '운영 IP',
            sub: null,
            vertical_key: 'webtoon',
            tagline: null,
            synopsis: null,
            glyph: null,
            bg: null,
            image_path: null,
            featured: true,
            fans_count: 3,
            archived_at: null,
          },
          {
            id: 'archived-ip',
            title: '보관 IP',
            sub: null,
            vertical_key: 'webtoon',
            tagline: null,
            synopsis: null,
            glyph: null,
            bg: null,
            image_path: null,
            featured: false,
            fans_count: 0,
            archived_at: '2026-07-17T01:02:03.000Z',
          },
        ],
        goods: [
          {
            id: 'active-good',
            ip_id: 'active-ip',
            name: '운영 굿즈',
            type: '아크릴',
            price: 1000,
            badge: null,
            stock: 'ok',
            stock_qty: 2,
            bg: null,
            image_path: null,
            archived_at: null,
          },
          {
            id: 'archived-good',
            ip_id: 'archived-ip',
            name: '보관 굿즈',
            type: '아크릴',
            price: 1000,
            badge: null,
            stock: 'soldout',
            stock_qty: 0,
            bg: null,
            image_path: null,
            archived_at: '2026-07-17T02:02:03.000Z',
          },
        ],
        events: [
          {
            id: 'active-event',
            ip_id: 'active-ip',
            title: '운영 이벤트',
            mode: '온라인',
            status: '예정',
            starts_at: null,
            ends_at: null,
            location: null,
            accent: null,
            bg: null,
            image_path: null,
            archived_at: null,
          },
          {
            id: 'archived-event',
            ip_id: 'archived-ip',
            title: '보관 이벤트',
            mode: '오프라인',
            status: '종료',
            starts_at: null,
            ends_at: null,
            location: null,
            accent: null,
            bg: null,
            image_path: null,
            archived_at: '2026-07-17T04:02:03.000Z',
          },
        ],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(result.ips.map(({ id, archivedAt }) => ({ id, archivedAt }))).toEqual([
      { id: 'active-ip', archivedAt: null },
      { id: 'archived-ip', archivedAt: '2026-07-17T01:02:03.000Z' },
    ]);
    expect(result.goods.map(({ id, archivedAt }) => ({ id, archivedAt }))).toEqual([
      { id: 'active-good', archivedAt: null },
      { id: 'archived-good', archivedAt: '2026-07-17T02:02:03.000Z' },
    ]);
    expect(result.events.map(({ id, archivedAt }) => ({ id, archivedAt }))).toEqual([
      { id: 'active-event', archivedAt: null },
      { id: 'archived-event', archivedAt: '2026-07-17T04:02:03.000Z' },
    ]);

    for (const table of ['ips', 'goods', 'events']) {
      expect(records.find((record) => record.table === table)?.select).toContain('archived_at');
    }
  });

  /* 게시 상태(20260907130000) — 어드민은 초안까지 전부 보되, 상태를 가릴 수 있어야 한다. */
  it('loads the IP publish timestamp so the console can tell drafts from published IPs', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        ips: [
          { id: 'draft-ip', title: '초안 IP', vertical_key: 'webtoon', featured: false, fans_count: 0, archived_at: null, published_at: null },
          { id: 'live-ip', title: '공개 IP', vertical_key: 'webtoon', featured: false, fans_count: 0, archived_at: null, published_at: '2026-09-07T04:00:00.000Z' },
        ],
      },
    });

    const result = await getAdminCatalogRecords({ include: ['ips'] });

    expect(records.find((record) => record.table === 'ips')?.select).toContain('published_at');
    expect(result.ips.map(({ id, publishedAt }) => ({ id, publishedAt }))).toEqual([
      { id: 'draft-ip', publishedAt: null },
      { id: 'live-ip', publishedAt: '2026-09-07T04:00:00.000Z' },
    ]);
  });

  /* 정가는 어드민 폼의 기본값이자 미리보기의 할인 표기 근거다 — 목록 select 에서
     빠지면 운영자가 저장한 할인이 다음 편집에서 조용히 지워진다(#326). */
  it('굿즈 목록에 정가를 싣는다', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        goods: [
          { id: 'on-sale', compare_at_price: 26000 },
          { id: 'not-on-sale', compare_at_price: null },
        ],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(records.find((record) => record.table === 'goods')?.select)
      .toContain('compare_at_price');
    expect(result.goods.map(({ id, compareAtPrice }) => ({ id, compareAtPrice }))).toEqual([
      { id: 'on-sale', compareAtPrice: 26000 },
      { id: 'not-on-sale', compareAtPrice: null },
    ]);
  });

  it('굿즈 목록에 검색 키워드와 공통 진열 순서를 싣는다', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        goods: [{ id: 'ordered-good', search_keywords: ['여름 굿즈', 'KUMA'], display_order: 7 }],
      },
    });

    const result = await getAdminCatalogRecords({ include: ['goods'] });

    expect(records.find((record) => record.table === 'goods')?.select)
      .toContain('search_keywords,display_order');
    expect(result.goods[0]).toMatchObject({
      searchKeywords: ['여름 굿즈', 'KUMA'],
      displayOrder: 7,
    });
  });

  /* D5②·m27 접합: 편집기는 goods.option_sale_mode로 랜덤 판매 상품의 옵션별 제한 입력을 막고,
     판매 방식 패널은 goods.updated_at이 바뀌면 낙관 잠금 값을 다시 읽는다. */
  it('굿즈 목록에 판매 방식과 수정 시각을 싣고, 판매 방식이 없으면 옵션 선택 판매로 본다', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        goods: [
          { id: 'random-good', option_sale_mode: 'random', updated_at: '2026-10-28T03:00:00.000Z' },
          { id: 'select-good', option_sale_mode: 'select', updated_at: '2026-10-28T04:00:00.000Z' },
          { id: 'legacy-good' },
        ],
      },
    });

    const result = await getAdminCatalogRecords({ include: ['goods'] });

    expect(records.find((record) => record.table === 'goods')?.select).toMatch(/(^|,)option_sale_mode(,|$)/);
    expect(records.find((record) => record.table === 'goods')?.select).toMatch(/(^|,)updated_at(,|$)/);
    expect(result.goods.map(({ id, optionSaleMode, updatedAt }) => ({ id, optionSaleMode, updatedAt }))).toEqual([
      { id: 'random-good', optionSaleMode: 'random', updatedAt: '2026-10-28T03:00:00.000Z' },
      { id: 'select-good', optionSaleMode: 'select', updatedAt: '2026-10-28T04:00:00.000Z' },
      { id: 'legacy-good', optionSaleMode: 'select', updatedAt: undefined },
    ]);
  });

  it('loads ticket history counts and maps event titles for the ticket console', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        events: [{
          id: 'e100',
          ip_id: null,
          title: '화산강림 팝업',
          mode: '오프라인',
          status: '예정',
          starts_at: null,
          ends_at: null,
          location: '성수',
          accent: '#8B5CFF',
          bg: null,
          image_path: null,
        }],
        ticket_types: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            event_id: 'e100',
            name: '7월 25일 1회차',
            price: 25000,
            capacity: 80,
            sold: 12,
            tickets: [{ id: '33333333-3333-4333-8333-333333333333' }],
            updated_at: '2026-07-14T12:00:00.000Z',
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            event_id: 'missing-event',
            name: '이력 없는 회차',
            price: 0,
            capacity: 0,
            sold: 0,
            tickets: [],
            updated_at: '2026-07-14T13:00:00.000Z',
          },
        ],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(result.ticketTypes).toEqual([
      {
        id: '11111111-1111-4111-8111-111111111111',
        eventId: 'e100',
        eventTitle: '화산강림 팝업',
        name: '7월 25일 1회차',
        price: 25000,
        capacity: 80,
        sold: 12,
        hasTicketHistory: true,
        updatedAt: '2026-07-14T12:00:00.000Z',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        eventId: 'missing-event',
        eventTitle: 'missing-event',
        name: '이력 없는 회차',
        price: 0,
        capacity: 0,
        sold: 0,
        hasTicketHistory: false,
        updatedAt: '2026-07-14T13:00:00.000Z',
      },
    ]);
    expect(records.find((record) => record.table === 'ticket_types')).toEqual({
      table: 'ticket_types',
      select: 'id,event_id,name,price,capacity,sold,updated_at,tickets(id)',
      order: [['event_id', undefined], ['name', undefined]],
      limit: [[1, { referencedTable: 'tickets' }]],
    });
  });

  it('fails closed when the ticket session query fails', async () => {
    mocks.client = createClient({
      errors: { ticket_types: 'ticket query unavailable' },
      records: [],
    });

    await expect(getAdminCatalogRecords()).rejects.toThrow(
      'Failed to load admin ticket types: ticket query unavailable',
    );
  });

  /*
   * 화면별 라우트가 갈라지기 전에는 어떤 화면을 열어도 모든 종류의 쿼리가 전부 나갔다.
   * include는 그 낭비를 막는 계약이므로 "요청하지 않은 테이블은 건드리지 않는다"를 고정한다.
   */
  it('include에 없는 종류는 쿼리하지 않는다', async () => {
    const records: QueryRecord[] = [];
    const rpcRecords: string[] = [];
    mocks.client = createClient({ records, rpcRecords, rows: { ips: [{ id: 'hwasan' }] } });

    const result = await getAdminCatalogRecords({ include: ['ips'] });

    expect(records.map((record) => record.table)).toEqual(['ips']);
    expect(rpcRecords).toEqual([]);
    expect(result.ips).toHaveLength(1);
    expect(result.goods).toEqual([]);
    expect(result).not.toHaveProperty('cards');
    expect(result.events).toEqual([]);
    expect(result.ticketTypes).toEqual([]);
  });

  /* include를 생략한 호출부(레거시 어드민 페이지)가 조용히 빈 화면이 되지 않아야 한다. */
  it('include를 생략하면 모든 종류를 조회해 돌려주고 카드·게임 표는 읽지 않는다', async () => {
    const records: QueryRecord[] = [];
    const rpcRecords: string[] = [];
    mocks.client = createClient({
      records,
      rpcRecords,
      rows: {
        ips: [{ id: 'hwasan' }],
        goods: [{ id: 'g1', ip_id: 'hwasan' }],
        events: [{ id: 'e1', title: '화산강림 팝업' }],
        ticket_types: [{ id: 't1', event_id: 'e1', name: '1회차', price: 0, capacity: 1, sold: 0 }],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(records.map((record) => record.table).sort()).toEqual([
      'events',
      'goods',
      'ips',
      'ticket_types',
    ]);
    expect(rpcRecords).toEqual([]);
    expect(Object.entries(result).every(([, value]) => value.length === 1)).toBe(true);
  });

  /*
   * 파생값이 다른 종류의 행을 본다 — 티켓 회차 제목은 events 다.
   * include를 곧이곧대로 따르면 화면은 조용히 틀린 값(제목 대신 id)을 본다.
   */
  it('파생에 필요한 종류는 조회하되 반환하지는 않는다', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        events: [{ id: 'e1', title: '화산강림 팝업' }],
        ticket_types: [{ id: 't1', event_id: 'e1', name: '1회차', price: 0, capacity: 1, sold: 0 }],
      },
    });

    const result = await getAdminCatalogRecords({ include: ['ticketTypes'] });

    expect(records.map((record) => record.table).sort()).toEqual(['events', 'ticket_types']);
    expect(result.ticketTypes[0].eventTitle).toBe('화산강림 팝업');
    expect(result.events).toEqual([]);
  });

});

it('loads only the exact goods editor target, including records outside the list page', async () => {
  mocks.client = createClient({ records: [], rows: { goods: [{ id: 'g1' }, { id: 'g999' }] } });
  const result = await getAdminCatalogRecords({ include: ['goods'], goodId: 'g999' });
  expect(result.goods.map((good) => good.id)).toEqual(['g999']);
});
