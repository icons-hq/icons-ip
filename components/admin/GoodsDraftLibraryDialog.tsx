'use client';
import { useEffect, useRef, useState } from 'react';
import { findGoodsDraftsAction, getGoodsDraftAction, setGoodsDraftArchivedAction } from '@/app/admin/goods-draft-actions';
import { AdminPickerDialog, type AdminPickerRowView } from '@/components/admin/console/AdminPickerDialog';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { adminConfirm } from '@/lib/admin/confirm';
import { GOODS_DRAFT_LIMIT, type GoodsDraft, type GoodsDraftSummary } from '@/lib/admin/goods-drafts';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import { publicMediaUrl } from '@/lib/media';

const LIST_FAILED = '목록을 불러오지 못했습니다. 잠시 뒤 다시 검색해주세요.';
/** 첫 항목이 처음 보는 목록이다(공용 선택창의 규칙). */
const VIEWS = [{ value: '', label: '저장한 항목' }, { value: 'archived', label: '삭제한 항목' }] as const;
const time = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

/** 지금 쓰는 조회 액션 그대로. 끝 쪽을 넘어선 쪽을 달라고 하면(다른 창에서 항목이 줄었을 때) 마지막 쪽으로 돌린다. */
const loadGoodsDrafts: AdminPickerLoader<GoodsDraftSummary> = async (request) => {
  const result = await findGoodsDraftsAction(request.query, request.filter === 'archived', request.page);
  if (!result.data) return { error: result.error ?? LIST_FAILED };
  const last = Math.max(1, Math.ceil(result.data.total / result.data.pageSize));
  return request.page > last ? loadGoodsDrafts({ ...request, page: last }) : result.data;
};

/**
 * 상품 등록 화면에서 임시저장을 골라 불러오는 창(공용 선택창, docs/admin-screen-rules.md 규칙 1).
 * 줄마다 [불러오기]와 [삭제](삭제한 항목에서는 [복원])를 둔다. 삭제는 묻고, 지운 줄은 목록에서 바로 빼지 않고 그 자리에서 [복원]으로 바꿔
 * 되돌릴 수 있게 한다 — 다음 검색이나 쪽 이동 때 목록이 새로 읽힌다.
 */
export function GoodsDraftLibraryDialog({ onClose, onLoad }: { onClose: () => void; onLoad: (draft: GoodsDraft) => boolean | Promise<boolean> }) {
  const [changed, setChanged] = useState<Readonly<Record<string, GoodsDraftSummary>>>({});
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const lock = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  /* 목록을 새로 읽으면 그 목록이 지금의 사실이다. 그 자리에서 바꾼 표시는 지운다. */
  const load: AdminPickerLoader<GoodsDraftSummary> = async (request) => {
    const result = await loadGoodsDrafts(request);
    if (!('error' in result) && alive.current) setChanged((current) => Object.keys(current).length ? {} : current);
    return result;
  };
  /** 한 번에 하나만 한다. 불러오는 동안 창을 닫으면 그 뒤 일은 하지 않는다. */
  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setWorking(true); setNotice('');
    try { await task(); }
    catch { if (alive.current) setNotice('처리 결과를 확인하지 못했습니다. 목록을 다시 검색해 확인해주세요.'); }
    finally { lock.current = false; if (alive.current) setWorking(false); }
  }
  async function open(row: GoodsDraftSummary) {
    const result = await getGoodsDraftAction(row.id);
    if (!alive.current) return;
    if (!result.data) { setNotice(result.error ?? '불러오지 못했습니다.'); return; }
    if (await onLoad(result.data) && alive.current) onClose();
  }
  async function toggle(row: GoodsDraftSummary) {
    const result = await setGoodsDraftArchivedAction(row, !row.archived);
    if (!alive.current) return;
    if (!result.data) { setNotice(result.error ?? '바꾸지 못했습니다.'); return; }
    const next = result.data;
    setChanged((current) => ({ ...current, [row.id]: next }));
  }
  async function remove(row: GoodsDraftSummary) {
    /* 삭제한 항목에서 되살릴 수 있으므로 위험색 확인(destructive)은 쓰지 않는다. */
    if (await adminConfirm({ title: '임시저장을 삭제할까요?', message: `‘${row.name}’ 임시저장을 삭제합니다. 삭제한 항목에서 다시 복원할 수 있습니다.`, confirmLabel: '삭제' })) await run(() => toggle(row));
  }
  const rowView = (row: GoodsDraftSummary): AdminPickerRowView => {
    const moved = changed[row.id];
    return {
      title: row.name,
      meta: `${row.archived ? '삭제' : '마지막 저장'} ${time(row.updatedAt)} (KST)${moved ? ` · ${moved.archived ? '삭제했습니다' : '복원했습니다'}` : ''}`,
      imageUrl: row.imagePath ? publicMediaUrl(row.imagePath) : null,
    };
  };
  return <AdminPickerDialog<GoodsDraftSummary>
    description={`내 임시저장을 최근 ${GOODS_DRAFT_LIMIT}건까지 보관하고, 넘으면 가장 오래된 것이 삭제한 항목으로 옮겨집니다.`}
    emptyText="임시저장한 상품이 없습니다."
    excludedNote="상품으로 등록을 마친 임시저장은 목록에서 뺐습니다."
    filterLabel="보기"
    filterOptions={VIEWS}
    footer={working || notice ? <div className="flex flex-col gap-1">
      {working ? <p className="text-sm text-muted-foreground" role="status">처리하는 중입니다.</p> : null}
      {notice ? <p className="text-sm text-destructive wrap-anywhere" role="alert">{notice}</p> : null}
    </div> : null}
    load={load}
    onClose={onClose}
    /* 줄 버튼이 [불러오기]·[삭제]라 [선택]은 쓰지 않는다. */
    onSelect={() => false}
    rowAction={(row, { busy }) => {
      const current = changed[row.id] ?? row;
      const disabled = busy || working;
      /* 줄마다 같은 이름의 버튼이 늘어서므로 읽어 주는 이름에는 어느 임시저장인지를 앞에 붙인다. */
      return <span className="flex items-center gap-2">
        {current.archived ? null : <button className={buttonVariants({ size: 'sm' })} data-slot="button" disabled={disabled} onClick={() => { void run(() => open(current)); }} type="button"><span className="sr-only">{current.name} </span>불러오기</button>}
        <button className={buttonVariants({ variant: current.archived ? 'outline' : 'destructive', size: 'sm' })} data-slot="button" disabled={disabled} onClick={() => { void (current.archived ? run(() => toggle(current)) : remove(current)); }} type="button"><span className="sr-only">{current.name} </span>{current.archived ? '복원' : '삭제'}</button>
      </span>;
    }}
    rowKey={(row) => row.id}
    rowView={rowView}
    searchPlaceholder="상품명으로 찾기"
    showImages
    title="임시저장 고르기"
  />;
}
