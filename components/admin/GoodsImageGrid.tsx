'use client';

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { ADMIN_ARTWORK_ACCEPT, ADMIN_ARTWORK_ERROR, normalizeAdminArtworkMetadata } from '@/lib/admin/artwork';
import { uploadAdminArtwork } from '@/lib/admin/artwork-upload.client';
import { GOODS_GALLERY_MAX } from '@/lib/admin/catalog';
import {
  GOODS_IMAGE_FIELD_NAMES,
  GOODS_IMAGE_SLOT_COUNT,
  createGoodsImageSlots,
  findGoodsImagePosition,
  goodsGalleryCount,
  goodsImageBlockingMessage,
  goodsImageLabel,
  goodsImageObjectParticle,
  goodsImageTargets,
  moveGoodsGalleryImage,
  promoteGoodsImage,
  removeGoodsImage,
  replaceGoodsImageTile,
  type GoodsImageSlots,
  type GoodsImageTile,
} from '@/lib/admin/goods-image-grid';
import { COMMON_ARTWORK_GUIDANCE } from './ArtworkUploadField';
import { ErrorText } from './fields';

export const GOODS_IMAGE_GUIDANCE_ID = 'goods-image-upload-guidance';
export const GOODS_IMAGE_RATIO_GUIDANCE = '1000×1000(1:1) 이미지를 권장합니다. 올린 원본 비율 그대로, 잘리지 않고 표시됩니다.';

type Slots = GoodsImageSlots<File>;
type Tile = GoodsImageTile<File>;
type FocusTarget = { position: number; control: 'input' | 'earlier' | 'later' };
type DragState = { pointerId: number; from: number; startX: number; startY: number; active: boolean; over: number };

const DRAG_THRESHOLD = 6;

/*
 * 상품 이미지 썸네일 그리드 (2026-10-07 MD 요청). 대표 이미지와 추가 이미지를 1:1 타일로 한곳에 보여준다.
 *
 * - 타일을 누르면 파일 선택 → 즉시 업로드로 교체한다. 업로드 파이프라인(서명 업로드·검증·claim)은
 *   ArtworkUploadField와 같은 uploadAdminArtwork를 쓴다.
 * - 자리마다 hidden input(`imagePath`, `galleryPath0…`)이 고정되어 있고 값만 옮겨진다. 저장 계약과
 *   로컬 자동복구·미저장 감지(hidden value 변경 감시)가 그대로 동작한다.
 * - 각 타일은 `.wc-admin-artwork-upload-field` 경계 안에 hidden input과 파일 입력을 함께 둔다. 폼의
 *   오류 이동·유효성 매핑(GoodEditor·GoodWorkspace)이 그 경계로 자리 이름을 찾는다.
 */
export function GoodsImageGrid({ errors = {}, initialPaths, initialUrls, onPreviewChange }: {
  errors?: Record<string, string | undefined>;
  /** 대표 이미지, 추가 이미지 1…N 순서. */
  initialPaths: readonly (string | null | undefined)[];
  initialUrls: readonly (string | null | undefined)[];
  onPreviewChange: (name: string, url: string | null) => void;
}) {
  const [slots, setSlots] = useState<Slots>(() => createGoodsImageSlots(initialPaths, initialUrls));
  const [announcement, setAnnouncement] = useState('');
  const [notice, setNotice] = useState('');
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const slotsRef = useRef<Slots>(slots);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const controlRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const objectUrls = useRef(new Set<string>());
  const keyCounter = useRef(0);
  const dragRef = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const galleryCount = goodsGalleryCount(slots);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  /* 업로드 중·실패한 새 이미지는 제출할 경로가 없다. 그 자리의 파일 입력이 폼 저장을 막는다. */
  useEffect(() => {
    inputRefs.current.forEach((input, position) => input?.setCustomValidity(goodsImageBlockingMessage(slots[position])));
    const focus = pendingFocus.current;
    if (!focus) return;
    pendingFocus.current = null;
    const control = focus.control === 'input' ? null : controlRefs.current[`${focus.control}-${focus.position}`];
    (control && !control.disabled ? control : inputRefs.current[focus.position])?.focus();
  }, [slots]);

  function releaseUrl(url: string | null | undefined) {
    if (url && objectUrls.current.delete(url)) URL.revokeObjectURL(url);
  }

  function commit(next: Slots, message?: string) {
    slotsRef.current = next;
    setSlots(next);
    GOODS_IMAGE_FIELD_NAMES.forEach((name, position) => onPreviewChange(name, next[position]?.url ?? null));
    if (message) setAnnouncement(message);
  }

  async function upload(key: string, file: File) {
    const result = await uploadAdminArtwork({ kind: 'good', file });
    const current = slotsRef.current;
    const position = findGoodsImagePosition(current, key);
    // 업로드 중에 삭제한 이미지의 결과는 버린다. 검증만 된 claim은 정기 정리가 회수한다.
    if (position < 0) return;
    const label = goodsImageLabel(position);
    if (result.ok) {
      const tile = current[position]!;
      releaseUrl(tile.previous?.url);
      commit(replaceGoodsImageTile(current, key, (value) => ({ key: value.key, path: result.imagePath, url: value.url, status: 'uploaded' })),
        `${label} 업로드 완료 · 상품 저장 전입니다.`);
      return;
    }
    commit(replaceGoodsImageTile(current, key, (value) => {
      if (!value.previous) return { ...value, status: 'failed', error: result.error };
      releaseUrl(value.url);
      return { key: value.key, ...value.previous, error: `${result.error} 원래 이미지를 유지합니다.` };
    }), `${label} 업로드 실패. ${result.error}`);
  }

  function newTile(file: File): Tile {
    const url = URL.createObjectURL(file);
    objectUrls.current.add(url);
    keyCounter.current += 1;
    return { key: `new-${keyCounter.current}`, path: '', url, status: 'uploading', file };
  }

  function addFiles(files: File[], fromMain: boolean) {
    const accepted = files.filter((file) => normalizeAdminArtworkMetadata({ kind: 'good', mimeType: file.type, size: file.size }).ok);
    const rejected = files.length - accepted.length;
    const { targets, overflow } = goodsImageTargets(slotsRef.current, accepted.length, fromMain);
    const next = [...slotsRef.current];
    const started: Tile[] = [];
    targets.forEach((position, index) => {
      const tile = newTile(accepted[index]);
      next[position] = tile;
      started.push(tile);
    });
    const messages = [
      rejected ? `형식·크기 조건에 맞지 않는 파일 ${rejected}개는 넣지 않았습니다. ${ADMIN_ARTWORK_ERROR}` : '',
      overflow ? `추가 이미지는 최대 ${GOODS_GALLERY_MAX}장입니다. 선택한 파일 중 ${overflow}개는 넣지 않았습니다.` : '',
    ].filter(Boolean);
    setNotice(messages.join(' '));
    if (!started.length) {
      if (messages.length) setAnnouncement(messages.join(' '));
      return;
    }
    commit(next, `${started.length}장 업로드를 시작했습니다.${messages.length ? ` ${messages.join(' ')}` : ''}`);
    for (const tile of started) void upload(tile.key, tile.file!);
  }

  function replaceFile(position: number, file: File) {
    const tile = slotsRef.current[position];
    if (!tile) return;
    const metadata = normalizeAdminArtworkMetadata({ kind: 'good', mimeType: file.type, size: file.size });
    if (!metadata.ok) {
      commit(replaceGoodsImageTile(slotsRef.current, tile.key, (value) => ({ ...value, error: metadata.error })), `${goodsImageLabel(position)}: ${metadata.error}`);
      return;
    }
    const url = URL.createObjectURL(file);
    objectUrls.current.add(url);
    const previous = tile.status === 'saved' || tile.status === 'uploaded' ? { path: tile.path, url: tile.url, status: tile.status } : undefined;
    if (!previous) releaseUrl(tile.url);
    commit(replaceGoodsImageTile(slotsRef.current, tile.key, (value) => ({ key: value.key, path: previous?.path ?? '', url, status: 'uploading', file, previous })),
      `${goodsImageLabel(position)} 교체 업로드를 시작했습니다.`);
    void upload(tile.key, file);
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>, position: number) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!files.length) return;
    setNotice('');
    const tile = slotsRef.current[position];
    if (tile) replaceFile(position, files[0]);
    else addFiles(files, position === 0);
  }

  function retry(position: number) {
    const tile = slotsRef.current[position];
    if (!tile?.file || tile.status !== 'failed') return;
    commit(replaceGoodsImageTile(slotsRef.current, tile.key, (value) => ({ ...value, status: 'uploading', error: undefined })),
      `${goodsImageLabel(position)} 업로드를 다시 시도합니다.`);
    void upload(tile.key, tile.file);
  }

  function remove(position: number) {
    const tile = slotsRef.current[position];
    if (!tile) return;
    releaseUrl(tile.url);
    releaseUrl(tile.previous?.url);
    // 지운 자리에는 다음 이미지나 "이미지 추가" 타일이 온다.
    pendingFocus.current = { position, control: 'input' };
    const label = goodsImageLabel(position);
    commit(removeGoodsImage(slotsRef.current, position), tile.path && position > 0
      ? `${label}${goodsImageObjectParticle(position)} 삭제했습니다. 상품을 저장하면 연결이 제거됩니다. 저장소 원본은 별도 보존됩니다.`
      : `${label} 업로드를 취소했습니다.`);
  }

  function move(from: number, to: number, control: FocusTarget['control'] = 'input') {
    const count = goodsGalleryCount(slotsRef.current);
    if (from < 1 || to < 1 || to > count || from === to) return;
    pendingFocus.current = { position: to, control };
    commit(moveGoodsGalleryImage(slotsRef.current, from, to),
      `${goodsImageLabel(from)}${goodsImageObjectParticle(from)} ${to}번째 추가 이미지로 옮겼습니다.`);
  }

  function promote(position: number) {
    if (!slotsRef.current[position]) return;
    const hadMain = Boolean(slotsRef.current[0]);
    pendingFocus.current = { position: 0, control: 'input' };
    commit(promoteGoodsImage(slotsRef.current, position), `${goodsImageLabel(position)}${goodsImageObjectParticle(position)} 대표 이미지로 지정했습니다.${hadMain ? ` 기존 대표 이미지는 ${position}번째 추가 이미지로 옮겼습니다.` : ''}`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>, position: number) {
    if (position < 1) return;
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    move(position, position + delta);
  }

  function pointerDown(event: PointerEvent<HTMLLabelElement>, position: number) {
    if (position < 1 || !event.isPrimary || event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, from: position, startX: event.clientX, startY: event.clientY, active: false, over: position };
  }

  function pointerMove(event: PointerEvent<HTMLLabelElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.active) {
      if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < DRAG_THRESHOLD) return;
      current.active = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDrag({ from: current.from, over: current.over });
      setAnnouncement(`${goodsImageLabel(current.from)} 순서를 바꾸는 중입니다. 놓을 자리에서 손을 떼주세요.`);
    }
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-image-position]');
    const over = Number(target?.dataset.imagePosition);
    if (Number.isInteger(over) && over >= 1 && over <= goodsGalleryCount(slotsRef.current) && over !== current.over) {
      current.over = over;
      setDrag({ from: current.from, over });
    }
  }

  function pointerEnd(event: PointerEvent<HTMLLabelElement>, cancelled = false) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (!current.active) return;
    setDrag(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    // 끌기를 마친 뒤 이어지는 click이 파일 선택 창을 열지 않게 한다.
    suppressClick.current = true;
    setTimeout(() => { suppressClick.current = false; }, 0);
    if (cancelled || current.over === current.from) {
      setAnnouncement(`${goodsImageLabel(current.from)} 순서를 바꾸지 않았습니다.`);
      return;
    }
    move(current.from, current.over);
  }

  function frameClick(event: MouseEvent<HTMLLabelElement>, tile: Tile | null) {
    if (suppressClick.current || tile?.status === 'uploading') {
      event.preventDefault();
      suppressClick.current = false;
    }
  }

  function renderTile(position: number) {
    const tile = slots[position];
    const name = GOODS_IMAGE_FIELD_NAMES[position];
    const label = goodsImageLabel(position);
    const particle = goodsImageObjectParticle(position);
    const isMain = position === 0;
    const isAdd = !tile && !isMain;
    const formError = errors[name];
    const errorId = `${name}-error`;
    const tileErrorId = `${name}-tile-error`;
    const describedBy = [GOODS_IMAGE_GUIDANCE_ID, tile?.error ? tileErrorId : null, formError ? errorId : null].filter(Boolean).join(' ');
    const inputLabel = tile ? `${label} 교체` : isMain ? '대표 이미지 추가' : '이미지 추가 (추가 이미지, 여러 장 선택 가능)';
    const state = tile?.status ?? 'empty';
    const stateText = tile?.status === 'uploading' ? '업로드 중…' : tile?.status === 'uploaded' ? '업로드 완료 · 저장 전' : tile?.status === 'failed' ? '업로드 실패' : null;
    return <li
      className="wc-admin-image-tile wc-admin-artwork-upload-field"
      data-add-tile={isAdd || undefined}
      data-drop-target={drag && drag.over === position && drag.from !== position ? 'true' : undefined}
      data-dragging={drag?.from === position || undefined}
      data-image-position={position}
      data-invalid={Boolean(formError || tile?.error) || undefined}
      data-main={isMain || undefined}
      data-upload-state={state}
      key={`position-${position}`}
    >
      <label
        className="wc-admin-image-tile__frame"
        data-draggable={(tile && !isMain) || undefined}
        onClick={(event) => frameClick(event, tile)}
        onPointerCancel={(event) => pointerEnd(event, true)}
        onPointerDown={(event) => tile && pointerDown(event, position)}
        onPointerMove={pointerMove}
        onPointerUp={(event) => pointerEnd(event)}
      >
        {tile?.url ? (
          // 선택 직후의 object URL도 즉시 보여야 한다.
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" draggable={false} src={tile.url} />
        ) : tile ? (
          <span className="wc-admin-image-tile__placeholder">미리보기 없음</span>
        ) : (
          <span className="wc-admin-image-tile__placeholder" aria-hidden="true"><b>+</b>{isMain ? '대표 이미지' : '이미지 추가'}</span>
        )}
        <input
          accept={ADMIN_ARTWORK_ACCEPT}
          aria-describedby={describedBy}
          aria-invalid={Boolean(formError || tile?.error) || undefined}
          aria-label={inputLabel}
          className="wc-admin-image-tile__input"
          multiple={!tile}
          onChange={(event) => handleFiles(event, position)}
          onClick={(event) => { if (tile?.status === 'uploading') event.preventDefault(); }}
          onKeyDown={(event) => handleKeyDown(event, position)}
          ref={(element) => { inputRefs.current[position] = element; }}
          type="file"
        />
      </label>
      {tile && (!isMain || !tile.path) ? (
        <button aria-label={isMain ? '대표 이미지 업로드 취소' : `${label} 삭제`} className="wc-admin-image-tile__remove" onClick={() => remove(position)} type="button">
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
      <div className="wc-admin-image-tile__caption">
        <strong>{isAdd ? `추가 이미지 ${galleryCount}/${GOODS_GALLERY_MAX}` : label}</strong>
        {isMain ? <span>공개 필수</span> : null}
        {stateText ? <span data-upload-status={state}>{stateText}</span> : null}
      </div>
      {tile && !isMain ? (
        <div className="wc-admin-image-tile__actions">
          <button aria-label={`${label}${particle} 앞으로`} disabled={position === 1} onClick={() => move(position, position - 1, 'earlier')} ref={(element) => { controlRefs.current[`earlier-${position}`] = element; }} type="button"><span aria-hidden="true">◀</span></button>
          <button aria-label={`${label}${particle} 뒤로`} disabled={position === galleryCount} onClick={() => move(position, position + 1, 'later')} ref={(element) => { controlRefs.current[`later-${position}`] = element; }} type="button"><span aria-hidden="true">▶</span></button>
          <button aria-label={`${label}${particle} 대표로 지정`} onClick={() => promote(position)} type="button">대표로</button>
        </div>
      ) : null}
      {tile?.status === 'failed' && tile.file ? <button className="wc-admin-image-tile__retry" onClick={() => retry(position)} type="button">다시 시도</button> : null}
      {tile?.error ? <span className="wc-admin-image-tile__error" id={tileErrorId} role="alert">{tile.error}</span> : null}
      <ErrorText id={errorId}>{formError}</ErrorText>
      <input name={name} readOnly type="hidden" value={tile?.path ?? ''} />
    </li>;
  }

  return <fieldset className="wc-admin-image-grid">
    <legend>상품 이미지 · 대표 이미지 1장 + 추가 이미지 최대 {GOODS_GALLERY_MAX}장</legend>
    <p className="wc-admin-image-grid__guidance" id={GOODS_IMAGE_GUIDANCE_ID}>{GOODS_IMAGE_RATIO_GUIDANCE} 공통 파일 규격: {COMMON_ARTWORK_GUIDANCE}.</p>
    <p className="wc-admin-image-grid__intro">이미지를 누르면 다른 파일로 바꿉니다. 추가 이미지는 끌어서(키보드는 ←·→) 순서를 바꾸며, 이 순서대로 상세페이지에 표시됩니다. 파일은 고르는 즉시 업로드되며, 상품 저장 후 공개 화면에 반영됩니다.</p>
    <ol className="wc-admin-image-grid__tiles">
      {Array.from({ length: GOODS_IMAGE_SLOT_COUNT }, (_, position) =>
        position === 0 || slots[position] || position === galleryCount + 1 ? renderTile(position) : null)}
    </ol>
    {Array.from({ length: GOODS_IMAGE_SLOT_COUNT }, (_, position) => position === 0 || slots[position] || position === galleryCount + 1
      ? null
      : <input key={`hidden-${position}`} name={GOODS_IMAGE_FIELD_NAMES[position]} readOnly type="hidden" value="" />)}
    {notice ? <p className="wc-admin-image-grid__notice" role="alert">{notice}</p> : null}
    <p aria-atomic="true" aria-live="polite" className="wc-sr-only" role="status">{announcement}</p>
  </fieldset>;
}
