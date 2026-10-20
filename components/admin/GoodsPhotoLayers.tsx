'use client';

import type { KeyboardEvent } from 'react';
import { PHOTO_LAYER_LIMIT, PHOTO_TEXT_LIMIT, fitPhotoMosaic, type PhotoMosaic, type PhotoText } from '@/lib/admin/photo-editor-layers';
import { photoSourcePoint, type PhotoRecipe, type PhotoSize } from '@/lib/admin/photo-editor';
import { PHOTO_DECORATED_TEXT_LIMIT, PHOTO_TEXT_STYLES, photoTextGeometry, photoTextLineLimit, type PhotoTextStyle } from '@/lib/admin/photo-editor-decorations';
import { GoodsPhotoDecorationPreview } from './GoodsPhotoDecorationPreview';

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
  return <div className="admin-photo-editor__layer-controls">
    <p>{kind === 'mosaic' ? '직접 선택한 영역을 가립니다. 자동 인식은 사용하지 않습니다.' : textMode === 'plain' ? 'Pretendard 글꼴로 문구를 추가합니다. 일반 텍스트는 300자, 8줄까지 입력할 수 있습니다.' : '스타일을 선택하면 선택한 텍스트를 바꿉니다. 선택한 텍스트가 없으면 새로 추가합니다. 말풍선·서명은 80자·3줄, 원형 서명은 2줄까지입니다.'} ({layers.length}/{PHOTO_LAYER_LIMIT})</p>
    <div className="admin-photo-editor__buttons">
      {kind === 'mosaic' ? <><button type="button" disabled={layers.length >= PHOTO_LAYER_LIMIT} onClick={() => add('rectangle')}>사각 모자이크 추가</button><button type="button" disabled={layers.length >= PHOTO_LAYER_LIMIT} onClick={() => add('circle')}>원 모자이크 추가</button></>
        : <button type="button" disabled={layers.length >= PHOTO_LAYER_LIMIT} onClick={() => add('rectangle', textMode === 'bubble' ? 'bubble-round' : textMode === 'signature' ? 'signature-rule' : 'plain')}>{textMode === 'plain' ? '텍스트 추가' : textMode === 'bubble' ? '새 말풍선 추가' : '새 텍스트 서명 추가'}</button>}
    </div>
    {kind === 'text' && textMode !== 'plain' && <div className="admin-photo-editor__presets" aria-label={textMode === 'bubble' ? '말풍선 스타일' : '텍스트 서명 템플릿'}>
      {PHOTO_TEXT_STYLES.filter(item => item.kind === textMode).map(item => {
        const geometry = photoTextGeometry(item.value as Exclude<PhotoTextStyle, 'plain'>);
        return <button key={item.value} type="button" aria-pressed={selectedText?.style === item.value} disabled={!selectedText && layers.length >= PHOTO_LAYER_LIMIT} onClick={() => chooseStyle(item.value)}>
          <GoodsPhotoDecorationPreview paths={geometry.paths} height={geometry.height} /><span>{item.label}</span>
        </button>;
      })}
    </div>}
    {layers.length > 0 && <label>편집할 {label}<select value={selected?.id ?? ''} onChange={event => select(event.target.value ? { kind, id: event.target.value } : null)}>
      <option value="">영역 선택</option>{layers.map((layer, index) => <option key={layer.id} value={layer.id}>{label} {index + 1}{'text' in layer ? ` · ${layer.text.slice(0, 16) || '빈 문구'}` : layer.shape === 'circle' ? ' · 원' : ' · 사각'}</option>)}
    </select></label>}
    {selected && <>
      {'text' in selected && <label>텍스트 내용<textarea value={selected.text} maxLength={decorated ? undefined : PHOTO_TEXT_LIMIT} rows={3} onChange={event => {
        const value = event.target.value.replace(/\r\n?/g, '\n');
        if (value.length <= textLimit && value.split('\n').length <= lineLimit) patch({ text: value });
        else reportError?.(`문구는 ${textLimit}자·${lineLimit}줄까지 입력할 수 있습니다. 마지막 유효 문구를 유지했습니다.`);
      }} /></label>}
      {decorated && <>
        <p>현재 스타일: {PHOTO_TEXT_STYLES.find(item => item.value === selectedText.style)?.label}. 일반 텍스트·말풍선·서명은 8개 한도를 함께 사용합니다.</p>
        <div className="admin-photo-editor__coordinates">
          <label>장식 너비 (px)<input type="number" min={1} max={Math.min(size.width, 4096)} step={1} value={selectedText.decorationWidth}
            onChange={event => { const value = Number(event.target.value); if (event.target.value !== '' && Number.isFinite(value)) patch({ decorationWidth: clamp(value, 1, Math.min(size.width, 4096)) }); }} /></label>
          <label>장식 배경색<input type="color" value={selectedText.backgroundColor} onChange={event => patch({ backgroundColor: event.target.value })} /></label>
        </div>
        <button type="button" onClick={() => chooseStyle('plain')}>일반 텍스트로 변경</button>
        <p className="admin-photo-editor__limit">문구가 장식 안에 맞지 않으면 글자 크기·장식 너비·줄바꿈을 조절해주세요. 빈 문구는 장식도 표시하지 않습니다.</p>
      </>}
      <p className="admin-photo-editor__limit">위치·크기는 회전 전 원본의 픽셀 기준입니다. 사진과 함께 회전·반전되고, 자른 범위 밖은 가려집니다.</p>
      <div className="admin-photo-editor__coordinates">
        {(['x', 'y'] as const).map(axis => <label key={axis}>{label} {axis === 'x' ? '왼쪽' : '위쪽'} 위치 (px)<input type="number" min={0} max={(axis === 'x' ? size.width : size.height) - 1} step={1} value={selected[axis]}
          onChange={event => { if (event.target.value !== '' && Number.isFinite(Number(event.target.value))) patch({ [axis]: Number(event.target.value) }); }} /></label>)}
        {'shape' in selected ? <>{(selected.shape === 'circle' ? ['width'] : ['width', 'height']).map(axis => <label key={axis}>{selected.shape === 'circle' ? '원 지름' : axis === 'width' ? '모자이크 너비' : '모자이크 높이'} (px)<input type="number" min={1} max={selected.shape === 'circle' ? Math.min(size.width, size.height) : axis === 'width' ? size.width : size.height} step={1} value={selected[axis as 'width' | 'height']}
          onChange={event => { if (event.target.value !== '' && Number.isFinite(Number(event.target.value))) patch({ [axis]: Number(event.target.value) }); }} /></label>)}</>
          : <><label>텍스트 크기 (px)<input type="number" min={8} max={512} step={1} value={selected.fontSize} onChange={event => { if (event.target.value !== '' && Number.isFinite(Number(event.target.value))) patch({ fontSize: Number(event.target.value) }); }} /></label>
            <label>텍스트 색상<input type="color" value={selected.color} onChange={event => patch({ color: event.target.value })} /></label></>}
      </div>
      {'shape' in selected && <label>모자이크 강도 · 블록 {selected.blockSize}px<input type="range" min={2} max={128} step={1} value={selected.blockSize} onChange={event => patch({ blockSize: Number(event.target.value) })} /></label>}
      <div className="admin-photo-editor__layer-move" role="group" tabIndex={0} aria-label={`${label} 이동: 방향키 1픽셀, Shift와 방향키 10픽셀`} onKeyDown={key}>방향키로 선택 영역 이동 · Shift와 함께 누르면 10px</div>
      <button type="button" onClick={event => {
        const target = event?.currentTarget.closest('.admin-photo-editor__layer-controls')?.querySelector<HTMLButtonElement>('button');
        edit(current => kind === 'mosaic' ? { ...current, mosaics: current.mosaics.filter(layer => layer.id !== selected.id) } : { ...current, texts: current.texts.filter(layer => layer.id !== selected.id) }); select(null);
        if (target) requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
      }}>선택한 {label} 삭제</button>
    </>}
    <p className="admin-photo-editor__limit">모자이크·로고·스티커 위에 텍스트를 추가한 순서대로 표시합니다.</p>
  </div>;
}
