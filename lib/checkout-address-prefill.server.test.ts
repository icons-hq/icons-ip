import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 주소록 읽기와 주문서 배송지 미리 채우기(L7 · MY-11, 10/14 S6a). Supabase 질의는 테이블별 가짜 빌더로 흉내 낸다. */
const mocks = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  errors: {} as Record<string, unknown>,
  calls: [] as { table: string; select?: string; eq: [string, unknown][]; in: [string, unknown[]][]; not: [string, string, unknown][]; order: [string, boolean][]; limit?: number }[],
}));

function query(table: string) {
  const call: (typeof mocks.calls)[number] = { table, eq: [], in: [], not: [], order: [] };
  mocks.calls.push(call);
  const result = () => {
    let rows = [...(mocks.rows[table] ?? [])];
    for (const [column, value] of call.eq) rows = rows.filter((row) => row[column] === value);
    for (const [column, values] of call.in) rows = rows.filter((row) => values.includes(row[column]));
    for (const [column] of call.not) rows = rows.filter((row) => row[column] !== null && row[column] !== undefined);
    rows.sort((left, right) => {
      for (const [column, ascending] of call.order) {
        const a = String(left[column] ?? ''), b = String(right[column] ?? '');
        if (a !== b) return (a < b ? -1 : 1) * (ascending ? 1 : -1);
      }
      return 0;
    });
    return { data: mocks.errors[table] ? null : rows.slice(0, call.limit ?? rows.length), error: mocks.errors[table] ?? null };
  };
  const builder = {
    select(columns: string) { call.select = columns; return builder; },
    eq(column: string, value: unknown) { call.eq.push([column, value]); return builder; },
    in(column: string, values: unknown[]) { call.in.push([column, values]); return builder; },
    not(column: string, operator: string, value: unknown) { call.not.push([column, operator, value]); return builder; },
    order(column: string, options?: { ascending?: boolean }) { call.order.push([column, options?.ascending ?? true]); return builder; },
    limit(count: number) { call.limit = count; return builder; },
    maybeSingle() { const { data, error } = result(); return Promise.resolve({ data: data?.[0] ?? null, error }); },
    then<T1, T2 = never>(fulfilled?: ((value: ReturnType<typeof result>) => T1 | PromiseLike<T1>) | null, rejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null) {
      return Promise.resolve(result()).then(fulfilled, rejected);
    },
  };
  return builder;
}

vi.mock('./supabase/server', () => ({ createClient: async () => ({ from: query }) }));
vi.mock('./supabase/service', () => ({ createServiceClient: () => ({ from: query }) }));

import { loadMyAddressBook } from './address-book.server';
import { loadCheckoutAddressPrefill, loadLatestCheckoutAddress } from './checkout.server';

const USER = '7a570000-0000-4000-8000-0000000000aa';
const OTHER = '7a570000-0000-4000-8000-0000000000bb';
const bookRow = (id: string, label: string, isDefault: boolean, createdAt: string, user = USER) => ({
  id, user_id: user, label, recipient_name: '홍길동', phone: '01012345678', postal_code: '04524',
  address1: `서울 ${label}`, address2: null, is_default: isDefault, created_at: createdAt,
});
const orderAddress = (name: string) => ({ recipientName: name, phone: '01099998888', postalCode: '06236', address1: '서울 강남구', address2: '', deliveryNote: '문 앞' });

beforeEach(() => {
  mocks.rows = {};
  mocks.errors = {};
  mocks.calls = [];
});

describe('loadMyAddressBook', () => {
  it('내 주소록만 등록 순으로 읽고 기본 배송지를 맨 앞에 둔다', async () => {
    mocks.rows.address_book_entries = [
      bookRow('7a570000-0000-4000-8000-000000000002', '회사', false, '2026-10-27T01:00:00Z'),
      bookRow('7a570000-0000-4000-8000-000000000001', '집', true, '2026-10-27T02:00:00Z'),
      bookRow('7a570000-0000-4000-8000-000000000003', '남의 집', true, '2026-10-27T00:00:00Z', OTHER),
    ];

    const book = await loadMyAddressBook(USER);

    expect(book?.map((entry) => [entry.label, entry.isDefault])).toEqual([['집', true], ['회사', false]]);
    expect(mocks.calls[0]).toMatchObject({ table: 'address_book_entries', eq: [['user_id', USER]], order: [['created_at', true], ['id', true]], limit: 10 });
  });

  it('읽기 오류나 모양이 틀린 행은 빈 주소록으로 단정하지 않고 null 로 접는다', async () => {
    mocks.errors.address_book_entries = { message: 'permission denied' };
    expect(await loadMyAddressBook(USER)).toBeNull();
    mocks.errors = {};
    mocks.rows.address_book_entries = [{ ...bookRow('7a570000-0000-4000-8000-000000000001', '집', true, '2026-10-27T00:00:00Z'), phone: 1 }];
    expect(await loadMyAddressBook(USER)).toBeNull();
  });
});

describe('loadLatestCheckoutAddress (S6a)', () => {
  it('결제를 마친 주문의 배송지만 쓴다 — 결제 대기·취소 주문의 주소는 건너뛴다', async () => {
    mocks.rows.orders = [
      { user_id: USER, status: 'pending', created_at: '2026-10-27T03:00:00Z', address: orderAddress('대기') },
      { user_id: USER, status: 'canceled', created_at: '2026-10-27T02:00:00Z', address: orderAddress('취소') },
      { user_id: USER, status: 'delivered', created_at: '2026-10-27T01:00:00Z', address: orderAddress('결제') },
      { user_id: USER, status: 'paid', created_at: '2026-10-26T01:00:00Z', address: orderAddress('예전') },
    ];

    expect((await loadLatestCheckoutAddress(USER))?.recipientName).toBe('결제');
    expect(mocks.calls[0].in).toEqual([['status', ['paid', 'confirmed', 'shipping', 'delivered', 'done']]]);
  });
});

describe('loadCheckoutAddressPrefill', () => {
  it('주소록에 기본 배송지가 있으면 직전 주문보다 먼저 쓰고 배송 메모는 비운다', async () => {
    mocks.rows.address_book_entries = [bookRow('7a570000-0000-4000-8000-000000000001', '집', true, '2026-10-27T00:00:00Z')];
    mocks.rows.orders = [{ user_id: USER, status: 'paid', created_at: '2026-10-27T01:00:00Z', address: orderAddress('직전') }];

    const prefill = await loadCheckoutAddressPrefill(USER, true);

    expect(prefill.source).toBe('address_book');
    expect(prefill.address).toEqual({ recipientName: '홍길동', phone: '01012345678', postalCode: '04524', address1: '서울 집', address2: '', deliveryNote: '' });
    expect(prefill.book?.map((entry) => entry.label)).toEqual(['집']);
  });

  it('주소록이 비었거나 읽지 못하면 결제를 마친 직전 주문으로 채우고, 둘 다 없으면 빈 폼이다', async () => {
    mocks.rows.address_book_entries = [];
    mocks.rows.orders = [{ user_id: USER, status: 'shipping', created_at: '2026-10-27T01:00:00Z', address: orderAddress('직전') }];
    expect(await loadCheckoutAddressPrefill(USER, true)).toMatchObject({ source: 'recent_order', book: [], address: { recipientName: '직전', deliveryNote: '문 앞' } });

    mocks.errors.address_book_entries = { message: 'unavailable' };
    expect(await loadCheckoutAddressPrefill(USER, true)).toMatchObject({ source: 'recent_order', book: null });

    mocks.errors = {};
    mocks.rows.orders = [{ user_id: USER, status: 'canceled', created_at: '2026-10-27T01:00:00Z', address: orderAddress('취소') }];
    expect(await loadCheckoutAddressPrefill(USER, true)).toEqual({ address: null, source: null, book: [] });
  });

  /* 처리방침 주소록 개정 시행일 전(주소록이 열리지 않은 회원) — 주소록을 읽지 않고 직전 주문 배송지만 채운다(L7 QA). */
  it('주소록이 아직 열리지 않았으면 주소록을 읽지 않고 고르기·저장 UI 도 없이(book null) 직전 주문으로 채운다', async () => {
    mocks.rows.address_book_entries = [bookRow('7a570000-0000-4000-8000-000000000001', '집', true, '2026-10-27T00:00:00Z')];
    mocks.rows.orders = [{ user_id: USER, status: 'paid', created_at: '2026-10-27T01:00:00Z', address: orderAddress('직전') }];

    expect(await loadCheckoutAddressPrefill(USER, false)).toMatchObject({ source: 'recent_order', book: null, address: { recipientName: '직전' } });
    expect(mocks.calls.map((call) => call.table)).not.toContain('address_book_entries');
  });
});
