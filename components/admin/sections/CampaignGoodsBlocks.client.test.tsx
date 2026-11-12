import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: new Map<number, unknown[]>(), jobs: [] as (() => void)[] }));
const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => void, deps: unknown[]) => {
    const index = hooks.index++, previous = hooks.effects.get(index);
    if (!previous || deps.some((dep, i) => dep !== previous[i])) { hooks.effects.set(index, deps); hooks.jobs.push(() => { effect(); }); }
  },
}));
vi.mock('@/app/admin/good-reference-actions', () => ({ resolveGoodReferencesAction: mocks.resolve, readGoodReferenceFileAction: vi.fn() }));
vi.mock('@/app/admin/category-display-actions', () => ({ searchCategoryDisplayGoodsAction: vi.fn() }));

import { CampaignGoodsBlocks } from './CampaignGoodsBlocks';
import type { GoodReferenceMatch } from '@/lib/admin/good-references';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => !isValidElement<Record<string, unknown>>(value) ? String(value)
  : typeof value.type === 'function' && value.type.name === 'DisplayGoodVisibilityNote' ? text((value.type as (props: Record<string, unknown>) => ReactNode)(value.props))
  : text(value.props.children as ReactNode)).join('');
const match = (ref: string, extra: Partial<GoodReferenceMatch> = {}): GoodReferenceMatch => ({
  ref, status: 'found', matchedBy: 'id', id: ref, name: `QA ${ref}`, code: ref.toUpperCase(), archived: false, published: true, candidate: null, ...extra,
});
function render() {
  hooks.index = 0; hooks.refIndex = 0;
  const tree = nodes(CampaignGoodsBlocks({ sectionsText: JSON.stringify([{ type: 'goods', good_ids: ['qa-pr1', 'qa-pr9'] }]), onSectionsTextChange: vi.fn(), campaignId: 'qa-open' }));
  for (const job of hooks.jobs.splice(0)) job();
  return tree;
}

beforeEach(() => { hooks.states = []; hooks.index = 0; hooks.refs = []; hooks.refIndex = 0; hooks.effects.clear(); hooks.jobs = []; vi.clearAllMocks(); });

/* QA1 MD major: 공개 전 상품도 상품 묶음에 둘 수 있지만, 칩에 비공개 배지를 달고 묶음 아래에 기획전 본문에서 빠지는 이유를 적는다. */
it('상품 묶음에 둔 비공개 상품을 배지와 이름으로 알리고, 이 기획전 할인 만들기는 캠페인 편집에서 연 것으로 표시한다', async () => {
  mocks.resolve.mockResolvedValueOnce({ ok: true, matches: [match('qa-pr1'), match('qa-pr9', { name: 'QA 비공개 굿즈', published: false })] });
  render();
  expect(mocks.resolve).toHaveBeenCalledWith(['qa-pr1', 'qa-pr9']);
  for (let i = 0; i < 6; i++) await Promise.resolve();
  const screen = render();
  const chip = (id: string) => screen.find(node => node.props['data-display-good'] === id)!;
  expect(text(chip('qa-pr1').props.children as ReactNode)).toBe('QA qa-pr1qa-pr1');
  expect(text(chip('qa-pr9').props.children as ReactNode)).toBe('QA 비공개 굿즈qa-pr9비공개');
  expect(text(screen.find(node => node.props['data-display-hidden-goods'] !== undefined)!.props.children as ReactNode))
    .toBe('비공개 상품 1개(QA 비공개 굿즈)는 공개 전까지 고객 화면에 보이지 않습니다. 기획전 본문에도 보이지 않습니다.');
  expect(screen.find(node => text(node.props.children as ReactNode) === '이 기획전 할인 만들기' && node.props.href)!.props.href)
    .toBe('/admin/sales/discount-promotions/new?campaign=qa-open&from=campaign');
});
