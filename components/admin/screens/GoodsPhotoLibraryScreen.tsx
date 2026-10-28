'use client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { findGoodsPhotosAction, saveGoodsPhotoAction } from '@/app/admin/goods-photo-library-actions';
import { ADMIN_ARTWORK_ACCEPT, ADMIN_ARTWORK_ERROR } from '@/lib/admin/artwork';
import { uploadAdminArtwork } from '@/lib/admin/artwork-upload.client';
import { GOODS_PHOTO_UPLOAD_LIMIT, goodsPhotoReferenceLabel, type GoodsPhoto, type GoodsPhotoPage } from '@/lib/admin/goods-photo-library';
import { publicMediaUrl } from '@/lib/media';
import { CustomerServiceDialog } from './CustomerServiceDialog';

const emptyPage: GoodsPhotoPage = { rows: [], total: 0, page: 1, pageSize: 20 };
export const GOODS_PHOTO_LIBRARY_PURPOSE = '여러 상품에 다시 쓸 사진을 모아 두는 곳입니다. 상품 편집기에서 직접 올린 사진은 여기에 자동으로 등록되지 않습니다.';

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
  async function search(page = 1, nextArchived = archived) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(''); setMessage(''); setRecent([]);
    try { await refresh(page, nextArchived); }
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
        const result = await saveGoodsPhotoAction({ id: crypto.randomUUID(), name: file.name.slice(0,100), imagePath: uploaded.imagePath, revision: 0, archived: false });
        if ('error' in result) failures.push(`${file.name}: ${result.error}`); else savedIds.push(result.id);
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
  return <section className="admin-photo-library" aria-label={onSelect ? '상품 사진 선택' : '사진 보관함'}>
    {!onSelect ? <header><h2>사진 보관함</h2><p>{GOODS_PHOTO_LIBRARY_PURPOSE}</p><p>스태프와 관리자가 함께 씁니다.</p></header> : null}
    <p>보관해도 파일은 유지됩니다. 사용 중인 사진은 먼저 연결을 해제해주세요.</p>
    <div className="admin-photo-library__toolbar">
      <label>사진 이름<input aria-label="사진 이름 검색" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if(event.key==='Enter') { event.preventDefault(); void search(); } }} /></label>
      {!onSelect ? <label>표시<select aria-label="사진 표시 상태" value={archived ? 'archived' : 'active'} disabled={busy} onChange={event => { void search(1,event.target.value==='archived'); }}><option value="active">사용 가능한 사진</option><option value="archived">보관한 사진</option></select></label> : null}
      <button type="button" disabled={busy} onClick={() => { void search(); }}>조회</button>
      {!onSelect ? <label className="admin-photo-library__upload">사진 업로드<input aria-label="사진 업로드" type="file" accept={ADMIN_ARTWORK_ACCEPT} multiple disabled={busy} onChange={upload} /></label> : null}
    </div>
    {!onSelect ? <p>한 번에 최대 {GOODS_PHOTO_UPLOAD_LIMIT}장. {ADMIN_ARTWORK_ERROR}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <p aria-live="polite" role="status">{busy ? message || '불러오는 중…' : message}</p>
    {uploadFailures.length ? <ul role="alert">{uploadFailures.map((failure,index) => <li key={index}>{failure}</li>)}</ul> : null}
    <p>총 {data.total}장</p>
    <ul className="admin-photo-library__grid">{pinRecentGoodsPhotos(data.rows, recent).map(photo => <li key={photo.id}>
      {/* 원본 이미지라 화면에 들어올 때만 내려받고, 디코딩은 메인 스레드를 막지 않게 한다.
          크기는 CSS(width:100%·aspect-ratio:1)가 정한다 — height 속성은 정사각 비율보다 먼저 높이를 고정한다. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={photo.name} src={publicMediaUrl(photo.imagePath) ?? ''} loading="lazy" decoding="async" />
      <strong>{photo.name}</strong><span>{recent.includes(photo.id) ? '방금 올림 · ' : ''}버전 {photo.revision} · 연결 {photo.references.length}건</span>
      {photo.references.length ? <details><summary>사용처 확인</summary><ul>{photo.references.map(ref => <li key={`${ref.kind}:${ref.id}`}>{goodsPhotoReferenceLabel(ref.kind)} · {ref.kind==='good' ? <Link href={`/admin/catalog/goods?goodId=${encodeURIComponent(ref.id)}`}>{ref.name}</Link> : ref.name}</li>)}</ul></details> : null}
      <div className="admin-photo-library__actions">{onSelect ? <button type="button" disabled={busy || photo.archived} onClick={() => onSelect(photo)}>이 사진 선택</button> : <>
        <button type="button" disabled={busy} onClick={() => { setEdit(photo); setName(photo.name); setError(''); }}>이름 수정</button>
        <button type="button" disabled={busy || (!photo.archived && photo.references.length>0)} onClick={() => { void save(photo,photo.name,!photo.archived); }}>{photo.archived ? '복구' : '보관'}</button>
      </>}</div>
    </li>)}</ul>
    {!data.rows.length ? <p>조건에 맞는 사진이 없습니다.</p> : null}
    <nav aria-label="사진 목록 페이지"><button type="button" disabled={busy || data.page===1} onClick={() => { void search(data.page-1); }}>이전</button><span>{data.page} / {Math.max(1,Math.ceil(data.total/20))}</span><button type="button" disabled={busy || data.page*20>=data.total} onClick={() => { void search(data.page+1); }}>다음</button></nav>
    {edit ? <CustomerServiceDialog title="사진 이름 수정" busy={busy} onClose={() => setEdit(null)}><label>사진 이름<input autoFocus aria-label="새 사진 이름" maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>{error ? <p role="alert">{error}</p> : null}<button type="button" disabled={busy || !name.trim()} onClick={() => { void save(edit,name,edit.archived); }}>이름 저장</button></CustomerServiceDialog> : null}
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
  return <CustomerServiceDialog title="사진 보관함에서 선택" onClose={onClose} wide>{data ? <GoodsPhotoLibraryScreen initial={data} onSelect={onSelect} /> : <><p role="status">{error || '사진을 불러오는 중…'}</p>{error ? <button type="button" onClick={() => { void load(); }}>다시 불러오기</button> : null}</>}</CustomerServiceDialog>;
}
