/* eslint-disable @next/next/no-img-element -- Draft thumbnails use fixed dimensions and verified stored paths. */
'use client';
import { useEffect, useRef, useState } from 'react';
import { findGoodsDraftsAction, getGoodsDraftAction, setGoodsDraftArchivedAction } from '@/app/admin/goods-draft-actions';
import type { GoodsDraft, GoodsDraftPage, GoodsDraftSummary } from '@/lib/admin/goods-drafts';
import { publicMediaUrl } from '@/lib/media';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';

const empty: GoodsDraftPage = { rows: [], total: 0, page: 1, pageSize: 20 };
const time = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
export function GoodsDraftLibraryDialog({ onClose, onLoad }: { onClose: () => void; onLoad: (draft: GoodsDraft) => boolean }) {
  const [data, setData] = useState(empty);
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const operation = useRef(false);
  useEffect(() => {
    let active = true;
    findGoodsDraftsAction('', false, 1).then(result => {
      if (!active) return;
      if (result.data) setData(result.data); else setError(result.error ?? '목록을 불러오지 못했습니다.');
    }).catch(() => { if (active) setError('목록을 불러오지 못했습니다. 다시 조회해주세요.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  async function refresh(page = 1, nextArchived = archived) {
    const result = await findGoodsDraftsAction(query, nextArchived, page);
    if (!result.data) { setError(result.error ?? '목록을 불러오지 못했습니다.'); return; }
    const last = Math.max(1, Math.ceil(result.data.total / result.data.pageSize));
    if (page > last) return refresh(last, nextArchived);
    setData(result.data); setArchived(nextArchived);
  }
  async function run(task: () => Promise<void>) {
    if (busy || operation.current) return;
    operation.current = true; setBusy(true); setError(''); setMessage('');
    try { await task(); }
    catch { setError('처리 결과를 확인하지 못했습니다. 목록을 다시 조회해주세요.'); }
    finally { operation.current = false; setBusy(false); }
  }
  async function load(row: GoodsDraftSummary) {
    const result = await getGoodsDraftAction(row.id);
    if (!result.data) { setError(result.error ?? '불러오지 못했습니다.'); return; }
    if (onLoad(result.data)) onClose();
  }
  async function archive(row: GoodsDraftSummary) {
    const result = await setGoodsDraftArchivedAction(row, !row.archived);
    if (!result.data) { setError(result.error ?? '변경하지 못했습니다.'); return; }
    await refresh(data.page); setMessage(row.archived ? '임시저장을 복구했습니다.' : '임시저장을 삭제했습니다. 삭제한 항목에서 복구할 수 있습니다.');
  }
  return <CustomerServiceDialog title="임시저장 불러오기" onClose={onClose} busy={busy} wide>
    <section className="admin-goods-drafts">
      <p>내 계정으로 저장한 상품 등록 입력을 다른 기기에서도 이어서 작성할 수 있습니다. 최근 임시저장 40건을 보관합니다. 초과 시 가장 오래된 항목은 삭제한 항목으로 이동하며 복구할 수 있습니다. 저장하기가 완료되면 이 목록에서 빠집니다.</p>
      <div className="admin-goods-drafts__toolbar">
        <label>상품명<input maxLength={100} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void run(() => refresh()); } }} /></label>
        <label>표시<select value={archived ? 'archived' : 'active'} disabled={busy} onChange={event => { void run(() => refresh(1, event.target.value === 'archived')); }}><option value="active">저장한 항목</option><option value="archived">삭제한 항목</option></select></label>
        <button type="button" disabled={busy} onClick={() => { void run(() => refresh()); }}>조회</button>
      </div>
      {error ? <p role="alert">{error}</p> : null}<p role="status">{busy ? '불러오는 중…' : message}</p>
      <p>총 {data.total}건 · 저장시각은 한국시간입니다.</p>
      {!busy && !data.rows.length ? <p className="admin-goods-drafts__empty">저장된 임시저장이 없습니다.</p> : null}
      <ul className="admin-goods-drafts__list">{data.rows.map(row => <li key={row.id}>
        {row.imagePath ? <img src={publicMediaUrl(row.imagePath) ?? ''} alt=""/> : <span className="admin-goods-drafts__image-placeholder">사진 없음</span>}
        <div><strong>{row.name}</strong><small>{time(row.updatedAt)} · 버전 {row.revision}</small></div>
        <div className="admin-goods-drafts__actions">{!row.archived ? <button type="button" disabled={busy} onClick={() => { void run(() => load(row)); }}>불러오기</button> : null}<button type="button" disabled={busy} onClick={() => { void run(() => archive(row)); }}>{row.archived ? '복구' : '삭제'}</button></div>
      </li>)}</ul>
      <nav aria-label="임시저장 페이지" className="admin-goods-drafts__pagination"><button type="button" disabled={busy || data.page <= 1} onClick={() => { void run(() => refresh(data.page - 1)); }}>이전</button><span>{data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}</span><button type="button" disabled={busy || data.page * data.pageSize >= data.total} onClick={() => { void run(() => refresh(data.page + 1)); }}>다음</button></nav>
    </section>
  </CustomerServiceDialog>;
}
