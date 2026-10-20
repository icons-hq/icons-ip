import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0,
  effects: [] as (() => void)[], portal: vi.fn<(child: unknown, target: unknown) => unknown>(child => child), write: vi.fn() }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual,
    useState: (initial: unknown) => {
      const index = hooks.index++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next; }];
    },
    useRef: (initial: unknown) => { const index = hooks.refIndex++; return hooks.refs[index] ?? (hooks.refs[index] = { current: initial }); },
    useEffect: (effect: () => (() => void) | undefined) => { if (!hooks.effects.length) { const cleanup = effect(); if (cleanup) hooks.effects.push(cleanup); } },
  };
});
vi.mock('react-dom', () => ({ createPortal: hooks.portal }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
import { CountryNameFinder, CountryNamePicker, GoodsOriginField } from './CountryNameFinder';
import { Field } from './fields';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
let props: Parameters<typeof CountryNameFinder>[0];
const apply = vi.fn(), close = vi.fn();
function render() { hooks.index = 0; hooks.refIndex = 0; return CountryNameFinder(props); }
function button(name: string) { return nodes(render()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === name)!; }
function click(name: string) { (button(name).props.onClick as () => void)(); }
function search(query: string) { (nodes(render()).find(node => node.type === 'input' && node.props.type === 'search')!.props.onChange as (event: unknown) => void)({ target: { value: query } }); }
function select(code: string) { (nodes(render()).find(node => node.type === 'input' && node.props.type === 'radio' && node.props.value === code)!.props.onChange as () => void)(); }
function selectRegion(label: string, value: string) {
  const field = nodes(render()).find(node => node.type === 'label' && text(node.props.children as ReactNode).startsWith(label))!;
  (nodes(field.props.children as ReactNode).find(node => node.type === 'select')!.props.onChange as (event: unknown) => void)({ target: { value } });
}
async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => {
  vi.clearAllMocks(); hooks.states = []; hooks.index = 0; hooks.refs = []; hooks.refIndex = 0; hooks.effects = [];
  props = { mode: 'apply', currentValue: '대한민국(경기도)', disabled: false, onApply: apply, onClose: close };
  apply.mockReturnValue(true); hooks.write.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText: hooks.write } });
});
afterEach(() => vi.unstubAllGlobals());

it('검색·선택만으로 입력을 바꾸지 않고 적용할 때 한국어 문자열만 전달한다', () => {
  search('KOR'); select('KR');
  expect(apply).not.toHaveBeenCalled(); expect(text(render())).toContain('대한민국(경기도)');
  expect(nodes(render()).find(node => node.type === 'input' && node.props.readOnly)!.props.value).toBe('대한민국');
  click('현재 입력에 적용'); expect(apply).toHaveBeenCalledExactlyOnceWith('대한민국'); expect(close).toHaveBeenCalledOnce();
});
it('선택 후 공개·보관/저장 잠금이 생기면 적용하지 않고 취소는 입력을 바꾸지 않는다', () => {
  search('JP'); select('JP'); props = { ...props, disabled: true } as typeof props;
  expect(button('현재 입력에 적용').props.disabled).toBe(true); click('현재 입력에 적용'); expect(apply).not.toHaveBeenCalled();
  click('취소'); expect(close).toHaveBeenCalledOnce();
});
it('적용 대상이 사라지거나 읽기 전용이 되면 창을 닫지 않고 현재 입력을 유지한다', () => {
  search('CN'); select('CN'); apply.mockReturnValue(false); click('현재 입력에 적용');
  expect(close).not.toHaveBeenCalled(); expect(text(render())).toContain('현재 입력을 바꿀 수 없습니다');
});
it('20개씩 페이지를 이동하고 새 검색은 이전 선택과 페이지를 초기화한다', () => {
  expect(nodes(render()).filter(node => node.props.name === 'countryNameChoice')).toHaveLength(20); click('다음');
  expect(text(render())).toContain('2 / 13'); search('Hong Kong'); select('HK');
  expect(text(render())).toContain('1 / 1'); search('없는국가');
  expect(button('현재 입력에 적용').props.disabled).toBe(true); expect(text(render())).toContain('직접 입력할 수도');
});
it('국내 시도·일반구는 최종 문구를 확인한 뒤 한 번만 기존 입력에 적용한다', () => {
  select('domestic'); expect(button('현재 입력에 적용').props.disabled).toBe(true);
  selectRegion('시·도', '4100000000');
  expect(nodes(render()).find(node => node.props.readOnly)!.props.value).toBe('대한민국(경기도)');
  selectRegion('시·군·구', '4111700000');
  expect(nodes(render()).find(node => node.props.readOnly)!.props.value).toBe('대한민국(경기도 수원시 영통구)');
  expect(apply).not.toHaveBeenCalled(); click('현재 입력에 적용');
  expect(apply).toHaveBeenCalledExactlyOnceWith('대한민국(경기도 수원시 영통구)');
});
it('시도 변경은 이전 일반구를 지우고 세종에는 중복 두 번째 단계를 만들지 않는다', () => {
  select('domestic'); selectRegion('시·도', '4100000000'); selectRegion('시·군·구', '4111700000');
  selectRegion('시·도', '3600000000');
  expect(nodes(render()).filter(node => node.type === 'select')).toHaveLength(1);
  expect(nodes(render()).find(node => node.props.readOnly)!.props.value).toBe('대한민국(세종특별자치시)');
  selectRegion('시·도', '4100000000');
  expect(nodes(render()).find(node => node.props.readOnly)!.props.value).toBe('대한민국(경기도)');
  select('country'); expect(button('현재 입력에 적용').props.disabled).toBe(true);
  select('domestic'); expect(button('현재 입력에 적용').props.disabled).toBe(true);
  expect(apply).not.toHaveBeenCalled();
});
it('국내 상세 문구도 엑셀용으로 복사하고 잠금이 생긴 상품에는 적용하지 않는다', async () => {
  props = { mode: 'copy', onClose: close }; select('domestic'); selectRegion('시·도', '4100000000'); selectRegion('시·군·구', '4111700000');
  click('제조국 값 복사'); await settle();
  expect(hooks.write).toHaveBeenCalledExactlyOnceWith('대한민국(경기도 수원시 영통구)');
  expect(apply).not.toHaveBeenCalled();
  props = { mode: 'apply', currentValue: '기존 자유문구', disabled: true, onApply: apply, onClose: close };
  expect(button('현재 입력에 적용').props.disabled).toBe(true); click('현재 입력에 적용');
  expect(apply).not.toHaveBeenCalled();
});
it('엑셀 복사는 코드가 아닌 제조국 명칭이며 클립보드 실패 시 직접 복사할 값을 남긴다', async () => {
  props = { mode: 'copy', onClose: close }; search('JP'); select('JP'); hooks.write.mockRejectedValueOnce(new Error('denied'));
  click('제조국 값 복사'); await settle();
  expect(hooks.write).toHaveBeenCalledWith('일본'); expect(text(render())).toContain('직접 복사해주세요');
  expect(nodes(render()).find(node => node.type === 'input' && node.props.readOnly)!.props.value).toBe('일본');
  click('제조국 값 복사'); await settle(); expect(text(render())).toContain('제조국 값을 복사했습니다'); expect(apply).not.toHaveBeenCalled();
});
it('검색 Enter와 portal의 change/submit은 상품 폼에 전파하지 않는다', () => {
  const preventDefault = vi.fn(), stopPropagation = vi.fn();
  (nodes(render()).find(node => node.props.type === 'search')!.props.onKeyDown as (event: unknown) => void)({ key: 'Enter', preventDefault, stopPropagation });
  expect(preventDefault).toHaveBeenCalledOnce(); expect(stopPropagation).toHaveBeenCalledOnce();
  const body = {}; vi.stubGlobal('document', { body }); CountryNamePicker(props);
  expect(hooks.portal).toHaveBeenCalledWith(expect.anything(), body);
  const container = hooks.portal.mock.calls[0][0] as Element;
  expect(container.props.className).toContain('wc-root wc-admin');
  (container.props.onChange as (event: unknown) => void)({ stopPropagation }); expect(stopPropagation).toHaveBeenCalledTimes(2);
});
it('복사 중 창을 닫으면 늦은 응답으로 상태나 다른 폼을 바꾸지 않는다', async () => {
  props = { mode: 'copy', onClose: close }; search('US'); select('US');
  let finish!: () => void; hooks.write.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  click('제조국 값 복사'); click('취소'); hooks.effects[0](); const before = [...hooks.states]; finish(); await settle();
  expect(hooks.states).toEqual(before); expect(close).toHaveBeenCalledOnce(); expect(apply).not.toHaveBeenCalled();
});
it('원산지 필드는 기존 자유 입력을 유지하고 선택 적용 때 그 입력 하나에만 input을 보낸다', () => {
  const field = Object.assign(new EventTarget(), { value: '직접 입력한 복수 원산지', readOnly: false, disabled: false });
  const nativeInput = vi.fn(); field.addEventListener('input', nativeInput);
  let fieldProps = { defaultValue: '직접 입력한 복수 원산지', label: '원산지', readOnly: false, required: false, disabled: false };
  const renderField = () => { hooks.index = 0; hooks.refIndex = 0; return GoodsOriginField(fieldProps); };
  renderField(); const querySelector = vi.fn(() => field); hooks.refs[0].current = { querySelector };
  (nodes(renderField()).find(node => node.type === 'button')!.props.onClick as () => void)();
  const picker = () => nodes(renderField()).find(node => node.type === CountryNamePicker)!;
  expect(picker().props.currentValue).toBe('직접 입력한 복수 원산지'); expect(field.value).toBe('직접 입력한 복수 원산지');
  expect((picker().props.onApply as (name: string) => boolean)('대한민국')).toBe(true);
  expect(field.value).toBe('대한민국'); expect(nativeInput).toHaveBeenCalledOnce();
  expect(querySelector).toHaveBeenLastCalledWith('input[name="noticeOrigin"]');
  expect(nodes(renderField()).find(node => node.type === Field)!.props.name).toBe('noticeOrigin');
  fieldProps = { ...fieldProps, readOnly: true }; expect((picker().props.onApply as (name: string) => boolean)('일본')).toBe(false);
  fieldProps = { ...fieldProps, readOnly: false, disabled: true }; expect((picker().props.onApply as (name: string) => boolean)('중국')).toBe(false);
  expect(field.value).toBe('대한민국'); expect(nativeInput).toHaveBeenCalledOnce();
});
