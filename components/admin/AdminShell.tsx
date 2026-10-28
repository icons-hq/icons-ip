'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ADMIN_CONSOLES, adminConsoleHomeHref, adminGroupConsoles, adminGroupForPath, adminScreenForPath, type AdminConsoleId } from '@/lib/admin/navigation';
import { AdminSidebar } from './AdminSidebar';
import { Header } from './Header';
import { AdminPreferencesProvider } from './console/AdminPreferences';
import { OperationsDock } from './OperationsDock';
import { AdminInquiryNotifier } from './AdminInquiryNotifier';
import { AdminNumberWheelGuard } from './AdminNumberWheelGuard';
import { hasAdminCapability, NO_OPERATOR_ACCESS, type OperatorAccess } from '@/lib/admin/access';

export function AdminShell({
  admin,
  children,
  console: consoleId = 'commerce',
}: {
  admin: { id: string; email: string | null; role: string; operatorAccess?: OperatorAccess };
  children: ReactNode;
  /** 이 셸을 그리는 route group의 콘솔. 사이드바 메뉴와 상단 전환 상태를 정한다. */
  console?: AdminConsoleId;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const currentPath = search ? `${pathname}?${search}` : pathname;
  const [collapsed, setCollapsed] = useState(false);
  const screen = adminScreenForPath(currentPath);
  const group = adminGroupForPath(currentPath);
  const isChat = screen?.id === 'inquiry-chat';
  const access = admin.operatorAccess ?? NO_OPERATOR_ACCESS;
  /* R2(D2①): 새 1:1 문의 PC 알림은 커머스 콘솔의 문의 담당(cs.manage)에게만. 켜고 끄기는 업무 도구 '알림'에 둔다. */
  const inquiryNotifications = consoleId === 'commerce' && Boolean(admin.id) && hasAdminCapability(access, 'cs.manage');
  /* 전환 링크는 그 콘솔에서 볼 수 있는 화면이 있을 때만 만든다. */
  const consoles = ADMIN_CONSOLES.map((item) => ({ ...item, href: adminConsoleHomeHref(item.id, admin.role, access) }))
    .filter((item): item is typeof item & { href: string } => Boolean(item.href));
  const consoleLinks = consoles.length > 1 ? consoles.map((item) => ({ ...item, current: item.id === consoleId })) : [];
  /* 콘텐츠 콘솔은 경로 첫 칸이 콘솔 이름이라, 그 콘솔 전용 메뉴 그룹(IP·콘텐츠 운영)을 다시 적지 않는다. */
  const groupLabel = group && consoleId !== 'commerce' && adminGroupConsoles(group).every((id) => id === consoleId) ? undefined : group?.label;
  const title = pathname === '/admin/catalog/goods' && searchParams.get('create') !== '1' && searchParams.get('goodId')
    ? '상품 수정' : screen?.label ?? '판매자센터';

  return (
    <AdminPreferencesProvider accountId={admin.id || admin.email || admin.role}>
    <div className={`admin-shell wc-root wc-admin${collapsed ? ' collapsed' : ''}${isChat ? ' admin-shell--chat' : ''}`} data-admin-console={consoleId}>
      <AdminSidebar
        accountId={admin.id || admin.email || admin.role}
        currentPath={currentPath}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        role={admin.role}
        operatorAccess={access}
        console={consoleId}
        homeHref={consoles.find((item) => item.id === consoleId)?.href ?? '/admin'}
      />
      <div className="wc-admin__main">
        <Header admin={admin} next={currentPath} title={title} groupLabel={groupLabel} immersive={isChat} consoles={consoleLinks}
          root={consoleId === 'content' ? { label: '콘텐츠 운영', href: consoles.find((item) => item.id === 'content')?.href ?? '/admin' } : undefined} />
        <main className="admin-content">
          {/* key로 화면 전환마다 진입 애니메이션을 다시 태운다 */}
          <div key={pathname} className="rise">
            {children}
          </div>
        </main>
      </div>
      <OperationsDock accountId={admin.id} access={admin.operatorAccess} inquiryNotifications={inquiryNotifications} />
      {inquiryNotifications ? <AdminInquiryNotifier accountId={admin.id} /> : null}
      {/* R18: 포커스된 어드민 number 입력 위의 휠은 값을 바꾸지 않고 페이지만 스크롤한다(셸에 한 번). */}
      <AdminNumberWheelGuard />
    </div>
    </AdminPreferencesProvider>
  );
}
