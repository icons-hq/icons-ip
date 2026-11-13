import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AdminCouponRecord } from '@/lib/admin/coupons';
const mocks = vi.hoisted(() => ({ confirm: vi.fn(async () => true) }));
vi.mock('@/app/admin/coupon-actions', () => ({ setAdminCouponStatusAction: vi.fn() }));
vi.mock('@/app/admin/coupon-target-actions', () => ({ searchCouponTargetGoodsAction: vi.fn() }));
vi.mock('@/lib/admin/leave-guard', async (original) => ({ ...await original<typeof import('@/lib/admin/leave-guard')>(), confirmAdminLeave: mocks.confirm }));
import { CouponSection } from './CouponSection';
import { normalizeAdminCouponFilters } from '@/lib/admin/coupons';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');

function render(selected: AdminCouponRecord | null, onSelect: (record: { id: string } | null) => void) {
  return nodes(CouponSection({ action: () => {}, draft: null, filters: normalizeAdminCouponFilters({}), onSelect, pageSize: 20, pending: false, records: [], selected, state: {}, total: 0, mode: selected ? 'list' : 'create' }));
}
const editorCancel = (tree: Element[]) => tree.find(node => typeof node.type === 'function' && node.type.name === 'CouponEditor')!.props.onCancel as () => void;
const backToList = (tree: Element[]) => tree.find(node => text(node) === '목록으로' && typeof node.props.onClick === 'function')!.props.onClick as () => void;

beforeEach(() => { mocks.confirm.mockReset(); mocks.confirm.mockResolvedValue(true); });

it('등록 화면의 취소 버튼은 공용 확인을 거치고, 취소하면 화면에 남는다', async () => {
  const onSelect = vi.fn();
  mocks.confirm.mockResolvedValue(false);
  editorCancel(render(null, onSelect))(); await Promise.resolve(); await Promise.resolve();
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect(onSelect).not.toHaveBeenCalled();
});

it('등록 화면의 취소 버튼은 확인하면(또는 묻지 않아도 되면) 목록으로 돌아간다', async () => {
  const onSelect = vi.fn();
  editorCancel(render(null, onSelect))(); await Promise.resolve(); await Promise.resolve();
  expect(onSelect).toHaveBeenCalledWith(null);
});

it('수정 화면의 목록으로 버튼도 같은 확인을 거친다', async () => {
  const selected = { id: 'SPRING', code: 'SPRING', name: '봄 혜택', targetGoodIds: [], targetGoods: [] } as unknown as AdminCouponRecord;
  const onSelect = vi.fn();
  mocks.confirm.mockResolvedValueOnce(false);
  const back = backToList(render(selected, onSelect));
  back(); await Promise.resolve(); await Promise.resolve();
  expect(onSelect).not.toHaveBeenCalled();
  back(); await Promise.resolve(); await Promise.resolve();
  expect(onSelect).toHaveBeenCalledWith(null);
});
