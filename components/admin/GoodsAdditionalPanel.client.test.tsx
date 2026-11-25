import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 저장된 상품의 추가 구성 패널: 연결 목록은 공용 부품이 맡고, 저장 계약(연결 순서·기준 버전)은 그대로다. */
const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), check: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
  },
  useTransition: () => [false, (task: () => void) => { void task(); }],
}));
vi.mock('@/app/admin/goods-additional-actions', () => ({ saveGoodsAdditionalAction: mocks.save, readGoodsAdditionalAction: mocks.read, checkGoodsAdditionalCandidateAction: mocks.check }));
vi.mock('@/app/admin/goods-option-import-actions', () => ({ searchGoodsOptionImportAction: vi.fn() }));

import type { AdminAdditionalGood, AdminAdditionalGoods } from '@/lib/admin/goods-additional';
import { Button } from '@/components/admin/kit/ui/button';
import { GOODS_ADDITIONAL_INTRO, GoodsAdditionalLinks } from './GoodsAdditionalLinks';
import { AdditionalEditor } from './GoodsAdditionalPanel';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');

const item = (goodId: string, extra: Partial<AdminAdditionalGood> = {}): AdminAdditionalGood => ({ goodId, name: `상품 ${goodId}`, available: true, ...extra });
const onSaved = vi.fn();
let configuration: AdminAdditionalGoods;
function view() {
  hooks.index = 0;
  const tree = AdditionalEditor({ goodId: 'hw-base', configuration, onSaved });
  const all = nodes(tree);
  return { all, links: all.find(node => node.type === GoodsAdditionalLinks)!, save: all.find(node => node.type === Button && node.props.type === 'button' && text(node.props.children as ReactNode).includes('저장'))!,
    alerts: all.filter(node => node.type === 'p' && node.props.role === 'alert').map(node => text(node.props.children as ReactNode)) };
}

beforeEach(() => { hooks.states = []; hooks.index = 0; vi.clearAllMocks(); configuration = { revision: 3, items: [item('hw-a'), item('hw-b', { available: false })] }; });

describe('저장된 상품의 추가 구성 패널', () => {
  it('저장된 연결을 공용 연결 목록에 그대로 보인다(이 상품은 자기 자신을 연결할 수 없다)', () => {
    const { links } = view();
    expect(links.props).toMatchObject({ baseGoodId: 'hw-base', items: configuration.items, disabled: false });
  });
  it('연결 목록을 고치고 저장하면 보이는 순서 그대로 상품 번호 목록과 읽을 때의 기준 버전을 보낸다', async () => {
    mocks.save.mockResolvedValue({ ok: true, message: '추가상품 연결과 표시 순서를 저장했습니다.' });
    (view().links.props.onChange as (update: (current: AdminAdditionalGood[]) => AdminAdditionalGood[]) => void)(current => [current[1], current[0], item('hw-c')]);
    await (view().save.props.onClick as () => Promise<void> | void)();
    await Promise.resolve(); await Promise.resolve();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith('hw-base', ['hw-b', 'hw-a', 'hw-c'], 3);
    expect(onSaved).toHaveBeenCalledWith('추가상품 연결과 표시 순서를 저장했습니다.');
  });
  it('저장하지 못하면 이유를 보이고 완료로 알리지 않는다', async () => {
    mocks.save.mockResolvedValue({ ok: false, error: '추가상품 설정이 변경되었습니다. 새로고침한 뒤 다시 저장해주세요.' });
    await (view().save.props.onClick as () => Promise<void> | void)();
    await Promise.resolve(); await Promise.resolve();
    expect(view().alerts).toEqual(['추가상품 설정이 변경되었습니다. 새로고침한 뒤 다시 저장해주세요.']);
    expect(onSaved).not.toHaveBeenCalled();
  });
  it('아직 한 번도 저장하지 않은 상품은 기준 버전 없이 보낸다', async () => {
    configuration = { revision: null, items: [] };
    mocks.save.mockResolvedValue({ ok: true, message: '저장했습니다.' });
    (view().links.props.onChange as (update: (current: AdminAdditionalGood[]) => AdminAdditionalGood[]) => void)(current => [...current, item('hw-a')]);
    await (view().save.props.onClick as () => Promise<void> | void)();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith('hw-base', ['hw-a'], null);
  });
  it('안내는 두 화면이 같은 한 줄이다', () => {
    expect(GOODS_ADDITIONAL_INTRO).toContain('연결한 상품은 각자의 옵션·가격 그대로 팔립니다.');
  });
});
