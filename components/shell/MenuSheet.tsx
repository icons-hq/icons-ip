'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { signOutAction } from '@/app/login/actions';
import { nextPathWithSearch } from '@/lib/auth/onboarding';
import { MENU_SHEET_GROUPS, hrefFor } from '@/lib/routes';
import { Icon } from '@/components/ui/Icon';
import { useAuthPresence } from './AuthPresenceProvider';
import { useCart } from './CartProvider';
import { useOverlayA11y } from './useOverlayA11y';

/* 모바일 전체 메뉴 시트. 바텀바의 '메뉴' 탭과 모바일 GNB의 '카테고리' 탭이 같은 시트를 연다.
   그룹 제목과 항목은 lib/routes.ts의 MENU_SHEET_GROUPS 하나에서만 온다. */
export function MenuSheet({
  open,
  onClose,
  cardRewardsEnabled,
}: {
  open: boolean;
  onClose: () => void;
  cardRewardsEnabled: boolean;
}) {
  const router = useRouter();
  const { resetForSignOut } = useCart();
  const presence = useAuthPresence();
  const panelRef = useRef<HTMLDivElement>(null);

  useOverlayA11y({ open, onClose, panelRef });

  if (!open) return null;

  /* 복귀 경로는 렌더 시점이 아니라 클릭 시점에 window에서 읽는다 — 시트는 라우트 전환에도 살아남으므로
     렌더 시점 pathname을 굳혀 두면 경로가 바뀐 뒤 돌아올 곳이 어긋난다. */
  const loginHref = () =>
    `/login?next=${encodeURIComponent(
      nextPathWithSearch(window.location.pathname, new URLSearchParams(window.location.search)),
    )}`;

  /* 카드 리워드가 꺼져 있으면 카드팩 항목을 빼고, 그래서 비어 버린 그룹은 제목째 지운다. */
  const groups = cardRewardsEnabled
    ? MENU_SHEET_GROUPS
    : MENU_SHEET_GROUPS
        .map((group) => ({ ...group, items: group.items.filter((item) => item.id !== 'packs') }))
        .filter((group) => group.items.length > 0);

  return (
    <>
      <div aria-hidden className="wc-sheet-dim" onClick={onClose} />
      <div ref={panelRef} aria-label="전체 메뉴" aria-modal="true" className="wc-sheet" role="dialog">
        <button aria-label="메뉴 닫기" className="wc-icon-btn wc-sheet__close" onClick={onClose} type="button">
          <Icon name="close" size={24} />
        </button>
        <div className="wc-sheet__inner">
          {groups.map((group) => (
            <section key={group.heading} className="wc-sheet__section">
              <h2 className="wc-sheet__title">{group.heading}</h2>
              <ul className="wc-sheet__links">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <Link className="wc-sheet__link" href={hrefFor(item.id)} onClick={onClose}>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="wc-sheet__auth">
            {presence === 'unknown' && <span aria-hidden className="wc-sheet__auth-placeholder" />}
            {presence === 'signed-in' && (
              <form action={signOutAction} onSubmit={resetForSignOut}>
                <button className="wc-btn" type="submit">로그아웃</button>
              </form>
            )}
            {presence === 'signed-out' && (
              <button className="wc-btn primary" onClick={() => router.push(loginHref())} type="button">로그인</button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
