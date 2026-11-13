'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setAdminOperationAlertBadgeAction, updateAdminOperationAlertsAction } from '@/app/admin/operations-dock-actions';
import { ADMIN_ALERT_CATEGORIES, type AdminAlertCategory, type AdminAlertFilterState, type AdminAlertPage, type AdminHelpResult, type AdminOperationTask } from '@/lib/admin/operations-dock';
import { startAdminNavigation } from '@/lib/admin/navigation-pending';
import { RefreshCw, Settings, X } from 'lucide-react';
import { Badge } from '@/components/admin/kit/ui/badge';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/admin/kit/ui/native-select';
import type { OperationsDockSection } from './OperationsDock';
import { InquiryNotificationToggle } from './AdminInquiryNotifier';
import { confirmAdminLeave } from '@/lib/admin/leave-guard';

async function read<T>(query: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/admin/operations-dock?${query}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('업무 정보를 불러오지 못했습니다. 새로고침해주세요.');
  return response.json() as Promise<T>;
}

export function OperationsDockPanel({ section, pathname, onClose, onAlertRead, categories = ADMIN_ALERT_CATEGORIES, inquiryNotificationAccountId }: { section: OperationsDockSection; pathname: string; onClose: () => void; onAlertRead: (page: AdminAlertPage) => void; categories?: ReadonlyArray<typeof ADMIN_ALERT_CATEGORIES[number]>; inquiryNotificationAccountId?: string }) {
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
    /* 알림을 눌러 다른 화면으로 가면 입력 중이던 화면의 변경이 사라진다. 읽음 처리 전에 먼저 묻는다. */
    if (href) { void confirmAdminLeave().then((leave) => { if (leave) run(action, ids, href); }); return; }
    run(action, ids);
  }
  function run(action: 'read' | 'hide' | 'restore', ids: string[] | null, href?: string) {
    if (!alerts) return;
    startTransition(async () => {
      try {
        const result = await updateAdminOperationAlertsAction({ action, ids, through: alerts.asOf, category, state });
        if (result.error) { setError(result.error); return; }
        if (href) { startAdminNavigation(href); router.push(href); onClose(); } else reload();
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
  const linkClass = 'font-medium text-foreground underline-offset-4 hover:underline';
  return <section className="flex h-full min-h-0 flex-col" id="admin-operations-panel" role="region" aria-labelledby="admin-operations-title" aria-busy={loading || pending}>
    <header className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
      <h2 className="text-base font-semibold text-foreground outline-none" id="admin-operations-title" ref={heading} tabIndex={-1}>{title}</h2>
      <div className="flex items-center gap-1">
        {section === 'alerts' ? <Button aria-expanded={settings} aria-label="알림 설정" onClick={() => setSettings(!settings)} size="icon-sm" type="button" variant="ghost"><Settings /></Button> : null}
        <Button aria-label="업무 도구 닫기" onClick={onClose} size="icon-sm" type="button" variant="ghost"><X /></Button>
      </div>
    </header>
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4 text-sm">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end"><Button disabled={loading || pending} onClick={reload} size="sm" type="button" variant="outline"><RefreshCw />새로고침</Button></div>
      {section === 'alerts' ? <>
        {inquiryNotificationAccountId ? <InquiryNotificationToggle accountId={inquiryNotificationAccountId} /> : null}
        {settings && alerts ? <form className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3" onSubmit={event => { event.preventDefault(); const enabled = new FormData(event.currentTarget).get('badge') === 'on'; startTransition(async () => { try { const result = await setAdminOperationAlertBadgeAction(enabled); if (result.error) setError(result.error); else { setSettings(false); reload(); } } catch { setError('알림 설정을 저장하지 못했습니다.'); } }); }}>
          <h3 className="text-sm font-medium">알림 설정</h3><label className="flex items-center gap-2"><input name="badge" type="checkbox" defaultChecked={alerts.badgeEnabled} /> 새 알림 건수 표시</label><p className="text-xs text-muted-foreground">현재 계정에 적용됩니다. 알림 목록은 계속 보관됩니다.</p><div className="flex gap-2"><Button disabled={pending} size="sm" type="submit">저장</Button><Button onClick={() => setSettings(false)} size="sm" type="button" variant="outline">취소</Button></div>
        </form> : null}
        <nav aria-label="알림 유형" className="flex flex-wrap gap-1">{categories.map(([key, label]) => <Button aria-pressed={category === key} disabled={pending} key={key} onClick={() => { if (key !== category) { setCategory(key); setLoading(true); } }} size="xs" type="button" variant={category === key ? 'default' : 'outline'}>{label}</Button>)}</nav>
        <div className="flex flex-wrap items-center gap-1.5"><NativeSelect aria-label="알림 상태" className="w-32" disabled={pending} onChange={event => { setState(event.target.value as AdminAlertFilterState); setLoading(true); }} size="sm" value={state}><NativeSelectOption value="all">전체 알림</NativeSelectOption><NativeSelectOption value="unread">안 읽은 알림</NativeSelectOption><NativeSelectOption value="hidden">숨긴 알림</NativeSelectOption></NativeSelect>
          <Button disabled={!alerts || loading || pending || state === 'hidden'} onClick={() => update('read', null)} size="sm" type="button" variant="outline">전체 읽음</Button><Button disabled={!alerts || loading || pending} onClick={() => update(state === 'hidden' ? 'restore' : 'hide', null)} size="sm" type="button" variant="outline">{state === 'hidden' ? '전체 복원' : '전체 숨김'}</Button></div>
        <p className="text-xs text-muted-foreground">최근 90일 · 기능 적용 후 발생한 알림 · 읽음/숨김은 현재 계정에만 적용됩니다.</p>
        {!loading && alerts?.items.length === 0 ? <p className="py-6 text-center text-muted-foreground">표시할 알림이 없습니다.</p> : null}
        {!loading && alerts?.items.length ? <ul className="flex flex-col divide-y rounded-lg border">{alerts.items.map(item => <li className="flex flex-col gap-1.5 p-3 data-[unread]:bg-info-soft" key={item.id} data-unread={!item.readAt || undefined}>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><Badge variant="outline">{ADMIN_ALERT_CATEGORIES.find(([key]) => key === item.category)?.[1]}</Badge><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>
          <div className="flex items-start justify-between gap-2"><Link className={linkClass} data-admin-nav-skip="" href={item.href} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); update('read', [item.id], item.href); }}>{item.title}</Link>
          <Button className="shrink-0" disabled={pending} onClick={() => update(item.hiddenAt ? 'restore' : 'hide', [item.id])} size="xs" type="button" variant="ghost">{item.hiddenAt ? '복원' : '숨김'}</Button></div>
        </li>)}</ul> : null}
        {!loading && alerts?.hasMore ? <Button disabled={pending} onClick={more} type="button" variant="outline">더보기</Button> : null}
      </> : null}
      {section === 'tasks' && !loading && tasks ? <><p className="text-xs text-muted-foreground">현재 처리 상태 기준 · 건수를 누르면 해당 조건의 목록으로 이동합니다.</p><ul className="flex flex-col gap-1.5">{tasks.map(task => <li key={task.id}><Link className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted" href={task.href} onClick={onClose}><span>{task.label}</span><strong className={`font-semibold tabular-nums ${task.count > 0 ? 'text-warning' : 'text-muted-foreground'}`}>{task.count.toLocaleString('ko-KR')}건</strong></Link></li>)}</ul>{tasks.every(task => task.count === 0) ? <p className="py-6 text-center text-muted-foreground">지금은 처리할 업무가 없습니다.</p> : null}</> : null}
      {section === 'help' ? <>
        <form className="flex gap-2" role="search" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setLoading(true); if (query.trim() === search) setRefresh(value => value + 1); }}><Input aria-label="도움말 검색어" maxLength={100} onChange={event => setQuery(event.target.value)} placeholder="도움말 검색" value={query} /><Button type="submit" variant="soft">검색</Button></form>
        <Link className={`${linkClass} self-start text-sm`} href="/admin/guide" onClick={onClose}>전체 가이드 보기 ›</Link>
        {!loading && help ? <><h3 className="text-sm font-medium">{search ? `검색 결과 ${help.total}개` : '현재 화면 도움말'}</h3>{help.entries.length === 0 ? <p className="py-6 text-center text-muted-foreground">일치하는 도움말이 없습니다.</p> : null}<div className="flex flex-col gap-2">{help.entries.map(entry => <details className="group rounded-lg border px-3 py-2.5" key={entry.id}><summary className="flex cursor-pointer list-none flex-col gap-0.5"><span className="text-xs text-muted-foreground">{entry.topic}</span><span className="font-medium">{entry.title}</span></summary><div className="mt-2 flex flex-col gap-2 text-muted-foreground">{entry.paragraphs.map((text, index) => <p key={index}>{text}</p>)}<Link className={linkClass} href={entry.href} onClick={onClose}>가이드에서 보기 ›</Link>{entry.links.map(link => <Link className={linkClass} href={link.href} key={link.href} onClick={onClose}>{link.label} ›</Link>)}</div></details>)}</div>{help.total > help.entries.length ? <p className="text-xs text-muted-foreground">상위 {help.entries.length}개를 표시합니다. 검색어를 구체적으로 입력해주세요.</p> : null}</> : null}
      </> : null}
      {loading ? <p role="status" className="py-6 text-center text-muted-foreground">불러오는 중입니다.</p> : null}
    </div>
  </section>;
}
