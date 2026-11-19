import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import type { AdminCategoryNode } from '@/lib/admin/category';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, jobs: [] as (() => void)[] }));
const mocks = vi.hoisted(() => ({ capture: null as null | ((data: FormData) => void), submit: vi.fn(), saveLocal: vi.fn(), saveServer: vi.fn(), reported: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial; return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }]; },
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.values[index] ??= { current: initial }; },
  useCallback: (callback: unknown) => callback,
  /* 의존값이 그대로면 이전 값을 돌려준다(R19 미리보기 재계산 검증). */
  useMemo: (factory: () => unknown, deps: unknown[]) => {
    const index = hooks.index++;
    const slot = hooks.values[index] as { deps: unknown[]; value: unknown } | undefined;
    if (slot && slot.deps.length === deps.length && slot.deps.every((dep, position) => Object.is(dep, deps[position]))) return slot.value;
    const value = factory(); hooks.values[index] = { deps, value }; return value;
  },
  useDeferredValue: (value: unknown) => value,
  /* 편집기 밖 provider(등록 화면 섹션·펼침 상태)가 없는 단독 렌더다. */
  useContext: () => null,
  useEffect: (callback: () => void) => { hooks.jobs.push(callback); },
}));
vi.mock('./useAdminLocalAutosave', () => ({ useAdminLocalAutosave: () => ({ snapshot: {}, scopeKey: 'capture-test',
  formRef: (_form: HTMLFormElement, callback: (data: FormData) => void) => { mocks.capture = callback; },
  onSubmitCapture: mocks.submit, saveDraft: mocks.saveLocal, discard: vi.fn(), restore: vi.fn(),
}) }));
vi.mock('@/app/admin/goods-draft-actions', () => ({ saveGoodsDraftAction: mocks.saveServer }));
const sanitize = vi.hoisted(() => ({ spy: null as null | ReturnType<typeof vi.fn> }));
const preview = vi.hoisted(() => ({ spy: null as null | ReturnType<typeof vi.fn> }));
vi.mock('@/lib/admin/good-editor', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin/good-editor')>('@/lib/admin/good-editor');
  preview.spy = vi.fn(actual.buildGoodEditorPreview);
  return { ...actual, buildGoodEditorPreview: preview.spy };
});
vi.mock('@/lib/goods-description', async () => {
  const actual = await vi.importActual<typeof import('@/lib/goods-description')>('@/lib/goods-description');
  sanitize.spy = vi.fn(actual.sanitizeGoodsDescription);
  return { ...actual, sanitizeGoodsDescription: sanitize.spy };
});
import { GoodEditor } from './GoodEditor';
import { GoodCategoryField } from './GoodCategoryFields';
import { GoodDraftSwitch } from './GoodPublishControls';
import { GoodsAttributeEditor } from './GoodsAttributeEditor';
import { GoodsImageGrid } from './GoodsImageGrid';
import { GoodWorkspaceErrors } from './GoodWorkspace';
import { createGoodEditorDraft } from '@/lib/admin/good-editor';
import { GoodsPriceFields } from './GoodsPriceFields';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import type { GoodsPriceDraft } from '@/lib/admin/goods-price-editor';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const originalFormData = FormData;
const good: AdminGoodRecord = { id: 'capture-owner', code: 'CAPTURE-OWNER', ipId: 'capture-ip', name: 'TEST 배송비 owner', price: 10000, compareAtPrice: null, badge: null, allowBankTransfer: true, saleRestriction: 'none',
  publishedAt: null, firstPublishedAt: null, archivedAt: null, stock: 'ok', stockQty: 10, bg: null,
  imagePath: 'public-media/catalog/good/11111111-1111-4111-8111-111111111111.webp', imageUrl: 'https://example.test/good.webp',
  galleryPaths: [], galleryUrls: [], detailImagePaths: [], detailImageUrls: [], description: '저장된 상세설명',
  originId: '11111111-1111-4111-8111-111111111112', shippingFeeType: 'individual', individualFee: 2500,
  notice: { maker: 'TEST 제조자', origin: '대한민국', material: '종이', size: 'A5', madeOn: '2026-10', asManager: 'TEST 담당', asContact: 'TEST 연락처' } };
const variants: AdminGoodsVariant[] = [{ id: '11111111-1111-4111-8111-111111111113', goodId: good.id, name: '기본 옵션', code: 'CAPTURE-01', price: good.price, stockQty: 10, isDefault: true, archivedAt: null }];

function setup(disabled = false, recovered = false, selected: AdminGoodRecord | null = good, categories: AdminCategoryNode[] = []) {
  const state = recovered ? { values: { previousId: selected?.id ?? '', name: '복구된 실제 편집' } } : {};
  const props = { accountId: 'operator', action: vi.fn(), catalogIps: [], ipOptions: [], pending: false, selected, state, variants: selected ? variants : [],
    origins: [], categories, shippingNoticeOptions: [], regionSummaries: [], onEditingStateChange: mocks.reported };
  const outer = GoodEditor(props);
  const element = nodes(outer).find(node => typeof node.type === 'function' && node.type.name === 'GoodEditorForm')!;
  hooks.values = []; hooks.jobs = []; hooks.index = 0;
  /* extra: 서버가 다시 그린 것처럼 같은 편집 상태(hooks) 위에 바뀐 props(예: 초안으로 전환된 상품)만 덮어 그린다. */
  const render = (extra: Record<string, unknown> = {}) => { hooks.index = 0; const result = (element.type as (props: typeof element.props) => ReactNode)({ ...element.props, ...extra }); for (const job of hooks.jobs.splice(0)) job(); return nodes(result); };
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
beforeEach(() => { hooks.values = []; hooks.jobs = []; hooks.index = 0; mocks.capture = null; vi.clearAllMocks(); vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', new EventTarget()); });
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

/*
 * TKT-094 — 공개 중 잠긴 칸(changedGoodLockedFields)을 바꿔 저장하면 저장 전 검사가 막는다. 제출 기본 동작을 멈추고 자동복구의 제출 기록
 * (onSubmitCapture → 서버 액션)을 시작하지 않으므로 서버 호출이 없다. 잠기지 않은 칸만 바꾸면 그대로 제출한다.
 */
it('공개 중 잠긴 칸을 바꾼 저장은 서버 호출 없이 막고 그 칸에 초안 전환 안내를 붙인다', () => {
  vi.stubGlobal('document', Object.assign(new EventTarget(), { getElementById: () => null, querySelector: () => null }));
  const published = { ...good, publishedAt: '2026-11-01T00:00:00Z', firstPublishedAt: '2026-11-01T00:00:00Z' };
  const h = setup(false, false, published); h.initialize();
  const submit = (tree: Element[]) => { const preventDefault = vi.fn(); (tree.find(node => node.type === 'form')!.props.onSubmitCapture as (event: unknown) => void)({ currentTarget: h.form, preventDefault }); return preventDefault; };
  h.entries.set('name', '바꾼 상품명'); h.entries.set('noticeOrigin', '일본');
  const blocked = submit(h.render());
  expect(blocked).toHaveBeenCalledOnce(); expect(mocks.submit).not.toHaveBeenCalled();
  expect(h.render().find(node => node.type === GoodWorkspaceErrors)!.props.errors).toMatchObject({
    name: '상품명 항목은 공개 중에 잠겨 있습니다. 초안으로 전환 후 수정해주세요.',
    noticeOrigin: '제조국 항목은 공개 중에 잠겨 있습니다. 초안으로 전환 후 수정해주세요.',
  });
  h.entries.set('name', good.name); h.entries.set('noticeOrigin', good.notice.origin!); h.entries.set('description', '잠기지 않은 상세설명 수정');
  const allowed = submit(h.render());
  expect(allowed).not.toHaveBeenCalled(); expect(mocks.submit).toHaveBeenCalledOnce();
});

/* 10/27 회의 R19 — 업로드 진행·안내 같은 상태 변화마다 상세 HTML 정리와 공개 미리보기를 다시 만들지 않는다. */
it('입력이 그대로면 다시 그려도 상세 HTML 정리·미리보기를 다시 계산하지 않고, 같은 이미지 알림은 상태를 바꾸지 않는다', () => {
  const htmlGood = { ...good, descriptionFormat: 'html' as const, description: '<p>저장된 본문</p>' };
  const h = setup(false, false, htmlGood);
  expect(sanitize.spy).toHaveBeenCalled();
  sanitize.spy!.mockClear(); preview.spy!.mockClear();
  let tree = h.render(); tree = h.render();
  expect(sanitize.spy).not.toHaveBeenCalled();
  expect(preview.spy).not.toHaveBeenCalled();
  const notify = tree.find(node => node.type === GoodsImageGrid)!.props.onPreviewChange as (name: string, url: string | null) => void;
  notify('imagePath', htmlGood.imageUrl!); notify('galleryPath0', null); tree = h.render();
  expect(preview.spy).not.toHaveBeenCalled();
  notify('imagePath', 'blob:new-preview'); tree = h.render();
  expect(preview.spy).toHaveBeenCalledOnce();
  h.entries.set('description', '<p>바뀐 본문</p>'); h.capture(); h.render();
  expect(sanitize.spy).toHaveBeenCalled();
});

/*
 * 리뷰 T3a-6 — 옵션별 구매 제한 표의 입력은 이름 없이(aria-label만) 옵션 행 JSON으로 제출된다. 브라우저 검증에 걸리면
 * 'form'으로 묶여 카테고리로 연결됐다. data-error-field로 구매 제한 칸에 붙이고 보이는 이름(aria-label)으로 안내한다.
 */
it('이름 없는 옵션별 제한 입력의 브라우저 검증 오류를 구매 제한 칸에 보이는 이름으로 붙인다', () => {
  class FakeElement {
    parentElement = null; hidden = false; labels: { textContent: string }[] = [];
    willValidate = true; validity = { valid: false, customError: false };
    scrollIntoView = vi.fn(); focus = vi.fn();
    constructor(public name: string, public dataset: Record<string, string>, private label: string, public validationMessage: string) {}
    getAttribute(attribute: string) { return attribute === 'aria-label' ? this.label : null; }
    closest() { return null; }
  }
  vi.stubGlobal('HTMLInputElement', FakeElement); vi.stubGlobal('HTMLSelectElement', class {}); vi.stubGlobal('HTMLTextAreaElement', class {}); vi.stubGlobal('HTMLDetailsElement', class {});
  const h = setup(false, false, null);
  const first = new FakeElement('', { errorField: 'optionLimits' }, '빨강 최대 구매수량(주문당)', '값은 1 이상이어야 합니다.');
  const second = new FakeElement('', { errorField: 'optionLimits' }, '파랑 1인 최대 구매수량', '유효한 값을 입력하세요.');
  const unnamed = new FakeElement('', {}, '', '값을 입력하세요.');
  const errors = (tree: Element[]) => tree.find(node => node.type === GoodWorkspaceErrors)!.props.errors;
  const invalid = (tree: Element[], elements: FakeElement[]) => (tree.find(node => node.type === 'form')!.props.onInvalidCapture as (event: unknown) => void)({ preventDefault: vi.fn(), currentTarget: { elements } });
  invalid(h.render(), [first, second]);
  let tree = h.render();
  expect(errors(tree)).toMatchObject({ optionLimits: '빨강 최대 구매수량(주문당) 입력값을 확인해주세요. 값은 1 이상이어야 합니다.' });
  expect(errors(tree)).not.toHaveProperty('form');
  expect(first.focus).toHaveBeenCalled();
  /* 이름도 오류 칸도 없는 입력은 지금처럼 form으로 남는다. */
  invalid(tree, [unnamed]);
  tree = h.render();
  expect(errors(tree)).toMatchObject({ form: 'form 입력값을 확인해주세요. 값을 입력하세요.' });
});

/*
 * ADR-0044 — 상품 유형이 없어졌다. 공개 중 상품의 대표 카테고리는 다른 카테고리로 자유롭게 옮길 수 있고(초안 전환 버튼 없음),
 * 비울 수만 없다. 폼은 type을 저장된 값 그대로 싣는다(패스스루 — 새 상품은 '').
 */
const category = (id: string, name: string, parentId: string | null = null): AdminCategoryNode => ({
  id, code: id, name, parentId, depth: parentId ? 2 : 1, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 0, assignedGoodCount: 0,
});
/* 상품속성 제출은 카테고리 id 를 UUID 로만 받는다. */
const FIGURE = '33333333-3333-4333-8333-333333333331', FIGURE_MINI = '33333333-3333-4333-8333-333333333332', DOLL = '33333333-3333-4333-8333-333333333333';
const typeCategories = [category(FIGURE, '피규어'), category(FIGURE_MINI, '미니 피규어', FIGURE), category(DOLL, '인형')];
const publishedGood: AdminGoodRecord = { ...good, categoryId: FIGURE, publishedAt: '2026-11-01T00:00:00Z', firstPublishedAt: '2026-11-01T00:00:00Z' };
const switches = (tree: Element[]) => tree.filter(node => node.type === GoodDraftSwitch);
const chooseCategory = (h: ReturnType<typeof setup>, id: string) => (h.render().find(node => node.type === GoodCategoryField)!.props.onPrimaryChange as (id: string) => void)(id);
/* 상품속성 편집기가 새 카테고리의 조회를 마쳤다고 알린다. 끝나기 전에는 저장 전 검사가 속성 안내로 먼저 막는다. */
const attributesReadyFor = (h: ReturnType<typeof setup>, id: string | null) => (h.render().find(node => node.type === GoodsAttributeEditor)!.props.onChange as (value: string, draft: string, initial: boolean, preview: unknown[]) => void)(
  JSON.stringify({ categoryId: id, schemaRevision: 0, expectedRevision: 0, values: {}, removeIds: [] }), '[]', true, []);
const categoryError = (tree: Element[]) => tree.find(node => node.type === GoodCategoryField)!.props.error;
const hasHiddenType = (tree: Element[]) => tree.some(node => node.type === 'input' && node.props.name === 'type' && node.props.type === 'hidden');
const submitForm = (h: ReturnType<typeof setup>, extra: Record<string, unknown> = {}) => {
  const preventDefault = vi.fn();
  (h.render(extra).find(node => node.type === 'form')!.props.onSubmitCapture as (event: unknown) => void)({ currentTarget: h.form, preventDefault });
  return preventDefault;
};

it('type 숨은 입력을 싣지 않는다(상품 유형 폐기)', () => {
  const stored = setup(false, false, publishedGood, typeCategories);
  expect(hasHiddenType(stored.render())).toBe(false);
  chooseCategory(stored, DOLL);
  expect(hasHiddenType(stored.render())).toBe(false);
  expect(hasHiddenType(setup(false, false, null, typeCategories).render())).toBe(false);
});

it('공개 중 상품의 카테고리를 다른 카테고리로 옮겨도 막지 않고 초안 전환 버튼도 없다', () => {
  vi.stubGlobal('document', Object.assign(new EventTarget(), { getElementById: () => null, querySelector: () => null }));
  const h = setup(false, false, publishedGood, typeCategories);
  chooseCategory(h, DOLL); attributesReadyFor(h, DOLL);
  const tree = h.render();
  expect(categoryError(tree)).toBeUndefined();
  /* 위쪽 잠금 안내의 기존 초안 전환 버튼 하나만 있다(카테고리 오류 아래 버튼은 없다). */
  expect(switches(tree)).toHaveLength(1);
  expect(switches(tree)[0].props.label).toBeUndefined();
  const preventDefault = submitForm(h);
  expect(preventDefault).not.toHaveBeenCalled();
  expect(mocks.submit).toHaveBeenCalledOnce();
});

it('공개 중 상품의 대표 카테고리를 비우면 서버 호출 없이 막고 카테고리 칸에 알린다', () => {
  vi.stubGlobal('document', Object.assign(new EventTarget(), { getElementById: () => null, querySelector: () => null }));
  const h = setup(false, false, publishedGood, typeCategories);
  chooseCategory(h, ''); attributesReadyFor(h, null);
  const blocked = submitForm(h);
  expect(blocked).toHaveBeenCalledOnce();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(h.render().find(node => node.type === GoodWorkspaceErrors)!.props.errors).toMatchObject({ categoryId: '공개 중인 상품은 대표 카테고리를 비울 수 없습니다. 다른 카테고리를 고르거나 비공개로 전환한 뒤 비워주세요.' });
});

it('공개 중 상품의 대표 카테고리 비움 오류는 카테고리를 다시 고르면 바로 지운다', () => {
  vi.stubGlobal('document', Object.assign(new EventTarget(), { getElementById: () => null, querySelector: () => null }));
  const h = setup(false, false, publishedGood, typeCategories);
  chooseCategory(h, ''); attributesReadyFor(h, null);
  submitForm(h);
  const categoryError = () => (h.render().find(node => node.type === GoodWorkspaceErrors)!.props.errors as Record<string, string | undefined>).categoryId;
  expect(categoryError()).toContain('비울 수 없습니다');
  chooseCategory(h, DOLL);
  expect(categoryError()).toBeUndefined();
});

it('대표 카테고리가 원래 없던 공개 상품은 그대로 두고 다른 칸을 저장할 수 있다', () => {
  vi.stubGlobal('document', Object.assign(new EventTarget(), { getElementById: () => null, querySelector: () => null }));
  const h = setup(false, false, { ...publishedGood, categoryId: null }, typeCategories);
  attributesReadyFor(h, null);
  const preventDefault = submitForm(h);
  expect(preventDefault).not.toHaveBeenCalled();
  expect(mocks.submit).toHaveBeenCalledOnce();
});

it('초안 상품과 새 상품에는 초안 전환 버튼이 없다', () => {
  const draft = setup(false, false, { ...publishedGood, publishedAt: null }, typeCategories);
  chooseCategory(draft, DOLL);
  expect(switches(draft.render())).toHaveLength(0);
  const created = setup(false, false, null, typeCategories);
  chooseCategory(created, DOLL);
  expect(switches(created.render())).toHaveLength(0);
});

/*
 * CAT-007·CAT-008 — 판매가를 저장된 금액의 절반 이하·두 배 이상(자릿수 오타)이나 0원·1,000원 미만으로 바꾼 저장은 이전 → 새 판매가를
 * 확인창(adminConfirm)으로 보이고, 확인해야 같은 제출을 다시 보낸다. 취소하면 서버 호출(자동복구 제출 기록)도 없다.
 */
describe('판매가 오입력 확인', () => {
  const changePrice = (h: ReturnType<typeof setup>, regularPrice: string) =>
    (h.render().find(node => node.type === GoodsPriceFields)!.props.onDraftChange as (update: (draft: GoodsPriceDraft) => GoodsPriceDraft) => void)(draft => ({ ...draft, regularPrice }));
  const connect = (h: ReturnType<typeof setup>) => Object.assign(h.form, { isConnected: true, requestSubmit: vi.fn(() => { submitForm(h); }) });

  it('자릿수 오타 판매가는 확인한 뒤에만 제출하고 확인창에 이전 → 새 판매가를 보인다', async () => {
    vi.stubGlobal('document', Object.assign(new EventTarget(), { getElementById: () => null, querySelector: () => null }));
    const confirm = stubAdminConfirm(true);
    try {
      const h = setup(); h.initialize(); connect(h);
      changePrice(h, '1000');
      const first = submitForm(h);
      expect(first).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
      expect(confirm).toHaveBeenCalledOnce();
      expect(confirm.mock.calls[0][0]).toContain('판매가: 10,000원 → 1,000원 (이전 금액의 절반 이하)');
    } finally { confirm.restore(); }
  });

  it('확인을 취소하면 제출하지 않고, 흔한 금액 변경은 묻지 않는다', async () => {
    vi.stubGlobal('document', Object.assign(new EventTarget(), { getElementById: () => null, querySelector: () => null }));
    const confirm = stubAdminConfirm(false);
    try {
      const h = setup(); h.initialize(); const form = connect(h);
      changePrice(h, '100000');
      expect(submitForm(h)).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
      await Promise.resolve();
      expect(form.requestSubmit).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
      changePrice(h, '12000');
      expect(submitForm(h)).not.toHaveBeenCalled();
      expect(mocks.submit).toHaveBeenCalledOnce(); expect(confirm).toHaveBeenCalledOnce();
    } finally { confirm.restore(); }
  });
});

/* CAT-027 — 저장된 상품의 편집 화면은 연 시점의 기본 칸 버전을 숨은 칸으로 보낸다. 새 상품·버전을 읽지 못한 기록에는 싣지 않는다. */
it('저장된 상품은 기본 칸 버전을 숨은 칸으로 싣고 새 상품에는 싣지 않는다', () => {
  const revisionInput = (tree: Element[]) => tree.find(node => node.type === 'input' && node.props.name === 'baseRevision');
  expect(revisionInput(setup(false, false, { ...good, baseRevision: 7 }).render())!.props.value).toBe('7');
  expect(revisionInput(setup(false, false, { ...good, baseRevision: 0 }).render())!.props.value).toBe('0');
  expect(revisionInput(setup(false, false, good).render())).toBeUndefined();
  expect(revisionInput(setup(false, false, null).render())).toBeUndefined();
});
