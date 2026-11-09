'use client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { findGoodsPhotosAction, finishGoodsPhotoUploadsAction, saveGoodsPhotoAction } from '@/app/admin/goods-photo-library-actions';
import { ADMIN_ARTWORK_ACCEPT } from '@/lib/admin/artwork';
import { uploadAdminArtwork } from '@/lib/admin/artwork-upload.client';
import { GOODS_PHOTO_UPLOAD_LIMIT, goodsPhotoNameFromFileName, goodsPhotoReferenceLabel, type GoodsPhoto, type GoodsPhotoPage } from '@/lib/admin/goods-photo-library';
import { publicMediaUrl } from '@/lib/media';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { Upload } from 'lucide-react';
import { AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminSelect } from '../console/AdminSelect';
import { CONSOLE_FILTER_CARD_CLASS, CONSOLE_FILTER_FIELDS_CLASS, CONSOLE_FILTER_LABEL_CLASS, ConsoleFilterActions } from '../console/ConsoleFilterPanel';
import { CONSOLE_LIST_EMPTY_CLASS, ConsoleListCard } from '../console/ConsoleListCard';
import { ConsolePagination } from '../console/ConsolePagination';
import { Button, buttonVariants } from '../kit/ui/button';
import { Input } from '../kit/ui/input';

const emptyPage: GoodsPhotoPage = { rows: [], total: 0, page: 1, pageSize: 20 };
export const GOODS_PHOTO_LIBRARY_PURPOSE = '여러 상품에 다시 쓸 사진을 모아 두는 곳입니다. 상품 편집기의 상품 이미지 타일에 올린 사진도 여기에 자동으로 등록됩니다.';

/** 방금 올린 사진을 목록 맨 앞에 둔다. 같은 순간 다른 운영자가 올린 사진이 더 최신이어도 내 업로드가 먼저 보인다. */
export function pinRecentGoodsPhotos(rows: GoodsPhoto[], recent: readonly string[]): GoodsPhoto[] {
  if (!recent.length) return rows;
  const pinned = new Set(recent);
  return [...rows.filter(row => pinned.has(row.id)), ...rows.filter(row => !pinned.has(row.id))];
}

/** One shared browser powers the standalone library and the goods image picker. */
export function GoodsPhotoLibraryScreen({ initial = emptyPage, onSelect }: { initial?: GoodsPhotoPage; onSelect?: (photo: GoodsPhoto) => void }) {
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<GoodsPhoto | null>(null);
  const [name, setName] = useState('');
  const [uploadFailures, setUploadFailures] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const operation = useRef(false);

  async function refresh(page = 1, nextArchived = archived, nextQuery = query) {
    const result = await findGoodsPhotosAction(nextQuery, nextArchived, page);
    if ('error' in result) { setError(result.error); return false; }
    setData(result.data); setArchived(nextArchived); return true;
  }
  async function search(page = 1, nextArchived = archived, nextQuery = query) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(''); setMessage(''); setRecent([]);
    try { await refresh(page, nextArchived, nextQuery); }
    catch { setError('사진 목록을 불러오지 못했습니다. 다시 조회해주세요.'); }
    finally { operation.current = false; setBusy(false); }
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = '';
    if (!files.length || operation.current) return;
    if (files.length > GOODS_PHOTO_UPLOAD_LIMIT) { setError(`한 번에 ${GOODS_PHOTO_UPLOAD_LIMIT}장까지 선택해주세요.`); return; }
    operation.current = true; setBusy(true); setError(''); setMessage(''); setUploadFailures([]);
    const failures: string[] = []; const savedIds: string[] = [];
    try {
      for (const file of files) {
        setMessage(`${files.length}장 중 ${savedIds.length + failures.length + 1}번째 사진을 확인하고 있습니다.`);
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
      setMessage(`${saved}장 저장${readBack ? ' 후 목록을 다시 확인했습니다.' : ' 요청을 완료했습니다. 목록을 다시 조회해주세요.'}`);
    } catch { setError('업로드 중 연결이 끊겼습니다. 목록에서 저장 여부를 확인한 뒤 실패한 파일만 다시 선택해주세요.'); }
    finally { setUploadFailures(failures); operation.current = false; setBusy(false); }
  }
  async function save(photo: GoodsPhoto, nextName: string, nextArchived: boolean) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const result = await saveGoodsPhotoAction({ ...photo, name: nextName, archived: nextArchived });
      if ('error' in result) { setError(result.error); return; }
      setEdit(null);
      const loaded = await refresh(data.page);
      setMessage(loaded ? '변경을 저장하고 목록을 다시 확인했습니다.' : '저장 후 목록을 다시 조회해주세요.');
    } catch { setError('저장 여부를 확인하지 못했습니다. 목록을 다시 조회해주세요.'); }
    finally { operation.current = false; setBusy(false); }
  }
  return <section className="flex min-w-0 flex-col gap-4" aria-label={onSelect ? '상품 사진 선택' : '사진 보관함'} data-admin-screen="photo-library">
    {/* 머리(설명·업로드) → 안내 → 조회 카드([초기화][검색]) → 목록 카드(사진·페이지 이동). 상품 사진 선택 팝업은 머리·업로드 없이 쓴다. */}
    {!onSelect ? <AdminPageHeader title="사진 보관함" description={`${GOODS_PHOTO_LIBRARY_PURPOSE} 스태프와 관리자가 함께 씁니다.`}
      actions={<label className={`${buttonVariants()} relative cursor-pointer focus-within:ring-3 focus-within:ring-ring/50 has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-50`} data-slot="button"><Upload aria-hidden="true" />사진 업로드<input className="absolute inset-0 size-full cursor-pointer opacity-0" aria-label="사진 업로드" type="file" accept={ADMIN_ARTWORK_ACCEPT} multiple disabled={busy} onChange={upload} /></label>} /> : null}
    <div className={CONSOLE_FILTER_CARD_CLASS}>
      <div className={CONSOLE_FILTER_FIELDS_CLASS}>
        <label className={`${CONSOLE_FILTER_LABEL_CLASS} w-full sm:w-64`}>사진 이름<Input aria-label="사진 이름 검색" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if(event.key==='Enter') { event.preventDefault(); void search(); } }} /></label>
        {!onSelect ? <label className={CONSOLE_FILTER_LABEL_CLASS}>표시<AdminSelect aria-label="사진 표시 상태" value={archived ? 'archived' : 'active'} disabled={busy} onChange={event => { void search(1,event.target.value==='archived'); }} wrapperClassName="w-44"><option value="active">사용 가능한 사진</option><option value="archived">보관한 사진</option></AdminSelect></label> : null}
      </div>
      <ConsoleFilterActions start={<p className="text-xs text-muted-foreground">보관해도 파일은 유지됩니다.{!onSelect ? ` 연결된 사진은 연결을 해제해야 보관할 수 있습니다. 업로드는 한 번에 ${GOODS_PHOTO_UPLOAD_LIMIT}장, 장당 5MB 이하 JPEG·PNG·WebP.` : ''}</p>}>
        <Button variant="ghost" type="button" disabled={busy} onClick={() => { setQuery(''); void search(1, false, ''); }}>초기화</Button>
        <Button type="button" disabled={busy} onClick={() => { void search(); }} variant="soft">검색</Button>
      </ConsoleFilterActions>
    </div>
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    <p className="text-sm empty:sr-only" aria-live="polite" role="status">{busy ? message || '불러오는 중…' : message}</p>
    {uploadFailures.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-destructive" role="alert">{uploadFailures.map((failure,index) => <li key={index}>{failure}</li>)}</ul> : null}
    <ConsoleListCard headingLevel={3} title="목록" total={data.total} unit="장">
    {/* 사진마다 이름 한 줄 · 연결 한 줄 · 버튼 한 줄로 줄여 첫 화면에 사진이 더 들어오게 한다. 같은 안내를 사진마다 반복하지 않고 조회 카드에 한 번만 둔다. */}
    <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-3">{pinRecentGoodsPhotos(data.rows, recent).map(photo => <li className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-2.5 text-card-foreground" key={photo.id}>
      {/* 원본 이미지라 화면에 들어올 때만 내려받고, 디코딩은 메인 스레드를 막지 않게 한다.
          크기는 CSS(w-full·aspect-square)가 정한다 — height 속성은 정사각 비율보다 먼저 높이를 고정한다. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="aspect-square w-full rounded-md bg-muted object-contain" alt={photo.name} src={publicMediaUrl(photo.imagePath) ?? ''} loading="lazy" decoding="async" />
      <span className="flex min-w-0 items-center gap-1.5"><strong className="min-w-0 truncate text-sm font-medium" title={`${photo.name} · 버전 ${photo.revision}`}>{photo.name}</strong>{photo.archived ? <AdminStatusBadge className="shrink-0" tone={statusTone('publication', 'archived')}>보관</AdminStatusBadge> : null}</span>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">{recent.includes(photo.id) ? <span className="font-medium text-foreground">방금 올림</span> : null}{photo.references.length ? <details className="min-w-0 wrap-anywhere"><summary className="cursor-pointer underline-offset-4 hover:text-foreground hover:underline">연결 {photo.references.length}건 · 사용처 보기</summary><ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-foreground">{photo.references.map(ref => <li key={`${ref.kind}:${ref.id}`}>{goodsPhotoReferenceLabel(ref.kind)} · {ref.kind==='good' ? <Link className="underline underline-offset-4" href={`/admin/catalog/goods?goodId=${encodeURIComponent(ref.id)}`}>{ref.name}</Link> : ref.name}</li>)}</ul></details> : '연결 없음'}</div>
      <div className="mt-auto flex flex-wrap gap-1.5">{onSelect ? <Button size="sm" type="button" disabled={busy || photo.archived} onClick={() => onSelect(photo)} variant="soft">이 사진 선택</Button> : <>
        <Button size="xs" variant="outline" type="button" disabled={busy} onClick={() => { setEdit(photo); setName(photo.name); setError(''); }}>이름 수정</Button>
        <span className="inline-flex" title={!photo.archived && photo.references.length ? '연결을 해제해야 보관할 수 있습니다.' : undefined}><Button size="xs" variant="outline" type="button" disabled={busy || (!photo.archived && photo.references.length>0)} onClick={() => { void save(photo,photo.name,!photo.archived); }}>{photo.archived ? '복구' : '보관'}</Button></span>
      </>}</div>
    </li>)}</ul>
    {!data.rows.length ? <p className={CONSOLE_LIST_EMPTY_CLASS}>조건에 맞는 사진이 없습니다.</p> : null}
    <ConsolePagination label="사진 목록 페이지" page={data.page} pageSize={20} total={data.total} unit="장" disabled={busy} onPageChange={page => { void search(page); }} />
    </ConsoleListCard>
    {edit ? <CustomerServiceDialog title="사진 이름 수정" busy={busy} onClose={() => setEdit(null)}><div className="flex flex-col gap-4"><label className="flex flex-col gap-2 text-sm font-medium">사진 이름<Input autoFocus aria-label="새 사진 이름" maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>{error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}<Button className="self-end" type="button" disabled={busy || !name.trim()} onClick={() => { void save(edit,name,edit.archived); }}>이름 저장</Button></div></CustomerServiceDialog> : null}
  </section>;
}

export function GoodsPhotoPicker({ onClose, onSelect }: { onClose: () => void; onSelect: (photo: GoodsPhoto) => void }) {
  const [data, setData] = useState<GoodsPhotoPage | null>(null);
  const [error,setError] = useState('');
  const loading = useRef(false);
  useEffect(() => {
    let active = true;
    void findGoodsPhotosAction('',false,1).then(result => {
      if (!active) return;
      if ('error' in result) setError(result.error); else setData(result.data);
    }).catch(() => { if (active) setError('사진을 불러오지 못했습니다. 다시 시도해주세요.'); });
    return () => { active = false; };
  }, []);
  async function load() {
    if (loading.current) return;
    loading.current=true;
    try { const result=await findGoodsPhotosAction('',false,1); if('error' in result) setError(result.error); else setData(result.data); }
    catch { setError('사진을 불러오지 못했습니다. 다시 시도해주세요.'); }
    finally { loading.current=false; }
  }
  return <CustomerServiceDialog title="사진 보관함에서 선택" onClose={onClose} wide>{data ? <GoodsPhotoLibraryScreen initial={data} onSelect={onSelect} /> : <div className="flex flex-col items-start gap-3"><p className={`text-sm${error ? ' text-destructive' : ' text-muted-foreground'}`} role="status">{error || '사진을 불러오는 중…'}</p>{error ? <Button variant="outline" type="button" onClick={() => { void load(); }}>다시 불러오기</Button> : null}</div>}</CustomerServiceDialog>;
}
