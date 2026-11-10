import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), goods: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => ({ user: { id: ACTOR }, profile: null }) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => mocks.goods() }) }) }),
}));

import { createGiftAction, issueGiftLinkAction } from './actions';

const ACTOR = '93942000-0000-4000-8000-000000000001', GIFT = '93942000-0000-4000-8000-000000000010', OPERATION = '93942000-0000-4000-8000-000000000020';
const VARIANT = '93942000-0000-4000-8000-000000000030';
const gift = { id: GIFT, revision: 1, message: '', senderLabel: '보낸 분', expiresAt: '2026-10-31T00:00:00Z',
  items: [{ goodId: 'random-good', variantId: VARIANT, name: '랜덤 포토카드', variantName: '포토카드 A', qty: 1, imagePath: null, customInputs: null }],
  party: 'sender', isRecipient: false, state: 'awaiting_acceptance', recipientLabel: null, createdAt: '2026-10-28T00:00:00Z', acceptedAt: null,
  address: null, addressRevision: null, order: null, shipments: [] };

beforeEach(() => {
  mocks.goods.mockReset().mockResolvedValue({ data: [{ id: 'random-good' }], error: null });
  mocks.rpc.mockReset();
});

/* m27 CUST-1: 서버 액션 응답으로 화면의 선물을 바꿔 그려도 랜덤 판매 굿즈의 옵션명은 가려져 있다. */
describe('선물 서버 액션의 랜덤 판매 옵션 가림', () => {
  it('선물 준비·링크 발급 응답의 품목 옵션명을 랜덤으로 가린다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { gift, receipt: { operationId: OPERATION, kind: 'created', revision: 1 } }, error: null });
    const created = await createGiftAction(GIFT, [{ goodId: 'random-good', variantId: VARIANT, qty: 1, inputRevision: 0, inputValues: {} }], '', OPERATION, ACTOR);
    expect('gift' in created && created.gift.items.map(item => item.variantName)).toEqual(['랜덤']);
    mocks.rpc.mockResolvedValueOnce({ data: { gift, receipt: { operationId: OPERATION, kind: 'link_issued', revision: 1 }, generation: 1 }, error: null });
    const issued = await issueGiftLinkAction(GIFT, 1, Buffer.alloc(32, 3).toString('base64url'), OPERATION, ACTOR);
    expect('gift' in issued && issued.gift.items.map(item => item.variantName)).toEqual(['랜덤']);
  });

  it('랜덤 판매 여부를 읽지 못하면 결과를 확인할 수 없는 응답으로 돌려 같은 요청으로 다시 확인하게 한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { gift, receipt: { operationId: OPERATION, kind: 'created', revision: 1 } }, error: null });
    mocks.goods.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const created = await createGiftAction(GIFT, [{ goodId: 'random-good', variantId: VARIANT, qty: 1, inputRevision: 0, inputValues: {} }], '', OPERATION, ACTOR);
    expect(created).toMatchObject({ uncertain: true });
    expect(JSON.stringify(created)).not.toContain('포토카드 A');
  });
});
