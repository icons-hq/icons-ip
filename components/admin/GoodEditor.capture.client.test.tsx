import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, jobs: [] as (() => void)[] }));
const mocks = vi.hoisted(() => ({ capture: null as null | ((data: FormData) => void), submit: vi.fn(), saveLocal: vi.fn(), saveServer: vi.fn(), reported: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial; return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }]; },
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.values[index] ??= { current: initial }; },
  useCallback: (callback: unknown) => callback,
  useEffect: (callback: () => void) => { hooks.jobs.push(callback); },
}));
vi.mock('./useAdminLocalAutosave', () => ({ useAdminLocalAutosave: () => ({ snapshot: {}, scopeKey: 'capture-test',
  formRef: (_form: HTMLFormElement, callback: (data: FormData) => void) => { mocks.capture = callback; },
  onSubmitCapture: mocks.submit, saveDraft: mocks.saveLocal, discard: vi.fn(), restore: vi.fn(),
}) }));
vi.mock('@/app/admin/goods-draft-actions', () => ({ saveGoodsDraftAction: mocks.saveServer }));
import { GoodEditor } from './GoodEditor';
import { GoodsAttributeEditor } from './GoodsAttributeEditor';
import { createGoodEditorDraft } from '@/lib/admin/good-editor';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const originalFormData = FormData;
const good: AdminGoodRecord = { id: 'capture-owner', code: 'CAPTURE-OWNER', ipId: 'capture-ip', name: 'TEST 배송비 owner', type: '문구', price: 10000, compareAtPrice: null, badge: null, allowBankTransfer: true, saleRestriction: 'none',
  publishedAt: null, firstPublishedAt: null, archivedAt: null, stock: 'ok', stockQty: 10, bg: null,
  imagePath: 'public-media/catalog/good/11111111-1111-4111-8111-111111111111.webp', imageUrl: 'https://example.test/good.webp',
  galleryPaths: [], galleryUrls: [], detailImagePath: null, detailImageUrl: null, description: '저장된 상세설명',
  originId: '11111111-1111-4111-8111-111111111112', shippingFeeType: 'individual', individualFee: 2500,
  notice: { maker: 'TEST 제조자', origin: '대한민국', material: '종이', size: 'A5', madeOn: '2026-10', asManager: 'TEST 담당', asContact: 'TEST 연락처' } };
const variants: AdminGoodsVariant[] = [{ id: '11111111-1111-4111-8111-111111111113', goodId: good.id, name: '기본 옵션', code: 'CAPTURE-01', price: good.price, stockQty: 10, isDefault: true, archivedAt: null }];

function setup(disabled = false, recovered = false, selected: AdminGoodRecord | null = good) {
  const state = recovered ? { values: { previousId: selected?.id ?? '', name: '복구된 실제 편집' } } : {};
  const props = { accountId: 'operator', action: vi.fn(), catalogIps: [], ipOptions: [], pending: false, selected, state, variants: selected ? variants : [],
    origins: [], categories: [], shippingNoticeOptions: [], regionSummaries: [], onEditingStateChange: mocks.reported };
  const outer = GoodEditor(props);
  const element = nodes(outer).find(node => typeof node.type === 'function' && node.type.name === 'GoodEditorForm')!;
  hooks.values = []; hooks.jobs = []; hooks.index = 0;
  const render = () => { hooks.index = 0; const result = (element.type as (props: typeof element.props) => ReactNode)(element.props); for (const job of hooks.jobs.splice(0)) job(); return nodes(result); };
  const ancestor = { disabled };
  const entries = new Map(Object.entries(createGoodEditorDraft(selected, state, selected ? variants : []).values));
  entries.set('previousId', selected?.id ?? ''); entries.set('productAttributeDraft', '[]');
  const form = { closest: () => ancestor.disabled ? ancestor : null } as unknown as HTMLFormElement;
  const reads = vi.fn();
  vi.stubGlobal('FormData', class extends originalFormData { constructor(target?: unknown) { super(); if (target) { reads(); if (!ancestor.disabled) for (const [key, value] of entries) this.set(key, value); } } });
  const tree = render(); (tree.find(node => node.type === 'form')!.props.ref as (form: HTMLFormElement) => void)(form);
  const initialize = () => { const submission = '{"categoryId":null,"schemaRevision":0,"expectedRevision":0,"values":{},"removeIds":[]}'; entries.set('productAttributes', submission);
    (render().find(node => node.type === GoodsAttributeEditor)!.props.onChange as (value: string, draft: string, initial: boolean, preview: unknown[]) => void)(submission, '[]', true, []); };
  const capture = () => mocks.capture?.(new FormData(form));
  return { form, ancestor, entries, reads, render, initialize, capture };
}
function summary(tree: Element[], id: string) { return tree.find(node => node.props.id === id)!.props.summary; }
beforeEach(() => { hooks.values = []; hooks.jobs = []; hooks.index = 0; mocks.capture = null; vi.clearAllMocks(); vi.stubGlobal('window', new EventTarget()); });
afterEach(() => vi.unstubAllGlobals());

it('속성 초기화가 외부 저장 잠금과 겹쳐도 요약과 pristine 상태를 유지하고 해제 후 전체 값으로 비교한다', () => {
  const h = setup(); h.ancestor.disabled = true; h.reads.mockClear(); h.initialize();
  let tree = h.render();
  expect(summary(tree, 'good-section-basic')).toBe(good.name); expect(summary(tree, 'good-section-images')).toContain('대표이미지 등록됨');
  expect(mocks.reported).toHaveBeenLastCalledWith({ goodId: good.id, dirty: false, busy: false }); expect(h.reads).not.toHaveBeenCalled();
  h.ancestor.disabled = false; h.capture(); tree = h.render();
  expect(summary(tree, 'good-section-basic')).toBe(good.name); expect(mocks.reported).toHaveBeenLastCalledWith({ goodId: good.id, dirty: false, busy: false });
  h.entries.set('name', '실제 변경한 상품명'); h.capture(); tree = h.render();
  expect(summary(tree, 'good-section-basic')).toBe('실제 변경한 상품명'); expect(mocks.reported).toHaveBeenLastCalledWith({ goodId: good.id, dirty: true, busy: false });
});

it('처음부터 잠긴 폼은 빈 baseline을 만들지 않고 첫 유효 snapshot에서 초기 기준을 정한다', () => {
  const h = setup(true); h.initialize(); h.render();
  expect(h.reads).not.toHaveBeenCalled(); expect(mocks.reported).toHaveBeenLastCalledWith({ goodId: good.id, dirty: false, busy: false });
  h.ancestor.disabled = false; h.capture(); h.render();
  expect(mocks.reported).toHaveBeenLastCalledWith({ goodId: good.id, dirty: false, busy: false });
});

it('복구된 실제 편집은 잠금과 초기화 이후에도 미저장 상태로 남는다', () => {
  const h = setup(true, true); h.initialize(); h.render(); h.ancestor.disabled = false; h.capture(); const tree = h.render();
  expect(summary(tree, 'good-section-basic')).toBe('복구된 실제 편집'); expect(mocks.reported).toHaveBeenLastCalledWith({ goodId: good.id, dirty: true, busy: false });
});

it('외부 잠금 중 프로그램 제출과 서버 초안 임시저장을 막는다', async () => {
  const h = setup(true, false, null); const tree = h.render(), preventDefault = vi.fn();
  (tree.find(node => node.type === 'form')!.props.onSubmitCapture as (event: unknown) => void)({ currentTarget: h.form, preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce(); expect(mocks.submit).not.toHaveBeenCalled();
  const save = tree.find(node => node.type === 'button' && text(node.props.children as ReactNode) === '임시저장')!;
  await (save.props.onClick as () => Promise<void>)(); expect(mocks.saveServer).not.toHaveBeenCalled(); expect(h.reads).not.toHaveBeenCalled();
});
