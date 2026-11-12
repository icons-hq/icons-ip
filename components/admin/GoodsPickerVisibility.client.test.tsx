import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void | (() => void))[], ran: false }));
const mocks = vi.hoisted(() => ({ category: vi.fn(), story: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useEffect: (effect: () => void | (() => void)) => { if (!hooks.ran) hooks.effects.push(effect); },
}));
vi.mock('@/app/admin/category-display-actions', () => ({ searchCategoryDisplayGoodsAction: mocks.category }));
vi.mock('@/app/admin/shopping-story-actions', () => ({ searchShoppingStoryGoodsAction: mocks.story }));

import { CategoryDisplayGoodsPicker } from './CategoryDisplayGoodsPicker';
import { ShoppingStoryGoodsPicker } from './ShoppingStoryGoodsPicker';
import { DisplayGoodVisibilityBadge, DisplayGoodVisibilityNote } from './DisplayGoodVisibility';
import { AdminStatusBadge } from './console/AdminKit';
import type { StoryGoodCandidate } from '@/lib/admin/shopping-story-picker';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const candidate = (id: string, extra: Partial<StoryGoodCandidate> = {}): StoryGoodCandidate => ({
  id, name: `QA ${id}`, code: id.toUpperCase(), price: 10000, priceMax: 10000, compareAtPrice: null, showDiscountRate: false, imageBackground: '#eee', badge: null,
  soldOut: false, imageUrl: null, archived: false, published: true, visibility: 'public', reviewCount: 0, ratingAverage: null, wishCount: 0, salesQuantity: 0,
  freeShipping: false, discounted: false, saleType: 'stock', ...extra,
});
const rows = [candidate('qa-pr1'), candidate('qa-pr9', { published: false, visibility: 'draft' }), candidate('qa-ip', { published: false, visibility: 'ip_draft' }),
  candidate('qa-adult', { published: false, visibility: 'restricted' }), candidate('qa-old', { published: false, visibility: undefined })];
const page = { rows, total: rows.length, page: 1, pageSize: 20 as const, checkedAt: '2026-11-12T00:00:00Z', categories: [] };
async function load(render: () => ReactNode) {
  hooks.index = 0; hooks.refIndex = 0; render();
  hooks.ran = true;
  for (const effect of hooks.effects.splice(0)) effect();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  hooks.index = 0; hooks.refIndex = 0;
  return nodes(render());
}

beforeEach(() => { hooks.states = []; hooks.index = 0; hooks.refs = []; hooks.refIndex = 0; hooks.effects = []; hooks.ran = false; vi.clearAllMocks(); });

/* QA1 MD 후속: 같은 창의 검색 표도 결과 줄·담은 목록과 같은 이유(초안·IP 초안·성인(19금))로 부른다 — '비노출'·'공개 제외'와 섞지 않는다. */
describe('선택 창 검색 표의 노출 상태', () => {
  it('카테고리 전시·캠페인·할인 프로모션 선택 창은 공개 행에 노출 중, 나머지 행에 이유 배지를 보인다', async () => {
    mocks.category.mockResolvedValue({ data: page });
    const screen = await load(() => CategoryDisplayGoodsPicker({ selected: [], limit: 10, onApply: vi.fn(), onClose: vi.fn() }));
    expect(screen.filter(node => node.type === DisplayGoodVisibilityBadge).map(node => node.props.visibility)).toEqual(['draft', 'ip_draft', 'restricted', 'hidden']);
    expect(screen.filter(node => node.type === AdminStatusBadge).map(node => text(node.props.children as ReactNode))).toEqual(['노출 중']);
    expect(text(screen[0])).not.toMatch(/비노출|비공개|공개 제외/);
  });
  it('쇼핑스토리 관련상품 찾기는 공개 행에 공개, 나머지 행 끝에 이유 배지를 붙인다', async () => {
    mocks.story.mockResolvedValue({ ok: true, data: page });
    const screen = await load(() => ShoppingStoryGoodsPicker({ existingIds: [], sectionCount: 0, onAdd: vi.fn(), onClose: vi.fn() }));
    expect(screen.filter(node => node.type === DisplayGoodVisibilityNote).map(node => node.props.visibility)).toEqual(['public', 'draft', 'ip_draft', 'restricted', 'hidden']);
    const items = screen.filter(node => node.type === 'li');
    expect(text(items[0].props.children as ReactNode)).toContain('QA-PR1 · 10,000원 · 공개');
    expect(text(items[1].props.children as ReactNode)).not.toMatch(/공개 제외|비공개/);
  });
});
