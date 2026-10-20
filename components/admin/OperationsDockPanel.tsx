'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setAdminOperationAlertBadgeAction, updateAdminOperationAlertsAction } from '@/app/admin/operations-dock-actions';
import { ADMIN_ALERT_CATEGORIES, type AdminAlertCategory, type AdminAlertFilterState, type AdminAlertPage, type AdminHelpResult, type AdminOperationTask } from '@/lib/admin/operations-dock';
import { Icon } from '@/components/ui/Icon';
import type { OperationsDockSection } from './OperationsDock';

async function read<T>(query: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/admin/operations-dock?${query}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('업무 정보를 불러오지 못했습니다. 새로고침해주세요.');
  return response.json() as Promise<T>;
}

export function OperationsDockPanel({ section, pathname, onClose, onAlertRead, categories = ADMIN_ALERT_CATEGORIES }: { section: OperationsDockSection; pathname: string; onClose: () => void; onAlertRead: (page: AdminAlertPage) => void; categories?: ReadonlyArray<typeof ADMIN_ALERT_CATEGORIES[number]> }) {
  const router = useRouter();
  const [category, setCategory] = useState<AdminAlertCategory>('all');
  const [state, setState] = useState<AdminAlertFilterState>('all');
  const [alerts, setAlerts] = useState<AdminAlertPage | null>(null);
  const [tasks, setTasks] = useState<AdminOperationTask[] | null>(null);
  const [help, setHelp] = useState<AdminHelpResult | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [settings, setSettings] = useState(false);
  const [pending, startTransition] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const onAlertReadRef = useRef(onAlertRead);
  useEffect(() => { onAlertReadRef.current = onAlertRead; }, [onAlertRead]);
  useEffect(() => { heading.current?.focus(); }, [section]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ section, category, state, q: search, path: pathname });
    read<AdminAlertPage | AdminOperationTask[] | AdminHelpResult>(params, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setError(''); setLoading(false);
      if (section === 'alerts') { const page = data as AdminAlertPage; setAlerts(page); onAlertReadRef.current(page); }
      if (section === 'tasks') setTasks(data as AdminOperationTask[]);
      if (section === 'help') setHelp(data as AdminHelpResult);
    }).catch(() => { if (!controller.signal.aborted) { setAlerts(null); setTasks(null); setHelp(null); setLoading(false); setError('업무 정보를 불러오지 못했습니다. 새로고침해주세요.'); } });
    return () => controller.abort();
  }, [section, category, state, search, pathname, refresh]);
  function reload() { setLoading(true); setRefresh(value => value + 1); }
  function update(action: 'read' | 'hide' | 'restore', ids: string[] | null, href?: string) {
    if (!alerts) return;
    startTransition(async () => {
      try {
        const result = await updateAdminOperationAlertsAction({ action, ids, through: alerts.asOf, category, state });
        if (result.error) { setError(result.error); return; }
        if (href) { router.push(href); onClose(); } else reload();
      } catch { setError('알림을 처리하지 못했습니다. 다시 시도해주세요.'); }
    });
  }
  function more() {
    const last = alerts?.items.at(-1); if (!last || !alerts) return;
    startTransition(async () => {
      try {
        const next = await read<AdminAlertPage>(new URLSearchParams({ section: 'alerts', category, state, before: last.createdAt, beforeId: last.id }));
        const ids = new Set(alerts.items.map(item => item.id));
        const merged = { ...next, asOf: alerts.asOf, items: [...alerts.items, ...next.items.filter(item => !ids.has(item.id))] };
        setAlerts(merged); onAlertReadRef.current(merged); setError('');
      } catch { setError('이전 알림을 불러오지 못했습니다. 다시 시도해주세요.'); }
    });
  }
  const title = section === 'alerts' ? '알림' : section === 'tasks' ? '할 일' : '도움말';
  return <section className="admin-operations-panel" id="admin-operations-panel" role="region" aria-labelledby="admin-operations-title" aria-busy={loading || pending}>
    <header><h2 id="admin-operations-title" ref={heading} tabIndex={-1}>{title}</h2><div>{section === 'alerts' ? <button type="button" aria-label="알림 설정" aria-expanded={settings} onClick={() => setSettings(!settings)}><Icon name="settings" size={19} /></button> : null}<button type="button" aria-label="업무 도구 닫기" onClick={onClose}><Icon name="close" size={20} /></button></div></header>
    <div className="admin-operations-body">
      {error ? <p role="alert" className="admin-operations-error">{error}</p> : null}
      <div className="admin-operations-refresh"><button type="button" disabled={loading || pending} onClick={reload}>새로고침</button></div>
      {section === 'alerts' ? <>
        {settings && alerts ? <form className="admin-operations-settings" onSubmit={event => { event.preventDefault(); const enabled = new FormData(event.currentTarget).get('badge') === 'on'; startTransition(async () => { try { const result = await setAdminOperationAlertBadgeAction(enabled); if (result.error) setError(result.error); else { setSettings(false); reload(); } } catch { setError('알림 설정을 저장하지 못했습니다.'); } }); }}>
          <h3>알림 설정</h3><label><input name="badge" type="checkbox" defaultChecked={alerts.badgeEnabled} /> 새 알림 건수 표시</label><p>현재 계정에 적용됩니다. 알림 목록은 계속 보관됩니다.</p><div><button disabled={pending} type="submit">저장</button><button type="button" onClick={() => setSettings(false)}>취소</button></div>
        </form> : null}
        <nav aria-label="알림 유형" className="admin-operations-categories">{categories.map(([key, label]) => <button type="button" key={key} disabled={pending} aria-pressed={category === key} onClick={() => { if (key !== category) { setCategory(key); setLoading(true); } }}>{label}</button>)}</nav>
        <div className="admin-operations-alert-tools"><select aria-label="알림 상태" disabled={pending} value={state} onChange={event => { setState(event.target.value as AdminAlertFilterState); setLoading(true); }}><option value="all">전체알림</option><option value="unread">안읽은알림</option><option value="hidden">숨긴알림</option></select>
          <button type="button" disabled={!alerts || loading || pending || state === 'hidden'} onClick={() => update('read', null)}>전체읽음</button><button type="button" disabled={!alerts || loading || pending} onClick={() => update(state === 'hidden' ? 'restore' : 'hide', null)}>{state === 'hidden' ? '전체복원' : '전체숨김'}</button></div>
        <p className="admin-operations-note">최근 90일 · 기능 적용 후 발생한 알림 · 읽음/숨김은 현재 계정에만 적용됩니다.</p>
        {!loading && alerts?.items.length === 0 ? <p className="admin-operations-empty">표시할 알림이 없습니다.</p> : null}
        {!loading && alerts ? <ul className="admin-operations-alert-list">{alerts.items.map(item => <li key={item.id} data-unread={!item.readAt || undefined}>
          <div><span>{ADMIN_ALERT_CATEGORIES.find(([key]) => key === item.category)?.[1]}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>
          <Link href={item.href} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); update('read', [item.id], item.href); }}>{item.title}</Link>
          <button type="button" disabled={pending} onClick={() => update(item.hiddenAt ? 'restore' : 'hide', [item.id])}>{item.hiddenAt ? '복원' : '숨김'}</button>
        </li>)}</ul> : null}
        {!loading && alerts?.hasMore ? <button className="admin-operations-more" disabled={pending} type="button" onClick={more}>더보기</button> : null}
      </> : null}
      {section === 'tasks' && !loading && tasks ? <><p className="admin-operations-note">현재 처리 상태 기준 · 건수를 누르면 해당 조건의 목록으로 이동합니다.</p><ul className="admin-operations-task-list">{tasks.map(task => <li key={task.id}><Link href={task.href} onClick={onClose}><span>{task.label}</span><strong>{task.count.toLocaleString('ko-KR')}건</strong></Link></li>)}</ul>{tasks.every(task => task.count === 0) ? <p className="admin-operations-empty">지금은 처리할 업무가 없습니다.</p> : null}</> : null}
      {section === 'help' ? <>
        <form role="search" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setLoading(true); if (query.trim() === search) setRefresh(value => value + 1); }}><input aria-label="도움말 검색어" placeholder="도움말 검색" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} /><button type="submit">검색</button></form>
        <Link className="admin-operations-guide-link" href="/admin/guide" onClick={onClose}>전체 가이드 보기 ›</Link>
        {!loading && help ? <><h3>{search ? `검색 결과 ${help.total}개` : '현재 화면 도움말'}</h3>{help.entries.length === 0 ? <p className="admin-operations-empty">일치하는 도움말이 없습니다.</p> : null}<div className="admin-operations-help-list">{help.entries.map(entry => <details key={entry.id}><summary><span>{entry.topic}</span>{entry.title}</summary><div>{entry.paragraphs.map((text, index) => <p key={index}>{text}</p>)}<Link href={entry.href} onClick={onClose}>가이드에서 보기 ›</Link>{entry.links.map(link => <Link href={link.href} key={link.href} onClick={onClose}>{link.label} ›</Link>)}</div></details>)}</div>{help.total > help.entries.length ? <p className="admin-operations-note">상위 {help.entries.length}개를 표시합니다. 검색어를 구체적으로 입력해주세요.</p> : null}</> : null}
      </> : null}
      {loading ? <p role="status" className="admin-operations-empty">불러오는 중입니다.</p> : null}
    </div>
  </section>;
}
