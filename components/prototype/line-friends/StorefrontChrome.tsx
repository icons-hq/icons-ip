'use client';

/**
 * THROWAWAY PROTOTYPE: 2026-08-12에 실측한 상거래 chrome이 ICONS 탐색 흐름을 더 명확하게 만드는가?
 * 외부 로고·이미지·카피는 사용하지 않고 ICONS 경로와 용어만 연결한다.
 */

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AuthButton } from '@/components/shell/AuthButton';
import { BusinessInfo } from '@/components/shell/BusinessInfo';
import { LEGAL_DOCUMENT_LABELS, LEGAL_DOCUMENT_SLUGS, legalDocumentHref } from '@/lib/legal/links';
import type { PrototypeVariant } from './variants';

interface StorefrontChromeProps {
  children: ReactNode;
  variant: PrototypeVariant;
  currentPage: 'home' | 'detail';
}

const NAV_ITEMS = [
  { label: '신규', href: '/shop' },
  { label: 'IP', href: '/ip' },
  { label: '굿즈', href: '/shop' },
  { label: '카드', href: '/packs' },
  { label: '팝업', href: '/events' },
  { label: '커뮤니티', href: '/community' },
];

const CATEGORY_COLUMNS = [
  {
    title: 'IP',
    links: [
      { label: '전체 IP', href: '/ip' },
      { label: '캐릭터 IP', href: '/ip' },
      { label: '게임', href: '/ip' },
      { label: '애니메이션', href: '/ip' },
    ],
  },
  {
    title: '굿즈',
    links: [
      { label: '전체 굿즈', href: '/shop' },
      { label: '봉제인형 · 쿠션', href: '/shop' },
      { label: '키링 · 아크릴', href: '/shop' },
      { label: '문구 · 파우치', href: '/shop' },
    ],
  },
  {
    title: '즐기기',
    links: [
      { label: '카드팩', href: '/packs' },
      { label: '팝업', href: '/events' },
      { label: '커뮤니티', href: '/community' },
      { label: '게임', href: '/games' },
    ],
  },
];

const drawerFocusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function withVariant(href: string, variant: PrototypeVariant): string {
  const joiner = href.includes('?') ? '&' : '?';
  return `${href}${joiner}variant=${variant}`;
}

export function StorefrontChrome({
  children,
  variant,
  currentPage,
}: StorefrontChromeProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [headerCompact, setHeaderCompact] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const mobileDrawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const update = () => setHeaderCompact(window.scrollY > 80);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previous = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => {
      mobileDrawerRef.current
        ?.querySelector<HTMLElement>(drawerFocusableSelector)
        ?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileMenuOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = Array.from(
        mobileDrawerRef.current?.querySelectorAll<HTMLElement>(drawerFocusableSelector) ?? [],
      );
      const first = focusables[0];
      const last = focusables.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || !mobileDrawerRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [mobileMenuOpen]);

  const closePanels = () => {
    setCategoryOpen(false);
    setSearchOpen(false);
    setMobileMenuOpen(false);
  };

  return (
    <div className="lfp-shell" data-page={currentPage} data-variant={variant}>
      <a className="lfp-skip" href="#lfp-main">본문으로 바로가기</a>

      <div className="lfp-promo" inert={mobileMenuOpen ? true : undefined}>
        <span>좋아하는 세계의 새 굿즈를 ICONS에서 만나보세요.</span>
        <Link href={withVariant('/shop', variant)}>둘러보기 <span aria-hidden>→</span></Link>
      </div>

      <header className={`lfp-header ${headerCompact ? 'is-compact' : ''}`} inert={mobileMenuOpen ? true : undefined}>
        <div className="lfp-header__utility">
          <span>대한민국 · 한국어</span>
          <nav aria-label="회원 메뉴">
            <span className="lfp-header__auth"><AuthButton /></span>
            <Link href="/cart">장바구니</Link>
          </nav>
        </div>

        <div className="lfp-header__main">
          <button
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? '전체 메뉴 닫기' : '전체 메뉴 열기'}
            className="lfp-header__mobile-menu"
            onClick={() => setMobileMenuOpen((open) => !open)}
            type="button"
          >
            <span /><span /><span />
          </button>
          <Link aria-label="ICONS 홈" className="lfp-wordmark" href={withVariant('/', variant)}>
            ICONS
          </Link>
          <div className="lfp-header__actions">
            <button
              aria-expanded={searchOpen}
              aria-label={searchOpen ? '검색 닫기' : '검색 열기'}
              onClick={() => {
                setCategoryOpen(false);
                setSearchOpen((open) => !open);
              }}
              type="button"
            >
              <span aria-hidden className="lfp-icon-search" />
              <span className="lfp-header__action-label">검색</span>
            </button>
            <Link aria-label="관심 목록" href="/my"><span aria-hidden>♡</span><span className="lfp-header__action-label">관심</span></Link>
            <Link aria-label="장바구니" href="/cart"><span aria-hidden>▢</span><span className="lfp-header__action-label">장바구니</span></Link>
          </div>
        </div>

        <div className="lfp-header__nav-row">
          <nav aria-label="스토어 메뉴" className="lfp-header__nav">
            <button
              aria-expanded={categoryOpen}
              className={categoryOpen ? 'is-active' : undefined}
              onClick={() => {
                setSearchOpen(false);
                setCategoryOpen(true);
              }}
              onMouseEnter={() => setCategoryOpen(true)}
              type="button"
            >
              카테고리 <span aria-hidden>⌄</span>
            </button>
            {NAV_ITEMS.map((item) => (
              <Link
                className={item.label === '굿즈' && currentPage === 'detail' ? 'is-active' : undefined}
                href={withVariant(item.href, variant)}
                key={item.label}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className={`lfp-search-panel ${searchOpen ? 'is-open' : ''}`} inert={!searchOpen ? true : undefined}>
          {/* 기존 공개 검색 화면의 `form[action="/search"]` 전역 레이아웃 선택자와
              충돌하지 않도록 prototype 표식을 action query에 둔다. */}
          <form action="/search?surface=storefront-prototype" className="lfp-search-panel__form" method="get">
            <input name="variant" type="hidden" value={variant} />
            <label htmlFor="lfp-search">ICONS에서 찾기</label>
            <div>
              <input id="lfp-search" name="q" placeholder="IP 또는 굿즈 이름을 입력하세요" ref={searchRef} type="search" />
              <button type="submit">검색</button>
            </div>
          </form>
          <div className="lfp-search-panel__quick">
            <span>빠른 탐색</span>
            <Link href={withVariant('/ip', variant)}>IP</Link>
            <Link href={withVariant('/shop', variant)}>굿즈</Link>
            <Link href={withVariant('/events', variant)}>팝업</Link>
          </div>
        </div>

        <div
          className={`lfp-mega ${categoryOpen ? 'is-open' : ''}`}
          inert={!categoryOpen ? true : undefined}
          onMouseLeave={() => setCategoryOpen(false)}
        >
          <div className="lfp-mega__inner">
            {CATEGORY_COLUMNS.map((column) => (
              <section key={column.title}>
                <h2>{column.title}</h2>
                {column.links.map((item) => (
                  <Link href={withVariant(item.href, variant)} key={item.label} onClick={closePanels}>{item.label}</Link>
                ))}
              </section>
            ))}
            <Link className="lfp-mega__feature" href={withVariant('/ip', variant)} onClick={closePanels}>
              <span>ICONS CURATION</span>
              <strong>좋아하는 IP의<br />새로운 장면</strong>
              <small>전체 IP 보기 →</small>
            </Link>
          </div>
        </div>
      </header>

      <div
        aria-hidden={!searchOpen && !categoryOpen}
        className={`lfp-backdrop ${searchOpen || categoryOpen ? 'is-open' : ''}`}
        onClick={closePanels}
      />

      <aside
        aria-hidden={!mobileMenuOpen}
        aria-label="모바일 전체 메뉴"
        aria-modal={mobileMenuOpen ? true : undefined}
        className={`lfp-mobile-drawer ${mobileMenuOpen ? 'is-open' : ''}`}
        inert={!mobileMenuOpen ? true : undefined}
        ref={mobileDrawerRef}
        role={mobileMenuOpen ? 'dialog' : undefined}
      >
        <div className="lfp-mobile-drawer__top">
          <strong>MENU</strong>
          <button aria-label="메뉴 닫기" onClick={() => setMobileMenuOpen(false)} type="button">×</button>
        </div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <Link href={withVariant(item.href, variant)} key={item.label} onClick={closePanels}>
              {item.label}<span aria-hidden>→</span>
            </Link>
          ))}
        </nav>
        <div className="lfp-mobile-drawer__account">
          <AuthButton />
        </div>
      </aside>

      <main id="lfp-main" inert={mobileMenuOpen ? true : undefined}>{children}</main>

      <footer className="lfp-footer" inert={mobileMenuOpen ? true : undefined}>
        <div className="lfp-footer__lead">
          <Link className="lfp-wordmark" href={withVariant('/', variant)}>ICONS</Link>
          <p>좋아하는 세계를 발견하고, 굿즈와 카드, 팝업으로 이어가는 팬덤 플랫폼.</p>
        </div>
        <div className="lfp-footer__links">
          <section><h2>둘러보기</h2><Link href={withVariant('/ip', variant)}>IP</Link><Link href={withVariant('/shop', variant)}>굿즈</Link><Link href={withVariant('/events', variant)}>팝업</Link></section>
          <section>
            <h2>고객지원</h2>
            {LEGAL_DOCUMENT_SLUGS.map((slug) => (
              <Link href={legalDocumentHref(slug)} key={slug}>{LEGAL_DOCUMENT_LABELS[slug]}</Link>
            ))}
          </section>
          <section><h2>함께하기</h2><Link href={withVariant('/community', variant)}>커뮤니티</Link><Link href="/my">MY</Link><Link href="/cart">장바구니</Link></section>
        </div>
        <BusinessInfo />
        <div className="lfp-footer__bottom"><span>© ICONS</span><span>SEOUL · 2026</span></div>
      </footer>

      <nav aria-label="모바일 빠른 메뉴" className="lfp-mobile-tabs" inert={mobileMenuOpen ? true : undefined}>
        <button aria-label="전체 메뉴" onClick={() => setMobileMenuOpen(true)} type="button"><span aria-hidden>☰</span>메뉴</button>
        <Link href={withVariant('/shop', variant)}><span aria-hidden>▦</span>굿즈</Link>
        <Link aria-current={currentPage === 'home' ? 'page' : undefined} href={withVariant('/', variant)}><span aria-hidden>⌂</span>홈</Link>
        <Link href="/my"><span aria-hidden>♡</span>관심</Link>
        <Link href="/my"><span aria-hidden>○</span>MY</Link>
      </nav>
    </div>
  );
}
