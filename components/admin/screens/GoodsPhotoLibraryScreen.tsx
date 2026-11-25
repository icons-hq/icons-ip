'use client';
import { useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { findGoodsPhotosAction, finishGoodsPhotoUploadsAction, saveGoodsPhotoAction } from '@/app/admin/goods-photo-library-actions';
import { ADMIN_ARTWORK_ACCEPT, GOODS_ARTWORK_MAX_BYTES } from '@/lib/admin/artwork';
import { uploadAdminArtwork } from '@/lib/admin/artwork-upload.client';
import { GOODS_PHOTO_UPLOAD_LIMIT, goodsPhotoNameFromFileName, goodsPhotoReferenceLabel, type GoodsPhoto, type GoodsPhotoPage } from '@/lib/admin/goods-photo-library';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import { normalizePublicMediaPath, publicMediaUrl } from '@/lib/media';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { Upload } from 'lucide-react';
import { AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { AdminPickerDialog } from '../console/AdminPickerDialog';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminSelect } from '../console/AdminSelect';
import { CONSOLE_FILTER_CARD_CLASS, CONSOLE_FILTER_FIELDS_CLASS, CONSOLE_FILTER_LABEL_CLASS, ConsoleFilterActions } from '../console/ConsoleFilterPanel';
import { CONSOLE_LIST_EMPTY_CLASS, ConsoleListCard } from '../console/ConsoleListCard';
import { ConsolePagination } from '../console/ConsolePagination';
import { Button, buttonVariants } from '../kit/ui/button';
import { Input } from '../kit/ui/input';

const emptyPage: GoodsPhotoPage = { rows: [], total: 0, page: 1, pageSize: 20 };
export const GOODS_PHOTO_LIBRARY_PURPOSE = '여러 상품에 다시 쓸 사진을 모아 두는 곳입니다. 상품 등록 화면의 상품 이미지 칸에 올린 사진도 여기에 들어옵니다.';
/** [사진 업로드] 옆 한 줄. 사진 보관함은 상품 이미지와 같은 한도(lib/admin/artwork의 GOODS_ARTWORK_MAX_BYTES)로 받는다. */
export const GOODS_PHOTO_UPLOAD_GUIDE = `한 번에 ${GOODS_PHOTO_UPLOAD_LIMIT}장 · 장당 ${GOODS_ARTWORK_MAX_BYTES / (1024 * 1024)}MB 이하 JPEG·PNG·WebP`;
const UPLOAD_GUIDE_ID = 'goods-photo-upload-guide';
const RELOAD_HINT = '목록은 [검색]을 눌러 다시 불러와 주세요.';

/** 방금 올린 사진을 목록 맨 앞에 둔다. 같은 순간 다른 운영자가 올린 사진이 더 최신이어도 내 업로드가 먼저 보인다. */
export function pinRecentGoodsPhotos(rows: GoodsPhoto[], recent: readonly string[]): GoodsPhoto[] {
  if (!recent.length) return rows;
  const pinned = new Set(recent);
  return [...rows.filter(row => pinned.has(row.id)), ...rows.filter(row => !pinned.has(row.id))];
}

/** 사진 보관함 관리 화면. 사진을 골라 넣는 창은 아래 GoodsPhotoPicker(공용 선택창)다. */
export function GoodsPhotoLibraryScreen({ initial = emptyPage }: { initial?: GoodsPhotoPage }) {
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState('');
  /* 지금 목록에 적용된 검색어. 페이지 이동·보관 상태 바꾸기·저장 뒤 다시 읽기는 칸에 적다 만 글자가 아니라 이 값으로 한다. */
  const [applied, setApplied] = useState('');
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<GoodsPhoto | null>(null);
  const [name, setName] = useState('');
  const [uploadFailures, setUploadFailures] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const operation = useRef(false);

  async function refresh(page: number, nextArchived: boolean, nextQuery: string) {
    const result = await findGoodsPhotosAction(nextQuery, nextArchived, page);
    if ('error' in result) { setError(result.error); return false; }
    setData(result.data); setArchived(nextArchived); setApplied(nextQuery); return true;
  }
  /** 목록을 다시 읽는다. 검색어를 주지 않으면 적용된 검색어를 그대로 쓴다 — 새 검색어는 [검색]·Enter만 넘긴다. */
  async function search(page = 1, nextArchived = archived, nextQuery = applied) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(''); setMessage(''); setRecent([]);
    try { await refresh(page, nextArchived, nextQuery); }
    catch { setError('사진 목록을 불러오지 못했습니다. [검색]을 다시 눌러 주세요.'); }
    finally { operation.current = false; setBusy(false); }
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = '';
    if (!files.length || operation.current) return;
    if (files.length > GOODS_PHOTO_UPLOAD_LIMIT) { setError(`한 번에 ${GOODS_PHOTO_UPLOAD_LIMIT}장까지 올릴 수 있습니다. 나눠서 올려 주세요.`); return; }
    operation.current = true; setBusy(true); setError(''); setMessage(''); setUploadFailures([]);
    const failures: string[] = []; const savedIds: string[] = [];
    try {
      for (const file of files) {
        setMessage(`${files.length}장 중 ${savedIds.length + failures.length + 1}번째 사진을 올리고 있습니다.`);
        const uploaded = await uploadAdminArtwork({ kind: 'good', file });
        if (!uploaded.ok) { failures.push(`${file.name}: ${uploaded.error}`); continue; }
        // R20: macOS 파일 이름(NFD 한글)을 NFC로 저장해 이름 검색에 걸리게 한다. R19: 저장마다 화면을 다시 그리지 않는다.
        const result = await saveGoodsPhotoAction({ id: crypto.randomUUID(), name: goodsPhotoNameFromFileName(file.name), imagePath: uploaded.imagePath, revision: 0, archived: false }, { revalidate: false });
        if ('error' in result) failures.push(`${file.name}: ${result.error}`); else savedIds.push(result.id);
      }
      if (savedIds.length) {
        try { await finishGoodsPhotoUploadsAction(); }
        catch { /* 화면 캐시 갱신은 부가 단계다. 목록은 아래에서 다시 읽는다. */ }
      }
      /* 검색어가 남아 있으면 새 사진(파일 이름)이 걸러져 사라진 것처럼 보인다. 검색어를 비우고 전체 목록 첫 페이지를 읽는다. */
      const saved = savedIds.length;
      setQuery(''); setRecent(savedIds);
      const readBack = await refresh(1, false, '');
      /* 한 장도 올리지 못했으면 성공 문구를 내지 않는다. 이유는 아래 실패 목록에 파일마다 있다. */
      setMessage(!saved ? '' : readBack ? `${saved}장을 올렸습니다.` : `${saved}장을 올렸습니다. ${RELOAD_HINT}`);
    } catch { setError('올리는 중에 연결이 끊겼습니다. 목록에 올라온 사진을 본 뒤, 빠진 파일만 다시 올려 주세요.'); }
    finally { setUploadFailures(failures); operation.current = false; setBusy(false); }
  }
  async function save(photo: GoodsPhoto, nextName: string, nextArchived: boolean) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const result = await saveGoodsPhotoAction({ ...photo, name: nextName, archived: nextArchived });
      if ('error' in result) { setError(result.error); return; }
      setEdit(null);
      /* 보관·복원한 사진은 지금 보는 목록에서 사라진다. 어디로 갔는지 한 줄로 알린다. */
      const done = nextArchived === photo.archived ? '이름을 바꿨습니다.'
        : nextArchived ? "보관했습니다. 보관 상태에서 '보관됨'을 고르면 다시 볼 수 있습니다."
        : "복원했습니다. 보관 상태 '사용 중' 목록에서 볼 수 있습니다.";
      const loaded = await refresh(data.page, archived, applied);
      setMessage(loaded ? done : `${done} ${RELOAD_HINT}`);
    } catch { setError(`저장됐는지 확인하지 못했습니다. ${RELOAD_HINT}`); }
    finally { operation.current = false; setBusy(false); }
  }
  return <section className="flex min-w-0 flex-col gap-4" aria-label="사진 보관함" data-admin-screen="photo-library">
    {/* 머리(설명·업로드 규격·업로드) → 조회 카드([초기화][검색]) → 목록 카드(사진·페이지 이동). */}
    <AdminPageHeader title="사진 보관함" description={`${GOODS_PHOTO_LIBRARY_PURPOSE} 운영자가 함께 씁니다.`}
      actions={<>
        <span className="text-xs text-muted-foreground" id={UPLOAD_GUIDE_ID}>{GOODS_PHOTO_UPLOAD_GUIDE}</span>
        <label className={`${buttonVariants()} relative cursor-pointer focus-within:ring-3 focus-within:ring-ring/50 has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-50`} data-slot="button"><Upload aria-hidden="true" />사진 업로드<input className="absolute inset-0 size-full cursor-pointer opacity-0" aria-describedby={UPLOAD_GUIDE_ID} aria-label="사진 업로드" type="file" accept={ADMIN_ARTWORK_ACCEPT} multiple disabled={busy} onChange={upload} /></label>
      </>} />
    <div className={CONSOLE_FILTER_CARD_CLASS}>
      <div className={CONSOLE_FILTER_FIELDS_CLASS}>
        <label className={`${CONSOLE_FILTER_LABEL_CLASS} w-full sm:w-64`}>사진 이름<Input aria-label="사진 이름 검색" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if(event.key==='Enter') { event.preventDefault(); void search(1, archived, query); } }} /></label>
        <label className={CONSOLE_FILTER_LABEL_CLASS}>보관 상태<AdminSelect aria-label="보관 상태" value={archived ? 'archived' : 'active'} disabled={busy} onChange={event => { void search(1,event.target.value==='archived'); }} wrapperClassName="w-40"><option value="active">사용 중</option><option value="archived">보관됨</option></AdminSelect></label>
      </div>
      <ConsoleFilterActions>
        <Button variant="ghost" type="button" disabled={busy} onClick={() => { setQuery(''); void search(1, false, ''); }}>초기화</Button>
        <Button type="button" disabled={busy} onClick={() => { void search(1, archived, query); }} variant="soft">검색</Button>
      </ConsoleFilterActions>
    </div>
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    <p className="text-sm empty:sr-only" aria-live="polite" role="status">{busy ? message || '불러오는 중…' : message}</p>
    {uploadFailures.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-destructive" role="alert">{uploadFailures.map((failure,index) => <li key={index}>{failure}</li>)}</ul> : null}
    <ConsoleListCard headingLevel={3} title="목록" total={data.total} unit="장">
    {/* 사진마다 이름 한 줄 · 연결 한 줄 · 버튼 한 줄이다. 쓰는 중인 사진은 [보관] 자리에 보관할 수 없는 이유를 글로 보인다(잠긴 버튼에 마우스를 올려야 보이던 안내). */}
    <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-3">{pinRecentGoodsPhotos(data.rows, recent).map(photo => <li className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-2.5 text-card-foreground" key={photo.id}>
      {/* 원본 이미지라 화면에 들어올 때만 내려받고, 디코딩은 메인 스레드를 막지 않게 한다.
          크기는 CSS(w-full·aspect-square)가 정한다 — height 속성은 정사각 비율보다 먼저 높이를 고정한다. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="aspect-square w-full rounded-md bg-muted object-contain" alt={photo.name} src={publicMediaUrl(photo.imagePath) ?? ''} loading="lazy" decoding="async" />
      <span className="flex min-w-0 items-center gap-1.5"><strong className="min-w-0 truncate text-sm font-medium" title={photo.name}>{photo.name}</strong>{photo.archived ? <AdminStatusBadge className="shrink-0" tone={statusTone('publication', 'archived')}>보관됨</AdminStatusBadge> : null}</span>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">{recent.includes(photo.id) ? <span className="font-medium text-foreground">방금 올림</span> : null}{photo.references.length ? <details className="min-w-0 wrap-anywhere"><summary className="cursor-pointer underline-offset-4 hover:text-foreground hover:underline"><AdminStatusBadge tone="success">연결 {photo.references.length}건</AdminStatusBadge> 사용처 보기</summary><ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-foreground">{photo.references.map(ref => <li key={`${ref.kind}:${ref.id}`}>{goodsPhotoReferenceLabel(ref.kind)} · {ref.kind==='good' ? <Link className="underline underline-offset-4" href={`/admin/catalog/goods?goodId=${encodeURIComponent(ref.id)}`}>{ref.name}</Link> : ref.name}</li>)}</ul></details> : <AdminStatusBadge tone="neutral">연결 없음</AdminStatusBadge>}</div>
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <Button size="xs" variant="outline" type="button" disabled={busy} onClick={() => { setEdit(photo); setName(photo.name); setError(''); }}>이름 수정</Button>
        {photo.archived ? <Button size="xs" variant="outline" type="button" disabled={busy} onClick={() => { void save(photo, photo.name, false); }}>복원</Button>
          : photo.references.length ? <span className="text-xs text-muted-foreground" data-photo-in-use="">쓰는 중이라 보관할 수 없음</span>
          : <Button size="xs" variant="outline" type="button" disabled={busy} onClick={() => { void save(photo, photo.name, true); }}>보관</Button>}
      </div>
    </li>)}</ul>
    {!data.rows.length ? <p className={CONSOLE_LIST_EMPTY_CLASS}>{applied ? '조건에 맞는 사진이 없습니다.' : archived ? '보관한 사진이 없습니다.' : '올린 사진이 없습니다.'}</p> : null}
    <ConsolePagination label="사진 목록 페이지" page={data.page} pageSize={20} total={data.total} unit="장" disabled={busy} onPageChange={page => { void search(page); }} />
    </ConsoleListCard>
    {edit ? <CustomerServiceDialog title="사진 이름 수정" busy={busy} onClose={() => setEdit(null)}><div className="flex flex-col gap-4"><label className="flex flex-col gap-2 text-sm font-medium">사진 이름<Input autoFocus aria-label="새 사진 이름" maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>{error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}<Button className="self-end" type="button" disabled={busy || !name.trim()} onClick={() => { void save(edit,name,edit.archived); }}>이름 저장</Button></div></CustomerServiceDialog> : null}
  </section>;
}

/** 사진 선택창의 조회. 보관한 사진은 고를 수 없어 읽지 않는다(20장씩, 총 장수 포함). */
export const loadGoodsPhotoPickerPage: AdminPickerLoader<GoodsPhoto> = async ({ query, page }) => {
  const result = await findGoodsPhotosAction(query, false, page);
  return 'error' in result ? result : result.data;
};

/**
 * 사진 보관함에서 사진을 골라 넣는 창(공용 선택창의 격자 배치).
 * 기본은 한 장을 고르면 닫힌다. `multiple`이면 [완료]를 누를 때까지 열려 있어 여러 장을 이어서 고른다.
 * 여러 장 고르기에서는 고른 사진이 어느 자리에 들어갔는지 보이고(`placeOf`), 창에서 방금 넣은 사진은 창 안에서 다시 뺀다(`onDeselect`).
 */
export function GoodsPhotoPicker({ onClose, onSelect, multiple = false, pickedPaths, remaining, nextIsMain = false, placeOf, onDeselect, deselectBlocked }: {
  onClose: () => void;
  onSelect: (photo: GoodsPhoto) => void;
  /** 여러 장 고르기. 고른 사진은 그때마다 `onSelect`로 넘기고 창은 [완료]로 닫는다. */
  multiple?: boolean;
  /** 이미 넣은 사진의 경로. 그 사진은 '선택됨'으로 보이고 다시 고를 수 없다. */
  pickedPaths?: readonly string[];
  /** 더 넣을 수 있는 장수. 창에 남은 자리를 보이고, 0이 되면 나머지 사진의 [선택]을 잠근다. */
  remaining?: number;
  /** 대표 이미지 칸이 비어 있어 다음에 고르는 사진이 대표 이미지가 되는가. 그렇다고 창에서 미리 알린다. */
  nextIsMain?: boolean;
  /** 넣은 사진이 들어간 자리의 이름(예: '대표 이미지', '추가 이미지 2'). 주면 '선택됨' 대신 그 이름을 보인다. */
  placeOf?: (photo: GoodsPhoto) => string | null;
  /** 넣은 사진을 창에서 다시 뺀다. 주면 뺄 수 있는 사진에 [빼기]가 보인다. */
  onDeselect?: (photo: GoodsPhoto) => void;
  /** 이 사진을 창에서 뺄 수 없으면 그 까닭(까닭 없이 [빼기]만 숨기려면 빈 글자). 뺄 수 있으면 null. */
  deselectBlocked?: (photo: GoodsPhoto) => string | null;
}) {
  /* 사진마다 경로가 하나라(DB unique) 경로를 줄의 키로 쓴다. 상품 폼의 경로와 앞머리 표기가 달라도 같은 사진으로 본다. */
  const picked = (pickedPaths ?? []).map(normalizePublicMediaPath);
  const full = remaining !== undefined && remaining <= 0;
  return <AdminPickerDialog<GoodsPhoto>
    title="사진 보관함에서 고르기"
    description={remaining === undefined ? undefined : full ? '자리가 다 찼습니다. [완료]를 눌러 닫아 주세요.'
      : `빈 칸에 앞에서부터 들어갑니다. 남은 자리 ${remaining}장.${nextIsMain ? ' 다음에 고르는 사진이 대표 이미지가 됩니다.' : ''}`}
    deselectBlocked={deselectBlocked}
    emptyText="고를 수 있는 사진이 없습니다."
    excludedNote="보관한 사진은 목록에서 뺐습니다."
    layout="grid"
    load={loadGoodsPhotoPickerPage}
    multiple={multiple}
    onClose={onClose}
    onDeselect={onDeselect}
    onSelect={onSelect}
    rowBlocked={full ? photo => picked.includes(normalizePublicMediaPath(photo.imagePath)) ? null : '자리 없음' : undefined}
    rowKey={photo => normalizePublicMediaPath(photo.imagePath)}
    rowView={photo => ({ title: photo.name, meta: photo.references.length ? `연결 ${photo.references.length}건` : undefined, imageUrl: publicMediaUrl(photo.imagePath) })}
    searchPlaceholder="사진 이름"
    selectedKeys={picked}
    selectedLabel={placeOf}
    unit="장"
  />;
}
