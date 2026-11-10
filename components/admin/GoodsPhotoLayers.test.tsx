import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { initialPhotoRecipe, type PhotoRecipe } from '@/lib/admin/photo-editor';
import { GoodsPhotoLayers, type PhotoLayerKind, type PhotoSelection } from './GoodsPhotoLayers';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
let recipe: PhotoRecipe, selection: PhotoSelection, kind: PhotoLayerKind;
let textMode: 'plain' | 'bubble' | 'signature';
const move = vi.fn(), reportError = vi.fn();
function render() { return GoodsPhotoLayers({ kind, textMode, size: { width: 400, height: 300 }, recipe, selection, select: value => { selection = value; }, edit: update => { recipe = update(recipe); }, move, reportError }); }
function button(name: string) { return nodes(render()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === name)!; }
function click(name: string) { (button(name).props.onClick as () => void)(); }
function input(label: string) { return nodes(nodes(render()).find(node => node.type === 'label' && text(node.props.children as ReactNode).startsWith(label))?.props.children as ReactNode).find(node => ['input', 'textarea', 'select'].includes(String(node.type)))!; }
function change(label: string, value: string) { (input(label).props.onChange as (event: unknown) => void)({ target: { value } }); }
beforeEach(() => { recipe = initialPhotoRecipe(); selection = null; kind = 'text'; textMode = 'plain'; move.mockClear(); reportError.mockClear(); });

it('여러 한글 텍스트의 내용·줄바꿈·색·크기·좌표를 독립 편집하고 선택 삭제한다', () => {
  click('텍스트 추가'); change('텍스트 내용', '한글 문구\n둘째 줄'); change('텍스트 색상', '#12ab34'); change('텍스트 크기', '40');
  change('텍스트 왼쪽 위치', '390'); change('텍스트 위쪽 위치', '290');
  const first = recipe.texts[0];
  expect(first).toMatchObject({ text: '한글 문구\n둘째 줄', color: '#12ab34', fontSize: 40, x: 390, y: 290 });
  click('텍스트 추가'); change('텍스트 내용', '두 번째'); expect(recipe.texts).toHaveLength(2); expect(recipe.texts[0]).toEqual(first);
  change('편집할 텍스트', first.id); click('선택한 텍스트 삭제');
  expect(recipe.texts.map(layer => layer.text)).toEqual(['두 번째']); expect(selection).toBeNull();
});
it('각 도구는 독립적으로 8개까지 추가하고 9번째를 거절한다', () => {
  for (let index = 0; index < 8; index++) click('텍스트 추가');
  expect(button('텍스트 추가').props.disabled).toBe(true); click('텍스트 추가'); expect(recipe.texts).toHaveLength(8);
  kind = 'mosaic';
  for (let index = 0; index < 8; index++) click(index % 2 ? '원 모자이크 추가' : '사각 모자이크 추가');
  expect(button('사각 모자이크 추가').props.disabled).toBe(true); expect(recipe.mosaics).toHaveLength(8); expect(recipe.texts).toHaveLength(8);
});
it('사각·원 영역은 크기·강도·위치·삭제를 지원하고 원 지름 변경 시 높이도 같다', () => {
  kind = 'mosaic'; click('사각 모자이크 추가'); change('모자이크 너비', '150'); change('모자이크 높이', '100');
  change('모자이크 왼쪽 위치', '399'); change('모자이크 위쪽 위치', '299'); change('모자이크 강도', '32');
  expect(recipe.mosaics[0]).toMatchObject({ shape: 'rectangle', x: 250, y: 200, width: 150, height: 100, blockSize: 32 });
  click('원 모자이크 추가'); change('원 지름', '200'); expect(recipe.mosaics[1]).toMatchObject({ shape: 'circle', width: 200, height: 200 });
  click('선택한 모자이크 삭제'); expect(recipe.mosaics).toHaveLength(1);
});
it('키보드 이동 영역은 화면 방향의 1px·10px 이동을 전달하고 폼 입력 화살표는 가로채지 않는다', () => {
  click('텍스트 추가');
  const group = nodes(render()).find(node => node.props.role === 'group')!, preventDefault = vi.fn();
  const target = {};
  (group.props.onKeyDown as (event: unknown) => void)({ key: 'ArrowRight', shiftKey: true, target, currentTarget: target, preventDefault });
  (group.props.onKeyDown as (event: unknown) => void)({ key: 'ArrowDown', shiftKey: false, target, currentTarget: target, preventDefault });
  expect(move.mock.calls).toEqual([[10, 0], [0, 1]]); expect(preventDefault).toHaveBeenCalledTimes(2);
  (group.props.onKeyDown as (event: unknown) => void)({ key: 'ArrowDown', shiftKey: false, target: {}, currentTarget: target, preventDefault });
  expect(move).toHaveBeenCalledTimes(2);
});
it('텍스트 초과 입력은 마지막 유효 문구를 보존하고 빈 문구는 제거와 같은 픽셀 효과를 가진다', () => {
  click('텍스트 추가'); change('텍스트 내용', '유효'); change('텍스트 내용', '\n'.repeat(8)); expect(recipe.texts[0].text).toBe('유효');
  change('텍스트 내용', '가'.repeat(301)); expect(recipe.texts[0].text).toBe('유효');
  change('텍스트 내용', ''); expect(recipe.texts[0].text).toBe('');
});
it('말풍선·서명 스타일 교체는 ID·문구·위치와 8개 한도를 공유하며 중복 추가하지 않는다', () => {
  click('텍스트 추가'); change('텍스트 내용', '한글\n설명'); const first = recipe.texts[0];
  textMode = 'bubble'; click('둥근 말풍선'); expect(recipe.texts).toHaveLength(1);
  expect(recipe.texts[0]).toMatchObject({ id: first.id, text: first.text, x: first.x, y: first.y, style: 'bubble-round', backgroundColor: '#ffffff' });
  click('타원 말풍선'); textMode = 'signature'; click('라벨 서명'); click('원형 서명');
  expect(recipe.texts).toHaveLength(1); expect(recipe.texts[0]).toMatchObject({ id: first.id, text: first.text, style: 'signature-seal' });
  click('일반 텍스트로 변경'); expect(recipe.texts[0]).toMatchObject({ style: 'plain', text: first.text });
  for (let i = 1; i < 8; i++) click('새 텍스트 서명 추가');
  expect(recipe.texts).toHaveLength(8); expect(button('새 텍스트 서명 추가').props.disabled).toBe(true);
  click('선 서명'); expect(recipe.texts).toHaveLength(8); expect(recipe.texts[7].style).toBe('signature-rule');
});
it('장식의 80자·줄 제한과 스타일 전환 실패는 입력을 자르지 않고 알려준다', () => {
  click('텍스트 추가'); change('텍스트 내용', '가'.repeat(81)); const previous = recipe.texts[0];
  textMode = 'bubble'; click('둥근 말풍선'); expect(recipe.texts[0]).toEqual(previous); expect(reportError).toHaveBeenCalledWith(expect.stringContaining('80자'));
  change('텍스트 내용', '한\n두\n세'); click('둥근 말풍선'); textMode = 'signature'; click('원형 서명');
  expect(recipe.texts[0].style).toBe('bubble-round'); expect(reportError).toHaveBeenLastCalledWith(expect.stringContaining('2줄'));
  change('텍스트 내용', '한\n두'); click('원형 서명'); change('장식 너비', '180'); change('장식 배경색', '#ffff00');
  expect(recipe.texts[0]).toMatchObject({ style: 'signature-seal', decorationWidth: 180, backgroundColor: '#ffff00' });
  change('텍스트 내용', '한\n두\n세'); expect(recipe.texts[0].text).toBe('한\n두');
  change('텍스트 내용', ''); expect(recipe.texts[0].text).toBe('');
});
