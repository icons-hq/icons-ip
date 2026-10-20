import { Children, isValidElement, type ReactElement, type ReactNode, type SetStateAction } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { planGoodsOptionImport, type GoodsOptionImportPlan } from '@/lib/admin/goods-option-import';
import type { GoodsOptionRow } from '@/lib/admin/goods-option-editor';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0 }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next; }]; } };
});
import { GoodsOptionEditor } from './GoodsOptionEditor';
import { GoodsOptionImportPicker } from './GoodsOptionImportDialog';
type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] { return Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []); }
function text(node: ReactNode): string { return Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join(''); }
let rows: GoodsOptionRow[];
const applied = vi.fn();
function render(blockedReason: string | null = null) { hooks.index = 0; return GoodsOptionEditor({ rows, baseline: [], basePrice: 5000, onRowsChange: (next: SetStateAction<GoodsOptionRow[]>) => { rows = typeof next === 'function' ? next(rows) : next; },
  optionImport: { accountId: 'operator', target: null, databaseVersion: 'new', pending: false, blockedReason, categories: [], onApplied: applied } }); }
beforeEach(() => { vi.clearAllMocks(); hooks.states = []; hooks.index = 0; rows = [{ name: '기본 옵션', attributes: {}, code: '', extraPrice: 0, stockQty: 0 }]; });
it('불러온 행·세 축·옵션 사용 상태를 같이 바꾸고 전체 초안 보관을 알린다', () => {
  const opener = nodes(render()).find(node => node.type === 'button' && text(node) === '다른 상품 옵션 불러오기')!;
  (opener.props.onClick as () => void)();
  const dialog = nodes(render()).find(node => node.type === GoodsOptionImportPicker)!;
  const planned = planGoodsOptionImport({ current: rows, basePrice: 5000, includePrices: false, source: { id: 'source', code: 'SRC', name: '원본', basePrice: 10000, version: 'a'.repeat(64),
    rows: [{ name: '빨강 M 기본', attributes: { 색상: '빨강', 크기: 'M', 포장: '기본' }, price: 10000 }] } });
  if (!planned.ok) throw new Error(planned.error);
  const apply = dialog.props.onApply as (plan: GoodsOptionImportPlan, fingerprint: string) => boolean;
  expect(apply(planned.plan, 'stale')).toBe(false); expect(applied).not.toHaveBeenCalled();
  expect(apply(planned.plan, dialog.props.fingerprint as string)).toBe(true);
  expect(rows[0]).toMatchObject({ attributes: { 색상: '빨강', 크기: 'M', 포장: '기본' }, stockQty: 0 }); expect(applied).toHaveBeenCalledOnce();
  const tree = render(), inputs = nodes(tree).find(node => Array.isArray(node.props.axes))!;
  expect(inputs.props.axes).toEqual([{ name: '색상', values: '빨강' }, { name: '크기', values: 'M' }, { name: '포장', values: '기본' }]);
  expect(nodes(tree).find(node => node.type === 'input' && node.props.name === 'optionUsage' && node.props.value === 'on')!.props.checked).toBe(true);
});
it('공개·보관 대상은 불러오기 진입부터 잠근다', () => {
  const tree = render('상품을 비공개 초안으로 전환해주세요.');
  expect(nodes(tree).find(node => node.type === 'button' && text(node) === '다른 상품 옵션 불러오기')!.props.disabled).toBe(true);
  expect(text(tree)).toContain('비공개 초안으로 전환');
});
