import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Good, GoodOption } from '@/lib/data';
import type { ShippingSavings } from '@/lib/product-detail-experiences';

/* 렌더러 없이 컴포넌트 함수를 돌린다 — state·ref·effect 를 인덱스 대역으로 바꾼다(ProductInterestShelf 시험과 같은 방식). */
const hooks = vi.hoisted(() => ({ state: [] as unknown[], refs: [] as { current: unknown }[], effects: [] as (() => void | (() => void))[], stateIndex: 0, refIndex: 0, effectIndex: 0 }));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), savings: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.stateIndex++; if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (old: unknown) => unknown)(hooks.state[index]) : next; }]; },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects[hooks.effectIndex++] = effect; },
}));
vi.mock('@/app/shop/experience-actions', () => ({ loadShippingSavingsAction: mocks.savings }));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));
vi.mock('@/components/wc/ProductCard', () => ({ ProductCard: () => null }));
vi.mock('./ProductDetailRefresh', () => ({ ProductDetailRefresh: () => null }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));

import { ProductCard } from '@/components/wc/ProductCard';
import { ProductShippingSavings } from './ProductShippingSavings';

const option: GoodOption = { id: '92200000-0000-4000-8000-000000000001', name: '기본', code: 'BASE', price: 12000, stockQty: 5, isDefault: true, attributes: {} };
const candidate = (id: string): Good => ({ id, name: `후보 ${id}`, ip: 'ip', type: '문구', price: 3000, badge: null, img: '', stock: 'ok', stockQty: 9,
  options: [{ id: id === 's1' ? '92200000-0000-4000-8000-000000000011' : '92200000-0000-4000-8000-000000000012', name: '기본', code: 'BASE', price: 3000, stockQty: 9, isDefault: true, attributes: {} }] });
const savings: ShippingSavings = { nextChangeAt: null, items: ['s1', 's2'].map((id) => ({
  goodId: id, variantId: candidate(id).options![0].id, variantName: '기본', qty: 1, separateFee: 3000, combinedFee: 0, savings: 3000, good: candidate(id),
})) };

function render(wishlist?: Parameters<typeof ProductShippingSavings>[0]['wishlist']) {
  hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effectIndex = 0;
  return ProductShippingSavings({ goodId: 'g13', option, quantity: 1, wishlist });
}
function cardProps(node: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const element = value as { type?: unknown; props?: Record<string, unknown> };
    if (element.type === ProductCard && element.props) found.push(element.props);
    if (element.props?.children !== undefined) visit(element.props.children);
  };
  visit(node);
  return found;
}
async function flush() { for (let index = 0; index < 4; index += 1) await Promise.resolve(); }

beforeEach(() => { vi.clearAllMocks(); hooks.state = []; hooks.refs = []; hooks.effects = []; });

/* L4b · CL-01·CL-02 — 배송비 절약 후보 카드도 목록 하트와 별점을 단다. 후보는 서버 액션으로 오므로 별점은 받은 뒤 한 번에 묻는다. */
describe('ProductShippingSavings listing cards', () => {
  it('받아 온 후보의 별점을 한 번에 묻고 하트·별점을 카드에 단다', async () => {
    render({ viewerId: 'viewer-1', goodIds: ['s2'] });
    hooks.state[0] = { key: `g13:${option.id}:1`, value: savings };
    render({ viewerId: 'viewer-1', goodIds: ['s2'] });

    mocks.rpc.mockResolvedValueOnce({ data: [{ goodId: 's1', reviewCount: 12, ratingAverage: 4.92 }], error: null });
    hooks.effects[1]();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_goods_review_summaries', { p_good_ids: ['s1', 's2'] });
    await flush();

    const cards = cardProps(render({ viewerId: 'viewer-1', goodIds: ['s2'] }));
    expect(cards.map(card => card.name)).toEqual(['후보 s1', '후보 s2']);
    expect(cards[0].reviewSummary).toEqual({ count: 12, average: 4.92 });
    expect(cards[1].reviewSummary).toBeUndefined();
    expect(cards[0].action).toMatchObject({ props: { goodId: 's1', initialWished: false, viewerId: 'viewer-1' } });
    expect(cards[1].action).toMatchObject({ props: { goodId: 's2', initialWished: true, label: '후보 s2' } });
  });

  it('후보가 없거나 비교 전이면 별점을 묻지 않고, 위시 상태를 받지 않으면 하트가 없다', () => {
    render();
    hooks.effects[1]();
    expect(mocks.rpc).not.toHaveBeenCalled();

    hooks.state[0] = { key: `g13:${option.id}:1`, value: savings };
    expect(cardProps(render()).map(card => card.action)).toEqual([undefined, undefined]);
  });
});
