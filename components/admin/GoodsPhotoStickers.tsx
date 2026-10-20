'use client';

import type { KeyboardEvent } from 'react';
import { photoSourcePoint, type PhotoRecipe, type PhotoSize } from '@/lib/admin/photo-editor';
import { PHOTO_LAYER_LIMIT } from '@/lib/admin/photo-editor-layers';
import { fitPhotoSticker, PHOTO_STICKERS, photoStickerGeometry, type PhotoSticker, type PhotoStickerAsset } from '@/lib/admin/photo-editor-decorations';
import { GoodsPhotoDecorationPreview } from './GoodsPhotoDecorationPreview';

type Props = { size: PhotoSize; recipe: PhotoRecipe; selectedId?: string; select: (id: string | null) => void;
  edit: (update: (recipe: PhotoRecipe) => PhotoRecipe) => void; move: (dx: number, dy: number) => void };
export function GoodsPhotoStickers({ size, recipe, selectedId, select, edit, move }: Props) {
  const layers = recipe.stickers ?? [], selected = layers.find(layer => layer.id === selectedId);
  function add(asset: PhotoStickerAsset) {
    if (layers.length >= PHOTO_LAYER_LIMIT) return;
    const point = photoSourcePoint({ x: recipe.crop.x + recipe.crop.width / 2, y: recipe.crop.y + recipe.crop.height / 2 }, recipe, size);
    const width = Math.max(1, Math.round(Math.min(size.width, size.height) / 4));
    const layer = fitPhotoSticker(size, { id: `sticker-${crypto.randomUUID()}`, asset, x: point.x * size.width - width / 2,
      y: point.y * size.height - width / 2, width, turns: 0, color: '#e34b60', opacity: 100 }, {});
    edit(current => ({ ...current, stickers: [...current.stickers ?? [], layer] })); select(layer.id);
  }
  function patch(value: Partial<PhotoSticker>) {
    if (!selected) return;
    edit(current => ({ ...current, stickers: (current.stickers ?? []).map(layer => layer.id === selected.id ? fitPhotoSticker(size, layer, value) : layer) }));
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 10 : 1, dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (dx || dy) { event.preventDefault(); move(dx, dy); }
  }
  return <div className="admin-photo-editor__layer-controls">
    <p>스티커를 선택해 사진에 추가하세요. ({layers.length}/{PHOTO_LAYER_LIMIT})</p>
    <div className="admin-photo-editor__presets" aria-label="스티커 목록">{PHOTO_STICKERS.map(asset => <button key={asset.value} type="button" disabled={layers.length >= PHOTO_LAYER_LIMIT} onClick={() => add(asset.value)} aria-label={`${asset.label} 스티커 추가`}>
      <GoodsPhotoDecorationPreview paths={photoStickerGeometry(asset.value)} /><span>{asset.label}</span>
    </button>)}</div>
    {layers.length > 0 && <label>편집할 스티커<select value={selected?.id ?? ''} onChange={event => select(event.target.value || null)}>
      <option value="">스티커 선택</option>{layers.map((layer, index) => <option key={layer.id} value={layer.id}>{index + 1} · {PHOTO_STICKERS.find(asset => asset.value === layer.asset)?.label}</option>)}
    </select></label>}
    {selected && <>
      <div className="admin-photo-editor__coordinates">
        {(['x', 'y', 'width'] as const).map(field => <label key={field}>스티커 {field === 'x' ? '왼쪽 위치' : field === 'y' ? '위쪽 위치' : '크기'} (px)<input type="number" min={field === 'width' ? 1 : 0}
          max={field === 'width' ? Math.min(size.width, size.height) : (field === 'x' ? size.width : size.height) - selected.width} step={1} value={selected[field]}
          onChange={event => { if (event.target.value !== '' && Number.isFinite(Number(event.target.value))) patch({ [field]: Number(event.target.value) }); }} /></label>)}
        <label>스티커 색상<input type="color" value={selected.color} onChange={event => patch({ color: event.target.value })} /></label>
      </div>
      <label>스티커 불투명도 · {selected.opacity}%<input type="range" min={0} max={100} step={1} value={selected.opacity} onChange={event => patch({ opacity: Number(event.target.value) })} /></label>
      <button type="button" onClick={() => patch({ turns: ((selected.turns + 1) % 4) as PhotoSticker['turns'] })}>스티커 오른쪽 90도 회전 · {selected.turns * 90}도</button>
      <div className="admin-photo-editor__layer-move" role="group" tabIndex={0} aria-label="스티커 이동: 방향키 1픽셀, Shift와 방향키 10픽셀" onKeyDown={key}>방향키로 스티커 이동 · Shift와 함께 누르면 10px</div>
      <button type="button" onClick={event => {
        const target = event?.currentTarget.closest('.admin-photo-editor__layer-controls')?.querySelector<HTMLButtonElement>('.admin-photo-editor__presets button');
        edit(current => ({ ...current, stickers: (current.stickers ?? []).filter(layer => layer.id !== selected.id) })); select(null);
        if (target) requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
      }}>선택한 스티커 삭제</button>
    </>}
    <p className="admin-photo-editor__limit">위치·크기는 회전 전 원본 기준입니다. 사진과 함께 회전·반전되고 자르기·도형 밖은 가려집니다. 불투명도 0은 표시하지 않습니다.</p>
  </div>;
}
