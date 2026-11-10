import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { GoodsPhotoLogo } from './GoodsPhotoLogo';
import { initialPhotoRecipe } from '@/lib/admin/photo-editor';
import { fitPhotoLogo, type PhotoLogoDescriptor } from '@/lib/admin/photo-editor-logo';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const content = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? content(value.props.children as ReactNode) : String(value)).join('');
const asset: PhotoLogoDescriptor = { assetId: 'logo', width: 100, height: 200, filename: '로고.png', mimeType: 'image/png', sha256: 'a'.repeat(64) };
function harness(loading = false) {
  const props = { size: { width: 400, height: 300 }, recipe: { ...initialPhotoRecipe(), logo: fitPhotoLogo({ width: 400, height: 300 }, asset) },
    asset, loading, error: '', choose: vi.fn(), remove: vi.fn(), move: vi.fn(), edit: vi.fn() };
  const tree = GoodsPhotoLogo(props); return { props, tree, elements: nodes(tree) };
}
it('파일 취소는 기존 선택을 건드리지 않으며 넘긴 input을 비워 같은 파일 재선택을 허용한다', () => {
  const { props, elements } = harness(), input = elements.find(node => node.type === 'input' && node.props.type === 'file')!;
  const change = input.props.onChange as (event: unknown) => void;
  change({ currentTarget: { files: [], value: '' } }); expect(props.choose).not.toHaveBeenCalled();
  const file = new File(['logo'], 'same.png'), target = { files: [file], value: 'C:\\fakepath\\same.png' };
  change({ currentTarget: target }); expect(props.choose).toHaveBeenCalledExactlyOnceWith(file); expect(target.value).toBe('');
  expect(input.props.accept).toBe('image/jpeg,image/png,image/webp');
});
it('로딩 중 파일·배치는 막고 제거는 유지하며, 키보드 이벤트도 무시한다', () => {
  const { props, elements } = harness(true);
  expect(elements.find(node => node.type === 'input' && node.props.type === 'file')?.props.disabled).toBe(true);
  expect(elements.find(node => node.type === 'fieldset')?.props.disabled).toBe(true);
  const remove = elements.find(node => node.type === 'button' && content(node.props.children as ReactNode) === '로고 제거')!;
  expect(remove.props.disabled).toBeUndefined(); (remove.props.onClick as () => void)(); expect(props.remove).toHaveBeenCalledOnce();
  const move = elements.find(node => node.props.role === 'group')!; expect(move.props.tabIndex).toBe(-1);
  const target = {}; (move.props.onKeyDown as (event: unknown) => void)({ key: 'ArrowRight', target, currentTarget: target, preventDefault: vi.fn() }); expect(props.move).not.toHaveBeenCalled();
});
it('너비와 좌표를 aspect-lock 범위로 맞추고 방향키는 1px·Shift는 10px 이동한다', () => {
  const { props, elements } = harness();
  const label = elements.find(node => node.type === 'label' && content(node.props.children as ReactNode) === '로고 너비 (px)')!;
  const input = nodes(label.props.children as ReactNode).find(node => node.type === 'input')!;
  expect([input.props.min, input.props.max]).toEqual([1.5, 150]);
  (input.props.onChange as (event: unknown) => void)({ target: { value: '999' } });
  const changed = props.edit.mock.calls[0][0](props.recipe); expect(changed.logo.width).toBe(150); expect(changed.logo.y).toBe(0);
  const group = elements.find(node => node.props.role === 'group')!, target = {}, preventDefault = vi.fn();
  for (const shiftKey of [false, true]) (group.props.onKeyDown as (event: unknown) => void)({ key: 'ArrowLeft', shiftKey, target, currentTarget: target, preventDefault });
  expect(props.move.mock.calls).toEqual([[-1, 0], [-10, 0]]); expect(preventDefault).toHaveBeenCalledTimes(2);
});
