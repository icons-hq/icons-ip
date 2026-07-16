'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOutAction } from '@/app/login/actions';
import { nextPathWithSearch } from '@/lib/auth/onboarding';
import { hrefFor, isActive } from '@/lib/routes';
import { useAuthPresence } from './AuthPresenceProvider';
import { useCart } from './CartProvider';

export function AuthButton() {
  const router = useRouter();
  const pathname = usePathname();
  const { resetForSignOut } = useCart();
  const presence = useAuthPresence();

  const loginHref = () =>
    `/login?next=${encodeURIComponent(
      nextPathWithSearch(window.location.pathname, new URLSearchParams(window.location.search)),
    )}`;

  if (presence === 'unknown') {
    return <span aria-hidden className="auth-presence-placeholder" />;
  }

  if (presence === 'signed-in') {
    const myActive = isActive('my', pathname);
    return (
      <>
        <Link
          aria-current={myActive ? 'page' : undefined}
          className={`account-my-link btn btn-ghost btn-sm${myActive ? ' active' : ''}`}
          href={hrefFor('my')}
        >
          마이
        </Link>
        <form action={signOutAction} onSubmit={resetForSignOut}>
          <button className="btn btn-ghost btn-sm">로그아웃</button>
        </form>
      </>
    );
  }

  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => router.push(loginHref())}>
        로그인
      </button>
      <button className="btn btn-holo btn-sm" onClick={() => router.push(loginHref())}>
        시작하기
      </button>
    </>
  );
}
