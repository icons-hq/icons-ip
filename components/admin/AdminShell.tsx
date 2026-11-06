'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { ADMIN_CONSOLES, adminConsoleHomeHref, adminGroupConsoles, adminGroupForPath, adminScreenForPath, type AdminConsoleId } from '@/lib/admin/navigation';
import { SidebarInset, SidebarProvider } from '@/components/admin/kit/ui/sidebar';
import { TooltipProvider } from '@/components/admin/kit/ui/tooltip';
import { AdminSidebar } from './AdminSidebar';
import { Header } from './Header';
import { AdminPreferencesProvider } from './console/AdminPreferences';
import { AdminShellTitleProvider } from './console/admin-shell-title';
import { AdminKitPortalHost } from './kit/portal-container';
import { OperationsDock } from './OperationsDock';
import { AdminInquiryNotifier } from './AdminInquiryNotifier';
import { AdminNumberWheelGuard } from './AdminNumberWheelGuard';
import { hasAdminCapability, NO_OPERATOR_ACCESS, type OperatorAccess } from '@/lib/admin/access';

/*
 * 어드민 셸 — kit Sidebar 대시보드 배치(ADR-0028 ②). 셸 루트(.wc-admin)는 kit 부품이 아니라 콘솔 토큰
 * (admin-kit.css · wc-admin.css)이 여기서 시작해 아래로 이어진다. 사이드바 접힘은 kit의 `sidebar_state`
 * 쿠키에 남고, 레이아웃이 그 값을 `sidebarDefaultOpen`으로 넘겨 첫 화면부터 같은 폭으로 그린다.
 */
export function AdminShell({
  admin,
  children,
  console: consoleId = 'commerce',
  sidebarDefaultOpen = true,
}: {
  admin: { id: string; email: string | null; role: string; operatorAccess?: OperatorAccess };
  children: ReactNode;
  /** 이 셸을 그리는 route group의 콘솔. 사이드바 메뉴와 상단 전환 상태를 정한다. */
  console?: AdminConsoleId;
  /** 지난번 사이드바 접힘 상태(`sidebar_state` 쿠키). */
  sidebarDefaultOpen?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const currentPath = search ? `${pathname}?${search}` : pathname;
  const screen = adminScreenForPath(currentPath);
  const group = adminGroupForPath(currentPath);
  const isChat = screen?.id === 'inquiry-chat';
  const isHome = pathname === '/admin';
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
  const accountId = admin.id || admin.email || admin.role;

  return (
    <AdminPreferencesProvider accountId={accountId}>
    <AdminKitPortalHost>
    <TooltipProvider delay={300}>
    <div className={`admin-shell wc-admin${isChat ? ' admin-shell--chat' : ''}`} data-admin-console={consoleId}>
      <SidebarProvider defaultOpen={sidebarDefaultOpen} style={{ '--sidebar-width': '15.5rem' } as CSSProperties}>
        <AdminSidebar
          accountId={accountId}
          console={consoleId}
          currentPath={currentPath}
          homeHref={consoles.find((item) => item.id === consoleId)?.href ?? '/admin'}
          operatorAccess={access}
          role={admin.role}
        />
        <SidebarInset className={`print:m-0! print:rounded-none! print:shadow-none! ${isChat ? 'h-svh min-h-0 overflow-hidden md:h-[calc(100svh-1rem)] print:h-auto! print:overflow-visible!' : 'min-w-0'}`}>
          <Header
            admin={admin}
            consoles={consoleLinks}
            groupLabel={groupLabel}
            next={currentPath}
            root={consoleId === 'content' ? { label: '콘텐츠 운영', href: consoles.find((item) => item.id === 'content')?.href ?? '/admin' } : undefined}
            title={title}
            tools={<OperationsDock accountId={admin.id} access={admin.operatorAccess} inquiryNotifications={inquiryNotifications} />}
          />
          {/* 본문만 main 랜드마크다(상단 막대는 그 밖의 banner). */}
          <main className={`admin-content flex min-w-0 flex-1 flex-col ${isChat ? 'min-h-0 overflow-hidden print:overflow-visible' : 'gap-4 p-4 md:p-6 print:p-0'}`}>
            {isChat || isHome ? <h1 className="sr-only">{title}</h1> : (
              <div className="admin-page-context flex flex-wrap items-end justify-between gap-2 print:hidden">
                <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
              </div>
            )}
            {/* key로 화면 전환마다 진입 애니메이션을 다시 태운다 */}
            {/* 화면이 여러 덩어리를 나란히 돌려줘도(접이 카드 + 목록 등) 카드 사이 간격은 같다. */}
            <div className={`rise min-w-0${isChat ? ' min-h-0 flex-1' : ' flex flex-col gap-4'}`} key={pathname}>
              {/* 홈·상담처럼 h1을 감춘 화면은 화면 머리가 제목을 보여 준다. */}
              <AdminShellTitleProvider title={isChat || isHome ? '' : title}>{children}</AdminShellTitleProvider>
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
      {inquiryNotifications ? <AdminInquiryNotifier accountId={admin.id} /> : null}
      {/* R18: 포커스된 어드민 number 입력 위의 휠은 값을 바꾸지 않고 페이지만 스크롤한다(셸에 한 번). */}
      <AdminNumberWheelGuard />
    </div>
    </TooltipProvider>
    </AdminKitPortalHost>
    </AdminPreferencesProvider>
  );
}
