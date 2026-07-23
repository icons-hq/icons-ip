'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS, hrefFor, isActive, isAuthShellPath } from '@/lib/routes';
import { Icon } from '@/components/ui/Icon';
import { useCart } from './CartProvider';
import { useGo } from './useGo';
import { AuthButton } from './AuthButton';
import { NotificationBell } from './NotificationBell';

export function shouldHideEditorialHeader({
  currentY,
  previousY,
  hidden,
}: {
  currentY: number;
  previousY: number;
  hidden: boolean;
}) {
  if (currentY <= 80) return false;
  const delta = currentY - previousY;
  if (delta > 12) return true;
  if (delta < -12) return false;
  return hidden;
}

export function closeEditorialMenu(pathname: string) {
  return { open: false, pathname };
}

const SECONDARY_LINKS = [
  { href: hrefFor('search'), label: '통합 검색' },
  { href: hrefFor('cart'), label: '장바구니' },
  { href: hrefFor('my'), label: '마이페이지' },
  { href: hrefFor('notifications'), label: '알림함' },
  { href: hrefFor('binder'), label: '내 바인더' },
  { href: hrefFor('tickets'), label: '내 티켓' },
  { href: hrefFor('market'), label: '굿즈 마켓' },
  { href: hrefFor('exchange'), label: '카드 교환' },
];

export function Nav() {
  const pathname = usePathname();
  const go = useGo();
  const { count } = useCart();
  const [menuState, setMenuState] = useState({ open: false, pathname });
  const menuOpen = menuState.pathname === pathname && menuState.open;
  const [headerHidden, setHeaderHidden] = useState(false);
  const scrollAnchorRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => setMenuState(closeEditorialMenu(pathname));

  useEffect(() => {
    const onScroll = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const currentY = window.scrollY;
        const previousY = scrollAnchorRef.current;
        setHeaderHidden((hidden) => {
          const next = menuOpen
            ? false
            : shouldHideEditorialHeader({ currentY, previousY, hidden });
          if (currentY <= 80 || Math.abs(currentY - previousY) > 12) {
            scrollAnchorRef.current = currentY;
          }
          return next;
        });
      });
    };

    scrollAnchorRef.current = window.scrollY;
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menuButton = menuButtonRef.current;
    const backgroundElements = [
      document.getElementById('root'),
      document.querySelector<HTMLElement>('.site-footer-editorial'),
    ].filter((element): element is HTMLElement => Boolean(element));
    const previousInert = backgroundElements.map((element) => element.inert);
    document.body.style.overflow = 'hidden';
    backgroundElements.forEach((element) => {
      element.inert = true;
    });

    const getFocusable = () => [
      menuButton,
      ...Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ),
    ].filter((element): element is HTMLElement => Boolean(element));

    const focusables = getFocusable();
    focusables[1]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuState(closeEditorialMenu(pathname));
        return;
      }
      if (event.key !== 'Tab') return;

      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      backgroundElements.forEach((element, index) => {
        element.inert = previousInert[index];
      });
      (previousFocus ?? menuButton)?.focus();
    };
  }, [menuOpen, pathname]);

  // 게임은 자기완결 번들, 어드민은 자체 작업대, 인증은 집중형 셸을 사용한다.
  if (pathname === '/' || isAuthShellPath(pathname) || pathname.startsWith('/games') || pathname.startsWith('/admin')) return null;

  return (
    <div
      aria-label={menuOpen ? '전체 메뉴' : undefined}
      aria-modal={menuOpen ? true : undefined}
      className="editorial-shell"
      role={menuOpen ? 'dialog' : undefined}
    >
      <header
        className="editorial-header"
        data-hidden={headerHidden ? 'true' : 'false'}
        data-menu-open={menuOpen ? 'true' : 'false'}
        onFocusCapture={() => setHeaderHidden(false)}
      >
        <div className="editorial-header__capsule">
          <Link className="editorial-header__brand" href="/" aria-label="ICONS 홈" inert={menuOpen ? true : undefined}>
            <span>ICONS</span>
          </Link>

          <nav aria-label="주요 내비게이션" className="editorial-header__nav" inert={menuOpen ? true : undefined}>
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.id, pathname);
              return (
                <Link
                  key={item.id}
                  aria-current={active ? 'page' : undefined}
                  href={hrefFor(item.id)}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="editorial-header__actions">
            <div className="editorial-header__utility" inert={menuOpen ? true : undefined}>
              <button className="icon-btn" onClick={() => go('search')} title="검색" aria-label="검색">
                <Icon name="search" />
              </button>
              <NotificationBell />
              <Link
                aria-current={isActive('cart', pathname) ? 'page' : undefined}
                className={`icon-btn${isActive('cart', pathname) ? ' active' : ''}`}
                href={hrefFor('cart')}
                title="장바구니"
                aria-label={`장바구니${count > 0 ? `, ${count}개` : ''}`}
              >
                <Icon name="bag" />
                {count > 0 && <span className="badge" aria-hidden>{count}</span>}
              </Link>
              <AuthButton />
            </div>
            <button
              ref={menuButtonRef}
              aria-controls="editorial-global-menu"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? '전체 메뉴 닫기' : '전체 메뉴 열기'}
              className="editorial-menu-trigger"
              onClick={() => {
                setHeaderHidden(false);
                setMenuState({ open: !menuOpen, pathname });
              }}
              type="button"
            >
              <span aria-hidden className="editorial-menu-trigger__lines" />
            </button>
          </div>
        </div>
      </header>

      <div
        ref={menuRef}
        aria-hidden={!menuOpen}
        className="editorial-menu"
        data-open={menuOpen ? 'true' : 'false'}
        id="editorial-global-menu"
        inert={menuOpen ? undefined : true}
      >
        <div className="editorial-menu__inner">
          <nav aria-label="전체 메뉴" className="editorial-menu__primary">
            {NAV_ITEMS.map((item, index) => (
              <Link
                key={item.id}
                aria-current={isActive(item.id, pathname) ? 'page' : undefined}
                data-close-menu="true"
                href={hrefFor(item.id)}
                onClick={closeMenu}
                tabIndex={menuOpen ? undefined : -1}
              >
                <span className="editorial-menu__index">{String(index + 1).padStart(2, '0')}</span>
                <span className="editorial-menu__label">{item.label}</span>
                <span aria-hidden className="editorial-menu__arrow">→</span>
              </Link>
            ))}
          </nav>

          <div className="editorial-menu__secondary">
            <p className="editorial-menu__meta">
              최애를 고르는 순간 굿즈, 카드, 팝업, 커뮤니티가 하나의 세계로 이어집니다.
            </p>
            <nav aria-label="보조 메뉴" className="editorial-menu__secondary-group">
              {SECONDARY_LINKS.map((item) => (
                <Link
                  key={item.href}
                  data-close-menu="true"
                  href={item.href}
                  onClick={closeMenu}
                  tabIndex={menuOpen ? undefined : -1}
                >
                  {item.label} ↗
                </Link>
              ))}
            </nav>
            <div
              className="editorial-menu__secondary-group editorial-menu__account"
              data-close-menu="true"
              onClick={closeMenu}
              onSubmitCapture={closeMenu}
            >
              <AuthButton />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
