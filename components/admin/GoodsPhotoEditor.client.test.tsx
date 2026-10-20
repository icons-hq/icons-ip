import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const harness = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0,
  callbacks: [] as { deps: readonly unknown[]; value: unknown }[], callbackIndex: 0,
  effects: [] as { deps: readonly unknown[]; cleanup?: () => void }[], effectIndex: 0, pending: [] as (() => void)[],
  portal: vi.fn<(child: unknown, target: unknown) => unknown>(child => child), open: vi.fn(), preview: vi.fn(), render: vi.fn(), dispose: vi.fn(), replaceLogo: vi.fn(), clearLogo: vi.fn(), estimateStraighten: vi.fn() }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const effect = (callback: () => void | (() => void), deps: readonly unknown[]) => {
    const index = harness.effectIndex++, previous = harness.effects[index];
    if (previous && deps.every((value, part) => Object.is(value, previous.deps[part]))) return;
    harness.pending.push(() => {
      previous?.cleanup?.(); const cleanup = callback();
      harness.effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
    });
  };
  return { ...actual,
    useState: (initial: unknown) => {
      const index = harness.index++;
      if (!(index in harness.states)) harness.states[index] = typeof initial === 'function' ? initial() : initial;
      return [harness.states[index], (next: unknown) => { harness.states[index] = typeof next === 'function' ? next(harness.states[index]) : next; }];
    },
    useRef: (initial: unknown) => { const index = harness.refIndex++; return harness.refs[index] ?? (harness.refs[index] = { current: initial }); },
    useEffect: effect, useLayoutEffect: effect, useCallback: (callback: unknown, deps: readonly unknown[]) => {
      const index = harness.callbackIndex++, previous = harness.callbacks[index];
      if (previous && deps.every((value, part) => Object.is(value, previous.deps[part]))) return previous.value;
      harness.callbacks[index] = { deps, value: callback }; return callback;
    },
  };
});
vi.mock('react-dom', () => ({ createPortal: harness.portal }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/lib/admin/photo-editor-session', () => ({ createPhotoEditSession: harness.open }));
import { GoodsPhotoEditor } from './GoodsPhotoEditor';
import { GoodsPhotoLogo } from './GoodsPhotoLogo';
import { GoodsPhotoStickers } from './GoodsPhotoStickers';
import { GoodsPhotoLayers } from './GoodsPhotoLayers';
import type { PhotoLogoDescriptor } from '@/lib/admin/photo-editor-logo';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
let props: Parameters<typeof GoodsPhotoEditor>[0];
const onApply = vi.fn(), onCancel = vi.fn();
function render() {
  harness.index = 0; harness.refIndex = 0; harness.effectIndex = 0; harness.callbackIndex = 0;
  const wrapper = GoodsPhotoEditor(props) as unknown as Element;
  const body = nodes(wrapper).find(node => typeof node.type === 'function')!;
  const result = (body.type as (props: unknown) => ReactNode)(body.props);
  for (const effect of harness.pending.splice(0)) effect();
  return result;
}
function button(name: string) { return nodes(render()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === name)!; }
function click(name: string) { (button(name).props.onClick as () => void)(); }
async function settle() { for (let index = 0; index < 8; index++) await Promise.resolve(); }
async function loaded() { render(); await settle(); render(); await settle(); render(); }
async function refreshPreview() { render(); await settle(); render(); }
function unmount() { for (const effect of harness.effects) effect?.cleanup?.(); }
function logoControls() { return nodes(render()).find(node => node.type === GoodsPhotoLogo)!.props as Parameters<typeof GoodsPhotoLogo>[0]; }
const logoDescriptor = (id: string): PhotoLogoDescriptor => ({ assetId: id, filename: 'same.png', width: 100, height: 50, sha256: 'a'.repeat(64), mimeType: 'image/png' });
beforeEach(() => {
  vi.clearAllMocks(); harness.states = []; harness.refs = []; harness.effects = []; harness.pending = []; harness.callbacks = [];
  harness.replaceLogo.mockReset(); harness.clearLogo.mockReset(); harness.open.mockReset(); harness.preview.mockReset(); harness.render.mockReset(); harness.dispose.mockReset(); harness.estimateStraighten.mockReset();
  props = { sourcePath: 'public-media/catalog/good/00000000-0000-4000-8000-000000000001.png', onApply, onCancel };
  harness.open.mockResolvedValue({ size: { width: 400, height: 300 }, preview: harness.preview, render: harness.render, dispose: harness.dispose, replaceLogo: harness.replaceLogo, clearLogo: harness.clearLogo, estimateStraighten: harness.estimateStraighten });
  harness.preview.mockResolvedValue({ blob: new Blob(['preview'], { type: 'image/png' }), width: 400, height: 300 });
  harness.render.mockResolvedValue(null); harness.estimateStraighten.mockResolvedValue({ degrees: -5, reason: 'detected', edgeSamples: 100 });
  vi.stubGlobal('document', { body: {} });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo-preview'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('폼 바깥 portal에서 로드하며 입력·제출을 상품 폼에 전달하지 않는다', async () => {
  await loaded(); expect(harness.open).toHaveBeenCalledExactlyOnceWith(props.sourcePath, expect.any(AbortSignal));
  expect(harness.portal).toHaveBeenCalledWith(expect.anything(), document.body);
  const wrapper = harness.portal.mock.calls[0][0] as Element, stopPropagation = vi.fn(), preventDefault = vi.fn();
  (wrapper.props.onChange as (event: unknown) => void)({ stopPropagation });
  (wrapper.props.onSubmit as (event: unknown) => void)({ preventDefault, stopPropagation });
  expect(stopPropagation).toHaveBeenCalledTimes(2); expect(preventDefault).toHaveBeenCalledOnce();
  expect(onApply).not.toHaveBeenCalled();
});
it('변경 없는 완료는 null을 전달하고 직접 업로드하지 않는다', async () => {
  await loaded(); expect(button('완료').props.disabled).toBe(false); click('완료'); await settle();
  expect(onApply).toHaveBeenCalledExactlyOnceWith(null); expect(onCancel).not.toHaveBeenCalled();
});
it('액자·말풍선·서명·스티커를 구별해 열고 액자 스타일만 고르면 무변경 두께를 유지한다', async () => {
  await loaded(); click('액자·도형'); click('이중선 액자'); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ frameStyle: 'double', frameWidth: 0 });
  click('말풍선'); expect(nodes(render()).find(node => node.type === GoodsPhotoLayers)?.props).toMatchObject({ kind: 'text', textMode: 'bubble' });
  click('텍스트 서명'); expect(nodes(render()).find(node => node.type === GoodsPhotoLayers)?.props).toMatchObject({ kind: 'text', textMode: 'signature' });
  click('스티커'); expect(nodes(render()).some(node => node.type === GoodsPhotoStickers)).toBe(true);
  click('로고·서명'); expect(nodes(render()).some(node => node.type === GoodsPhotoLogo)).toBe(true);
});
it('스티커 선택 이동은 텍스트로 흐르지 않고 원본 비교·재설정에서 전체 장식을 처리한다', async () => {
  await loaded(); click('스티커');
  const panel = nodes(render()).find(node => node.type === GoodsPhotoStickers)!.props as Parameters<typeof GoodsPhotoStickers>[0];
  const sticker = { id: 'sticker', asset: 'arrow' as const, x: 20, y: 30, width: 50, turns: 0 as const, opacity: 100, color: '#ff0000' };
  panel.edit(recipe => ({ ...recipe, stickers: [sticker], texts: [{ id: 'text', text: '보존', x: 5, y: 5, fontSize: 12, color: '#ffffff' }] })); panel.select(sticker.id); await refreshPreview();
  let marker = nodes(render()).find(node => node.type === 'button' && node.props['aria-label'] === '선택 영역 이동: 드래그 또는 방향키')!;
  const preventDefault = vi.fn(); (marker.props.onKeyDown as (event: unknown) => void)({ key: 'ArrowRight', shiftKey: true, preventDefault }); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ stickers: [{ x: 30, y: 30 }], texts: [{ x: 5, y: 5 }] });
  click('오른쪽 90도 회전'); await refreshPreview();
  marker = nodes(render()).find(node => node.type === 'button' && node.props['aria-label'] === '선택 영역 이동: 드래그 또는 방향키')!;
  (marker.props.onKeyDown as (event: unknown) => void)({ key: 'ArrowRight', shiftKey: false, preventDefault }); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ stickers: [{ x: 30, y: 29 }], texts: [{ x: 5, y: 5 }] });
  click('원본 보기'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ stickers: [], texts: [] });
  click('편집 결과 보기'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0].stickers).toHaveLength(1);
  click('편집 시작 상태로 재설정'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ stickers: [], texts: [], frameStyle: 'solid' });
  expect(nodes(render()).some(node => node.props['aria-label'] === '선택 영역 이동: 드래그 또는 방향키')).toBe(false);
});
it('스티커 드래그 취소는 시작 좌표로 돌아가고 다른 레이어를 움직이지 않는다', async () => {
  await loaded(); click('스티커');
  const panel = nodes(render()).find(node => node.type === GoodsPhotoStickers)!.props as Parameters<typeof GoodsPhotoStickers>[0];
  const first = { id: 'first', asset: 'heart' as const, x: 20, y: 30, width: 50, turns: 0 as const, opacity: 100, color: '#ff0000' };
  panel.edit(recipe => ({ ...recipe, stickers: [first, { ...first, id: 'second', x: 100 }] })); panel.select(first.id); await refreshPreview();
  const marker = () => nodes(render()).find(node => node.type === 'button' && node.props['aria-label'] === '선택 영역 이동: 드래그 또는 방향키')!;
  const currentTarget = { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn(), parentElement: { getBoundingClientRect: () => ({ width: 400, height: 300 }) } };
  (marker().props.onPointerDown as (event: unknown) => void)({ isPrimary: true, button: 0, pointerId: 1, clientX: 10, clientY: 10, currentTarget });
  panel.select('second');
  (marker().props.onPointerMove as (event: unknown) => void)({ pointerId: 1, clientX: 30, clientY: 40, currentTarget }); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0].stickers).toMatchObject([{ id: 'first', x: 40, y: 60 }, { id: 'second', x: 100, y: 30 }]);
  (marker().props.onPointerCancel as (event: unknown) => void)({ pointerId: 1, currentTarget }); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0].stickers).toMatchObject([{ id: 'first', x: 20, y: 30 }, { id: 'second', x: 100, y: 30 }]);
  expect(currentTarget.releasePointerCapture).toHaveBeenCalledWith(1);
});

it('자동 수평 분석은 중복·완료·편집을 잠그고 반전 방향에 맞춰 한 번 설정한다', async () => {
  await loaded(); click('좌우 반전'); await refreshPreview();
  let finish!: (value: unknown) => void;
  harness.estimateStraighten.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  click('자동 수평 맞춤'); click('자동 수평 맞춤'); click('오른쪽 90도 회전'); click('완료');
  expect(harness.estimateStraighten).toHaveBeenCalledOnce(); expect(harness.render).not.toHaveBeenCalled();
  expect(button('완료').props.disabled).toBe(true);
  expect(nodes(render()).find(node => node.type === 'fieldset')?.props.disabled).toBe(true);
  finish({ degrees: -5.2, reason: 'detected', edgeSamples: 100 }); await settle(); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ straightenDegrees: 5.2, turns: 0, flipX: true });
  expect(button('완료').props.disabled).toBe(false);
  harness.estimateStraighten.mockResolvedValueOnce({ degrees: -5.2, reason: 'detected', edgeSamples: 100 });
  click('자동 수평 맞춤'); await settle(); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0].straightenDegrees).toBe(5.2);
  click('원본 보기'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0].straightenDegrees).toBe(0);
  click('편집 결과 보기'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0].straightenDegrees).toBe(5.2);
});
it.each(['cancel', 'source'] as const)('수평 분석 중 %s는 늦은 결과를 무시하고 분석을 중단한다', async action => {
  await loaded(); let finish!: (value: unknown) => void;
  harness.estimateStraighten.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  click('자동 수평 맞춤'); const active = harness.estimateStraighten.mock.calls[0][0] as AbortSignal;
  if (action === 'cancel') click('취소'); else { props = { ...props, sourcePath: 'public-media/catalog/other.png' }; render(); }
  expect(active.aborted).toBe(true); finish({ degrees: 12, reason: 'detected', edgeSamples: 100 }); await settle(); await refreshPreview();
  expect(harness.preview.mock.calls.every(([recipe]) => recipe.straightenDegrees === 0)).toBe(true); expect(onApply).not.toHaveBeenCalled();
});
it('수평 각도 입력은 0.1도·15도 한도를 지키고 모호한 자동 분석은 현재 각도와 다른 효과를 유지한다', async () => {
  await loaded();
  const label = nodes(render()).find(node => node.type === 'label' && text(node.props.children as ReactNode) === '수평 보정 각도 (도)')!;
  const input = nodes(label.props.children as ReactNode).find(node => node.type === 'input')!;
  expect(input.props).toMatchObject({ min: -15, max: 15, step: .1, value: 0 });
  (input.props.onChange as (event: unknown) => void)({ target: { value: '16.28' } }); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0].straightenDegrees).toBe(15);
  harness.estimateStraighten.mockResolvedValueOnce({ degrees: null, reason: 'ambiguous', edgeSamples: 100 });
  click('자동 수평 맞춤'); await settle(); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0].straightenDegrees).toBe(15);
  expect(text(render())).toContain('현재 각도는 유지'); expect(button('완료').props.disabled).toBe(false);
  click('수평 보정 해제'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0].straightenDegrees).toBe(0);
});
it('최종 미리보기 준비 전 적용을 막고 완료 시 최신 onApply prop에 파일을 전달한다', async () => {
  await loaded(); click('오른쪽 90도 회전'); expect(button('완료').props.disabled).toBe(true); await settle(); render();
  const file = new File(['edited'], 'edited-photo.png', { type: 'image/png' }); let finish!: (value: File) => void;
  harness.render.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  click('완료'); const latest = vi.fn(); props = { ...props, onApply: latest }; render(); finish(file); await settle();
  expect(latest).toHaveBeenCalledExactlyOnceWith(file); expect(onApply).not.toHaveBeenCalled();
});
it('취소는 렌더를 중단하고 늦게 온 결과를 부모에 전달하지 않는다', async () => {
  await loaded(); let finish!: (value: File) => void;
  harness.render.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  click('완료'); const signal = harness.render.mock.calls[0][1] as AbortSignal; click('취소');
  expect(signal.aborted).toBe(true); expect(harness.dispose).toHaveBeenCalled();
  finish(new File(['late'], 'late.png')); await settle(); expect(onApply).not.toHaveBeenCalled(); expect(onCancel).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-preview');
});
it('로드 중 취소하면 늦게 열린 세션도 정리하고 미리보기를 만들지 않는다', async () => {
  let finish!: (value: unknown) => void; harness.open.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(); click('취소'); finish({ size: { width: 400, height: 300 }, preview: harness.preview, render: harness.render, dispose: harness.dispose, replaceLogo: harness.replaceLogo, clearLogo: harness.clearLogo, estimateStraighten: harness.estimateStraighten }); await settle();
  expect(harness.dispose).toHaveBeenCalled(); expect(harness.preview).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
});
it('자르기는 확인 후 완료할 수 있고 재설정은 편집 시작 recipe로 돌아간다', async () => {
  await loaded(); click('자르기'); expect(button('완료').props.disabled).toBe(true);
  const ratio = nodes(render()).find(node => node.type === 'select')!;
  (ratio.props.onChange as (event: unknown) => void)({ target: { value: '1:1' } });
  expect(text(render())).toContain('300 × 300px'); click('자르기 확인'); await refreshPreview();
  click('편집 시작 상태로 재설정'); await refreshPreview();
  expect(text(render())).toContain('400 × 300px'); expect(button('완료').props.disabled).toBe(false);
});
it('인코딩 실패 이유를 보여주며 부모 입력은 바꾸지 않는다', async () => {
  await loaded(); harness.render.mockRejectedValueOnce(new Error('편집 결과가 5MB를 넘습니다.'));
  click('완료'); await settle(); expect(text(render())).toContain('편집 결과가 5MB를 넘습니다.'); expect(onApply).not.toHaveBeenCalled();
});

it('선명도·두 블러·비네팅의 범위와 공간 의미를 표시하고 정수 입력을 최신 recipe에 반영한다', async () => {
  await loaded();
  const initial = nodes(render()).filter(node => node.type === 'input' && node.props.type === 'range');
  expect(initial).toHaveLength(8);
  expect(initial.slice(4).map(node => [node.props.min, node.props.max, node.props.step, node.props.value])).toEqual([[-100, 100, 1, 0], [0, 100, 1, 0], [0, 100, 1, 0], [0, 100, 1, 0]]);
  expect(text(render())).toContain('중앙의 가로 띠 안을 선명하게 두고 바깥을 흐리게');
  expect(text(render())).toContain('자르기에 따라 중심이 이동하지 않습니다');
  function number(label: string, value: string) {
    const field = nodes(render()).find(node => node.type === 'label' && text(node.props.children as ReactNode) === `${label} 값`)!;
    const input = nodes(field.props.children as ReactNode).find(node => node.type === 'input')!;
    (input.props.onChange as (event: unknown) => void)({ target: { value } });
  }
  number('선명도', '-101'); number('원형 블러', '33.6'); number('선형 블러', '-10'); number('비네팅', '120');
  await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ sharpness: -100, circularBlur: 34, linearBlur: 0, vignette: 100 });
  click('편집 시작 상태로 재설정'); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ sharpness: 0, circularBlur: 0, linearBlur: 0, vignette: 0 });
  expect(button('완료').props.disabled).toBe(false);
});

it('자동 명암은 명시적으로 켜고 원본 비교와 재설정에서는 끈다', async () => {
  await loaded();
  const checkbox = nodes(render()).find(node => node.type === 'input' && node.props.type === 'checkbox')!;
  expect(checkbox.props.checked).toBe(false);
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } }); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ automaticLevels: true });
  click('원본 보기'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ automaticLevels: false });
  click('편집 결과 보기'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ automaticLevels: true });
  click('편집 시작 상태로 재설정'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ automaticLevels: false });
});

it('로고 로드 중 중복 선택·완료를 막고 새 asset ID를 현재 recipe에 반영한다', async () => {
  await loaded(); click('로고·서명'); let finish!: (value: PhotoLogoDescriptor) => void;
  harness.replaceLogo.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const file = new File(['logo'], 'same.png'); logoControls().choose(file); logoControls().choose(file);
  expect(harness.replaceLogo).toHaveBeenCalledOnce(); expect(button('완료').props.disabled).toBe(true); expect(logoControls().loading).toBe(true);
  const previousPreviewCount = harness.preview.mock.calls.length; render(); await settle(); expect(harness.preview).toHaveBeenCalledTimes(previousPreviewCount);
  finish(logoDescriptor('A')); await settle(); await refreshPreview();
  expect(logoControls().asset?.assetId).toBe('A'); expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ logo: { assetId: 'A', x: 294, y: 244, width: 100, opacity: 100 } });
  expect(button('완료').props.disabled).toBe(false);
  logoControls().edit(current => ({ ...current, logo: { ...current.logo!, x: 20, y: 30, width: 50, opacity: 45 } })); await refreshPreview();
  harness.replaceLogo.mockResolvedValueOnce(logoDescriptor('B')); logoControls().choose(file); await settle(); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0].logo).toEqual({ assetId: 'B', x: 20, y: 30, width: 50, opacity: 45 });
});
it.each(['remove', 'reset', 'cancel'] as const)('로고 선택 중 %s는 즉시 허용하고 늦은 descriptor를 recipe나 부모에 전달하지 않는다', async action => {
  await loaded(); click('로고·서명'); let finish!: (value: PhotoLogoDescriptor) => void;
  harness.replaceLogo.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  logoControls().choose(new File(['logo'], 'same.png'));
  const requested = harness.replaceLogo.mock.calls[0][1] as AbortSignal;
  if (action === 'remove') logoControls().remove(); else if (action === 'reset') click('편집 시작 상태로 재설정'); else click('취소');
  expect(requested.aborted).toBe(true); finish(logoDescriptor('late')); await settle(); await refreshPreview();
  expect(harness.preview.mock.calls.every(([value]) => value.logo === null)).toBe(true); expect(onApply).not.toHaveBeenCalled();
  if (action !== 'cancel') { expect(logoControls().asset).toBeNull(); expect(button('완료').props.disabled).toBe(false); }
  else expect(onCancel).toHaveBeenCalledOnce();
});
it('교체 실패는 로고 오류만 표시하고 기존 로고로 완료하며 비교·재설정은 초기 상태를 보인다', async () => {
  await loaded(); click('로고·서명'); harness.replaceLogo.mockResolvedValueOnce(logoDescriptor('A'));
  logoControls().choose(new File(['logo'], 'same.png')); await settle(); await refreshPreview();
  harness.replaceLogo.mockRejectedValueOnce(new Error('파일 형식 오류')); logoControls().choose(new File(['bad'], 'same.png')); await settle(); await refreshPreview();
  expect(logoControls().error).toBe('파일 형식 오류'); expect(logoControls().asset?.assetId).toBe('A'); expect(button('완료').props.disabled).toBe(false);
  click('원본 보기'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0].logo).toBeNull();
  click('편집 결과 보기'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0].logo.assetId).toBe('A');
  click('편집 시작 상태로 재설정'); await refreshPreview(); expect(logoControls().asset).toBeNull(); expect(harness.clearLogo).toHaveBeenCalledOnce();
});
it('로고 이동은 다른 영역 선택과 독립이며 90도 회전 뒤 화면 방향을 원본 좌표로 바꾼다', async () => {
  await loaded(); click('로고·서명'); harness.replaceLogo.mockResolvedValueOnce(logoDescriptor('A'));
  logoControls().choose(new File(['logo'], 'same.png')); await settle(); await refreshPreview();
  click('오른쪽 90도 회전'); await refreshPreview(); logoControls().move(-10, 0); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0].logo).toMatchObject({ x: 294, y: 250 });
  click('텍스트'); click('로고·서명'); const marker = nodes(render()).find(node => node.type === 'button' && node.props['aria-label'] === '선택 영역 이동: 드래그 또는 방향키');
  expect(marker).toBeDefined();
});

it('테두리·도형은 자르기 중 숨긴 뒤 복원하며 최종 1픽셀 crop에서는 테두리 두께를 0으로 제한한다', async () => {
  await loaded(); click('액자·도형'); click('흰 테두리');
  const mask = nodes(render()).find(node => node.type === 'select')!;
  (mask.props.onChange as (event: unknown) => void)({ target: { value: 'circle' } }); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ mask: 'circle', frameWidth: 8, frameColor: '#ffffff' });
  expect(text(render())).toContain('JPG 사진도 PNG로 바뀝니다');
  click('자르기'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ mask: 'none', frameWidth: 0 });
  expect(button('완료').props.disabled).toBe(true);
  click('자르기 확인'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ mask: 'circle', frameWidth: 8 });
  click('자르기');
  const ratio = nodes(render()).find(node => node.type === 'select')!;
  (ratio.props.onChange as (event: unknown) => void)({ target: { value: 'free' } });
  for (const label of ['자를 너비 (px)', '자를 높이 (px)']) {
    const field = nodes(render()).find(node => node.type === 'label' && text(node.props.children as ReactNode) === label)!;
    const input = nodes(field.props.children as ReactNode).find(node => node.type === 'input')!;
    (input.props.onChange as (event: unknown) => void)({ target: { value: '1' } });
  }
  click('자르기 확인'); await refreshPreview();
  expect(text(render())).toContain('1 × 1px'); expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ mask: 'circle', frameWidth: 0 });
  expect(button('흰 테두리').props.disabled).toBe(true);
  click('편집 시작 상태로 재설정'); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ mask: 'none', frameWidth: 0, automaticLevels: false });
});

it('테두리 두께의 정수·상한과 색상 입력을 최신 미리보기에 반영한다', async () => {
  await loaded(); click('액자·도형');
  const number = nodes(render()).find(node => node.type === 'input' && node.props.type === 'number')!;
  expect(number.props).toMatchObject({ min: 0, max: 64, step: 1, value: 0 });
  (number.props.onChange as (event: unknown) => void)({ target: { value: '77.8' } });
  const color = nodes(render()).find(node => node.type === 'input' && node.props.type === 'color')!;
  (color.props.onChange as (event: unknown) => void)({ target: { value: '#123456' } }); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ frameWidth: 64, frameColor: '#123456' });
  click('검은 테두리'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ frameWidth: 64, frameColor: '#000000' });
  click('테두리 없음'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ frameWidth: 0 });
});


it('필터 변경과 해제는 수동 보정·방향·자르기·로고를 보존하고 원본 비교와 전체 재설정을 구분한다', async () => {
  await loaded();
  const field = nodes(render()).find(node => node.type === 'label' && text(node.props.children as ReactNode) === '밝기 값')!;
  const input = nodes(field.props.children as ReactNode).find(node => node.type === 'input')!;
  (input.props.onChange as (event: unknown) => void)({ target: { value: '17' } });
  click('로고·서명'); harness.replaceLogo.mockResolvedValueOnce(logoDescriptor('A'));
  logoControls().choose(new File(['logo'], 'same.png')); await settle(); await refreshPreview();
  click('오른쪽 90도 회전'); await refreshPreview(); click('자르기');
  const aspect = nodes(render()).find(node => node.type === 'select')!;
  (aspect.props.onChange as (event: unknown) => void)({ target: { value: '1:1' } }); click('자르기 확인'); await refreshPreview();
  const before = harness.preview.mock.calls.at(-1)![0];
  click('색상 보정');
  const choose = (value: string) => {
    const label = nodes(render()).find(node => node.type === 'label' && text(node.props.children as ReactNode).startsWith('색조 필터'))!;
    const select = nodes(label.props.children as ReactNode).find(node => node.type === 'select')!;
    (select.props.onChange as (event: unknown) => void)({ target: { value } });
  };
  choose('warm'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0]).toEqual({ ...before, filter: 'warm' });
  choose('sepia'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0]).toEqual({ ...before, filter: 'sepia' });
  choose('none'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0]).toEqual(before);
  choose('cool'); await refreshPreview(); click('원본 보기'); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ filter: 'none', brightness: 0, turns: 0, logo: null });
  click('편집 결과 보기'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0]).toEqual({ ...before, filter: 'cool' });
  click('편집 시작 상태로 재설정'); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ filter: 'none', brightness: 0, turns: 0, logo: null, crop: { x: 0, y: 0, width: 1, height: 1 } });
});
it.each(['triangle', 'pentagon', 'hexagon', 'star'])('추가 도형 %s를 선택하면 PNG 안내와 현재 recipe에 반영한다', async value => {
  await loaded(); click('액자·도형');
  const select = nodes(render()).find(node => node.type === 'select')!;
  expect(nodes(select.props.children as ReactNode).filter(node => node.type === 'option')).toHaveLength(7);
  (select.props.onChange as (event: unknown) => void)({ target: { value } }); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ mask: value });
  expect(text(render())).toContain('도형 밖은 투명하게 처리하고 PNG로 저장합니다');
});

it('필터 강도를 0~100 정수로 조절하고 필터 전환·해제는 강도와 다른 보정을 보존한다', async () => {
  await loaded();
  const choose = (value: string) => {
    const label = nodes(render()).find(node => node.type === 'label' && text(node.props.children as ReactNode).startsWith('색조 필터'))!;
    const select = nodes(label.props.children as ReactNode).find(node => node.type === 'select')!;
    (select.props.onChange as (event: unknown) => void)({ target: { value } });
  };
  const strength = (value: string) => {
    const label = nodes(render()).find(node => node.type === 'label' && text(node.props.children as ReactNode) === '필터 강도 값')!;
    const input = nodes(label.props.children as ReactNode).find(node => node.type === 'input')!;
    expect(input.props).toMatchObject({ min: 0, max: 100, step: 1 });
    (input.props.onChange as (event: unknown) => void)({ target: { value } });
  };
  choose('warm'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0].filterStrength).toBe(100);
  strength('37.8'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0].filterStrength).toBe(38);
  choose('none'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ filter: 'none', filterStrength: 38 });
  expect(text(render())).not.toContain('필터 강도 값');
  choose('cool'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ filter: 'cool', filterStrength: 38 });
  strength('-1'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0].filterStrength).toBe(0);
  strength('101'); await refreshPreview(); expect(harness.preview.mock.calls.at(-1)?.[0].filterStrength).toBe(100);
  strength('50'); click('편집 시작 상태로 재설정'); await refreshPreview();
  expect(harness.preview.mock.calls.at(-1)?.[0]).toMatchObject({ filter: 'none', filterStrength: 100 });
});
