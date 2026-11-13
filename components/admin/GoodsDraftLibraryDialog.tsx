/* eslint-disable @next/next/no-img-element -- Draft thumbnails use fixed dimensions and verified stored paths. */
'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { findGoodsDraftsAction, getGoodsDraftAction, setGoodsDraftArchivedAction } from '@/app/admin/goods-draft-actions';
import type { GoodsDraft, GoodsDraftPage, GoodsDraftSummary } from '@/lib/admin/goods-drafts';
import { publicMediaUrl } from '@/lib/media';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { Button } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import { GOOD_INPUT_CLASS } from './GoodEditorParts';

const empty: GoodsDraftPage = { rows: [], total: 0, page: 1, pageSize: 20 };
const time = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const LABEL_CLASS = 'text-sm leading-snug font-medium text-foreground';
export function GoodsDraftLibraryDialog({ onClose, onLoad }: { onClose: () => void; onLoad: (draft: GoodsDraft) => boolean | Promise<boolean> }) {
  const [data, setData] = useState(empty);
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const operation = useRef(false);
  const id = useId();
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
    if (await onLoad(result.data)) onClose();
  }
  async function archive(row: GoodsDraftSummary) {
    const result = await setGoodsDraftArchivedAction(row, !row.archived);
    if (!result.data) { setError(result.error ?? '변경하지 못했습니다.'); return; }
    await refresh(data.page); setMessage(row.archived ? '임시저장을 복구했습니다.' : '임시저장을 삭제했습니다. 삭제한 항목에서 복구할 수 있습니다.');
  }
  return <CustomerServiceDialog title="임시저장 불러오기" onClose={onClose} busy={busy} wide>
    <section className="flex min-w-0 flex-col gap-3 text-sm" data-good-drafts="">
      <p className="text-muted-foreground">내 계정으로 저장한 상품 등록 입력을 다른 기기에서도 이어서 작성할 수 있습니다. 최근 임시저장 40건을 보관합니다. 초과 시 가장 오래된 항목은 삭제한 항목으로 이동하며 복구할 수 있습니다. 저장하기가 완료되면 이 목록에서 빠집니다.</p>
      <div className="flex min-w-0 flex-wrap items-end gap-3 rounded-lg border bg-muted/40 p-3">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-2"><label className={LABEL_CLASS} htmlFor={`${id}-query`}>상품명</label><input className={GOOD_INPUT_CLASS} data-slot="input" id={`${id}-query`} maxLength={100} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void run(() => refresh()); } }} /></div>
        <div className="flex min-w-0 flex-col gap-2"><label className={LABEL_CLASS} htmlFor={`${id}-scope`}>표시</label><NativeSelect className="w-full sm:w-40" id={`${id}-scope`} value={archived ? 'archived' : 'active'} disabled={busy} onChange={event => { void run(() => refresh(1, event.target.value === 'archived')); }}><option value="active">저장한 항목</option><option value="archived">삭제한 항목</option></NativeSelect></div>
        <Button type="button" variant="outline" disabled={busy} onClick={() => { void run(() => refresh()); }}>조회</Button>
      </div>
      {error ? <p className="text-destructive" role="alert">{error}</p> : null}<p className="text-muted-foreground" role="status">{busy ? '불러오는 중…' : message}</p>
      <p className="text-muted-foreground tabular-nums">총 {data.total}건 · 저장시각은 KST입니다.</p>
      {!busy && !data.rows.length ? <p className="rounded-lg border border-dashed py-10 text-center text-muted-foreground">저장된 임시저장이 없습니다.</p> : null}
      <ul className="m-0 flex min-w-0 list-none flex-col rounded-lg border p-0 empty:hidden">{data.rows.map(row => <li className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 border-b p-3 last:border-b-0 sm:grid-cols-[4rem_minmax(0,1fr)_auto]" key={row.id}>
        {row.imagePath ? <img className="size-16 rounded-md bg-muted object-contain" src={publicMediaUrl(row.imagePath) ?? ''} alt=""/> : <span className="grid size-16 place-items-center rounded-md bg-muted text-xs text-muted-foreground">사진 없음</span>}
        <div className="flex min-w-0 flex-col gap-1"><strong className="font-medium wrap-anywhere">{row.name}</strong><small className="text-xs text-muted-foreground tabular-nums">{time(row.updatedAt)} · 버전 {row.revision}</small></div>
        <div className="col-span-2 flex justify-end gap-2 sm:col-span-1">{!row.archived ? <Button type="button" size="sm" disabled={busy} onClick={() => { void run(() => load(row)); }}>불러오기</Button> : null}<Button type="button" size="sm" variant={row.archived ? 'outline' : 'destructive'} disabled={busy} onClick={() => { void run(() => archive(row)); }}>{row.archived ? '복구' : '삭제'}</Button></div>
      </li>)}</ul>
      <ConsolePagination label="임시저장 페이지" page={data.page} pageSize={data.pageSize} total={data.total} disabled={busy} onPageChange={page => { void run(() => refresh(page)); }} />
    </section>
  </CustomerServiceDialog>;
}
