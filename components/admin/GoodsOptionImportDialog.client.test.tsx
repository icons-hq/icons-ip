import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { GoodsOptionImportContext, GoodsOptionImportSource } from '@/lib/admin/goods-option-import';
import type { GoodsOptionRow } from '@/lib/admin/goods-option-editor';
const mocks = vi.hoisted(() => ({ search: vi.fn(), read: vi.fn(), states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0,
  effects: [] as (() => unknown)[], dependencies: [] as unknown[][], effectIndex: 0,
  initialEffect: null as (() => unknown) | null, initialCleanup: null as (() => unknown) | null }));
vi.mock('@/app/admin/goods-option-import-actions', () => ({ searchGoodsOptionImportAction: mocks.search, readGoodsOptionImportAction: mocks.read }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useState: (initial: unknown) => {
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
import { GoodsOptionImportDialog } from './GoodsOptionImportDialog';
type Element = ReactElement<Record<string, unknown>>;
const source: GoodsOptionImportSource = { id: 'source', code: 'SRC', name: '원본 상품', basePrice: 10000, version: 'a'.repeat(64), rows: [{ name: '빨강', attributes: { 색상: '빨강' }, price: 12000 }] };
const blank: GoodsOptionRow = { name: '기본 옵션', attributes: {}, code: '', extraPrice: 0, stockQty: 0 };
let props: Parameters<typeof GoodsOptionImportDialog>[0];
const apply = vi.fn(), close = vi.fn();
const context: GoodsOptionImportContext = { accountId: 'operator', target: null, blockedReason: null, pending: false, databaseVersion: 'initial' };
function nodes(node: ReactNode): Element[] { return Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []); }
function text(node: ReactNode): string { return Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join(''); }
function render() { mocks.index = 0; mocks.refIndex = 0; mocks.effectIndex = 0; const result = GoodsOptionImportDialog(props); mocks.effects.splice(0).forEach(effect => effect()); return result; }
function button(label: string) { const found = nodes(render()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === label); if (!found) throw new Error(`Missing button: ${label}`); return found; }
function click(label: string) { (button(label).props.onClick as () => void)(); }
async function settle() { for (let i = 0; i < 14; i++) await Promise.resolve(); }
async function open() { render(); await settle(); render(); }
const readResult = (next = source) => ({ ok: true, accountId: 'operator', source: next, targetVersion: 'new' });
beforeEach(() => {
  vi.clearAllMocks(); mocks.states = []; mocks.index = 0; mocks.refs = []; mocks.refIndex = 0; mocks.effects = []; mocks.dependencies = []; mocks.effectIndex = 0; mocks.initialEffect = null; mocks.initialCleanup = null;
  props = { context, currentRows: [blank], basePrice: 5000, categories: [], fingerprint: 'draft1', onApply: apply, onClose: close };
  apply.mockReturnValue(true);
  mocks.search.mockResolvedValue({ ok: true, accountId: 'operator', data: { rows: [{ id: 'source', code: 'SRC', name: '원본 상품', imageUrl: null, categoryName: null, published: false }], total: 1, page: 1, pageSize: 20 } });
  mocks.read.mockResolvedValue(readResult());
});
it('비교 후에도 최신 원본/대상을 다시 읽고 일치할 때만 현재 초안에 적용한다', async () => {
  await open(); click('옵션 비교'); await settle();
  expect(button('현재 초안에 적용').props.disabled).toBe(false); expect(apply).not.toHaveBeenCalled();
  click('현재 초안에 적용'); await settle();
  expect(mocks.read).toHaveBeenCalledTimes(2); expect(apply).toHaveBeenCalledWith(expect.objectContaining({ rows: [{ name: '빨강', attributes: { 색상: '빨강' }, code: '', extraPrice: 0, stockQty: 0, isActive: true }] }), 'draft1'); expect(close).toHaveBeenCalledOnce();
});
it('비교 중 가격·축·옵션 또는 새 DB props가 바뀌면 늦은 응답을 적용하지 않는다', async () => {
  await open(); let finish: ((value: unknown) => void) | undefined;
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  click('옵션 비교'); props = { ...props, fingerprint: 'price-or-axis-or-db-changed', basePrice: 7000 }; render();
  finish!(readResult()); await settle();
  expect(text(render())).toContain('다시 비교'); expect(button('현재 초안에 적용').props.disabled).toBe(true); expect(apply).not.toHaveBeenCalled();
});
it('원본 옵션가 선택이나 현재 입력 변경은 기존 비교를 무효화한다', async () => {
  await open(); click('옵션 비교'); await settle();
  const checkbox = nodes(render()).find(node => node.type === 'input' && node.props.type === 'checkbox')!;
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  expect(button('현재 초안에 적용').props.disabled).toBe(true); click('다시 비교'); await settle();
  expect(text(render())).toContain('7,000원'); expect(button('현재 초안에 적용').props.disabled).toBe(false);
  props = { ...props, fingerprint: 'new-input' }; expect(button('현재 초안에 적용').props.disabled).toBe(true);
});
it('적용 직전 서버 변경·계정 변경·읽기 실패는 입력에 손대지 않고 재비교하게 한다', async () => {
  await open(); click('옵션 비교'); await settle();
  mocks.read.mockResolvedValueOnce(readResult({ ...source, version: 'b'.repeat(64), rows: [{ ...source.rows[0], price: 13000 }] }));
  click('현재 초안에 적용'); await settle(); expect(apply).not.toHaveBeenCalled(); expect(text(render())).toContain('저장 정보가 바뀌었습니다');
  mocks.read.mockResolvedValueOnce({ ...readResult(), accountId: 'other' }); click('다시 비교'); await settle();
  expect(button('현재 초안에 적용').props.disabled).toBe(true); expect(text(render())).toContain('현재 계정');
  mocks.read.mockRejectedValueOnce(new Error('offline')); click('다시 비교'); await settle(); expect(apply).not.toHaveBeenCalled(); expect(text(render())).toContain('현재 입력을 유지');
});
it('선택 이후 대상이 공개/보관되거나 상품 저장 중이면 적용할 수 없다', async () => {
  await open(); click('옵션 비교'); await settle();
  props = { ...props, context: { ...context, blockedReason: '비공개 초안으로 전환해주세요.' } };
  expect(button('현재 초안에 적용').props.disabled).toBe(true); expect(apply).not.toHaveBeenCalled();
});
it.each(['success', 'error'])('StrictMode의 오래된 초기 %s 응답은 새 검색 목록·오류·busy를 덮어쓰지 않는다', async (lateKind) => {
  let initialA: ((value: unknown) => void) | undefined, initialB: ((value: unknown) => void) | undefined, latestC: ((value: unknown) => void) | undefined;
  mocks.search.mockImplementationOnce(() => new Promise(resolve => { initialA = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { initialB = resolve; })).mockImplementationOnce(() => new Promise(resolve => { latestC = resolve; }));
  const result = (name: string) => ({ ok: true, accountId: 'operator', data: { rows: [{ id: 'source', code: 'SRC', name, imageUrl: null, categoryName: null, published: false }], total: 1, page: 1, pageSize: 20 } });
  render(); mocks.initialCleanup!(); mocks.initialEffect!();
  initialB!(result('초기 최신 목록')); await settle(); render(); click('검색');
  initialA!(lateKind === 'success' ? result('오래된 목록') : { ok: false, error: '오래된 조회 오류' }); await settle();
  expect(text(render())).toContain('상품 정보를 확인하고 있습니다.'); expect(text(render())).not.toContain('오래된');
  latestC!(result('현재 검색 목록')); await settle(); expect(text(render())).toContain('현재 검색 목록'); expect(text(render())).not.toContain('오래된');
});
it('적용 전 재조회 중 취소·닫기 후 늦게 도착한 응답은 작성 폼을 바꾸지 않는다', async () => {
  await open(); click('옵션 비교'); await settle();
  let finish: ((value: unknown) => void) | undefined;
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  click('현재 초안에 적용'); expect(button('취소').props.disabled).toBeUndefined(); click('취소'); mocks.initialCleanup!();
  finish!(readResult()); await settle(); expect(close).toHaveBeenCalledOnce(); expect(apply).not.toHaveBeenCalled(); expect(props.currentRows).toEqual([blank]);
});
