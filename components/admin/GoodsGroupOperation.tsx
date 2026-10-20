'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { readGoodsGroupOperationAction, readGoodsGroupSourceAction, searchGoodsGroupProductsAction } from '@/app/admin/goods-group-actions';
import { goodsGroupHref, goodsGroupRecoveryKey, parseGoodsGroupRecovery, type GoodsGroupCandidates, type GoodsGroupIdentity,
  type GoodsGroupReceipt, type GoodsGroupRecovery, type GoodsGroupResult, type GoodsGroupSource } from '@/lib/admin/goods-groups';
import { AdminField, AdminSectionCard } from './console/AdminKit';

export const GROUP_BUTTON = 'wc-admin-kit__button';
export const GROUP_PRIMARY = `${GROUP_BUTTON} wc-admin-kit__button--primary`;
export function GroupTable({ label, children }: { label: string; children: ReactNode }) {
  return <div className="admin-console-grid"><div className="admin-console-grid-scroll" role="region" aria-label={`${label} 가로 스크롤`} tabIndex={0}>
    <table className="admin-console-grid-table"><caption className="admin-console-grid-caption">{label}</caption>{children}</table>
  </div></div>;
}
export function GroupPager({ page, total, pageSize, disabled, onChange }: { page: number; total: number; pageSize: number; disabled: boolean; onChange: (page: number) => void }) {
  return <nav className="admin-console-pagination" aria-label="목록 페이지"><button className={GROUP_BUTTON} type="button" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>이전</button>
    <span className="admin-console-pagination-summary">{page} / {Math.max(1, Math.ceil(total / pageSize))} 페이지 · {total.toLocaleString('ko-KR')}건</span>
    <button className={GROUP_BUTTON} type="button" disabled={disabled || page * pageSize >= total} onClick={() => onChange(page + 1)}>다음</button></nav>;
}
export function useGoodsGroupSession(actorId: string, sessionId: string | null) {
  const [blocked, setBlocked] = useState(!sessionId); const mounted = useRef(true), blockedRef = useRef(!sessionId);
  useEffect(() => {
    mounted.current = true;
    const subscription = createClient().auth.onAuthStateChange((_event, session) => {
      if (!sessionId || session?.user.id !== actorId || inquiryDraftSessionId(session.access_token) !== sessionId) {
        blockedRef.current = true; setBlocked(true);
      }
    }).data.subscription;
    return () => { mounted.current = false; subscription.unsubscribe(); };
  }, [actorId, sessionId]);
  return { blocked, current: () => mounted.current && !blockedRef.current, deny: () => { blockedRef.current = true; setBlocked(true); } };
}
/** The journal contains identity metadata only. A mounted/reloaded form never
 * dispatches the saved operation; only its database receipt may be read/sealed. */
export function useGoodsGroupOperation(identity: GoodsGroupIdentity | null, scope: string, current: () => boolean, deny: () => void) {
  const [recovery, setRecovery] = useState<GoodsGroupRecovery | null>(null), [receipt, setReceipt] = useState<GoodsGroupReceipt | null>(null);
  const [message, setMessage] = useState(''), [storageBroken, setStorageBroken] = useState(false), [initialized, setInitialized] = useState(false);
  const [pending, startTransition] = useTransition(); const busy = useRef(false), journal = useRef<GoodsGroupRecovery | null>(null);
  const key = identity ? goodsGroupRecoveryKey(identity, scope) : null;
  function nextSaved(): GoodsGroupRecovery | null {
    if (!key || !identity) return null;
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const candidate = window.localStorage.key(index); if (candidate?.startsWith(`${key}:`)) keys.push(candidate);
    }
    for (const candidate of keys.sort()) {
      const raw = window.localStorage.getItem(candidate); if (raw === null) continue;
      const saved = parseGoodsGroupRecovery(JSON.parse(raw), identity);
      const expectedScope = saved?.command === 'convert' ? 'convert' : saved?.command === 'create' ? 'create'
        : saved ? `${saved.command === 'common' ? 'common' : 'group'}:${saved.groupId}` : null;
      if (!saved || candidate !== `${key}:${saved.operationId}` || scope !== expectedScope) throw new Error('invalid journal');
      return saved;
    }
    return null;
  }
  useEffect(() => {
    let active = true;
    const synchronize = () => {
      if (!active) return;
      try {
        const saved = journal.current ?? nextSaved();
        if (saved) { journal.current = saved; setRecovery(saved); setMessage('이전 요청의 결과 확인이 남아 있습니다. 다시 실행하지 않고 진행 내역을 확인해주세요.'); }
      } catch { setStorageBroken(true); setMessage('진행 내역을 읽지 못했습니다. 브라우저 저장공간을 확인하고 화면을 다시 열어주세요.'); }
      setInitialized(true);
    };
    const changed = (event: StorageEvent) => { if (event.key === null || event.key?.startsWith(`${key}:`)) synchronize(); };
    window.addEventListener('storage', changed);
    // Hydration and later cross-tab updates enter the same external-store callback.
    queueMicrotask(synchronize);
    return () => { active = false; window.removeEventListener('storage', changed); };
    // Identity is fixed by the keyed parent throughout this editor lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!recovery) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [recovery]);
  function accept(result: GoodsGroupResult<GoodsGroupReceipt>) {
    if (!current()) return;
    if ('error' in result) { setMessage(result.error); if (result.authChanged) deny(); return; }
    if (result.value.state === 'unresolved') { setMessage('아직 완료 결과가 확인되지 않았습니다. 다시 조회하거나 이 요청을 종료한 뒤 다시 준비해주세요.'); return; }
    try { if (key) window.localStorage.removeItem(`${key}:${result.value.operationId}`); } catch { setStorageBroken(true); setMessage('결과는 확인했지만 진행 기록 정리를 완료하지 못했습니다. 화면을 다시 열어주세요.'); }
    journal.current = null; setRecovery(null); setReceipt(result.value);
    try { const next = nextSaved(); if (next) { journal.current = next; setRecovery(next); } } catch { setStorageBroken(true); }
    setMessage(result.value.state === 'sealed' ? '처리되지 않은 요청을 종료했습니다. 최신 상품 상태로 다시 준비해주세요.' : '저장 결과를 확인했습니다.');
  }
  function execute(metadata: GoodsGroupRecovery, action: () => Promise<GoodsGroupResult<GoodsGroupReceipt>>) {
    if (!current() || !initialized || storageBroken || busy.current || journal.current || !identity || !key) return;
    const safe = parseGoodsGroupRecovery(metadata, identity);
    if (!safe) { setMessage('요청 정보가 현재 로그인과 일치하지 않습니다. 화면을 다시 열어주세요.'); return; }
    try {
      const previous = nextSaved(); if (previous) { journal.current = previous; setRecovery(previous); setMessage('먼저 이전 진행 내역을 확인해주세요.'); return; }
      const itemKey = `${key}:${safe.operationId}`; window.localStorage.setItem(itemKey, JSON.stringify(safe));
      if (window.localStorage.getItem(itemKey) !== JSON.stringify(safe)) throw new Error('journal not durable');
    }
    catch { setMessage('진행 내역을 보관하지 못해 실행하지 않았습니다. 브라우저 저장공간을 확인해주세요.'); return; }
    journal.current = safe; setRecovery(safe); setReceipt(null); setMessage(''); busy.current = true;
    startTransition(async () => {
      try { accept(await action()); } catch { if (current()) setMessage('결과가 불명확합니다. 같은 진행 내역의 결과를 확인해주세요.'); }
      finally { busy.current = false; }
    });
  }
  function recover(seal = false) {
    const saved = journal.current;
    if (!saved || !current() || busy.current) return;
    busy.current = true; setMessage(''); startTransition(async () => {
      try { accept(await readGoodsGroupOperationAction(saved, seal)); } catch { if (current()) setMessage('진행 내역을 조회하지 못했습니다. 잠시 후 다시 확인해주세요.'); }
      finally { busy.current = false; }
    });
  }
  return { initialized, pending, recovery, receipt, message, locked: !initialized || storageBroken || pending || recovery !== null,
    execute, recover, clearReceipt: () => { setReceipt(null); setMessage(''); }, setMessage };
}
export function GroupOperationStatus({ operation, disabled }: { operation: ReturnType<typeof useGoodsGroupOperation>; disabled: boolean }) {
  return <>{operation.message ? <p role={operation.recovery ? 'alert' : 'status'}>{operation.message}</p> : null}
    {operation.recovery ? <AdminSectionCard title="진행 결과 확인"><p>진행 내역을 조회합니다. 이미 완료된 변경은 한 번만 반영됩니다.</p>
      <div className="wc-admin-kit__actions"><button type="button" className={GROUP_PRIMARY} disabled={disabled || operation.pending} onClick={() => operation.recover()}>진행 내역 확인</button>
        <button type="button" className={GROUP_BUTTON} disabled={disabled || operation.pending} onClick={() => operation.recover(true)}>이 요청 종료하고 다시 준비</button></div>
      <p className="wc-admin-kit__hint">종료를 누르면 아직 처리되지 않은 요청만 종료합니다. 이미 처리됐다면 완료 결과를 불러옵니다.</p></AdminSectionCard> : null}</>;
}
export function GroupCompleted({ receipt, children }: { receipt: Extract<GoodsGroupReceipt, { state: 'completed' }>; children?: ReactNode }) {
  return <AdminSectionCard title={receipt.group.archivedAt ? '그룹 연결을 해제했습니다' : '그룹상품 저장을 확인했습니다'}>
    <p>{receipt.group.name} · {receipt.group.members.length}개 판매옵션</p>
    <p>{receipt.group.archivedAt ? '개별 상품과 원상품의 합산 조건은 유지됩니다.' : '변경한 상품은 미공개 상태입니다. 상품정보와 KC 검토를 마친 뒤 개별 상품에서 공개해주세요.'}</p>
    <div className="wc-admin-kit__actions"><Link className={GROUP_BUTTON} href={goodsGroupHref(receipt.group.id)}>그룹상품 열기</Link>{children}</div>
  </AdminSectionCard>;
}
export function GoodsGroupProductPicker({ identity, disabled, onSelect }: { identity: GoodsGroupIdentity | null; disabled: boolean; onSelect: (source: GoodsGroupSource) => void }) {
  const [query, setQuery] = useState(''), [applied, setApplied] = useState(''), [page, setPage] = useState<GoodsGroupCandidates | null>(null), [error, setError] = useState('');
  const [pending, startTransition] = useTransition(); const ticket = useRef(0), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; ticket.current += 1; }; }, []);
  function search(number = 1, q = query) {
    if (!identity || disabled || pending) return;
    const sequence = ++ticket.current; setError(''); startTransition(async () => {
      try { const result = await searchGoodsGroupProductsAction(q, number, identity); if (!alive.current || sequence !== ticket.current) return;
        if ('error' in result) setError(result.error); else { setPage(result.value); setApplied(q); }
      } catch { if (alive.current && sequence === ticket.current) setError('상품을 검색하지 못했습니다. 다시 조회해주세요.'); }
    });
  }
  function select(goodId: string) {
    if (!identity || disabled || pending) return;
    const sequence = ++ticket.current; setError(''); startTransition(async () => {
      try { const result = await readGoodsGroupSourceAction(goodId, identity); if (!alive.current || sequence !== ticket.current) return;
        if ('error' in result) setError(result.error); else onSelect(result.value);
      } catch { if (alive.current && sequence === ticket.current) setError('상품과 옵션을 불러오지 못했습니다. 다시 선택해주세요.'); }
    });
  }
  return <AdminSectionCard title="상품 선택"><div className="wc-admin-kit__form-grid" role="search">
    <AdminField label="상품명·판매자상품코드·상품번호" inputId="group-product-search"><input id="group-product-search" type="search" value={query} maxLength={100} disabled={disabled || pending}
      onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); search(); } }} /></AdminField>
    <div className="wc-admin-kit__actions"><button type="button" className={GROUP_BUTTON} disabled={disabled || pending || !identity} onClick={() => search()}>상품 검색</button></div>
  </div>{error ? <p role="alert">{error}</p> : null}{page ? <><GroupTable label="상품 검색 결과"><thead><tr><th>상품</th><th>판매자상품코드</th><th>선택</th></tr></thead><tbody>
    {page.rows.map(row => <tr key={row.id}><td>{row.name}<br /><small>{row.id}</small></td><td>{row.code ?? '—'}</td><td><button type="button" className={GROUP_BUTTON} disabled={disabled || pending} onClick={() => select(row.id)}>{row.name} 선택</button></td></tr>)}
    {!page.rows.length ? <tr><td colSpan={3}>검색 결과가 없습니다.</td></tr> : null}</tbody></GroupTable>
    <GroupPager {...page} disabled={disabled || pending} onChange={number => search(number, applied)} /></> : <p className="wc-admin-kit__hint">검색어를 비우고 조회하면 등록된 상품을 확인할 수 있습니다.</p>}</AdminSectionCard>;
}
