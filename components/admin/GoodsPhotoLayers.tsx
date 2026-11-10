'use client';

import type { KeyboardEvent } from 'react';
import { PHOTO_LAYER_LIMIT, PHOTO_TEXT_LIMIT, fitPhotoMosaic, type PhotoMosaic, type PhotoText } from '@/lib/admin/photo-editor-layers';
import { photoSourcePoint, type PhotoRecipe, type PhotoSize } from '@/lib/admin/photo-editor';
import { PHOTO_DECORATED_TEXT_LIMIT, PHOTO_TEXT_STYLES, photoTextGeometry, photoTextLineLimit, type PhotoTextStyle } from '@/lib/admin/photo-editor-decorations';
import { cn } from 'cn';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { toggleVariants } from '@/components/admin/kit/ui/toggle';
import { GOOD_INPUT_CLASS, GOOD_TEXTAREA_CLASS } from './GoodEditorParts';
import { GoodsPhotoDecorationPreview } from './GoodsPhotoDecorationPreview';

/*
 * 사진 편집기 도구 패널의 모양(템플릿 룩). 편집기 본체·스티커·로고 패널이 함께 쓴다.
 * 테스트가 요소 트리를 직접 걷기 때문에(라벨 안의 입력, 네이티브 button) kit 부품 대신 네이티브 요소에 kit 클래스를 입힌다.
 * select는 data-slot 없이 두어 어휘 CSS(admin-kit-vocabulary.css)가 펼침 화살표를 그리게 한다.
 */
export const PHOTO_PANEL_CLASS = 'flex min-w-0 flex-col gap-3 rounded-lg border p-3';
export const PHOTO_LABEL_CLASS = 'flex min-w-0 flex-col gap-1.5 text-sm font-medium text-foreground';
export const PHOTO_INPUT_CLASS = GOOD_INPUT_CLASS;
export const PHOTO_TEXTAREA_CLASS = `${GOOD_TEXTAREA_CLASS} resize-y`;
export const PHOTO_SELECT_CLASS = 'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-sm font-normal transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';
export const PHOTO_COLOR_CLASS = 'h-8 w-full min-w-0 cursor-pointer rounded-lg border border-input bg-transparent p-1 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-0';
export const PHOTO_RANGE_CLASS = 'h-8 w-full min-w-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50';
export const PHOTO_HINT_CLASS = 'text-xs text-muted-foreground';
/** 버튼 줄. 좁은 화면에서는 두 개씩 나눠 누르기 쉽게 한다. */
export const PHOTO_BUTTONS_CLASS = 'flex flex-wrap gap-2 max-md:*:grow max-md:*:basis-[calc(50%-0.5rem)]';
export const PHOTO_BUTTON_CLASS = buttonVariants({ variant: 'outline' });
/** 눌림 상태(aria-pressed)가 있는 도구 버튼. 고대비 모드에서도 선택이 보이게 Highlight 윤곽을 둔다. */
export const PHOTO_TOGGLE_CLASS = cn(toggleVariants({ variant: 'outline' }), 'aria-pressed:border-primary forced-colors:aria-pressed:outline-2 forced-colors:aria-pressed:-outline-offset-2 forced-colors:aria-pressed:outline-[Highlight]');
export const PHOTO_COORDINATES_CLASS = 'grid min-w-0 grid-cols-2 gap-2.5 md:grid-cols-4';
export const PHOTO_PRESETS_CLASS = 'grid min-w-0 grid-cols-2 gap-2 md:grid-cols-3';
export const PHOTO_PRESET_CLASS = 'flex min-h-16 min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg border border-input bg-transparent px-2 py-2 text-sm font-medium text-foreground wrap-anywhere transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-pressed:border-primary aria-pressed:bg-muted forced-colors:aria-pressed:outline-2 forced-colors:aria-pressed:-outline-offset-2 forced-colors:aria-pressed:outline-[Highlight]';
/** 방향키로 선택 영역을 옮기는 자리(초점을 받는 group). */
export const PHOTO_MOVE_PAD_CLASS = 'flex min-h-11 items-center rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

export type PhotoLayerKind = 'mosaic' | 'text';
export type PhotoSelection = { kind: PhotoLayerKind; id: string } | null;
type Props = { kind: PhotoLayerKind; size: PhotoSize; recipe: PhotoRecipe; selection: PhotoSelection;
  select: (value: PhotoSelection) => void; edit: (update: (recipe: PhotoRecipe) => PhotoRecipe) => void;
  move: (dx: number, dy: number) => void; textMode?: 'plain' | 'bubble' | 'signature'; reportError?: (message: string) => void };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

export function GoodsPhotoLayers({ kind, size, recipe, selection, select, edit, move, textMode = 'plain', reportError }: Props) {
  const layers = kind === 'mosaic' ? recipe.mosaics : recipe.texts;
  const selected = selection?.kind === kind ? layers.find(layer => layer.id === selection.id) : undefined;
  const label = kind === 'mosaic' ? '모자이크' : '텍스트';
  const selectedText = selected && 'text' in selected ? selected : undefined;
  const decorated = selectedText?.style && selectedText.style !== 'plain';
  const textLimit = decorated ? PHOTO_DECORATED_TEXT_LIMIT : PHOTO_TEXT_LIMIT;
  const lineLimit = photoTextLineLimit(selectedText?.style);
  function decoration(style: PhotoTextStyle, fontSize: number) {
    return style === 'plain' ? { style } : { style, decorationWidth: Math.max(1, Math.min(size.width, size.height * 100 / photoTextGeometry(style).height, Math.max(fontSize * 12, Math.min(size.width, size.height) * .6))), backgroundColor: '#ffffff' };
  }
  function add(shape: PhotoMosaic['shape'] = 'rectangle', style: PhotoTextStyle = 'plain') {
    if (layers.length >= PHOTO_LAYER_LIMIT) return;
    const id = `${kind}-${crypto.randomUUID()}`;
    const point = photoSourcePoint({ x: recipe.crop.x + recipe.crop.width * .2, y: recipe.crop.y + recipe.crop.height * .2 }, recipe, size);
    const x = clamp(point.x * size.width, 0, size.width - 1), y = clamp(point.y * size.height, 0, size.height - 1);
    if (kind === 'mosaic') {
      const width = Math.max(1, Math.round(Math.min(size.width, size.height) * .25));
      const layer = fitPhotoMosaic(size, { id, shape, x, y, width, height: width, blockSize: 16 }, {});
      edit(current => ({ ...current, mosaics: [...current.mosaics, layer] }));
    } else {
      const fontSize = clamp(Math.min(size.width, size.height) * (style === 'plain' ? .08 : .045), 8, 128);
      const layer = { id, x, y, text: style === 'plain' ? '텍스트' : '문구', fontSize, color: style === 'plain' ? '#ffffff' : '#222222', ...decoration(style, fontSize) };
      edit(current => ({ ...current, texts: [...current.texts, layer] }));
    }
    select({ kind, id });
  }
  function chooseStyle(style: PhotoTextStyle) {
    if (!selectedText) { add('rectangle', style); return; }
    if (style !== 'plain' && (selectedText.text.length > PHOTO_DECORATED_TEXT_LIMIT || selectedText.text.split('\n').length > photoTextLineLimit(style))) {
      reportError?.(`선택한 문구는 그대로 유지했습니다. ${PHOTO_TEXT_STYLES.find(item => item.value === style)?.label}은 80자·${photoTextLineLimit(style)}줄까지입니다. 문구를 줄인 뒤 다시 선택해주세요.`); return;
    }
    patch({ ...decoration(style, selectedText.fontSize), ...(style !== 'plain' && selectedText.decorationWidth ? { decorationWidth: selectedText.decorationWidth, backgroundColor: selectedText.backgroundColor ?? '#ffffff' } : {}) });
  }
  function patch(patch: Partial<PhotoMosaic & PhotoText>) {
    if (!selected) return;
    edit(current => kind === 'mosaic'
      ? { ...current, mosaics: current.mosaics.map(layer => layer.id === selected.id ? fitPhotoMosaic(size, layer, patch) : layer) }
      : { ...current, texts: current.texts.map(layer => layer.id === selected.id ? { ...layer, ...patch,
        x: clamp(patch.x ?? layer.x, 0, size.width - 1), y: clamp(patch.y ?? layer.y, 0, size.height - 1),
        fontSize: clamp(patch.fontSize ?? layer.fontSize, 8, 512) } : layer) });
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (dx || dy) { event.preventDefault(); move(dx, dy); }
  }
  return <div className={PHOTO_PANEL_CLASS} data-photo-layer-controls="">
    <p className="text-sm">{kind === 'mosaic' ? '직접 선택한 영역을 가립니다. 자동 인식은 사용하지 않습니다.' : textMode === 'plain' ? 'Pretendard 글꼴로 문구를 추가합니다. 일반 텍스트는 300자, 8줄까지 입력할 수 있습니다.' : '스타일을 선택하면 선택한 텍스트를 바꿉니다. 선택한 텍스트가 없으면 새로 추가합니다. 말풍선·서명은 80자·3줄, 원형 서명은 2줄까지입니다.'} ({layers.length}/{PHOTO_LAYER_LIMIT})</p>
    <div className={PHOTO_BUTTONS_CLASS}>
      {kind === 'mosaic' ? <><button className={PHOTO_BUTTON_CLASS} data-slot="button" type="button" disabled={layers.length >= PHOTO_LAYER_LIMIT} onClick={() => add('rectangle')}>사각 모자이크 추가</button><button className={PHOTO_BUTTON_CLASS} data-slot="button" type="button" disabled={layers.length >= PHOTO_LAYER_LIMIT} onClick={() => add('circle')}>원 모자이크 추가</button></>
        : <button className={PHOTO_BUTTON_CLASS} data-slot="button" type="button" disabled={layers.length >= PHOTO_LAYER_LIMIT} onClick={() => add('rectangle', textMode === 'bubble' ? 'bubble-round' : textMode === 'signature' ? 'signature-rule' : 'plain')}>{textMode === 'plain' ? '텍스트 추가' : textMode === 'bubble' ? '새 말풍선 추가' : '새 텍스트 서명 추가'}</button>}
    </div>
    {kind === 'text' && textMode !== 'plain' && <div className={PHOTO_PRESETS_CLASS} aria-label={textMode === 'bubble' ? '말풍선 스타일' : '텍스트 서명 템플릿'}>
      {PHOTO_TEXT_STYLES.filter(item => item.kind === textMode).map(item => {
        const geometry = photoTextGeometry(item.value as Exclude<PhotoTextStyle, 'plain'>);
        return <button className={PHOTO_PRESET_CLASS} key={item.value} type="button" aria-pressed={selectedText?.style === item.value} disabled={!selectedText && layers.length >= PHOTO_LAYER_LIMIT} onClick={() => chooseStyle(item.value)}>
          <GoodsPhotoDecorationPreview paths={geometry.paths} height={geometry.height} /><span>{item.label}</span>
        </button>;
      })}
    </div>}
    {layers.length > 0 && <label className={PHOTO_LABEL_CLASS}>편집할 {label}<select className={PHOTO_SELECT_CLASS} value={selected?.id ?? ''} onChange={event => select(event.target.value ? { kind, id: event.target.value } : null)}>
      <option value="">영역 선택</option>{layers.map((layer, index) => <option key={layer.id} value={layer.id}>{label} {index + 1}{'text' in layer ? ` · ${layer.text.slice(0, 16) || '빈 문구'}` : layer.shape === 'circle' ? ' · 원' : ' · 사각'}</option>)}
    </select></label>}
    {selected && <>
      {'text' in selected && <label className={PHOTO_LABEL_CLASS}>텍스트 내용<textarea className={PHOTO_TEXTAREA_CLASS} data-slot="textarea" value={selected.text} maxLength={decorated ? undefined : PHOTO_TEXT_LIMIT} rows={3} onChange={event => {
        const value = event.target.value.replace(/\r\n?/g, '\n');
        if (value.length <= textLimit && value.split('\n').length <= lineLimit) patch({ text: value });
        else reportError?.(`문구는 ${textLimit}자·${lineLimit}줄까지 입력할 수 있습니다. 마지막 유효 문구를 유지했습니다.`);
      }} /></label>}
      {decorated && <>
        <p className="text-sm">현재 스타일: {PHOTO_TEXT_STYLES.find(item => item.value === selectedText.style)?.label}. 일반 텍스트·말풍선·서명은 8개 한도를 함께 사용합니다.</p>
        <div className={PHOTO_COORDINATES_CLASS}>
          <label className={PHOTO_LABEL_CLASS}>장식 너비 (px)<input className={PHOTO_INPUT_CLASS} data-slot="input" type="number" min={1} max={Math.min(size.width, 4096)} step={1} value={selectedText.decorationWidth}
            onChange={event => { const value = Number(event.target.value); if (event.target.value !== '' && Number.isFinite(value)) patch({ decorationWidth: clamp(value, 1, Math.min(size.width, 4096)) }); }} /></label>
          <label className={PHOTO_LABEL_CLASS}>장식 배경색<input className={PHOTO_COLOR_CLASS} data-slot="input" type="color" value={selectedText.backgroundColor} onChange={event => patch({ backgroundColor: event.target.value })} /></label>
        </div>
        <button className={cn(PHOTO_BUTTON_CLASS, 'self-start')} data-slot="button" type="button" onClick={() => chooseStyle('plain')}>일반 텍스트로 변경</button>
        <p className={PHOTO_HINT_CLASS}>문구가 장식 안에 맞지 않으면 글자 크기·장식 너비·줄바꿈을 조절해주세요. 빈 문구는 장식도 표시하지 않습니다.</p>
      </>}
      <p className={PHOTO_HINT_CLASS}>위치·크기는 회전 전 원본의 픽셀 기준입니다. 사진과 함께 회전·반전되고, 자른 범위 밖은 가려집니다.</p>
      <div className={PHOTO_COORDINATES_CLASS}>
        {(['x', 'y'] as const).map(axis => <label className={PHOTO_LABEL_CLASS} key={axis}>{label} {axis === 'x' ? '왼쪽' : '위쪽'} 위치 (px)<input className={PHOTO_INPUT_CLASS} data-slot="input" type="number" min={0} max={(axis === 'x' ? size.width : size.height) - 1} step={1} value={selected[axis]}
          onChange={event => { if (event.target.value !== '' && Number.isFinite(Number(event.target.value))) patch({ [axis]: Number(event.target.value) }); }} /></label>)}
        {'shape' in selected ? <>{(selected.shape === 'circle' ? ['width'] : ['width', 'height']).map(axis => <label className={PHOTO_LABEL_CLASS} key={axis}>{selected.shape === 'circle' ? '원 지름' : axis === 'width' ? '모자이크 너비' : '모자이크 높이'} (px)<input className={PHOTO_INPUT_CLASS} data-slot="input" type="number" min={1} max={selected.shape === 'circle' ? Math.min(size.width, size.height) : axis === 'width' ? size.width : size.height} step={1} value={selected[axis as 'width' | 'height']}
          onChange={event => { if (event.target.value !== '' && Number.isFinite(Number(event.target.value))) patch({ [axis]: Number(event.target.value) }); }} /></label>)}</>
          : <><label className={PHOTO_LABEL_CLASS}>텍스트 크기 (px)<input className={PHOTO_INPUT_CLASS} data-slot="input" type="number" min={8} max={512} step={1} value={selected.fontSize} onChange={event => { if (event.target.value !== '' && Number.isFinite(Number(event.target.value))) patch({ fontSize: Number(event.target.value) }); }} /></label>
            <label className={PHOTO_LABEL_CLASS}>텍스트 색상<input className={PHOTO_COLOR_CLASS} data-slot="input" type="color" value={selected.color} onChange={event => patch({ color: event.target.value })} /></label></>}
      </div>
      {'shape' in selected && <label className={PHOTO_LABEL_CLASS}>모자이크 강도 · 블록 {selected.blockSize}px<input className={PHOTO_RANGE_CLASS} data-slot="input" type="range" min={2} max={128} step={1} value={selected.blockSize} onChange={event => patch({ blockSize: Number(event.target.value) })} /></label>}
      <div className={PHOTO_MOVE_PAD_CLASS} role="group" tabIndex={0} aria-label={`${label} 이동: 방향키 1픽셀, Shift와 방향키 10픽셀`} onKeyDown={key}>방향키로 선택 영역 이동 · Shift와 함께 누르면 10px</div>
      <button className={cn(buttonVariants({ variant: 'destructive' }), 'self-start')} data-slot="button" type="button" onClick={event => {
        const target = event?.currentTarget.closest('[data-photo-layer-controls]')?.querySelector<HTMLButtonElement>('button');
        edit(current => kind === 'mosaic' ? { ...current, mosaics: current.mosaics.filter(layer => layer.id !== selected.id) } : { ...current, texts: current.texts.filter(layer => layer.id !== selected.id) }); select(null);
        if (target) requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
      }}>선택한 {label} 삭제</button>
    </>}
    <p className={PHOTO_HINT_CLASS}>모자이크·로고·스티커 위에 텍스트를 추가한 순서대로 표시합니다.</p>
  </div>;
}
