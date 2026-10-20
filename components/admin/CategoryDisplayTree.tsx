'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { AdminSectionCard } from './console/AdminKit';
import { reloadCategoryDisplayTreeAction, updateCategoryDisplayTreeAction, type CategoryDisplayTreeResult } from '@/app/admin/category-display-actions';
import { CATEGORY_DISPLAY_ADMIN_PATH, categoryDisplayParentChoices, type CategoryDisplayDirectory, type CategoryDisplayTreeChange } from '@/lib/category-display';
import { createClient } from '@/lib/supabase/client';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';

export function CategoryDisplayTree({ initial, selectedId, actorId, sessionId }: { initial: CategoryDisplayDirectory; selectedId: string | null; actorId: string; sessionId: string | null }) {
  const [directory, setDirectory] = useState(initial), [creating, setCreating] = useState(!selectedId);
  const selected = directory.categories.find(node => node.id === selectedId);
  const [name, setName] = useState(selected?.name ?? ''), [parentId, setParentId] = useState(selected?.parentId ?? '');
  const [pending, startTransition] = useTransition(), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false), [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState(false), [createdId, setCreatedId] = useState<string | null>(null);
  const request = useRef<{ change: CategoryDisplayTreeChange; revision: number; operationId: string } | null>(null), alive = useRef(true), blockedRef = useRef(false);
  const locked = pending || uncertain || conflict || blocked;
  const dirty = creating ? Boolean(name || parentId) : name !== (selected?.name ?? '') || parentId !== (selected?.parentId ?? '');
  const parents = categoryDisplayParentChoices(directory, creating ? null : selectedId);
  const siblings = directory.categories.filter(node => node.parentId === (parentId || null) && (creating || node.id !== selectedId));
  useEffect(() => {
    alive.current = true;
    const subscription = createClient().auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== actorId || sessionId !== null && inquiryDraftSessionId(session.access_token) !== sessionId) {
        blockedRef.current = true; setBlocked(true);
      }
    }).data.subscription;
    return () => { alive.current = false; subscription.unsubscribe(); };
  }, [actorId, sessionId]);
  useEffect(() => {
    if (!dirty && !uncertain) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      if (!window.confirm('저장하지 않은 전시분류 입력을 두고 이동할까요?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', prevent); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', prevent); document.removeEventListener('click', navigate, true); };
  }, [dirty, uncertain]);
  function submit(change: CategoryDisplayTreeChange) {
    if (pending || conflict || blockedRef.current) return;
    request.current ??= { change, revision: directory.revision, operationId: crypto.randomUUID() };
    const attempt = request.current;
    setMessage('');
    startTransition(async () => {
      let result: CategoryDisplayTreeResult;
      try { result = await updateCategoryDisplayTreeAction(attempt.change, attempt.revision, attempt.operationId, actorId); }
      catch { result = { error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }; }
      if (!alive.current || blockedRef.current) return;
      if ('error' in result) {
        setMessage(result.error); setError(true); setUncertain(Boolean(result.uncertain)); setConflict(Boolean(result.conflict));
        if (!result.uncertain) request.current = null;
        return;
      }
      setDirectory(result.directory); setUncertain(false); setConflict(false); request.current = null; setError(false);
      const updated = result.directory.categories.find(node => node.id === result.nodeId)!;
      if (attempt.change.action === 'create') { setCreatedId(updated.id); setName(''); setParentId(''); setMessage('전시분류를 만들었습니다. 상품과 상단 콘텐츠를 구성해주세요.'); }
      else { setName(updated.name); setParentId(updated.parentId ?? ''); setMessage('전시분류를 저장했습니다.'); }
    });
  }
  function save() {
    if (request.current) { submit(request.current.change); return; }
    const sameParent = !creating && selected?.parentId === (parentId || null);
    const position = sameParent ? directory.categories.filter(node => node.parentId === selected.parentId).findIndex(node => node.id === selectedId) : siblings.length;
    submit({ action: creating ? 'create' : 'update', id: creating ? crypto.randomUUID() : selectedId!, name: name.trim(), parentId: parentId || null, position });
  }
  function move(delta: number) {
    if (!selected || dirty) return;
    const currentSiblings = directory.categories.filter(node => node.parentId === selected.parentId), index = currentSiblings.findIndex(node => node.id === selected.id);
    if (index + delta < 0 || index + delta >= currentSiblings.length) return;
    submit({ action: 'update', id: selected.id, name: selected.name, parentId: selected.parentId, position: index + delta });
  }
  function reload() {
    if (pending || uncertain || blocked || dirty && !window.confirm('현재 전시분류 입력을 버리고 최신 저장본을 불러올까요?')) return;
    startTransition(async () => {
      const result = await reloadCategoryDisplayTreeAction(actorId).catch(() => ({ error: '최신 전시분류를 불러오지 못했습니다. 입력은 유지됩니다.' }));
      if (!alive.current || blockedRef.current) return;
      if ('error' in result) { setMessage(result.error); setError(true); return; }
      setDirectory(result.directory); setConflict(false); request.current = null;
      const fresh = result.directory.categories.find(node => node.id === selectedId);
      setName(creating ? '' : fresh?.name ?? ''); setParentId(creating ? '' : fresh?.parentId ?? ''); setMessage('최신 전시분류를 불러왔습니다.'); setError(false);
    });
  }
  const peerIndex = selected ? directory.categories.filter(node => node.parentId === selected.parentId).findIndex(node => node.id === selected.id) : -1;
  const peerCount = selected ? directory.categories.filter(node => node.parentId === selected.parentId).length : 0;
  return <AdminSectionCard title="전시분류">
    <p>상품분류와 별도로 이름·계층·순서를 구성합니다. 새 분류는 3단계까지, 최상위 19개·각 하위 15개까지 만들 수 있습니다. 기존 분류와 상품 연결은 유지됩니다.</p>
    {blocked ? <p role="alert">로그인 상태가 바뀌었습니다. 이 화면을 새로 열어주세요.</p> : null}
    <div className="admin-category-display__tree-layout">
      <nav className="admin-category-display__tree" aria-label="전시분류 목록">{directory.categories.map(node => <Link key={node.id} href={`${CATEGORY_DISPLAY_ADMIN_PATH}?id=${node.id}`} aria-current={node.id === selectedId ? 'page' : undefined}
        style={{ paddingInlineStart: `${12 + (node.depth - 1) * 18}px` }}><span>{node.name}</span>{node.archivedAt ? <small>보관됨</small> : null}</Link>)}{!directory.categories.length ? <p>첫 전시분류를 만들어주세요.</p> : null}</nav>
      <form className="admin-category-display__tree-form" onSubmit={event => { event.preventDefault(); save(); }}>
        <div className="admin-category-display__tree-actions"><button type="button" disabled={locked || creating} onClick={() => { if (dirty && !window.confirm('현재 전시분류 입력을 버리고 새 분류를 만들까요?')) return; setCreating(true); setName(''); setParentId(''); setMessage(''); }}>새 전시분류</button>
          {selected ? <button type="button" disabled={locked || !creating} onClick={() => { if (dirty && !window.confirm('새 전시분류 입력을 버릴까요?')) return; setCreating(false); setName(selected.name); setParentId(selected.parentId ?? ''); setMessage(''); }}>선택한 분류 편집</button> : null}</div>
        <fieldset disabled={locked}><legend>{creating ? '새 전시분류 만들기' : '선택한 전시분류 설정'}</legend>
          <label>전시분류명 · 20자<input value={name} onChange={event => setName(event.target.value)} maxLength={Math.max(40, selected?.name.length ?? 0)} required /></label>
          <label>상위 전시분류<select value={parentId} onChange={event => setParentId(event.target.value)}><option value="">최상위</option>{parents.map(node => <option key={node.id} value={node.id}>{'　'.repeat(node.depth - 1)}{node.name}</option>)}
            {parentId && !parents.some(node => node.id === parentId) ? <option value={parentId}>{directory.categories.find(node => node.id === parentId)?.name ?? '기존 상위 분류'} (기존 계층 유지)</option> : null}</select></label>
          {!creating && selected?.depth === 4 ? <p>기존 4단계 분류는 보존됩니다. 다른 상위 분류로 옮길 때는 하위 분류를 포함해 3단계 이내여야 합니다.</p> : null}
          {!creating && selected?.archivedAt ? <p>보관 중에는 이 분류와 하위 분류의 공개 전시가 숨겨집니다. 상품 연결과 상단 콘텐츠는 보존됩니다.</p> : null}
        </fieldset>
        <div className="admin-category-display__tree-actions"><button type="submit" disabled={pending || conflict || blocked}>{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : creating ? '전시분류 만들기' : '이름·상위 분류 저장'}</button>
          {!creating && selected ? <><button type="button" disabled={locked || dirty || peerIndex <= 0} onClick={() => move(-1)}>위로</button><button type="button" disabled={locked || dirty || peerIndex >= peerCount - 1} onClick={() => move(1)}>아래로</button>
            <button type="button" disabled={locked || dirty} onClick={() => { if (selected.archivedAt || window.confirm('이 전시분류와 하위 공개 전시를 숨길까요? 상품 연결과 상단 콘텐츠는 보존됩니다.')) submit({ action: selected.archivedAt ? 'restore' : 'archive', id: selected.id }); }}>{selected.archivedAt ? '보관 해제' : '보관'}</button></> : null}
          <button type="button" disabled={pending || uncertain || blocked} onClick={reload}>최신 분류 불러오기</button></div>
        {message ? <p role={error ? 'alert' : 'status'}>{message}</p> : null}
        {createdId ? <Link href={`${CATEGORY_DISPLAY_ADMIN_PATH}?id=${createdId}`}>새 전시분류의 상품·상단 콘텐츠 구성하기</Link> : null}
      </form>
    </div>
  </AdminSectionCard>;
}
