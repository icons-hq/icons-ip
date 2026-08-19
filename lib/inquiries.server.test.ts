import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countOpenInquiries,
  loadMyInquiries,
  loadMyInquiryThread,
  resolveInquiryLinkTargets,
} from './inquiries.server';

const USER_ID = '33333333-3333-4333-8333-333333333333';
const INQUIRY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';

interface TableResult {
  data: unknown;
  error: { message: string } | null;
  count?: number;
}

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, TableResult>,
  filters: [] as [string, string, unknown][],
  signedUrl: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from(table: string) {
      const result = () => mocks.tables[table] ?? { data: null, error: null };
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          mocks.filters.push([table, column, value]);
          return query;
        },
        neq: (column: string, value: unknown) => {
          mocks.filters.push([table, column, value]);
          return query;
        },
        order: () => query,
        limit: () => Promise.resolve(result()),
        maybeSingle: () => Promise.resolve(result()),
        then: (resolve: (value: TableResult) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
    storage: { from: () => ({ createSignedUrl: mocks.signedUrl }) },
  }),
}));

beforeEach(() => {
  mocks.tables = {};
  mocks.filters = [];
  mocks.signedUrl.mockReset();
  mocks.signedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.example/a.png' }, error: null });
});

describe('loadMyInquiries', () => {
  /* 앱이 모르는 값 때문에 사용자가 자기가 보낸 문의를 잃어버리면 안 된다. */
  it('모르는 카테고리·상태는 안전한 값으로 접고 행은 남긴다', async () => {
    mocks.tables.inquiries = {
      data: [{
        id: INQUIRY_ID,
        reference: 12,
        category: 'refund',
        title: '제목',
        status: 'escalated',
        order_id: null,
        good_id: null,
        created_at: '2026-08-18T01:00:00.000Z',
        last_message_at: '2026-08-18T01:00:00.000Z',
        answered_at: null,
        closed_at: null,
      }],
      error: null,
    };

    const rows = await loadMyInquiries(USER_ID);

    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('etc');
    expect(rows[0].categoryLabel).toBe('기타');
    expect(rows[0].status).toBe('open');
  });

  it('본인 문의만 읽는다', async () => {
    mocks.tables.inquiries = { data: [], error: null };

    await loadMyInquiries(USER_ID);

    expect(mocks.filters).toContainEqual(['inquiries', 'user_id', USER_ID]);
  });
});

describe('loadMyInquiryThread', () => {
  it('없는 문의는 null이다', async () => {
    mocks.tables.inquiries = { data: null, error: null };

    expect(await loadMyInquiryThread(USER_ID, INQUIRY_ID)).toBeNull();
  });

  /* 이미지 하나 때문에 대화 전체가 사라지는 편이 훨씬 나쁘다. */
  it('서명에 실패한 첨부는 빠지지만 본문은 남는다', async () => {
    mocks.tables.inquiries = {
      data: {
        id: INQUIRY_ID,
        reference: 12,
        category: 'order',
        title: '제목',
        status: 'open',
        order_id: null,
        good_id: null,
        created_at: '2026-08-18T01:00:00.000Z',
        last_message_at: '2026-08-18T01:00:00.000Z',
        answered_at: null,
        closed_at: null,
      },
      error: null,
    };
    mocks.tables.inquiry_messages = {
      data: [{
        id: 'm1',
        author: 'user',
        body: '본문',
        image_paths: [`${USER_ID}/inquiry/x.png`],
        created_at: '2026-08-18T01:00:00.000Z',
      }],
      error: null,
    };
    mocks.signedUrl.mockResolvedValue({ data: null, error: { message: 'nope' } });

    const thread = await loadMyInquiryThread(USER_ID, INQUIRY_ID);

    expect(thread?.messages[0].body).toBe('본문');
    expect(thread?.messages[0].imageUrls).toEqual([]);
  });
});

describe('resolveInquiryLinkTargets', () => {
  /* 남의 주문번호를 URL에 실어도 "주문 …에 연결됨" 확인 문구를 보지 못해야 한다 —
     존재 여부를 알려주는 것 자체가 정보다. */
  it('본인 주문이 아니면 연결을 만들지 않는다', async () => {
    mocks.tables.orders = { data: null, error: null };

    const targets = await resolveInquiryLinkTargets(USER_ID, { orderId: ORDER_ID });

    expect(targets.orderId).toBeNull();
    expect(targets.orderLabel).toBeNull();
    expect(mocks.filters).toContainEqual(['orders', 'user_id', USER_ID]);
  });

  it('본인 주문은 주문번호 축약 표기를 함께 돌려준다', async () => {
    mocks.tables.orders = { data: { id: ORDER_ID }, error: null };

    const targets = await resolveInquiryLinkTargets(USER_ID, { orderId: ORDER_ID });

    expect(targets.orderId).toBe(ORDER_ID);
    expect(targets.orderLabel).toBe('11111111');
  });

  it('굿즈는 공개 카탈로그라 존재 확인만 한다', async () => {
    mocks.tables.goods = { data: { id: 'g13', name: '아크릴 블록' }, error: null };

    const targets = await resolveInquiryLinkTargets(USER_ID, { goodId: 'g13' });

    expect(targets.goodName).toBe('아크릴 블록');
  });
});

describe('countOpenInquiries', () => {
  it('집계에 실패하면 0으로 접는다 — 카드 하나 때문에 마이페이지가 죽지 않는다', async () => {
    mocks.tables.inquiries = { data: null, error: { message: 'boom' } };

    expect(await countOpenInquiries(USER_ID)).toBe(0);
  });
});
