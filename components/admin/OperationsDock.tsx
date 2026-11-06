'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Bell, CircleHelp, ListTodo, MessagesSquare } from 'lucide-react';
import { allowedAdminAlertCategories, type AdminAlertPage } from '@/lib/admin/operations-dock';
import { hasAdminCapability, type OperatorAccess } from '@/lib/admin/access';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Sheet, SheetContent } from '@/components/admin/kit/ui/sheet';

const Panel = dynamic(() => import('./OperationsDockPanel').then(module => module.OperationsDockPanel), { ssr: false });
export type OperationsDockSection = 'alerts' | 'tasks' | 'help';
const tools = [
  { id: 'alerts', label: '알림', Icon: Bell },
  { id: 'tasks', label: '할 일', Icon: ListTodo },
  { id: 'help', label: '도움말', Icon: CircleHelp },
] as const;

/*
 * 판매자 업무 도구(알림·할 일·도움말·상담하기). 상단 막대의 아이콘 버튼으로 열고, 내용은 오른쪽 시트에
 * 그린다(ADR-0028 템플릿 룩). 알림 배지는 1분마다·탭으로 돌아올 때 다시 센다.
 */
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
  const showBadge = badgeEnabled && badge !== null && badge > 0;
  return <>
    <div aria-label="판매자 업무 도구" className="flex items-center gap-0.5" role="group">
      {tools.map(({ id, label, Icon }) => <Button
        aria-controls="admin-operations-panel"
        aria-expanded={section === id}
        aria-label={id === 'alerts' && badgeEnabled && badge ? `알림 ${badge}건` : label}
        className="relative"
        key={id}
        onClick={() => setSection(section === id ? null : id)}
        ref={element => { buttonRefs.current[id] = element; }}
        size="icon-sm"
        title={label}
        type="button"
        variant="ghost"
      >
        <Icon aria-hidden="true" />
        {id === 'alerts' && showBadge ? <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white tabular-nums">{badge > 99 ? '99+' : badge}</span> : null}
      </Button>)}
      {hasAdminCapability(access, 'cs.manage') ? <Link
        aria-current={pathname === '/admin/cs/chat' ? 'page' : undefined}
        aria-label="상담하기"
        className={`${buttonVariants({ variant: 'ghost', size: 'icon-sm' })} aria-[current=page]:bg-muted`}
        href="/admin/cs/chat"
        title="상담하기"
      >
        <MessagesSquare aria-hidden="true" />
      </Link> : null}
    </div>
    <Sheet onOpenChange={(open) => { if (!open) close(); }} open={section !== null}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md" showCloseButton={false} side="right">
        {section ? <Panel key={`${accountId}:${access?.revision}:${section}`} section={section} pathname={pathname} categories={allowedAdminAlertCategories(access)} inquiryNotificationAccountId={inquiryNotifications && accountId ? accountId : undefined} onClose={close} onAlertRead={page => { setBadge(page.unreadCount); setBadgeEnabled(page.badgeEnabled); }} /> : null}
      </SheetContent>
    </Sheet>
  </>;
}
