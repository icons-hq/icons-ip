'use client';

import { Fragment, useActionState, useRef, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, BookOpen, Check, ChevronsUpDown, ExternalLink, LogOut } from 'lucide-react';
import { adminSignOutAction, type SignOutActionState } from '@/app/login/actions';
import { MANAGER_ROLE_LABELS, type OperatorAccess } from '@/lib/admin/access';
import { clearInquiryDraftsForSignOut } from '@/lib/admin/inquiry-draft-lifecycle';
import { confirmAdminLeave } from '@/lib/admin/leave-guard';
import { Avatar, AvatarFallback } from '@/components/admin/kit/ui/avatar';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/admin/kit/ui/breadcrumb';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/admin/kit/ui/dropdown-menu';
import { Separator } from '@/components/admin/kit/ui/separator';
import { SidebarTrigger, useSidebar } from '@/components/admin/kit/ui/sidebar';
import { ADMIN_NAVIGATION_ID } from './AdminSidebar';

const emptySignOutState: SignOutActionState = {};

function preserveCurrentAdminPath(event: FormEvent<HTMLFormElement>, fallback: string) {
  const nextInput = event.currentTarget.elements.namedItem('next');
  if (!(nextInput instanceof HTMLInputElement)) return;

  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  nextInput.value = currentPath === '/admin' || currentPath.startsWith('/admin/') ? currentPath : fallback;
}

/** 사이드바 버튼. 데스크톱은 아이콘 막대로 접고 펴며, 모바일은 메뉴 시트를 연다. */
function NavigationToggle() {
  const { isMobile, open, openMobile } = useSidebar();
  const expanded = isMobile ? openMobile : open;
  const label = isMobile ? (openMobile ? '메뉴 닫기' : '메뉴 열기') : (open ? '사이드바 접기' : '사이드바 펼치기');
  return <SidebarTrigger aria-controls={ADMIN_NAVIGATION_ID} aria-expanded={expanded} aria-label={label} className="-ml-1" title={label} />;
}

/**
 * 어드민 상단 막대(템플릿 룩, ADR-0028). 사이드바 버튼 · 현재 위치 · 콘솔 전환 · 바로가기 · 계정 메뉴.
 * 화면 제목(h1)은 본문 첫 줄이 그린다(AdminShell).
 */
export function Header({
  admin,
  next,
  title,
  groupLabel,
  consoles = [],
  root,
  tools,
}: {
  admin: { email: string | null; role: string; operatorAccess?: OperatorAccess };
  next: string;
  title: string;
  groupLabel?: string;
  /** 쇼핑·카드·게임 칸 전환(D9, 1014-074). 볼 수 있는 칸이 둘 이상일 때만 그린다. 쇼핑 밖 칸은 `target` 이름의 새 창으로 열린다. */
  consoles?: { id: string; label: string; href: string; current: boolean; newWindow?: boolean; target?: string }[];
  /** 경로 표시의 첫 칸. 기본은 판매자센터 홈이다. */
  root?: { label: string; href: string };
  /** 판매자 업무 도구(알림·할 일·도움말·상담하기) 버튼 묶음. */
  tools?: ReactNode;
}) {
  const [signOutState, signOutFormAction, signOutPending] = useActionState(adminSignOutAction, emptySignOutState);
  const signOutFormRef = useRef<HTMLFormElement>(null);
  const email = admin.email ?? 'staff';
  const initial = email.charAt(0).toUpperCase();
  const roleLabel = admin.operatorAccess?.managerRole ? MANAGER_ROLE_LABELS[admin.operatorAccess.managerRole]
    : admin.role === 'admin' ? '관리자' : '운영자';
  const rootLabel = root?.label ?? '홈';
  const crumbs = [
    ...(groupLabel && groupLabel !== '홈' && groupLabel !== root?.label ? [groupLabel] : []),
    ...(title !== '홈' ? [title] : []),
  ];

  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:rounded-t-xl md:px-4 print:hidden" data-admin-header="">
      <NavigationToggle />
      <Separator className="mr-1 data-vertical:self-center data-[orientation=vertical]:h-4" orientation="vertical" />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem className={crumbs.length ? 'max-sm:hidden' : undefined}>
            {crumbs.length ? <BreadcrumbLink render={<Link href={root?.href ?? '/admin'} prefetch={false} />}>{rootLabel}</BreadcrumbLink> : <BreadcrumbPage>{rootLabel}</BreadcrumbPage>}
          </BreadcrumbItem>
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <Fragment key={`${index}-${crumb}`}>
                {/* 구분자는 앞 칸과 함께 숨는다 — 첫 구분자는 루트(640px 아래), 나머지는 가운데 칸(768px 아래)을 따른다. */}
                <BreadcrumbSeparator className={index === 0 ? 'max-sm:hidden' : 'max-md:hidden'} />
                <BreadcrumbItem className={last ? 'min-w-0' : 'whitespace-nowrap max-md:hidden'}>
                  {last ? <BreadcrumbPage className="truncate">{crumb}</BreadcrumbPage> : <span>{crumb}</span>}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {consoles.length > 1 ? (
          <nav aria-label="콘솔 전환" className="hidden items-center rounded-lg bg-muted p-0.5 sm:flex">
            {consoles.map((item) => (
              <Link
                aria-current={item.current ? 'page' : undefined}
                className="inline-flex h-7 items-center rounded-md px-2.5 text-[0.8rem] font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm"
                data-admin-console-link={item.id}
                href={item.href}
                key={item.id}
                prefetch={false}
                target={item.target}
              >
                {item.label}
                {item.target ? <span className="sr-only"> (새 창)</span> : null}
              </Link>
            ))}
          </nav>
        ) : null}
        <nav aria-label="판매자 바로가기" className="hidden items-center gap-1 lg:flex">
          <Link className={buttonVariants({ variant: 'ghost', size: 'sm' })} href="/admin/guide" prefetch={false}>
            <BookOpen aria-hidden="true" />
            사용 가이드
          </Link>
          <Link className={buttonVariants({ variant: 'ghost', size: 'sm' })} href="/" prefetch={false} rel="noopener noreferrer" target="_blank">
            쇼핑몰 바로가기
            <ExternalLink aria-hidden="true" />
          </Link>
        </nav>
        {tools}
        <Separator className="mx-1 data-vertical:self-center data-[orientation=vertical]:h-4" orientation="vertical" />
        <form
          action={signOutFormAction}
          className="hidden"
          onSubmit={(event) => { clearInquiryDraftsForSignOut(); preserveCurrentAdminPath(event, next); }}
          ref={signOutFormRef}
        >
          <input name="next" type="hidden" value={next} />
        </form>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`${email} 계정 메뉴`}
            className="flex h-9 items-center gap-2 rounded-lg px-1.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:bg-muted"
          >
            <Avatar className="size-7 rounded-lg">
              <AvatarFallback className="rounded-lg text-xs font-semibold">{initial}</AvatarFallback>
            </Avatar>
            <span className="hidden max-w-48 min-w-0 flex-col leading-tight 2xl:flex">
              <span className="truncate text-sm font-medium">{email}</span>
              <span className="truncate text-xs text-muted-foreground">{roleLabel}</span>
            </span>
            <ChevronsUpDown aria-hidden="true" className="hidden size-4 text-muted-foreground 2xl:block" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
                <span className="text-xs text-muted-foreground">현재 계정</span>
                <span className="truncate text-sm font-medium text-foreground">{email}</span>
                <span className="text-xs text-muted-foreground">권한 · {roleLabel}</span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {/* 640px 아래에서는 상단 막대의 콘솔 전환이 숨으므로, 쇼핑·카드·게임 전환을 계정 메뉴로 옮긴다. */}
            {consoles.length > 1 ? (
              <DropdownMenuGroup className="sm:hidden">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">콘솔 전환</DropdownMenuLabel>
                {consoles.map((item) => (
                  <DropdownMenuItem aria-current={item.current ? 'page' : undefined} key={item.id} render={<Link href={item.href} prefetch={false} target={item.target} />}>
                    <ArrowLeftRight />
                    {item.label}
                    {item.target ? <span className="sr-only"> (새 창)</span> : null}
                    {item.current ? <Check className="ml-auto" /> : null}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </DropdownMenuGroup>
            ) : null}
            <DropdownMenuGroup className="md:hidden">
              <DropdownMenuItem render={<Link href="/admin/guide" prefetch={false} />}><BookOpen />사용 가이드</DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/" prefetch={false} rel="noopener noreferrer" target="_blank" />}><ExternalLink />쇼핑몰 바로가기</DropdownMenuItem>
              <DropdownMenuSeparator />
            </DropdownMenuGroup>
            <DropdownMenuItem disabled={signOutPending} onClick={() => { void confirmAdminLeave().then((leave) => { if (leave) signOutFormRef.current?.requestSubmit(); }); }}>
              <LogOut />
              {signOutPending ? '로그아웃 중…' : '로그아웃'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {signOutState.errors?.form ? (
        <p className="absolute top-full right-3 mt-1 rounded-md border border-destructive/30 bg-background px-2 py-1 text-xs text-destructive shadow-sm" role="alert">
          {signOutState.errors.form}
        </p>
      ) : null}
    </header>
  );
}
