import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), goods: vi.fn(), filters: [] as unknown[][], cookie: null as string | null }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => mocks.cookie === null ? undefined : { value: mocks.cookie } }) }));
vi.mock('./supabase/service', () => ({ createServiceClient: vi.fn() }));
vi.mock('./supabase/server', () => ({
  createClient: async () => ({
    rpc: mocks.rpc,
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: unknown) => { mocks.filters.push([table, columns, column, value]); return mocks.goods(); },
      }),
    }),
  }),
}));

import { loadGift, loadGiftInvitation, loadGifts } from './gifts.server';

const id = '93942000-0000-4000-8000-000000000010', variant = '93942000-0000-4000-8000-000000000030';
const items = [
  { goodId: 'select-good', variantId: variant, name: '아크릴 블록', variantName: '빨강', qty: 1, imagePath: null, customInputs: null },
  { goodId: 'random-good', variantId: variant, name: '랜덤 포토카드', variantName: '포토카드 A', qty: 1, imagePath: null, customInputs: null },
];
const invitation = { id, revision: 1, message: '선물', senderLabel: '보낸 분', expiresAt: '2026-10-31T00:00:00Z', items };
const gift = { ...invitation, party: 'sender', isRecipient: false, state: 'awaiting_acceptance', recipientLabel: null, createdAt: '2026-10-28T00:00:00Z',
  acceptedAt: null, address: null, addressRevision: null, order: null, shipments: [] };
const variantNames = (value: { items: { variantName: string }[] } | null) => value?.items.map(item => item.variantName);

beforeEach(() => {
  mocks.filters = []; mocks.cookie = null;
  mocks.goods.mockReset().mockResolvedValue({ data: [{ id: 'random-good' }], error: null });
  mocks.rpc.mockReset();
});

/* m27 CUST-1: 선물을 만든 뒤 랜덤 판매로 바뀐 굿즈의 품목 스냅샷에는 기본 옵션 이름이 남는다 — 화면에 닿기 전에 '랜덤'으로 가린다. */
describe('선물 품목의 랜덤 판매 옵션 가림', () => {
  it('선물 상세·선물함·받은 선물 링크가 모두 랜덤 판매 굿즈의 옵션명을 가린다', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null,
      data: name === 'get_my_gift_numbered' ? gift : name === 'list_my_gifts_numbered' ? { items: [gift], hasMore: false } : invitation }));
    expect(variantNames(await loadGift(id))).toEqual(['빨강', '랜덤']);
    expect((await loadGifts('sender')).items.map(variantNames)).toEqual([['빨강', '랜덤']]);
    mocks.cookie = Buffer.alloc(32, 7).toString('base64url');
    expect(variantNames(await loadGiftInvitation())).toEqual(['빨강', '랜덤']);
    expect(mocks.filters).toEqual(Array(3).fill(['goods', 'id', 'option_sale_mode', 'random']));
  });

  it('랜덤 판매 여부를 읽지 못하면 옵션명을 그대로 내보내지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: gift, error: null });
    mocks.goods.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(loadGift(id)).rejects.toThrow();
  });
});
