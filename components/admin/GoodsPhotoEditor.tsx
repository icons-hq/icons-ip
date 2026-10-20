'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { fitPhotoCrop, flipPhotoRecipe, initialPhotoRecipe, orientedPhotoSize, photoCropPixels, photoOrientedPoint, photoSourcePoint, rotatePhotoRecipe, setPhotoCrop, type PhotoCrop, type PhotoRecipe, type PhotoSize } from '@/lib/admin/photo-editor';
import { createPhotoEditSession, type PhotoEditSession } from '@/lib/admin/photo-editor-session';
import { fitPhotoMosaic } from '@/lib/admin/photo-editor-layers';
import { PHOTO_MASKS, PHOTO_FRAME_STYLES, photoDecoratedFrameGeometry, photoFrameMaximum, photoFrameWidth, type PhotoMask } from '@/lib/admin/photo-editor-presentation';
import { PHOTO_FILTERS, type PhotoFilter } from '@/lib/admin/photo-editor-filters';
import { PHOTO_STRAIGHTEN_LIMIT } from '@/lib/admin/photo-editor-straighten';
import { GoodsPhotoLayers, type PhotoLayerKind, type PhotoSelection } from './GoodsPhotoLayers';
import { GoodsPhotoLogo } from './GoodsPhotoLogo';
import { GoodsPhotoStickers } from './GoodsPhotoStickers';
import { GoodsPhotoDecorationPreview } from './GoodsPhotoDecorationPreview';
import { fitPhotoSticker, photoTextGeometry } from '@/lib/admin/photo-editor-decorations';
import { fitPhotoLogo, positionPhotoLogo, type PhotoLogoDescriptor } from '@/lib/admin/photo-editor-logo';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';

type Props = { sourcePath: string; onCancel: () => void; onApply: (file: File | null) => void };
type Aspect = 'original' | 'free' | '1:1' | '16:9' | '3:2' | '4:3' | '3:4' | '2:3' | '9:16';
const aspects: readonly [Aspect, string][] = [['original', '원본 비율'], ['free', '자유'], ['1:1', '1:1'], ['16:9', '16:9'], ['3:2', '3:2'], ['4:3', '4:3'], ['3:4', '3:4'], ['2:3', '2:3'], ['9:16', '9:16']];
const inverseAspect: Record<Aspect, Aspect> = { original: 'original', free: 'free', '1:1': '1:1', '16:9': '9:16', '9:16': '16:9', '3:2': '2:3', '2:3': '3:2', '4:3': '3:4', '3:4': '4:3' };
const fullCrop = { x: 0, y: 0, width: 1, height: 1 };

export function GoodsPhotoEditor(props: Props) {
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="wc-root wc-admin admin-photo-editor-shell" onChange={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); event.stopPropagation(); }}>
    <PhotoEditorBody key={props.sourcePath} {...props} />
  </div>, document.body);
}

function PhotoEditorBody({ sourcePath, onApply, onCancel }: Props) {
  const [size, setSize] = useState<PhotoSize | null>(null), [recipe, setRecipe] = useState(initialPhotoRecipe);
  const [aspect, setAspect] = useState<Aspect>('original'), [cropping, setCropping] = useState(false), [comparing, setComparing] = useState(false);
  const [tool, setTool] = useState<'adjust' | 'presentation' | 'logo' | 'sticker' | 'bubble' | 'signature' | PhotoLayerKind>('adjust'), [selection, setSelection] = useState<PhotoSelection | { kind: 'logo' | 'sticker'; id: string }>(null);
  const [preview, setPreview] = useState<{ key: string; url: string } | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [logoAsset, setLogoAsset] = useState<PhotoLogoDescriptor | null>(null), [logoBusy, setLogoBusy] = useState(false), [logoError, setLogoError] = useState('');
  const [straightenBusy, setStraightenBusy] = useState(false), [straightenStatus, setStraightenStatus] = useState('');
  const straightenController = useRef<AbortController | null>(null);
  const logoOperation = useRef(false), logoGeneration = useRef(0), logoController = useRef<AbortController | null>(null);
  const session = useRef<PhotoEditSession | null>(null), mounted = useRef(true), operation = useRef(false);
  const loadController = useRef<AbortController | null>(null), previewController = useRef<AbortController | null>(null), applyController = useRef<AbortController | null>(null);
  const previewUrl = useRef<string | null>(null), callbacks = useRef({ onApply, onCancel });
  const drag = useRef<{ pointerId: number; x: number; y: number; recipe: PhotoRecipe } | null>(null);
  const layerDrag = useRef<{ pointerId: number; clientX: number; clientY: number; recipe: PhotoRecipe; selection: typeof selection } | null>(null);
  useLayoutEffect(() => { callbacks.current = { onApply, onCancel }; }, [onApply, onCancel]);
  const releaseResources = useCallback(() => {
    straightenController.current?.abort();
    logoController.current?.abort(); logoGeneration.current++;
    loadController.current?.abort(); previewController.current?.abort(); applyController.current?.abort(); session.current?.dispose(); session.current = null;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
  }, []);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController(); loadController.current = controller;
    void createPhotoEditSession(sourcePath, controller.signal).then(value => {
      if (controller.signal.aborted || !mounted.current) { value.dispose(); return; }
      session.current = value; setSize(value.size);
    }).catch(cause => { if (!controller.signal.aborted && mounted.current) setError(cause instanceof Error ? cause.message : '사진을 불러오지 못했습니다. 원래 사진은 유지됩니다.'); });
    return () => { mounted.current = false; releaseResources(); };
  }, [sourcePath, releaseResources]);
  const previewKey = JSON.stringify(comparing ? initialPhotoRecipe() : cropping ? { ...recipe, crop: fullCrop, mask: 'none', frameWidth: 0 } : recipe);
  useEffect(() => {
    const active = session.current;
    if (!size || !active || logoBusy || straightenBusy) return;
    const controller = new AbortController(); previewController.current = controller;
    void active.preview(JSON.parse(previewKey) as PhotoRecipe, controller.signal).then(result => {
      if (controller.signal.aborted || !mounted.current) return;
      const url = URL.createObjectURL(result.blob), previous = previewUrl.current;
      previewUrl.current = url;
      if (previous) URL.revokeObjectURL(previous);
      setPreview({ key: previewKey, url });
    }).catch(cause => { if (!controller.signal.aborted && mounted.current) setError(cause instanceof Error ? cause.message : '사진 미리보기를 만들지 못했습니다.'); });
    return () => controller.abort();
  }, [previewKey, size, logoBusy, straightenBusy]);

  const ready = !logoBusy && !straightenBusy && preview?.key === previewKey;
  const crop = size ? photoCropPixels(size, recipe) : null;
  const oriented = size ? orientedPhotoSize(size, recipe) : null;
  const textLayer = selection?.kind === 'text' ? recipe.texts.find(layer => layer.id === selection.id) : undefined;
  const stickerLayer = selection?.kind === 'sticker' ? recipe.stickers?.find(layer => layer.id === selection.id) : undefined;
  const selected = selection?.kind === 'mosaic' ? recipe.mosaics.find(layer => layer.id === selection.id)
    : stickerLayer ? { ...stickerLayer, height: stickerLayer.width }
    : textLayer ? textLayer.style && textLayer.style !== 'plain' ? { ...textLayer, width: textLayer.decorationWidth!, height: textLayer.decorationWidth! * photoTextGeometry(textLayer.style).height / 100 } : textLayer
      : selection?.kind === 'logo' && recipe.logo && logoAsset ? { ...recipe.logo, height: recipe.logo.width * logoAsset.height / logoAsset.width } : undefined;
  function layerPoint(x: number, y: number) {
    if (!size) return { x: 0, y: 0 };
    const point = photoOrientedPoint({ x: x / size.width, y: y / size.height }, recipe, size);
    return { x: (point.x - recipe.crop.x) / recipe.crop.width, y: (point.y - recipe.crop.y) / recipe.crop.height };
  }
  const anchor = selected ? layerPoint(selected.x, selected.y) : null;
  const outline = selected && 'width' in selected ? ('shape' in selected && selected.shape === 'circle'
    ? Array.from({ length: 48 }, (_, index) => { const angle = index / 48 * Math.PI * 2;
      return layerPoint(selected.x + selected.width * (.5 + .5 * Math.cos(angle)), selected.y + selected.height * (.5 + .5 * Math.sin(angle))); })
    : [layerPoint(selected.x, selected.y), layerPoint(selected.x + selected.width, selected.y),
      layerPoint(selected.x + selected.width, selected.y + selected.height), layerPoint(selected.x, selected.y + selected.height)]) : null;
  function aspectRatio(): number | undefined {
    if (!oriented || aspect === 'free') return undefined;
    if (aspect === 'original') return oriented.width / oriented.height;
    const [width, height] = aspect.split(':').map(Number); return width / height;
  }
  function edit(update: (current: PhotoRecipe) => PhotoRecipe) {
    if (operation.current) return;
    setRecipe(current => {
      const next = update(current);
      return size ? { ...next, frameWidth: photoFrameWidth(photoCropPixels(size, next), next.frameWidth) } : next;
    }); setComparing(false); setError(''); setStraightenStatus('');
  }
  function changeCrop(patch: Partial<PhotoCrop>) { if (size) edit(current => setPhotoCrop(size, current, patch, aspectRatio())); }
  function moveLayer(dx: number, dy: number, base = recipe, activeSelection = selection) {
    if (!size || !oriented || !activeSelection || activeSelection.kind === 'logo' && logoOperation.current) return;
    const origin = photoSourcePoint({ x: 0, y: 0 }, base, size), target = photoSourcePoint({ x: dx / oriented.width, y: dy / oriented.height }, base, size);
    const deltaX = Math.round((target.x - origin.x) * size.width), deltaY = Math.round((target.y - origin.y) * size.height);
    edit(() => activeSelection.kind === 'logo' && logoAsset && base.logo ? { ...base, logo: fitPhotoLogo(size, logoAsset, base.logo, { x: base.logo.x + deltaX, y: base.logo.y + deltaY }) }
      : activeSelection.kind === 'mosaic' ? { ...base, mosaics: base.mosaics.map(layer => layer.id === activeSelection.id ? fitPhotoMosaic(size, layer, { x: layer.x + deltaX, y: layer.y + deltaY }) : layer) }
      : activeSelection.kind === 'sticker' ? { ...base, stickers: (base.stickers ?? []).map(layer => layer.id === activeSelection.id ? fitPhotoSticker(size, layer, { x: layer.x + deltaX, y: layer.y + deltaY }) : layer) }
      : activeSelection.kind === 'text' ? { ...base, texts: base.texts.map(layer => layer.id === activeSelection.id ? { ...layer, x: Math.min(size.width - 1, Math.max(0, layer.x + deltaX)), y: Math.min(size.height - 1, Math.max(0, layer.y + deltaY)) } : layer) } : base);
  }
  function layerKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (operation.current) return;
    const step = event.shiftKey ? 10 : 1, dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (dx || dy) { event.preventDefault(); moveLayer(dx, dy); }
  }
  function startLayer(event: PointerEvent<HTMLButtonElement>) {
    if (operation.current || !event.isPrimary || event.button !== 0) return;
    layerDrag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, recipe, selection };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveLayerPointer(event: PointerEvent<HTMLButtonElement>) {
    const start = layerDrag.current, bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!start || !crop || !bounds || !bounds.width || !bounds.height || start.pointerId !== event.pointerId) return;
    moveLayer((event.clientX - start.clientX) / bounds.width * crop.width, (event.clientY - start.clientY) / bounds.height * crop.height, start.recipe, start.selection);
  }
  function stopLayer(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const start = layerDrag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (cancelled) edit(() => start.recipe);
    layerDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function removeLogo() {
    logoGeneration.current++; logoController.current?.abort(); previewController.current?.abort();
    session.current?.clearLogo(); setLogoAsset(null); setLogoError('');
    edit(current => ({ ...current, logo: null })); setSelection(null);
  }
  async function chooseLogo(file: File) {
    const active = session.current;
    if (!active || !size || operation.current || logoOperation.current) return;
    logoOperation.current = true; setLogoBusy(true); setLogoError(''); previewController.current?.abort();
    const generation = ++logoGeneration.current, controller = new AbortController(); logoController.current = controller;
    try {
      const asset = await active.replaceLogo(file, controller.signal);
      if (!mounted.current || controller.signal.aborted || generation !== logoGeneration.current) return;
      setLogoAsset(asset);
      edit(current => ({ ...current, logo: current.logo ? fitPhotoLogo(size, asset, current.logo)
        : positionPhotoLogo(size, asset, fitPhotoLogo(size, asset), 'bottom-right') }));
      setSelection({ kind: 'logo', id: asset.assetId });
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted && generation === logoGeneration.current)
        setLogoError(cause instanceof Error ? cause.message : '로고를 불러오지 못했습니다. 기존 로고는 유지됩니다.');
    } finally { logoOperation.current = false; if (mounted.current) setLogoBusy(false); }
  }
  function cancel() { mounted.current = false; releaseResources(); callbacks.current.onCancel(); }
  async function straighten() {
    const active = session.current;
    if (!active || !size || operation.current || logoOperation.current) return;
    operation.current = true; setStraightenBusy(true); setStraightenStatus('수평을 분석하고 있습니다…'); setComparing(false);
    previewController.current?.abort();
    const controller = new AbortController(); straightenController.current = controller;
    try {
      const result = await active.estimateStraighten(controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      if (result.degrees !== null) {
        const degrees = (recipe.flipX !== recipe.flipY ? -result.degrees : result.degrees) || 0;
        setRecipe(current => ({ ...current, straightenDegrees: degrees })); setError('');
        setStraightenStatus(degrees === 0 ? '이미 수평에 가깝습니다. 수평 보정 각도를 0도로 맞췄습니다.' : `${degrees}도로 수평을 보정했습니다. 미리보기를 확인해주세요.`);
      } else {
        setStraightenStatus(result.reason === 'outside-range' || result.reason === 'excessive-crop'
          ? '자동으로 보정하기 어려운 기울기입니다. 현재 각도는 유지하며 직접 조절할 수 있습니다.'
          : '기준이 될 선을 확실하게 찾지 못했습니다. 현재 각도는 유지하며 직접 조절할 수 있습니다.');
      }
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) setStraightenStatus(cause instanceof Error ? cause.message : '수평을 분석하지 못했습니다. 현재 각도는 유지됩니다.');
    } finally { operation.current = false; if (mounted.current) setStraightenBusy(false); }
  }
  async function apply() {
    const active = session.current;
    if (!active || !ready || cropping || comparing || error || operation.current || logoOperation.current) return;
    operation.current = true; setBusy(true); setError('');
    const controller = new AbortController(); applyController.current = controller;
    try {
      const file = await active.render(recipe, controller.signal);
      if (!controller.signal.aborted && mounted.current) callbacks.current.onApply(file);
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setError(cause instanceof Error ? cause.message : '편집 이미지를 만들지 못했습니다. 원래 사진은 유지됩니다.');
    } finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  function pointerPoint(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) };
  }
  function startCrop(event: PointerEvent<HTMLDivElement>) {
    if (!oriented || operation.current || !event.isPrimary || event.button !== 0) return;
    const point = pointerPoint(event);
    drag.current = { pointerId: event.pointerId, ...point, recipe };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveCrop(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!size || !oriented || !start || start.pointerId !== event.pointerId) return;
    const point = pointerPoint(event);
    edit(() => setPhotoCrop(size, start.recipe, {
      x: Math.min(start.x, point.x) * oriented.width, y: Math.min(start.y, point.y) * oriented.height,
      width: Math.max(1, Math.abs(start.x - point.x) * oriented.width), height: Math.max(1, Math.abs(start.y - point.y) * oriented.height),
    }, aspectRatio()));
  }
  function stopCrop(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (cancelled) edit(() => current.recipe);
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function cropKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!crop || operation.current) return;
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (dx || dy) { event.preventDefault(); changeCrop({ x: crop.x + dx, y: crop.y + dy }); }
  }
  return <CustomerServiceDialog title="사진 편집" onClose={cancel}>
    <section className="admin-photo-editor" aria-busy={busy || straightenBusy}>
      <p>원본 사진은 바뀌지 않습니다. 완료 후 상품을 저장하면 편집한 사진으로 반영됩니다.</p>
      <p className="admin-photo-editor__limit">사진 편집: 5MB 이하 · 400만 픽셀 이하 · 가로·세로 4096px 이하</p>
      {error && <p role="alert">{error}</p>}
      <div className="admin-photo-editor__stage" aria-label="사진 편집 미리보기">
        {preview ? <div className="admin-photo-editor__frame" aria-busy={!ready}>
          {/* Canvas output is an ephemeral local Blob, never a product path. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt={comparing ? '편집 시작 전 원본 사진' : cropping ? '자를 범위를 선택할 사진' : '편집 결과 미리보기'} draggable={false} />
          {cropping && !comparing && ready && <div className="admin-photo-editor__crop-surface" role="group" tabIndex={busy ? -1 : 0}
            aria-label="자를 범위 이동: 방향키 1픽셀, Shift와 방향키 10픽셀" onKeyDown={cropKey}
            onPointerDown={startCrop} onPointerMove={moveCrop} onPointerUp={event => stopCrop(event)} onPointerCancel={event => stopCrop(event, true)}>
            <div className="admin-photo-editor__crop-box" style={{ left: `${recipe.crop.x * 100}%`, top: `${recipe.crop.y * 100}%`, width: `${recipe.crop.width * 100}%`, height: `${recipe.crop.height * 100}%` }} />
          </div>}
          {!cropping && !comparing && selected && anchor && (selection?.kind === tool || selection?.kind === 'text' && (tool === 'bubble' || tool === 'signature')) && <div className="admin-photo-editor__layer-surface">
            {outline && <svg className="admin-photo-editor__layer-box" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true"><polygon points={outline.map(point => `${point.x},${point.y}`).join(' ')} vectorEffect="non-scaling-stroke" /></svg>}
            <button type="button" className="admin-photo-editor__layer-handle" disabled={busy || straightenBusy || selection?.kind === 'logo' && logoBusy} aria-label="선택 영역 이동: 드래그 또는 방향키" style={{ left: `${Math.min(.95, Math.max(.05, anchor.x)) * 100}%`, top: `${Math.min(.95, Math.max(.05, anchor.y)) * 100}%` }}
              onKeyDown={layerKey} onPointerDown={startLayer} onPointerMove={moveLayerPointer} onPointerUp={event => stopLayer(event)} onPointerCancel={event => stopLayer(event, true)}>↔</button>
          </div>}
        </div> : <p role="status">{error ? '원래 사진은 유지됩니다.' : size ? '미리보기를 만드는 중…' : '사진을 불러오는 중…'}</p>}
      </div>
      {preview && !ready && !error && <p role="status">미리보기 갱신 중… 갱신이 끝나면 완료할 수 있습니다.</p>}
      <p role="status" className="admin-photo-editor__dimensions">{crop ? `${comparing ? '원본 비교 중 · ' : ''}편집 결과 ${crop.width} × ${crop.height}px` : '사진 정보를 확인하고 있습니다.'}</p>
      <fieldset className="admin-photo-editor__controls" disabled={!size || busy || straightenBusy}>
        <legend className="wc-sr-only">사진 편집 도구</legend>
        <div className="admin-photo-editor__buttons">
          <button type="button" aria-pressed={cropping} onClick={() => { setCropping(value => !value); setComparing(false); }}>{cropping ? '자르기 확인' : '자르기'}</button>
          <button type="button" aria-pressed={comparing} onClick={() => { setComparing(value => !value); setCropping(false); }}>{comparing ? '편집 결과 보기' : '원본 보기'}</button>
          <button type="button" onClick={() => { removeLogo(); edit(() => initialPhotoRecipe()); setAspect('original'); setCropping(false); setSelection(null); }}>편집 시작 상태로 재설정</button>
        </div>
        <div className="admin-photo-editor__buttons">
          <button type="button" onClick={() => { edit(current => rotatePhotoRecipe(current, -1)); setAspect(value => inverseAspect[value]); }}>왼쪽 90도 회전</button>
          <button type="button" onClick={() => { edit(current => rotatePhotoRecipe(current, 1)); setAspect(value => inverseAspect[value]); }}>오른쪽 90도 회전</button>
          <button type="button" onClick={() => edit(current => flipPhotoRecipe(current, 'x'))}>좌우 반전</button>
          <button type="button" onClick={() => edit(current => flipPhotoRecipe(current, 'y'))}>상하 반전</button>
        </div>
        {cropping && crop && oriented && <div className="admin-photo-editor__crop-controls">
          <p>사진 위에서 범위를 그리거나 아래 좌표를 입력하세요. 사진에 초점을 두고 방향키로 범위를 옮길 수도 있습니다.</p>
          <label>자르기 비율<select value={aspect} onChange={event => {
            const value = event.target.value as Aspect; setAspect(value);
            if (value !== 'free' && size) { const ratio = value === 'original' ? oriented.width / oriented.height : Number(value.split(':')[0]) / Number(value.split(':')[1]); edit(current => fitPhotoCrop(size, current, ratio)); }
          }}>{aspects.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <div className="admin-photo-editor__coordinates">{([['x', '왼쪽 위치'], ['y', '위쪽 위치'], ['width', '자를 너비'], ['height', '자를 높이']] as const).map(([key, label]) => <label key={key}>{label} (px)<input type="number" min={key === 'width' || key === 'height' ? 1 : 0} max={key === 'x' || key === 'width' ? oriented.width : oriented.height} step={1} value={crop[key]}
            onChange={event => { if (event.target.value !== '') changeCrop({ [key]: Number(event.target.value) }); }} /></label>)}</div>
        </div>}
        <div className="admin-photo-editor__buttons" aria-label="보정과 추가 도구">{([['adjust', '색상 보정'], ['mosaic', '모자이크'], ['text', '텍스트'], ['bubble', '말풍선'], ['signature', '텍스트 서명'], ['sticker', '스티커'], ['logo', '로고·서명'], ['presentation', '액자·도형']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={!cropping && tool === key} onClick={() => { setTool(key); setCropping(false); setComparing(false); if (key === 'logo' && recipe.logo) setSelection({ kind: 'logo', id: recipe.logo.assetId }); }}>{label}</button>)}</div>
        {!cropping && tool === 'adjust' && <div className="admin-photo-editor__adjustments">
          <div className="admin-photo-editor__buttons">
            <button type="button" disabled={logoBusy} onClick={() => void straighten()}>자동 수평 맞춤</button>
            <button type="button" onClick={() => edit(current => ({ ...current, straightenDegrees: 0 }))}>수평 보정 해제</button>
          </div>
          <label>수평 보정 각도 (도)<input type="number" min={-PHOTO_STRAIGHTEN_LIMIT} max={PHOTO_STRAIGHTEN_LIMIT} step={.1} value={recipe.straightenDegrees}
            onChange={event => { const value = Number(event.target.value); if (event.target.value !== '' && Number.isFinite(value)) edit(current => ({ ...current, straightenDegrees: Math.round(Math.min(PHOTO_STRAIGHTEN_LIMIT, Math.max(-PHOTO_STRAIGHTEN_LIMIT, value)) * 10) / 10 || 0 })); }} /></label>
          <p className="admin-photo-editor__limit">사진 속 직선을 기준으로 수평을 맞춥니다. 기울일 때 빈 모서리가 생기지 않도록 가장자리를 잘라내며 사진 크기는 유지합니다. 미리보기로 확인하고 직접 각도를 조절할 수 있습니다.</p>
          {straightenStatus && <p role="status">{straightenStatus}</p>}
          <label className="admin-photo-editor__toggle"><input type="checkbox" checked={recipe.automaticLevels} onChange={event => edit(current => ({ ...current, automaticLevels: event.target.checked }))} />자동 명암</label>
          <p className="admin-photo-editor__limit">원본 전체의 명암 범위를 자동으로 넓힌 뒤 아래 보정을 적용합니다. 변화가 작은 사진은 그대로 유지합니다. 켜기·끄기로 비교해주세요.</p>
          <label>색조 필터<select value={recipe.filter} onChange={event => edit(current => ({ ...current, filter: event.target.value as PhotoFilter }))}>
            {PHOTO_FILTERS.map(filter => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
          </select></label>
          <p className="admin-photo-editor__limit">필터를 적용한 뒤 아래 수동 보정값을 적용합니다. 필터를 바꾸거나 없애도 수동 보정값·자르기·추가한 요소는 유지합니다.</p>
          {recipe.filter !== 'none' && <div className="admin-photo-editor__adjustment">
            <label>필터 강도 · {recipe.filterStrength}%<input type="range" min={0} max={100} step={1} value={recipe.filterStrength} onChange={event => edit(current => ({ ...current, filterStrength: Number(event.target.value) }))} /></label>
            <label><span className="wc-sr-only">필터 강도 값</span><input type="number" min={0} max={100} step={1} value={recipe.filterStrength} onChange={event => { const value = Number(event.target.value); if (event.target.value !== '' && Number.isFinite(value)) edit(current => ({ ...current, filterStrength: Math.round(Math.min(100, Math.max(0, value))) })); }} /></label>
          </div>}
          {recipe.filter !== 'none' && <p className="admin-photo-editor__limit">강도 0은 필터 효과 없음, 100은 선택한 필터를 최대로 적용합니다. 사진의 투명도는 바꾸지 않습니다.</p>}
          {([
          ['brightness', '밝기', -100], ['contrast', '대비', -100], ['saturation', '채도', -100], ['temperature', '색온도', -100],
          ['sharpness', '선명도', -100], ['circularBlur', '원형 블러', 0], ['linearBlur', '선형 블러', 0], ['vignette', '비네팅', 0],
        ] as const).map(([key, label, minimum]) => <div className="admin-photo-editor__adjustment" key={key}>
          <label>{label}<input type="range" min={minimum} max={100} step={1} value={recipe[key]} onChange={event => edit(current => ({ ...current, [key]: Number(event.target.value) }))} /></label>
          <label><span className="wc-sr-only">{label} 값</span><input type="number" min={minimum} max={100} step={1} value={recipe[key]} onChange={event => { const value = Number(event.target.value); if (event.target.value !== '' && Number.isFinite(value)) edit(current => ({ ...current, [key]: Math.round(Math.min(100, Math.max(minimum, value))) })); }} /></label>
        </div>)}
          <p className="admin-photo-editor__limit">색온도는 음수일수록 차갑게, 양수일수록 따뜻하게 바꿉니다. 선명도는 음수일수록 부드럽게, 양수일수록 윤곽을 강조합니다.</p>
          <p className="admin-photo-editor__limit">원형 블러는 원본 중앙의 원 안을, 선형 블러는 중앙의 가로 띠 안을 선명하게 두고 바깥을 흐리게 합니다. 비네팅은 가장자리를 어둡게 합니다. 효과는 사진과 함께 회전하며 자르기에 따라 중심이 이동하지 않습니다. 수동 보정값 0은 해당 효과 없음입니다.</p>
        </div>}
        {!cropping && tool === 'presentation' && crop && <div className="admin-photo-editor__presentation">
          <p>테두리와 도형은 자르기를 마친 사진에 적용합니다. 사진 크기는 유지하며 테두리는 안쪽에 그립니다.</p>
          <div className="admin-photo-editor__presets" aria-label="액자 스타일">{PHOTO_FRAME_STYLES.map(style => <button type="button" key={style.value} aria-pressed={(recipe.frameStyle ?? 'solid') === style.value}
            onClick={() => edit(current => ({ ...current, frameStyle: style.value }))}>
            {style.value !== 'solid' && <GoodsPhotoDecorationPreview paths={photoDecoratedFrameGeometry({ width: 100, height: 100 }, { frameStyle: style.value, frameWidth: 9, frameColor: '#000000', mask: 'none' })} />}
            <span>{style.label}</span>
          </button>)}</div>
          <p className="admin-photo-editor__limit">액자 스타일을 선택한 뒤 두께를 정하세요. 두께 0은 액자 없음이며, 3px 미만의 이중선은 한 줄로 표시됩니다.</p>
          <label>도형 마스크<select value={recipe.mask} onChange={event => edit(current => ({ ...current, mask: event.target.value as PhotoMask }))}>
            {PHOTO_MASKS.map(mask => <option key={mask} value={mask}>{{ none: '적용 안 함', circle: '원형', rounded: '둥근 사각형', triangle: '삼각형', pentagon: '오각형', hexagon: '육각형', star: '별' }[mask]}</option>)}
          </select></label>
          <div className="admin-photo-editor__buttons">
            <button type="button" onClick={() => edit(current => ({ ...current, frameWidth: 0 }))}>테두리 없음</button>
            <button type="button" disabled={photoFrameMaximum(crop) === 0} onClick={() => edit(current => ({ ...current, frameColor: '#ffffff', frameWidth: current.frameWidth || 8 }))}>흰 테두리</button>
            <button type="button" disabled={photoFrameMaximum(crop) === 0} onClick={() => edit(current => ({ ...current, frameColor: '#000000', frameWidth: current.frameWidth || 8 }))}>검은 테두리</button>
          </div>
          <div className="admin-photo-editor__presentation-fields">
            <label>테두리 두께 (px)<input type="number" min={0} max={photoFrameMaximum(crop)} step={1} value={recipe.frameWidth} disabled={photoFrameMaximum(crop) === 0}
              onChange={event => { const value = Number(event.target.value); if (event.target.value !== '' && Number.isFinite(value)) edit(current => ({ ...current, frameWidth: photoFrameWidth(crop, Math.round(value)) })); }} /></label>
            <label>테두리 색<input type="color" value={recipe.frameColor} onChange={event => edit(current => ({ ...current, frameColor: event.target.value }))} /></label>
          </div>
          <p className="admin-photo-editor__limit">두께 0은 테두리 없음입니다. 원형·다각형·별은 사진 중앙에서 짧은 변에 맞추며, 둥근 사각형의 모서리는 짧은 변의 10%입니다. 자르기 중에는 테두리·도형을 잠시 숨깁니다.</p>
          {recipe.mask !== 'none' && <p role="status">도형 밖은 투명하게 처리하고 PNG로 저장합니다. JPG 사진도 PNG로 바뀝니다.</p>}
        </div>}
        {!cropping && (tool === 'mosaic' || tool === 'text' || tool === 'bubble' || tool === 'signature') && size && <GoodsPhotoLayers kind={tool === 'mosaic' ? 'mosaic' : 'text'} textMode={tool === 'bubble' || tool === 'signature' ? tool : 'plain'} size={size} recipe={recipe} selection={selection?.kind === 'mosaic' || selection?.kind === 'text' ? selection : null} select={setSelection} edit={edit} move={moveLayer} reportError={setError} />}
        {!cropping && tool === 'sticker' && size && <GoodsPhotoStickers size={size} recipe={recipe} selectedId={selection?.kind === 'sticker' ? selection.id : undefined} select={id => setSelection(id ? { kind: 'sticker', id } : null)} edit={edit} move={moveLayer} />}
        {!cropping && tool === 'logo' && size && <GoodsPhotoLogo size={size} recipe={recipe} asset={logoAsset} loading={logoBusy} error={logoError} choose={file => void chooseLogo(file)} remove={removeLogo} move={(dx, dy) => { if (recipe.logo) moveLayer(dx, dy, recipe, { kind: 'logo', id: recipe.logo.assetId }); }} edit={edit} />}
      </fieldset>
      {cropping && <p>범위를 확인한 뒤 ‘자르기 확인’을 눌러 결과를 보세요.</p>}
      <div className="admin-photo-editor__footer">
        <button type="button" className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={!size || !ready || busy || cropping || comparing || Boolean(error)} onClick={() => void apply()}>{busy ? '편집 결과 만드는 중…' : '완료'}</button>
        <button type="button" className="wc-admin-kit__button" onClick={cancel}>취소</button>
      </div>
    </section>
  </CustomerServiceDialog>;
}
