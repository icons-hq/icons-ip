'use client';

import { useActionState, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { adminSignOutAction, type SignOutActionState } from '@/app/login/actions';
import { MANAGER_ROLE_LABELS, type OperatorAccess } from '@/lib/admin/access';
import { clearInquiryDraftsForSignOut } from '@/lib/admin/inquiry-draft-lifecycle';

const emptySignOutState: SignOutActionState = {};

function preserveCurrentAdminPath(event: FormEvent<HTMLFormElement>, fallback: string) {
  const nextInput = event.currentTarget.elements.namedItem('next');
  if (!(nextInput instanceof HTMLInputElement)) return;

  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  nextInput.value = currentPath === '/admin' || currentPath.startsWith('/admin/') ? currentPath : fallback;
}

export function Header({
  admin,
  next,
  title,
  groupLabel,
  immersive = false,
}: {
  admin: { email: string | null; role: string; operatorAccess?: OperatorAccess };
  next: string;
  title: string;
  groupLabel?: string;
  immersive?: boolean;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [signOutState, signOutFormAction, signOutPending] = useActionState(adminSignOutAction, emptySignOutState);
  const initial = (admin.email ?? 'staff').charAt(0).toUpperCase();
  const roleLabel = admin.operatorAccess?.managerRole ? MANAGER_ROLE_LABELS[admin.operatorAccess.managerRole]
    : admin.role === 'admin' ? '관리자' : '운영자';
  const accountMenuId = 'admin-account-menu';

  return (
    <>
    <header className="wc-admin__header">
      <div className="wc-admin__header-start">
        <Link aria-label="ICONS 판매자센터 홈" className="wc-admin__top-brand" href="/admin">
          <strong>ICONS</strong><span>판매자센터</span>
        </Link>
        <nav aria-label="판매자 바로가기" className="wc-admin__header-links">
          <Link href="/admin/guide">판매자 가이드</Link>
          <Link href="/" target="_blank" rel="noopener noreferrer">쇼핑몰 바로가기 ↗</Link>
        </nav>
      </div>
      <div className="wc-admin__identity">
        <button
          aria-label={`${admin.email ?? 'staff'} 계정 메뉴`}
          aria-controls={accountMenuId}
          aria-expanded={accountOpen}
          className="wc-admin__account-trigger"
          onClick={() => setAccountOpen((open) => !open)}
          type="button"
        >
          <span className="wc-admin__identity-text">
            <span className="wc-admin__email">{admin.email ?? 'staff'}</span>
            <span className="wc-admin__role">{roleLabel}</span>
          </span>
          <span aria-hidden className="wc-admin__avatar">{initial}</span>
        </button>
        <div className="wc-admin__account-menu" hidden={!accountOpen} id={accountMenuId}>
          <div className="wc-admin__account-summary">
            <span className="wc-admin__account-label">현재 계정</span>
            <strong className="wc-admin__account-email">{admin.email ?? 'staff'}</strong>
            <span className="wc-admin__account-role">권한 · {roleLabel}</span>
          </div>
          <form action={signOutFormAction} className="wc-admin__account-form" onSubmit={(event) => { clearInquiryDraftsForSignOut(); preserveCurrentAdminPath(event, next); }}>
            <input name="next" type="hidden" value={next} />
            <button className="wc-admin__account-logout" disabled={signOutPending} type="submit">
              {signOutPending ? '로그아웃 중…' : '로그아웃'}
            </button>
          </form>
          {signOutState.errors?.form && (
            <p className="wc-admin__account-error" role="alert">
              {signOutState.errors.form}
            </p>
          )}
        </div>
      </div>
    </header>
    {immersive || next.split('?')[0] === '/admin' ? <h1 className="sr-only">{title}</h1> : <div className="wc-admin__page-context">
      <h1 className="wc-admin__title">{title}</h1>
      <nav aria-label="현재 위치" className="wc-admin__breadcrumb">
        <Link href="/admin">홈</Link>
        {groupLabel && groupLabel !== '홈' ? <><span aria-hidden="true">›</span><span>{groupLabel}</span></> : null}
        {title !== '홈' ? <><span aria-hidden="true">›</span><span aria-current="page">{title}</span></> : null}
      </nav>
    </div>}
    </>
  );
}
