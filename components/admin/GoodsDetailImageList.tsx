'use client';

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { ADMIN_ARTWORK_ACCEPT, GOODS_ARTWORK_ERROR } from '@/lib/admin/artwork';
// 상대 경로는 ArtworkUploadField·GoodsImageGrid와 같은 모듈 지정자다 — 시각 fixture가 이 지정자로 합성 업로드를 끼운다.
import { uploadAdminArtwork } from '../../lib/admin/artwork-upload.client';
import { createAdminArtworkPreviewUrl } from '@/lib/admin/artwork-preview.client';
import { GOODS_DETAIL_IMAGE_FIELD_NAMES, GOODS_DETAIL_IMAGE_MAX } from '@/lib/admin/catalog';
import {
  createGoodsDetailImageTiles,
  findGoodsDetailImageIndex,
  goodsDetailImageCapacity,
  goodsDetailImageFileAcceptable,
  goodsDetailImageLabel,
  goodsDetailImageObjectParticle,
  goodsDetailImageSignature,
  moveGoodsDetailImage,
  removeGoodsDetailImage,
  replaceGoodsDetailImageTile,
  type GoodsDetailImageTiles,
} from '@/lib/admin/goods-detail-image-list';
import { goodsImageBlockingMessage, type GoodsImageTile } from '@/lib/admin/goods-image-grid';
import { cn } from 'cn';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { GOODS_ARTWORK_GUIDANCE } from './ArtworkUploadField';
import { ErrorText } from './fields';

export const GOODS_DETAIL_IMAGE_GUIDANCE_ID = 'goods-detail-image-guidance';
/** 세로로 긴 이미지 타일 미리보기의 긴 변. 타일(폭 약 100px)에 그리기에 충분하고, 원본 디코딩 메모리를 쌓지 않는다(R19). */
const DETAIL_PREVIEW_MAX_EDGE = 1600;

type Tile = GoodsImageTile<File>;
type Tiles = GoodsDetailImageTiles<File>;
type FocusTarget = { index: number; control: 'input' | 'earlier' | 'later' | 'add' };

const TILE_ACTION_CLASS = cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-w-7 px-1.5 text-xs');

function tileFrameClass({ empty, state, invalid }: { empty: boolean; state: string; invalid: boolean }) {
  const color = state === 'failed' || invalid ? 'border-destructive'
    : state === 'uploaded' ? 'border-[var(--wc-success)]' : state === 'uploading' ? 'border-[var(--wc-info)]' : 'border-input';
  return cn('relative flex aspect-[1/2] items-start justify-center overflow-hidden rounded-lg border text-muted-foreground select-none has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50 forced-colors:border-[CanvasText] forced-colors:has-[input:focus-visible]:outline-2 forced-colors:has-[input:focus-visible]:outline-[Highlight]',
    empty ? 'items-center border-dashed bg-background' : 'border-solid bg-muted', color, state === 'uploading' ? 'cursor-progress' : 'cursor-pointer');
}

/*
 * 긴 상세 이미지 목록(2026-11-19 MD 요청). 세로로 긴 통이미지를 잘라 여러 장으로 올리면 상세 설명 아래에 이 순서대로
 * 이음새 없이 이어 붙는다. 상품 이미지 그리드처럼 타일을 누르면 교체, ×로 빼기, ◀·▶ 버튼이나 ←·→ 키로 순서를 바꾼다.
 *
 * - 업로드는 다른 이미지 칸과 같은 uploadAdminArtwork다(파일 내용으로 형식을 판별하고 서버가 검증한다). 여러 장을 한 번에
 *   골라도 한 장씩 차례로 올린다(DB는 운영자별로 한 번에 한 장만 확인한다).
 * - 폼 칸은 GOODS_DETAIL_IMAGE_FIELD_NAMES(첫 칸은 옛 한 장 칸 이름 detailImagePath)이고 앞에서부터 채운다. 자동복구·
 *   미저장 감지·서버 임시저장이 hidden input 값을 그대로 읽는다.
 * - 각 타일은 `[data-artwork-upload-field]` 경계 안에 hidden input과 파일 입력을 함께 둔다. 업로드 중·실패한 타일의 파일
 *   입력이 폼 저장을 막고(setCustomValidity), 편집기의 오류 이동이 그 경계로 칸 이름을 찾는다.
 */
export function GoodsDetailImageList({ errors = {}, initialPaths, initialUrls, onPreviewChange }: {
  errors?: Record<string, string | undefined>;
  initialPaths: readonly (string | null | undefined)[];
  initialUrls: readonly (string | null | undefined)[];
  onPreviewChange: (name: string, url: string | null) => void;
}) {
  const [tiles, setTiles] = useState<Tiles>(() => createGoodsDetailImageTiles(initialPaths, initialUrls));
  const [announcement, setAnnouncement] = useState('');
  const [notice, setNotice] = useState('');
  const tilesRef = useRef<Tiles>(tiles);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const controlRefs = useRef<Record<string, HTMLElement | null>>({});
  const objectUrls = useRef(new Set<string>());
  const pendingPreviews = useRef(new Map<string, File>());
  const pendingFocus = useRef<FocusTarget | null>(null);
  const keyCounter = useRef(0);
  const uploadQueue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(false);
  const fieldsetRef = useRef<HTMLFieldSetElement>(null);
  const submittedSignature = useRef(goodsDetailImageSignature(tiles));

  useEffect(() => {
    mounted.current = true;
    const urls = objectUrls.current;
    const previews = pendingPreviews.current;
    return () => {
      mounted.current = false;
      previews.clear();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  /* 업로드 중·실패한 새 이미지는 제출할 경로가 없다. 그 타일의 파일 입력이 폼 저장을 막는다. */
  useEffect(() => {
    inputRefs.current.forEach((input, index) => input?.setCustomValidity(goodsImageBlockingMessage(tiles[index])));
    // 순서 변경·빼기는 hidden 칸의 value를 바꾸지 않고 노드를 옮기거나 지운다. 제출 경로가 바뀌었으면 커밋된 DOM에서
    // change를 알려 자동복구·이탈 경고·편집기 값이 새 순서를 읽게 한다(Codex 리뷰 P1).
    const signature = goodsDetailImageSignature(tiles);
    if (signature !== submittedSignature.current) {
      submittedSignature.current = signature;
      fieldsetRef.current?.querySelector('input[type="hidden"][name]')?.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const focus = pendingFocus.current;
    if (!focus) return;
    pendingFocus.current = null;
    const control = focus.control === 'input' ? null : focus.control === 'add' ? controlRefs.current.add : controlRefs.current[`${focus.control}-${focus.index}`];
    const target = control && !(control as HTMLButtonElement).disabled ? control : inputRefs.current[focus.index] ?? controlRefs.current.add;
    target?.focus();
  }, [tiles]);

  function releaseUrl(url: string | null | undefined) {
    if (url && objectUrls.current.delete(url)) URL.revokeObjectURL(url);
  }

  function commit(next: Tiles, message?: string) {
    const previous = tilesRef.current;
    tilesRef.current = next;
    setTiles(next);
    // 미리보기 주소가 실제로 바뀐 칸만 편집기에 알린다(R19 — 상태만 바뀐 커밋에 편집기 전체를 다시 그리지 않는다).
    GOODS_DETAIL_IMAGE_FIELD_NAMES.forEach((name, index) => {
      const url = next[index]?.url ?? null;
      if (url !== (previous[index]?.url ?? null)) onPreviewChange(name, url);
    });
    if (message) setAnnouncement(message);
  }

  function enqueueUpload(key: string, file: File) {
    const run = uploadQueue.current.then(() => upload(key, file));
    uploadQueue.current = run.catch(() => undefined);
  }

  async function upload(key: string, file: File) {
    if (!mounted.current) return;
    // 차례를 기다리는 동안 삭제됐거나 다른 파일로 바뀐 타일은 올리지 않는다.
    const waiting = tilesRef.current[findGoodsDetailImageIndex(tilesRef.current, key)];
    if (!waiting || waiting.file !== file) return;
    const result = await uploadAdminArtwork({ kind: 'good', file });
    if (!mounted.current) return;
    const current = tilesRef.current;
    const index = findGoodsDetailImageIndex(current, key);
    // 업로드 중에 삭제했거나 다시 교체한 이미지의 결과는 버린다. 검증만 된 claim은 정기 정리가 회수한다.
    if (index < 0 || current[index]?.file !== file) return;
    const label = goodsDetailImageLabel(index);
    if (result.ok) {
      releaseUrl(current[index].previous?.url);
      commit(replaceGoodsDetailImageTile(current, key, (value) => ({ key: value.key, path: result.imagePath, url: value.url, status: 'uploaded' })),
        `${label} 업로드 완료 · 상품 저장 전입니다.`);
      return;
    }
    commit(replaceGoodsDetailImageTile(current, key, (value) => {
      if (!value.previous) return { ...value, status: 'failed', error: result.error };
      pendingPreviews.current.delete(key);
      releaseUrl(value.url);
      return { key: value.key, ...value.previous, error: `${result.error} 원래 이미지를 유지합니다.` };
    }), `${label} 업로드 실패. ${result.error}`);
  }

  function attachPreview(key: string, file: File) {
    pendingPreviews.current.set(key, file);
    void createAdminArtworkPreviewUrl(file, DETAIL_PREVIEW_MAX_EDGE).then((url) => {
      const current = tilesRef.current;
      const tile = current[findGoodsDetailImageIndex(current, key)];
      if (!mounted.current || pendingPreviews.current.get(key) !== file || !tile || tile.url) {
        if (pendingPreviews.current.get(key) === file) pendingPreviews.current.delete(key);
        URL.revokeObjectURL(url);
        return;
      }
      pendingPreviews.current.delete(key);
      objectUrls.current.add(url);
      commit(replaceGoodsDetailImageTile(current, key, (value) => ({ ...value, url })));
    }, () => {
      if (pendingPreviews.current.get(key) === file) pendingPreviews.current.delete(key);
    });
  }

  function addFiles(files: File[]) {
    const acceptable = files.filter(goodsDetailImageFileAcceptable);
    const rejected = files.length - acceptable.length;
    const { accepted, overflow } = goodsDetailImageCapacity(tilesRef.current, acceptable.length);
    const started: Tile[] = acceptable.slice(0, accepted).map((file) => {
      keyCounter.current += 1;
      return { key: `new-${keyCounter.current}`, path: '', url: null, status: 'uploading', file };
    });
    const messages = [
      rejected ? `형식·크기 조건에 맞지 않는 파일 ${rejected}개는 넣지 않았습니다. ${GOODS_ARTWORK_ERROR}` : '',
      overflow ? `긴 상세 이미지는 최대 ${GOODS_DETAIL_IMAGE_MAX}장입니다. 선택한 파일 중 ${overflow}개는 넣지 않았습니다.` : '',
    ].filter(Boolean);
    setNotice(messages.join(' '));
    if (!started.length) {
      if (messages.length) setAnnouncement(messages.join(' '));
      return;
    }
    // 고른 순서(파일 선택 창의 정렬 순서) 그대로 뒤에 붙는다. 파일 이름에 번호를 붙여 고르면 그 순서가 된다.
    commit([...tilesRef.current, ...started], `긴 상세 이미지 ${started.length}장 업로드를 시작했습니다.${messages.length ? ` ${messages.join(' ')}` : ''}`);
    for (const tile of started) {
      attachPreview(tile.key, tile.file!);
      enqueueUpload(tile.key, tile.file!);
    }
  }

  function replaceFile(index: number, file: File) {
    const tile = tilesRef.current[index];
    if (!tile) return;
    if (!goodsDetailImageFileAcceptable(file)) {
      commit(replaceGoodsDetailImageTile(tilesRef.current, tile.key, (value) => ({ ...value, error: GOODS_ARTWORK_ERROR })), `${goodsDetailImageLabel(index)}: ${GOODS_ARTWORK_ERROR}`);
      return;
    }
    const previous = tile.status === 'saved' || tile.status === 'uploaded' ? { path: tile.path, url: tile.url, status: tile.status } : undefined;
    if (!previous) releaseUrl(tile.url);
    commit(replaceGoodsDetailImageTile(tilesRef.current, tile.key, (value) => ({ key: value.key, path: previous?.path ?? '', url: null, status: 'uploading', file, previous })),
      `${goodsDetailImageLabel(index)} 교체 업로드를 시작했습니다.`);
    attachPreview(tile.key, file);
    enqueueUpload(tile.key, file);
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>, index: number | null) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!files.length) return;
    setNotice('');
    if (index === null) addFiles(files);
    else replaceFile(index, files[0]);
  }

  function retry(index: number) {
    const tile = tilesRef.current[index];
    if (!tile?.file || tile.status !== 'failed') return;
    commit(replaceGoodsDetailImageTile(tilesRef.current, tile.key, (value) => ({ ...value, status: 'uploading', error: undefined })),
      `${goodsDetailImageLabel(index)} 업로드를 다시 시도합니다.`);
    enqueueUpload(tile.key, tile.file);
  }

  function remove(index: number) {
    const tile = tilesRef.current[index];
    if (!tile) return;
    pendingPreviews.current.delete(tile.key);
    releaseUrl(tile.url);
    releaseUrl(tile.previous?.url);
    pendingFocus.current = index < tilesRef.current.length - 1 ? { index, control: 'input' } : { index, control: 'add' };
    const label = goodsDetailImageLabel(index);
    commit(removeGoodsDetailImage(tilesRef.current, index), tile.path
      ? `${label}${goodsDetailImageObjectParticle(index)} 뺐습니다. 상품을 저장하면 연결이 제거됩니다. 저장소 원본은 별도 보존됩니다.`
      : `${label} 업로드를 취소했습니다.`);
  }

  function move(from: number, to: number, control: FocusTarget['control'] = 'input') {
    const count = tilesRef.current.length;
    if (from < 0 || to < 0 || to >= count || from === to) return;
    pendingFocus.current = { index: to, control };
    commit(moveGoodsDetailImage(tilesRef.current, from, to),
      `${goodsDetailImageLabel(from)}${goodsDetailImageObjectParticle(from)} ${to + 1}번째로 옮겼습니다.`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>, index: number) {
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    move(index, index + delta);
  }

  function frameClick(event: MouseEvent<HTMLLabelElement>, tile: Tile) {
    if (tile.status === 'uploading') event.preventDefault();
  }

  function renderTile(tile: Tile, index: number) {
    const name = GOODS_DETAIL_IMAGE_FIELD_NAMES[index];
    const label = goodsDetailImageLabel(index);
    const particle = goodsDetailImageObjectParticle(index);
    const formError = errors[name];
    const errorId = `${name}-error`;
    const tileErrorId = `${name}-tile-error`;
    const describedBy = [GOODS_DETAIL_IMAGE_GUIDANCE_ID, tile.error ? tileErrorId : null, formError ? errorId : null].filter(Boolean).join(' ');
    const stateText = tile.status === 'uploading' ? '업로드 중…' : tile.status === 'uploaded' ? '업로드 완료 · 저장 전' : tile.status === 'failed' ? '업로드 실패' : null;
    const invalid = Boolean(formError || tile.error);
    return <li className="relative grid min-w-0 content-start gap-1.5 p-0" data-artwork-upload-field="" data-detail-image-index={index}
      data-invalid={invalid || undefined} data-upload-state={tile.status} key={tile.key}>
      <label className={tileFrameClass({ empty: false, state: tile.status, invalid })} onClick={(event) => frameClick(event, tile)}>
        {tile.url ? (
          // 업로드 전 축소 미리보기(object URL)도 바로 보여야 한다. 세로로 긴 이미지는 위쪽부터 보인다.
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className={cn('pointer-events-none size-full object-cover object-top', tile.status === 'uploading' && 'opacity-60')} decoding="async" draggable={false} src={tile.url} />
        ) : (
          <span className="grid self-center justify-items-center gap-1 p-2 text-center text-xs leading-snug">{tile.file ? '미리보기 준비 중…' : '미리보기 없음'}</span>
        )}
        <input
          accept={ADMIN_ARTWORK_ACCEPT}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-keyshortcuts="ArrowLeft ArrowRight"
          aria-label={`${label} 교체 (←·→ 키로 순서 바꾸기)`}
          className="sr-only"
          data-detail-image-input=""
          onChange={(event) => handleFiles(event, index)}
          onClick={(event) => { if (tile.status === 'uploading') event.preventDefault(); }}
          onKeyDown={(event) => handleKeyDown(event, index)}
          ref={(element) => { inputRefs.current[index] = element; }}
          type="file"
        />
      </label>
      <button aria-label={tile.path ? `${label} 빼기` : `${label} 업로드 취소`} className="absolute top-1 right-1 z-[1] inline-flex size-7 items-center justify-center rounded-full border bg-background p-0 text-base leading-none text-foreground shadow-xs outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" data-detail-image-remove="" onClick={() => remove(index)} type="button">
        <span aria-hidden="true">×</span>
      </button>
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs leading-snug">
        <strong className="font-medium text-foreground">{label}</strong>
        {stateText ? <span className={tile.status === 'uploaded' ? 'text-[var(--wc-success)]' : tile.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'} data-upload-status={tile.status}>{stateText}</span> : null}
      </div>
      <div className="flex gap-1">
        <button className={TILE_ACTION_CLASS} data-slot="button" aria-label={`${label}${particle} 앞으로`} disabled={index === 0} onClick={() => move(index, index - 1, 'earlier')} ref={(element) => { controlRefs.current[`earlier-${index}`] = element; }} type="button"><span aria-hidden="true">◀</span></button>
        <button className={TILE_ACTION_CLASS} data-slot="button" aria-label={`${label}${particle} 뒤로`} disabled={index === tiles.length - 1} onClick={() => move(index, index + 1, 'later')} ref={(element) => { controlRefs.current[`later-${index}`] = element; }} type="button"><span aria-hidden="true">▶</span></button>
      </div>
      {tile.status === 'failed' && tile.file ? <button className={cn(TILE_ACTION_CLASS, 'h-auto min-h-7 w-full py-1 whitespace-normal')} data-slot="button" onClick={() => retry(index)} type="button">다시 시도</button> : null}
      {tile.error ? <span className="text-xs font-medium leading-snug text-destructive wrap-anywhere" id={tileErrorId} role="alert">{tile.error}</span> : null}
      <ErrorText id={errorId}>{formError}</ErrorText>
      <input name={name} readOnly type="hidden" value={tile.path} />
    </li>;
  }

  const addName = GOODS_DETAIL_IMAGE_FIELD_NAMES[tiles.length];
  return <fieldset className="m-0 flex min-w-0 flex-col gap-3 rounded-lg border p-4" data-detail-image-list="" ref={fieldsetRef}>
    <legend className="float-left w-full p-0 text-sm font-medium text-foreground">긴 상세 이미지 · 최대 {GOODS_DETAIL_IMAGE_MAX}장</legend>
    <p className="text-sm wrap-anywhere" id={GOODS_DETAIL_IMAGE_GUIDANCE_ID}>
      상세페이지(상세 설명) 아래에 이 순서대로 원래 비율 그대로 이어 붙습니다. 세로로 아주 긴 통이미지는 3,000~5,000px 높이로 잘라 여러 장으로 올리면
      휴대폰에서 더 빨리 보입니다. 여러 장을 한 번에 고르면 고른 순서대로 뒤에 붙고, ◀·▶ 버튼이나 이미지를 선택한 뒤 ←·→ 키로 순서를 바꿉니다.
      호스팅 HTML로 상세페이지를 만들었다면 비워 두어도 됩니다. 파일 규격: {GOODS_ARTWORK_GUIDANCE}.
    </p>
    <ol className="m-0 grid max-w-[680px] list-none grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3 p-0">
      {tiles.map((tile, index) => renderTile(tile, index))}
      {addName ? <li className="relative grid min-w-0 content-start gap-1.5 p-0" data-artwork-upload-field="" data-add-tile="">
        <label className={tileFrameClass({ empty: true, state: 'empty', invalid: Boolean(errors[addName]) })}>
          <span aria-hidden="true" className="grid justify-items-center gap-1 p-2 text-center text-xs leading-snug"><b className="text-2xl leading-none font-normal">+</b>이미지 추가</span>
          <input accept={ADMIN_ARTWORK_ACCEPT} aria-describedby={GOODS_DETAIL_IMAGE_GUIDANCE_ID} aria-label="긴 상세 이미지 추가 (여러 장 선택 가능)" className="sr-only" data-detail-image-add="" multiple onChange={(event) => handleFiles(event, null)} ref={(element) => { controlRefs.current.add = element; }} type="file" />
        </label>
        <strong className="text-xs font-medium text-foreground">{`긴 상세 이미지 ${tiles.length}/${GOODS_DETAIL_IMAGE_MAX}`}</strong>
        <ErrorText id={`${addName}-error`}>{errors[addName]}</ErrorText>
        <input name={addName} readOnly type="hidden" value="" />
      </li> : null}
    </ol>
    {GOODS_DETAIL_IMAGE_FIELD_NAMES.slice(tiles.length + 1).map((name) => <input key={`hidden-${name}`} name={name} readOnly type="hidden" value="" />)}
    {notice ? <p className="text-xs font-medium text-destructive" role="alert">{notice}</p> : null}
    <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">{announcement}</p>
  </fieldset>;
}
