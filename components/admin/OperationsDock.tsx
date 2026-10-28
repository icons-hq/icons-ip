'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { allowedAdminAlertCategories, type AdminAlertPage } from '@/lib/admin/operations-dock';
import { hasAdminCapability, type OperatorAccess } from '@/lib/admin/access';

const Panel = dynamic(() => import('./OperationsDockPanel').then(module => module.OperationsDockPanel), { ssr: false });
export type OperationsDockSection = 'alerts' | 'tasks' | 'help';
const tools = [{ id: 'alerts', label: '알림', icon: 'bell' }, { id: 'tasks', label: '할 일', icon: 'check' }, { id: 'help', label: '도움말', icon: 'help' }] as const;

export function OperationsDock({ accountId, access, inquiryNotifications = false }: {
  accountId: string; access?: OperatorAccess;
  /** 커머스 콘솔 cs.manage 운영자에게 '알림' 패널 안 '새 1:1 문의 PC 알림' 켜기·끄기를 보인다(R2). */
  inquiryNotifications?: boolean;
}) {
  const pathname = usePathname();
  const [section, setSection] = useState<OperationsDockSection | null>(null);
  const [badge, setBadge] = useState<number | null>(null);
  const [badgeEnabled, setBadgeEnabled] = useState(true);
  const buttonRefs = useRef<Partial<Record<OperationsDockSection, HTMLButtonElement | null>>>({});
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const response = await fetch('/api/admin/operations-dock?section=alerts', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('unavailable');
        const page = await response.json() as AdminAlertPage;
        setBadge(page.unreadCount); setBadgeEnabled(page.badgeEnabled);
      } catch { if (!controller.signal.aborted) setBadge(null); }
    };
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 60000);
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, [accountId, access?.revision]);
  function close() { if (section) buttonRefs.current[section]?.focus(); setSection(null); }
  useEffect(() => {
    if (!section) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { buttonRefs.current[section]?.focus(); setSection(null); } };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, [section]);
  return <>
    <aside className="admin-operations-rail" aria-label="판매자 업무 도구">
      {tools.map(tool => <button key={tool.id} ref={element => { buttonRefs.current[tool.id] = element; }} type="button" aria-label={tool.id === 'alerts' && badgeEnabled && badge ? `알림 ${badge}건` : tool.label} aria-expanded={section === tool.id} aria-controls="admin-operations-panel" onClick={() => setSection(section === tool.id ? null : tool.id)}>
        <span className={`admin-operations-rail-icon admin-operations-rail-icon-${tool.id}`}><Icon name={tool.icon} size={23} /></span><span>{tool.label}</span>
        {tool.id === 'alerts' && badgeEnabled && badge !== null && badge > 0 ? <b>{badge > 99 ? '99+' : badge}</b> : null}
      </button>)}
      {hasAdminCapability(access, 'cs.manage') ? <Link href="/admin/cs/chat" aria-current={pathname === '/admin/cs/chat' ? 'page' : undefined}>
        <span className="admin-operations-rail-icon admin-operations-rail-icon-chat"><Icon name="chat" size={23} /></span><span>상담하기</span>
      </Link> : null}
    </aside>
    {section ? <Panel key={`${accountId}:${access?.revision}:${section}`} section={section} pathname={pathname} categories={allowedAdminAlertCategories(access)} inquiryNotificationAccountId={inquiryNotifications && accountId ? accountId : undefined} onClose={close} onAlertRead={page => { setBadge(page.unreadCount); setBadgeEnabled(page.badgeEnabled); }} /> : null}
  </>;
}
