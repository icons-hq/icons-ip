import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { GoodsOptionImportContext, GoodsOptionImportSource } from '@/lib/admin/goods-option-import';
import type { GoodsOptionRow } from '@/lib/admin/goods-option-editor';
import type { AdminPickerLoader } from '@/lib/admin/picker';
const mocks = vi.hoisted(() => ({ search: vi.fn(), read: vi.fn(), states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0,
  effects: [] as (() => unknown)[], dependencies: [] as unknown[][], effectIndex: 0,
  initialEffect: null as (() => unknown) | null, initialCleanup: null as (() => unknown) | null }));
vi.mock('@/app/admin/goods-option-import-actions', () => ({ searchGoodsOptionImportAction: mocks.search, readGoodsOptionImportAction: mocks.read }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useId: () => 'picker', useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
  }, useRef: (initial: unknown) => { const index = mocks.refIndex++; return mocks.refs[index] ?? (mocks.refs[index] = { current: initial }); },
  useEffect: (effect: () => unknown, deps: unknown[]) => {
    const index = mocks.effectIndex++;
    if (!mocks.dependencies[index] || deps.some((value, position) => value !== mocks.dependencies[index][position])) {
      mocks.dependencies[index] = deps;
      const setup = () => { const cleanup = effect(); if (!deps.length && typeof cleanup === 'function') mocks.initialCleanup = cleanup as () => unknown; return cleanup; };
      if (!deps.length) mocks.initialEffect = setup;
      mocks.effects.push(setup);
    }
  } };
});
import { AdminPickerPanel } from '@/components/admin/console/AdminPickerDialog';
import { GoodsOptionImportDialog } from './GoodsOptionImportDialog';
type Element = ReactElement<Record<string, unknown>>;
type Row = { id: string; code: string; name: string; imageUrl: null; categoryName: null; published: boolean };
const source: GoodsOptionImportSource = { id: 'source', code: 'SRC', name: '원본 상품', basePrice: 10000, version: 'a'.repeat(64), rows: [{ name: '빨강', attributes: { 색상: '빨강' }, price: 12000 }] };
const sourceRow: Row = { id: 'source', code: 'SRC', name: '원본 상품', imageUrl: null, categoryName: null, published: false };
const blank: GoodsOptionRow = { name: '기본 옵션', attributes: {}, code: '', extraPrice: 0, stockQty: 0 };
let props: Parameters<typeof GoodsOptionImportDialog>[0];
const apply = vi.fn(), close = vi.fn();
const context: GoodsOptionImportContext = { accountId: 'operator', target: null, blockedReason: null, pending: false, databaseVersion: 'initial' };
const APPLY = '이대로 불러오기';
function nodes(node: ReactNode): Element[] { return Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []); }
function text(node: ReactNode): string { return Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join(''); }
function render() { mocks.index = 0; mocks.refIndex = 0; mocks.effectIndex = 0; const result = GoodsOptionImportDialog(props); mocks.effects.splice(0).forEach(effect => effect()); return result; }
function button(label: string) { const found = nodes(render()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === label); if (!found) throw new Error(`Missing button: ${label}`); return found; }
function click(label: string) { (button(label).props.onClick as () => void)(); }
async function settle() { for (let i = 0; i < 14; i++) await Promise.resolve(); }
/** 1단계: 공용 선택창 부품. 화면 시험은 부품을 그리지 않고 넘긴 조회·선택 함수를 직접 부른다. */
function panel() { const found = nodes(render()).find(node => node.type === AdminPickerPanel); if (!found) throw new Error('Missing picker panel'); return found; }
const hasPanel = () => nodes(render()).some(node => node.type === AdminPickerPanel);
/** 목록에서 [선택]을 누른다. 비교가 끝나기를 기다리지 않는다(늦은 응답 시험). */
function pick(row: Row = sourceRow) { void (panel().props.onSelect as (row: Row) => Promise<unknown>)(row); }
async function compare(row: Row = sourceRow) { pick(row); await settle(); }
const readResult = (next = source) => ({ ok: true, accountId: 'operator', source: next, targetVersion: 'new' });
const page = (name = '원본 상품') => ({ ok: true, accountId: 'operator', data: { rows: [{ ...sourceRow, name }], total: 1, page: 1, pageSize: 20 } });
beforeEach(() => {
  vi.clearAllMocks(); mocks.states = []; mocks.index = 0; mocks.refs = []; mocks.refIndex = 0; mocks.effects = []; mocks.dependencies = []; mocks.effectIndex = 0; mocks.initialEffect = null; mocks.initialCleanup = null;
  props = { context, currentRows: [blank], basePrice: 5000, categories: [], fingerprint: 'draft1', onApply: apply, onClose: close };
  apply.mockReturnValue(true);
  mocks.search.mockResolvedValue(page());
  mocks.read.mockResolvedValue(readResult());
});

/* 화면 규칙 2: 고를 수 없는 상품은 조회에서 뺀다. 목록은 "선택형 옵션이 있는 상품만" 조건으로 읽고, 뺀 것을 한 줄로 알린다. */
it('목록은 선택형 옵션이 있는 상품만 조회하고, 뺀 상품을 한 줄로 알린다', async () => {
  const load = () => panel().props.load as AdminPickerLoader<Row>;
  expect(panel().props.excludedNote).toBe('옵션이 없는 상품은 목록에서 뺐습니다.');
  expect(await load()({ query: ' 키링 ', field: 'code', filter: '', page: 2 })).toEqual(page().data);
  expect(mocks.search).toHaveBeenCalledExactlyOnceWith({ query: ' 키링 ', field: 'code', categoryId: '', page: 2, optionSourcesOnly: true });
  /* 저장된 상품을 편집 중이면 그 상품도 조회에서 뺀다(자기 옵션은 불러올 수 없다). */
  props = { ...props, categories: [{ id: 'category', name: '키링' }],
    context: { ...context, target: { id: 'target', publishedAt: null, archivedAt: null, price: 5000, compareAtPrice: null, variants: [] } } };
  expect(panel().props.excludedNote).toBe('옵션이 없는 상품과 지금 편집 중인 상품은 목록에서 뺐습니다.');
  expect(panel().props.filterOptions).toEqual([{ value: '', label: '전체' }, { value: 'category', label: '키링' }]);
  await load()({ query: '', field: '', filter: 'category', page: 1 });
  expect(mocks.search).toHaveBeenLastCalledWith({ query: '', field: 'name', categoryId: 'category', page: 1, optionSourcesOnly: true, excludeGoodId: 'target' });
  /* 그사이 로그인 계정이 바뀐 응답·조회 오류는 목록 대신 이유를 돌려준다. */
  mocks.search.mockResolvedValueOnce({ ...page(), accountId: 'other' });
  expect(await load()({ query: '', field: 'name', filter: '', page: 1 })).toEqual({ error: '로그인 계정이 바뀌었습니다. 상품 화면을 다시 열어주세요.' });
  mocks.search.mockResolvedValueOnce({ ok: false, error: '상품 검색 조건을 확인해주세요.' });
  expect(await load()({ query: '', field: 'name', filter: '', page: 1 })).toEqual({ error: '상품 검색 조건을 확인해주세요.' });
});
it('비교 후에도 최신 원본/대상을 다시 읽고 일치할 때만 지금 입력에 넣는다', async () => {
  await compare();
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ sourceId: 'source', targetId: null });
  expect(hasPanel()).toBe(false); expect(text(render())).toContain('지금 옵션 그대로 0개 · 새 옵션 1개 · 사용 중지 0개 · 옵션가 바뀜 0개');
  expect(button(APPLY).props.disabled).toBe(false); expect(apply).not.toHaveBeenCalled();
  click(APPLY); await settle();
  expect(mocks.read).toHaveBeenCalledTimes(2); expect(apply).toHaveBeenCalledWith(expect.objectContaining({ rows: [{ name: '빨강', attributes: { 색상: '빨강' }, code: '', extraPrice: 0, stockQty: 0, isActive: true }] }), 'draft1'); expect(close).toHaveBeenCalledOnce();
});
it('비교 중 가격·축·옵션 또는 새 DB props가 바뀌면 늦은 응답을 적용하지 않는다', async () => {
  let finish: ((value: unknown) => void) | undefined;
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  pick(); props = { ...props, fingerprint: 'price-or-axis-or-db-changed', basePrice: 7000 }; render();
  finish!(readResult()); await settle();
  /* 목록에 머문 채 이유와 다시 하는 방법(상품을 다시 선택)을 알린다. 불러오기 버튼은 아직 없다. */
  expect(text(render())).toContain('비교하는 동안 지금 상품의 가격이나 옵션이 바뀌었습니다. 입력한 내용은 그대로이니 상품을 다시 선택해 주세요.');
  expect(hasPanel()).toBe(true); expect(() => button(APPLY)).toThrow('Missing button'); expect(apply).not.toHaveBeenCalled();
  /* 다시 고르면 바뀐 입력으로 비교한다. */
  await compare(); expect(button(APPLY).props.disabled).toBe(false); expect(text(render())).toContain('7,000원');
});
it('옵션가 선택이나 현재 입력 변경은 기존 비교를 무효화한다', async () => {
  await compare();
  const checkbox = nodes(render()).find(node => node.type === 'input' && node.props.type === 'checkbox')!;
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  expect(button(APPLY).props.disabled).toBe(true); expect(text(render())).toContain('[다시 비교]를 눌러 주세요.');
  click('다시 비교'); await settle();
  expect(text(render())).toContain('7,000원'); expect(button(APPLY).props.disabled).toBe(false);
  props = { ...props, fingerprint: 'new-input' }; expect(button(APPLY).props.disabled).toBe(true);
});
it('불러오기 직전 서버 변경·계정 변경·읽기 실패는 입력에 손대지 않고 다시 비교하게 한다', async () => {
  await compare();
  mocks.read.mockResolvedValueOnce(readResult({ ...source, version: 'b'.repeat(64), rows: [{ ...source.rows[0], price: 13000 }] }));
  click(APPLY); await settle(); expect(apply).not.toHaveBeenCalled(); expect(text(render())).toContain('비교한 뒤에 고른 상품이나 지금 상품이 다른 곳에서 바뀌었습니다. 불러오지 않았으니 [다시 비교]를 눌러 주세요.');
  /* 한 번 비교한 상품은 비교 화면에 머문다(목록으로 되돌아가 검색을 잃지 않는다). */
  expect(hasPanel()).toBe(false);
  mocks.read.mockResolvedValueOnce({ ...readResult(), accountId: 'other' }); click('다시 비교'); await settle();
  expect(button(APPLY).props.disabled).toBe(true); expect(text(render())).toContain('현재 계정과 불러올 상품을 확인하지 못했습니다. [다시 비교]를 눌러 주세요.');
  mocks.read.mockRejectedValueOnce(new Error('offline')); click('다시 비교'); await settle(); expect(apply).not.toHaveBeenCalled();
  expect(text(render())).toContain('상품과 옵션을 확인하지 못했습니다. 입력한 내용은 그대로이니 [다시 비교]를 눌러 주세요.');
  mocks.read.mockResolvedValueOnce(readResult()); click('다시 비교'); await settle(); expect(button(APPLY).props.disabled).toBe(false);
});
/* 불러올 수 없는 드문 상품(옵션명 구성이 다름·같은 옵션값이 겹침 등)은 조회에서 미리 빼지 못한다. 고르면 원인을 그대로 알리고 목록에 머문다. */
it('불러올 수 없는 상품을 고르면 원인을 알리고 목록에 머물러 다른 상품을 바로 고르게 한다', async () => {
  const reason = '이 상품은 옵션마다 옵션명이 달라 불러올 수 없습니다(색상만 있는 옵션과 색상·사이즈가 있는 옵션이 섞인 경우). 그 상품의 옵션명을 하나로 맞춘 뒤 불러와 주세요.';
  mocks.read.mockResolvedValueOnce({ ok: false, error: reason });
  await compare();
  expect(text(render())).toContain(reason); expect(hasPanel()).toBe(true); expect(apply).not.toHaveBeenCalled();
  await compare({ ...sourceRow, name: '다른 상품' });
  expect(hasPanel()).toBe(false); expect(text(render())).toContain('다른 상품'); expect(text(render())).not.toContain(reason);
  /* [다른 상품 고르기]는 비교를 버리고 목록으로 돌아간다. */
  click('다른 상품 고르기'); expect(hasPanel()).toBe(true); expect(() => button(APPLY)).toThrow('Missing button');
});
it('고른 뒤 대상이 공개/보관되거나 상품 저장 중이면 불러올 수 없다', async () => {
  await compare();
  props = { ...props, context: { ...context, blockedReason: '비공개 초안으로 전환해주세요.' } };
  expect(button(APPLY).props.disabled).toBe(true); expect(text(render())).toContain('비공개 초안으로 전환해주세요.'); expect(apply).not.toHaveBeenCalled();
  props = { ...props, context: { ...context, pending: true } };
  expect(button(APPLY).props.disabled).toBe(true); expect(button('다시 비교').props.disabled).toBe(true);
  expect(text(render())).toContain('상품을 저장하고 있습니다. 저장이 끝난 뒤 다시 눌러 주세요.');
  click(APPLY); await settle(); expect(apply).not.toHaveBeenCalled(); expect(mocks.read).toHaveBeenCalledTimes(1);
});
/*
 * 목록 조회의 경합(느린 응답이 새 검색을 덮지 않는다)은 이제 공용 선택창 부품의 일이다. 이 창이 넘긴 값으로 그 부품을 그려,
 * 예전 이 창의 시험이 지키던 동작이 구조를 바꾼 뒤에도 그대로인지 본다.
 */
it.each(['success', 'error'])('StrictMode의 오래된 초기 %s 응답은 새 검색 목록·오류·busy를 덮어쓰지 않는다', async (lateKind) => {
  let initialA: ((value: unknown) => void) | undefined, initialB: ((value: unknown) => void) | undefined, latestC: ((value: unknown) => void) | undefined;
  mocks.search.mockImplementationOnce(() => new Promise(resolve => { initialA = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { initialB = resolve; })).mockImplementationOnce(() => new Promise(resolve => { latestC = resolve; }));
  const list = () => {
    mocks.index = 0; mocks.refIndex = 0; mocks.effectIndex = 0;
    const found = nodes(GoodsOptionImportDialog(props)).find(node => node.type === AdminPickerPanel)!;
    const tree = (AdminPickerPanel as unknown as (props: Record<string, unknown>) => ReactNode)(found.props);
    mocks.effects.splice(0).forEach(effect => effect());
    return tree;
  };
  list(); mocks.initialCleanup!(); mocks.initialEffect!();
  initialB!(page('초기 최신 목록')); await settle(); expect(text(list())).toContain('초기 최신 목록');
  (nodes(list()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === '검색')!.props.onClick as () => void)();
  initialA!(lateKind === 'success' ? page('오래된 목록') : { ok: false, error: '오래된 조회 오류' }); await settle();
  expect(text(list())).toContain('불러오고 있습니다.'); expect(text(list())).not.toContain('오래된');
  latestC!(page('현재 검색 목록')); await settle(); expect(text(list())).toContain('현재 검색 목록'); expect(text(list())).not.toContain('오래된');
  expect(mocks.search).toHaveBeenCalledTimes(3);
  for (const call of mocks.search.mock.calls) expect(call[0]).toMatchObject({ optionSourcesOnly: true });
});
it('불러오기 전 재조회 중 닫은 뒤 늦게 도착한 응답은 작성 폼을 바꾸지 않는다', async () => {
  await compare();
  let finish: ((value: unknown) => void) | undefined;
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  click(APPLY); expect(button('닫기').props.disabled).toBeUndefined(); click('닫기'); mocks.initialCleanup!();
  finish!(readResult()); await settle(); expect(close).toHaveBeenCalledOnce(); expect(apply).not.toHaveBeenCalled(); expect(props.currentRows).toEqual([blank]);
});
