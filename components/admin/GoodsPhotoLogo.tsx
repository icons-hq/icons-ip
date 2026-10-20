'use client';

import type { KeyboardEvent } from 'react';
import type { PhotoRecipe, PhotoSize } from '@/lib/admin/photo-editor';
import { fitPhotoLogo, photoLogoMaximum, positionPhotoLogo, type PhotoLogoDescriptor } from '@/lib/admin/photo-editor-logo';

type Props = { size: PhotoSize; recipe: PhotoRecipe; asset: PhotoLogoDescriptor | null; loading: boolean; error: string;
  choose: (file: File) => void; remove: () => void; move: (dx: number, dy: number) => void;
  edit: (update: (recipe: PhotoRecipe) => PhotoRecipe) => void };

export function GoodsPhotoLogo({ size, recipe, asset, loading, error, choose, remove, move, edit }: Props) {
  const logo = recipe.logo;
  function patch(value: Partial<NonNullable<PhotoRecipe['logo']>>) {
    if (!asset || !logo || loading) return;
    edit(current => ({ ...current, logo: fitPhotoLogo(size, asset, current.logo, value) }));
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (loading || event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 10 : 1, dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (dx || dy) { event.preventDefault(); move(dx, dy); }
  }
  return <div className="admin-photo-editor__layer-controls">
    <p>로고·서명 이미지 1개를 사진 위에 추가합니다. JPEG·PNG·WebP 정지 이미지 · 5MB 이하 · 100만 픽셀 이하 · 가로·세로 2048px 이하</p>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">로고를 불러오는 중… 기존 로고는 새 파일 확인이 끝날 때까지 유지됩니다.</p>}
    <label>로고 이미지 파일<input type="file" accept="image/jpeg,image/png,image/webp" disabled={loading} onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) choose(file);
    }} /></label>
    {asset && logo && <>
      <p className="admin-photo-editor__logo-name">{asset.filename} · {asset.width} × {asset.height}px</p>
      <fieldset disabled={loading} className="admin-photo-editor__logo-controls">
        <legend className="wc-sr-only">로고 배치</legend>
        <div className="admin-photo-editor__buttons">{([['top-left', '왼쪽 위'], ['top-right', '오른쪽 위'], ['center', '가운데'], ['bottom-left', '왼쪽 아래'], ['bottom-right', '오른쪽 아래']] as const).map(([value, label]) => <button type="button" key={value} onClick={() => edit(current => ({ ...current, logo: positionPhotoLogo(size, asset, current.logo!, value) }))}>{label}</button>)}</div>
        <div className="admin-photo-editor__coordinates">
          {(['x', 'y'] as const).map(axis => <label key={axis}>로고 {axis === 'x' ? '왼쪽' : '위쪽'} 위치 (px)<input type="number" min={0} step="any" max={axis === 'x' ? size.width - logo.width : size.height - logo.width * asset.height / asset.width} value={logo[axis]}
            onChange={event => { if (event.target.value !== '' && Number.isFinite(Number(event.target.value))) patch({ [axis]: Number(event.target.value) }); }} /></label>)}
          <label>로고 너비 (px)<input type="number" step="any" min={photoLogoMaximum(size, asset) / 100} max={photoLogoMaximum(size, asset)} value={logo.width}
            onChange={event => { if (event.target.value !== '' && Number.isFinite(Number(event.target.value))) patch({ width: Number(event.target.value) }); }} /></label>
        </div>
        <label>로고 불투명도 · {logo.opacity}%<input type="range" min={0} max={100} step={1} value={logo.opacity} onChange={event => patch({ opacity: Number(event.target.value) })} /></label>
        <div className="admin-photo-editor__layer-move" role="group" tabIndex={loading ? -1 : 0} aria-label="로고 이동: 방향키 1픽셀, Shift와 방향키 10픽셀" onKeyDown={key}>방향키로 로고 이동 · Shift와 함께 누르면 10px</div>
      </fieldset>
    </>}
    {(asset || loading) && <button type="button" onClick={remove}>로고 제거</button>}
    <p className="admin-photo-editor__limit">가로세로 비율을 유지합니다. 위치는 회전 전 원본 기준이며 사진과 함께 회전·반전되고 자르기·도형 밖은 가려집니다. 사진 보정은 로고에 적용되지 않으며 텍스트는 로고 위에 표시됩니다.</p>
  </div>;
}
