import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void | (() => void))[] }));
const mocks = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useMemo: (factory: () => unknown) => factory(),
  useId: () => 'promotion',
  useTransition: () => [false, (callback: () => unknown) => { void callback(); }],
}));
vi.mock('@/app/admin/discount-promotion-actions', () => ({ previewDiscountPromotionAction: mocks.preview, commitDiscountPromotionAction: vi.fn(), readDiscountPromotionAction: vi.fn() }));
vi.mock('@/app/admin/category-display-actions', () => ({ searchCategoryDisplayGoodsAction: vi.fn(() => new Promise(() => {})) }));
vi.mock('@/components/admin/GoodsGroupOperation', () => ({
  GroupTable: ({ children }: { children: ReactNode }) => children,
  useGoodsGroupSession: () => ({ blocked: false, current: () => true, deny: vi.fn() }),
}));

import { DiscountPromotionEditorScreen } from './DiscountPromotionEditorScreen';
import { AdminSelect } from '@/components/admin/console/AdminSelect';
import { Input } from '@/components/admin/kit/ui/input';
import type { DiscountPromotionPreview, DiscountPromotionPreviewGood } from '@/lib/admin/discount-promotions';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const identity = { actorId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222' };
const OPERATION = '6f1c2a9e-3d4b-4c5d-8e6f-7a8b9c0d1e2f';
const row = (id: string, extra: Partial<DiscountPromotionPreviewGood> = {}): DiscountPromotionPreviewGood => ({
  id, name: `QA ${id}`, code: id.toUpperCase(), price: 20000, priceMin: 20000, priceMax: 20000, nextMin: 18000, nextMax: 18000,
  published: true, archived: false, rule: { source: 'default', mode: 'rate', value: 10 }, skip: null, overlap: null, ...extra,
});

function render() {
  hooks.index = 0; hooks.refIndex = 0;
  const tree = nodes(DiscountPromotionEditorScreen({ identity, options: { campaigns: [{ id: 'qa-open', title: 'QA 오픈 기획전', status: 'published', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-31T00:00:00Z', goodsCount: 3 }], ips: [] },
    initial: { kind: 'campaign', campaignId: 'qa-open', ipId: null, name: 'QA 오픈 10%' } }));
  for (const effect of hooks.effects.splice(0)) effect();
  return tree;
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function type(find: (node: Element) => boolean, value: string) { (render().find(node => node.type === Input && find(node))!.props.onChange as (event: unknown) => void)({ target: { value } }); }

beforeEach(() => {
  hooks.states = []; hooks.index = 0; hooks.refs = []; hooks.refIndex = 0; hooks.effects = []; vi.clearAllMocks();
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { get length() { return store.size; }, key: (index: number) => [...store.keys()][index] ?? null, getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage }));
});
afterEach(() => { vi.unstubAllGlobals(); });

/* QA1 MD: 비교 표에서 기간이 겹쳐 건너뛴 줄은 규칙을 바꿔도 결과가 같다 — 그 줄의 규칙 선택을 잠그고, 기간은 목록·상세와 같은 24시간제로 보인다. */
it('겹침·판매 옵션 없음으로 건너뛴 줄만 규칙 선택을 잠그고, 기간을 24시간제로 보인다', async () => {
  render(); await flush();
  type(node => node.props.placeholder === '예: 오픈 기획전 10%', 'QA 오픈 10%');
  const [starts, ends] = render().filter(node => node.type === Input && node.props.type === 'datetime-local');
  (starts.props.onChange as (event: unknown) => void)({ target: { value: '2026-11-12T14:01' } });
  (ends.props.onChange as (event: unknown) => void)({ target: { value: '2026-11-19T14:01' } });
  type(node => node.props.type === 'number', '10');
  const preview: DiscountPromotionPreview = {
    state: 'ready', operationId: OPERATION, expiresAt: '2026-11-12T05:15:00Z',
    request: { name: 'QA 오픈 10%', startsAt: '2026-11-12T05:01:00.000Z', endsAt: '2026-11-19T05:01:00.000Z', target: { kind: 'campaign', ids: ['qa-open'] }, rule: { mode: 'rate', value: 10 }, exceptions: [] },
    target: { kind: 'campaign', ids: ['qa-open'], label: 'QA 오픈 기획전' },
    goods: [row('qa-pr1'),
      row('qa-pr5', { skip: 'price_period_overlap', nextMin: null, nextMax: null, overlap: { promotionId: null, promotionName: null, startsAt: '2026-11-11T15:00:00Z', endsAt: '2026-12-12T04:55:00Z' } }),
      row('qa-pr6', { skip: 'price_period_variant_inactive', nextMin: null, nextMax: null, priceMin: null, priceMax: null }),
      row('qa-pr7', { skip: 'goods_bulk_price_invalid', nextMin: null, nextMax: null })],
  };
  mocks.preview.mockResolvedValueOnce({ value: preview });
  (render().find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
  await flush();

  const screen = render();
  expect(mocks.preview).toHaveBeenCalledOnce();
  const select = (name: string) => screen.find(node => node.type === AdminSelect && node.props['aria-label'] === `${name} 할인 규칙`)!;
  expect(select('QA qa-pr1').props.disabled).toBe(false);
  expect(select('QA qa-pr5').props.disabled).toBe(true);
  expect(select('QA qa-pr6').props.disabled).toBe(true);
  /* 할인가가 범위를 벗어난 줄은 다른 할인율로 고치면 할인되므로 열어 둔다. */
  expect(select('QA qa-pr7').props.disabled).toBe(false);
  const summary = screen.find(node => node.type === 'p' && text(node.props.children as ReactNode).includes('(한국 시간)'))!;
  expect(text(summary.props.children as ReactNode)).toContain('2026. 11. 12. 14:01 ~ 2026. 11. 19. 14:01 (한국 시간)');
  const whole = text(screen[0]);
  expect(whole).toContain('건너뜀 · 기간이 겹치는 즉시할인이 이미 있음 (개별 할인 2026. 11. 12. 00:00 ~ 2026. 12. 12. 13:55)');
  expect(whole).not.toMatch(/오전|오후/);
});
