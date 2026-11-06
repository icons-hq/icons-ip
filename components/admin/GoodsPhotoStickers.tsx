'use client';

import type { KeyboardEvent } from 'react';
import { photoSourcePoint, type PhotoRecipe, type PhotoSize } from '@/lib/admin/photo-editor';
import { PHOTO_LAYER_LIMIT } from '@/lib/admin/photo-editor-layers';
import { fitPhotoSticker, PHOTO_STICKERS, photoStickerGeometry, type PhotoSticker, type PhotoStickerAsset } from '@/lib/admin/photo-editor-decorations';
import { cn } from 'cn';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { GoodsPhotoDecorationPreview } from './GoodsPhotoDecorationPreview';
import { PHOTO_BUTTON_CLASS, PHOTO_COLOR_CLASS, PHOTO_COORDINATES_CLASS, PHOTO_HINT_CLASS, PHOTO_INPUT_CLASS, PHOTO_LABEL_CLASS, PHOTO_MOVE_PAD_CLASS, PHOTO_PANEL_CLASS, PHOTO_PRESETS_CLASS, PHOTO_PRESET_CLASS, PHOTO_RANGE_CLASS, PHOTO_SELECT_CLASS } from './GoodsPhotoLayers';

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
  return <div className={PHOTO_PANEL_CLASS} data-photo-layer-controls="">
    <p className="text-sm">스티커를 선택해 사진에 추가하세요. ({layers.length}/{PHOTO_LAYER_LIMIT})</p>
    <div className={PHOTO_PRESETS_CLASS} aria-label="스티커 목록" data-photo-presets="">{PHOTO_STICKERS.map(asset => <button className={PHOTO_PRESET_CLASS} key={asset.value} type="button" disabled={layers.length >= PHOTO_LAYER_LIMIT} onClick={() => add(asset.value)} aria-label={`${asset.label} 스티커 추가`}>
      <GoodsPhotoDecorationPreview paths={photoStickerGeometry(asset.value)} /><span>{asset.label}</span>
    </button>)}</div>
    {layers.length > 0 && <label className={PHOTO_LABEL_CLASS}>편집할 스티커<select className={PHOTO_SELECT_CLASS} value={selected?.id ?? ''} onChange={event => select(event.target.value || null)}>
      <option value="">스티커 선택</option>{layers.map((layer, index) => <option key={layer.id} value={layer.id}>{index + 1} · {PHOTO_STICKERS.find(asset => asset.value === layer.asset)?.label}</option>)}
    </select></label>}
    {selected && <>
      <div className={PHOTO_COORDINATES_CLASS}>
        {(['x', 'y', 'width'] as const).map(field => <label className={PHOTO_LABEL_CLASS} key={field}>스티커 {field === 'x' ? '왼쪽 위치' : field === 'y' ? '위쪽 위치' : '크기'} (px)<input className={PHOTO_INPUT_CLASS} data-slot="input" type="number" min={field === 'width' ? 1 : 0}
          max={field === 'width' ? Math.min(size.width, size.height) : (field === 'x' ? size.width : size.height) - selected.width} step={1} value={selected[field]}
          onChange={event => { if (event.target.value !== '' && Number.isFinite(Number(event.target.value))) patch({ [field]: Number(event.target.value) }); }} /></label>)}
        <label className={PHOTO_LABEL_CLASS}>스티커 색상<input className={PHOTO_COLOR_CLASS} data-slot="input" type="color" value={selected.color} onChange={event => patch({ color: event.target.value })} /></label>
      </div>
      <label className={PHOTO_LABEL_CLASS}>스티커 불투명도 · {selected.opacity}%<input className={PHOTO_RANGE_CLASS} data-slot="input" type="range" min={0} max={100} step={1} value={selected.opacity} onChange={event => patch({ opacity: Number(event.target.value) })} /></label>
      <button className={cn(PHOTO_BUTTON_CLASS, 'self-start')} data-slot="button" type="button" onClick={() => patch({ turns: ((selected.turns + 1) % 4) as PhotoSticker['turns'] })}>스티커 오른쪽 90도 회전 · {selected.turns * 90}도</button>
      <div className={PHOTO_MOVE_PAD_CLASS} role="group" tabIndex={0} aria-label="스티커 이동: 방향키 1픽셀, Shift와 방향키 10픽셀" onKeyDown={key}>방향키로 스티커 이동 · Shift와 함께 누르면 10px</div>
      <button className={cn(buttonVariants({ variant: 'destructive' }), 'self-start')} data-slot="button" type="button" onClick={event => {
        const target = event?.currentTarget.closest('[data-photo-layer-controls]')?.querySelector<HTMLButtonElement>('[data-photo-presets] button');
        edit(current => ({ ...current, stickers: (current.stickers ?? []).filter(layer => layer.id !== selected.id) })); select(null);
        if (target) requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
      }}>선택한 스티커 삭제</button>
    </>}
    <p className={PHOTO_HINT_CLASS}>위치·크기는 회전 전 원본 기준입니다. 사진과 함께 회전·반전되고 자르기·도형 밖은 가려집니다. 불투명도 0은 표시하지 않습니다.</p>
  </div>;
}
