'use client';

import { useActionState, useState, type FormEvent } from 'react';
import { adminSignOutAction, type SignOutActionState } from '@/app/login/actions';

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
}: {
  admin: { email: string | null; role: string };
  next: string;
  title: string;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [signOutState, signOutFormAction, signOutPending] = useActionState(adminSignOutAction, emptySignOutState);
  const initial = (admin.email ?? 'staff').charAt(0).toUpperCase();
  const accountMenuId = 'admin-account-menu';

  return (
    <header className="wc-admin__header">
      <h1 className="wc-admin__title">{title}</h1>
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
            <span className="wc-admin__role">{admin.role}</span>
          </span>
          <span aria-hidden className="wc-admin__avatar">{initial}</span>
        </button>
        <div className="wc-admin__account-menu" hidden={!accountOpen} id={accountMenuId}>
          <div className="wc-admin__account-summary">
            <span className="wc-admin__account-label">현재 계정</span>
            <strong className="wc-admin__account-email">{admin.email ?? 'staff'}</strong>
            <span className="wc-admin__account-role">역할 · {admin.role}</span>
          </div>
          <form action={signOutFormAction} className="wc-admin__account-form" onSubmit={(event) => preserveCurrentAdminPath(event, next)}>
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
  );
}
