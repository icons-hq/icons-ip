import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 상담 위젯 유형 버튼의 답(0901-044) — 대표 FAQ가 없을 때의 폴백 순서.
 * search_faq_entries는 DB 함수와 같은 규칙(공개만·카테고리·2자 이상 낱말 중 하나가 질문+답변에 포함·표시 순서)으로 흉내 낸다.
 */
interface Row { id: string; category: string; question: string; answer: string; sort_order: number; is_published: boolean; updated_at: string; widget_topic: string | null }
const mocks = vi.hoisted(() => ({ rows: [] as Row[], rpc: vi.fn(), designatedError: null as { message: string } | null }));

function searchFaqEntries(args: { target_query: string; target_category: string; page_limit: number; page_offset: number }) {
  const words = args.target_query.trim().toLowerCase().split(/[\s\p{P}]+/u).filter((word) => word.length >= 2);
  const matches = mocks.rows
    .filter((row) => row.is_published && (!args.target_category || row.category === args.target_category))
    .filter((row) => !args.target_query.trim() || words.some((word) => `${row.question} ${row.answer}`.toLowerCase().includes(word)))
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const limit = Math.max(1, Math.min(args.page_limit, 50));
  return { total: matches.length, entries: matches.slice(args.page_offset, args.page_offset + limit).map((row) => ({
    id: row.id, category: row.category, question: row.question, answer: row.answer, sortOrder: row.sort_order, published: row.is_published, updatedAt: row.updated_at,
  })) };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: mocks.rpc,
    from: () => {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => { filters[column] = value; return chain; },
        limit: async (count: number) => mocks.designatedError
          ? { data: null, error: mocks.designatedError }
          : { data: mocks.rows.filter((row) => Object.entries(filters).every(([column, value]) => row[column as keyof Row] === value)).slice(0, count), error: null },
      };
      return chain;
    },
  }),
}));

import { loadFaqWidgetTopicAnswer } from './faq.server';

const row = (id: string, category: string, question: string, answer: string, sortOrder: number, extra: Partial<Row> = {}): Row => ({
  id, category, question, answer, sort_order: sortOrder, is_published: true, updated_at: '2026-11-12T00:00:00Z', widget_topic: null, ...extra,
});
/* 리뷰어 재현: 취소/반품/교환 카테고리의 공개 FAQ 3개(취소·교환·반품배송비). 취소 FAQ 답변에는 '반품'이 나온다. */
const CANCEL = row('faq-cancel', 'claim', '주문 취소는 어떻게 하나요?', '발주확인 전에는 주문 상세에서 취소합니다. 출고 뒤에는 반품으로 진행됩니다.', 0);
const EXCHANGE = row('faq-exchange', 'claim', '교환은 어떻게 하나요?', '배송 중부터 주문 상세에서 요청합니다.', 1);
const RETURN_FEE = row('faq-return-fee', 'claim', '반품 배송비는 얼마인가요?', '단순 변심은 왕복 배송비를 부담합니다.', 2);

beforeEach(() => {
  mocks.rows = [CANCEL, EXCHANGE, RETURN_FEE];
  mocks.designatedError = null;
  mocks.rpc.mockReset().mockImplementation(async (name: string, args: Parameters<typeof searchFaqEntries>[0]) =>
    name === 'search_faq_entries' ? { data: searchFaqEntries(args), error: null } : { data: null, error: { message: 'unknown rpc' } });
});

describe('상담 위젯 유형 버튼의 답 — 대표 FAQ가 없을 때 (0901-044)', () => {
  it('교환/반품은 질문에 교환·반품이 든 공개 FAQ만, 취소는 취소 FAQ만 표시 순서대로 보인다(답변 속 낱말은 세지 않는다)', async () => {
    const exchange = await loadFaqWidgetTopicAnswer('return');
    expect(exchange.entry).toBeNull();
    expect(exchange.entries.map((entry) => entry.id)).toEqual(['faq-exchange', 'faq-return-fee']);
    const cancel = await loadFaqWidgetTopicAnswer('cancel');
    expect(cancel.entries.map((entry) => entry.id)).toEqual(['faq-cancel']);
    expect(mocks.rpc).toHaveBeenCalledWith('search_faq_entries', expect.objectContaining({ target_query: '교환 반품', target_category: 'claim', page_limit: 50 }));
  });

  it('질문에 낱말이 든 FAQ가 하나도 없을 때만 그 카테고리의 공개 FAQ 목록으로 내려간다', async () => {
    mocks.rows = [row('faq-order-1', 'order', '주문 내역은 어디서 보나요?', '마이페이지에서 봅니다.', 0), row('faq-order-2', 'order', '결제 수단은 무엇이 있나요?', '카드와 무통장입금입니다. 배송은 결제 후 시작합니다.', 1)];
    const delivery = await loadFaqWidgetTopicAnswer('delivery');
    expect(delivery.entries.map((entry) => entry.id)).toEqual(['faq-order-1', 'faq-order-2']);
    expect(mocks.rpc).toHaveBeenLastCalledWith('search_faq_entries', expect.objectContaining({ target_query: '', target_category: 'order', page_limit: 5 }));
    mocks.rows = [row('faq-account', 'account', '배송지 변경은 어디서 하나요?', '주소록에서 바꿉니다.', 0)];
    expect((await loadFaqWidgetTopicAnswer('delivery')).entries).toEqual([]);
  });

  it('비공개 FAQ는 낱말이 맞아도 고르지 않고, 낱말 목록도 최대 5개다', async () => {
    mocks.rows = [
      row('faq-draft', 'claim', '취소 수수료가 있나요?', '초안', 0, { is_published: false }),
      ...Array.from({ length: 7 }, (_, index) => row(`faq-cancel-${index}`, 'claim', `취소 안내 ${index}`, '답변', index + 1)),
    ];
    const cancel = await loadFaqWidgetTopicAnswer('cancel');
    expect(cancel.entries.map((entry) => entry.id)).toEqual(['faq-cancel-0', 'faq-cancel-1', 'faq-cancel-2', 'faq-cancel-3', 'faq-cancel-4']);
  });

  it('공개 대표 FAQ가 지정돼 있으면 그것 하나만 돌려주고 검색하지 않는다. 비공개 지정은 없는 것으로 본다', async () => {
    mocks.rows = [CANCEL, { ...EXCHANGE, widget_topic: 'return' }, RETURN_FEE];
    const designated = await loadFaqWidgetTopicAnswer('return');
    expect(designated.entry).toMatchObject({ id: 'faq-exchange', widgetTopic: 'return' });
    expect(designated.entries).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rows = [CANCEL, { ...EXCHANGE, widget_topic: 'return', is_published: false }, RETURN_FEE];
    const draft = await loadFaqWidgetTopicAnswer('return');
    expect(draft.entry).toBeNull();
    expect(draft.entries.map((entry) => entry.id)).toEqual(['faq-return-fee']);
  });

  it('조회가 실패하면 오류로 돌려 위젯이 다시 시도 안내를 보이게 한다', async () => {
    mocks.designatedError = { message: 'db unreachable' };
    await expect(loadFaqWidgetTopicAnswer('delivery')).rejects.toThrow('Failed to load FAQ widget topic');
    mocks.designatedError = null;
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'db unreachable' } });
    await expect(loadFaqWidgetTopicAnswer('delivery')).rejects.toThrow('Failed to load FAQ');
  });
});
