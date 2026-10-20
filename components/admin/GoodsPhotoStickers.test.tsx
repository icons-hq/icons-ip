import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initialPhotoRecipe, type PhotoRecipe } from '@/lib/admin/photo-editor';
import { PHOTO_STICKERS, photoStickerGeometry, photoPathData } from '@/lib/admin/photo-editor-decorations';
import { GoodsPhotoStickers } from './GoodsPhotoStickers';
import { GoodsPhotoDecorationPreview } from './GoodsPhotoDecorationPreview';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
let recipe: PhotoRecipe, selectedId: string | undefined;
const move = vi.fn();
function render() { return GoodsPhotoStickers({ size: { width: 400, height: 300 }, recipe, selectedId, select: value => { selectedId = value ?? undefined; }, edit: update => { recipe = update(recipe); }, move }); }
function button(name: string) { return nodes(render()).find(node => node.type === 'button' && (node.props['aria-label'] === name || text(node.props.children as ReactNode) === name))!; }
function click(name: string) { (button(name).props.onClick as () => void)(); }
function change(label: string, value: string) {
  const field = nodes(nodes(render()).find(node => node.type === 'label' && text(node.props.children as ReactNode).startsWith(label))?.props.children as ReactNode).find(node => ['input', 'select'].includes(String(node.type)))!;
  (field.props.onChange as (event: unknown) => void)({ target: { value } });
}
beforeEach(() => { recipe = initialPhotoRecipe(); selectedId = undefined; move.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

it('자체 6종을 각각 추가하고 위치·크기·색·회전·불투명도·선택 삭제를 지원한다', () => {
  for (const asset of PHOTO_STICKERS) click(`${asset.label} 스티커 추가`);
  expect(recipe.stickers?.map(layer => layer.asset)).toEqual(PHOTO_STICKERS.map(asset => asset.value));
  change('스티커 크기', '80'); change('스티커 왼쪽 위치', '399'); change('스티커 위쪽 위치', '299'); change('스티커 색상', '#123456'); change('스티커 불투명도', '0');
  click('스티커 오른쪽 90도 회전 · 0도');
  expect(recipe.stickers?.[5]).toMatchObject({ asset: 'ring', width: 80, x: 320, y: 220, turns: 1, color: '#123456', opacity: 0 });
  const first = recipe.stickers![0]; change('편집할 스티커', first.id); click('선택한 스티커 삭제');
  expect(recipe.stickers).toHaveLength(5); expect(recipe.stickers?.some(layer => layer.id === first.id)).toBe(false); expect(selectedId).toBeUndefined();
});
it('8개 한도에서 추가를 막고 방향키 이동은 입력창을 가로채지 않는다', () => {
  for (let i = 0; i < 8; i++) click('별 스티커 추가');
  expect(button('별 스티커 추가').props.disabled).toBe(true); click('하트 스티커 추가'); expect(recipe.stickers).toHaveLength(8);
  const group = nodes(render()).find(node => node.props.role === 'group')!, target = {}, preventDefault = vi.fn();
  const key = group.props.onKeyDown as (event: unknown) => void;
  key({ key: 'ArrowRight', shiftKey: true, target, currentTarget: target, preventDefault });
  key({ key: 'ArrowDown', shiftKey: false, target: {}, currentTarget: target, preventDefault });
  expect(move.mock.calls).toEqual([[10, 0]]); expect(preventDefault).toHaveBeenCalledOnce();
});
it('한도에서 삭제하면 다시 활성화된 추가 버튼으로 다음 프레임에 포커스를 돌리며 닫힌 대화상자는 건드리지 않는다', () => {
  let frame!: FrameRequestCallback; vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  for (let i = 0; i < 8; i++) click('별 스티커 추가');
  const target = { isConnected: true, focus: vi.fn() }, event = { currentTarget: { closest: () => ({ querySelector: () => target }) } };
  (button('선택한 스티커 삭제').props.onClick as (event: unknown) => void)(event);
  expect(target.focus).not.toHaveBeenCalled(); expect(button('별 스티커 추가').props.disabled).toBe(false);
  frame(0); expect(target.focus).toHaveBeenCalledOnce();
  click('별 스티커 추가'); (button('선택한 스티커 삭제').props.onClick as (event: unknown) => void)(event); target.isConnected = false; frame(0);
  expect(target.focus).toHaveBeenCalledOnce();
});
it('썸네일은 Canvas와 같은 숫자 경로만 쓰며 외부 href·입력 SVG·포커스 대상이 없다', () => {
  for (const asset of PHOTO_STICKERS) {
    const paths = photoStickerGeometry(asset.value), markup = renderToStaticMarkup(<GoodsPhotoDecorationPreview paths={paths} />);
    expect(markup).toContain('aria-hidden="true"'); expect(markup).toContain('focusable="false"');
    expect(markup).not.toMatch(/href|<script|foreignObject|url\(|tabindex/i);
    for (const path of paths) expect(markup).toContain(`d="${photoPathData(path.commands)}"`);
  }
});
