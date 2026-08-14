'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LEGAL_DOCUMENT_LABELS, LEGAL_DOCUMENT_SLUGS, legalDocumentHref } from '@/lib/legal/links';
import { hrefFor, isAuthShellPath } from '@/lib/routes';
import { BusinessInfo } from './BusinessInfo';
import { useCardRewardsEnabled } from './CardRewardAvailability';

const DISCOVER_LINKS: [label: string, route: string][] = [
  ['IP 세계', 'iphub'],
  ['공식 굿즈', 'shop'],
  ['카드팩', 'packs'],
  ['팝업과 이벤트', 'events'],
  ['팬 커뮤니티', 'community'],
];

const ACCOUNT_LINKS: [label: string, route: string][] = [
  ['내 주문', 'orders'],
  ['내 티켓', 'tickets'],
  ['바인더', 'binder'],
  ['알림함', 'notifications'],
  ['카드 교환', 'exchange'],
  ['굿즈 마켓', 'market'],
];

export function SiteFooter() {
  const pathname = usePathname();
  const cardRewardsEnabled = useCardRewardsEnabled();
  if (pathname === '/' || isAuthShellPath(pathname) || pathname.startsWith('/games') || pathname.startsWith('/admin')) return null;

  return (
    <footer className="site-footer-editorial">
      <div className="site-footer-editorial__inner">
        <Link className="site-footer-editorial__brand" href="/" aria-label="ICONS 홈">
          <span aria-hidden className="site-footer-editorial__brand-mark" />
          <span>ICONS</span>
        </Link>

        <div className="site-footer-editorial__grid">
          <p className="site-footer-editorial__copy">
            좋아하는 IP의 공식 굿즈, 무상 카드 리워드, 팝업 티켓과 팬 커뮤니티를
            하나의 세계에서 만나는 공개 팬덤 플랫폼입니다.
          </p>
          <nav aria-label="발견 메뉴" className="site-footer-editorial__links">
            {DISCOVER_LINKS
              .filter(([, route]) => cardRewardsEnabled || route !== 'packs')
              .map(([label, route]) => (
              <Link key={route} href={hrefFor(route)}>{label}</Link>
              ))}
          </nav>
          <nav aria-label="내 활동과 보조 메뉴" className="site-footer-editorial__links">
            {ACCOUNT_LINKS.map(([label, route]) => (
              <Link key={route} href={hrefFor(route)}>{label}</Link>
            ))}
          </nav>
          <nav aria-label="법정 고지" className="site-footer-editorial__links">
            {LEGAL_DOCUMENT_SLUGS.map((slug) => (
              <Link key={slug} href={legalDocumentHref(slug)}>{LEGAL_DOCUMENT_LABELS[slug]}</Link>
            ))}
          </nav>
        </div>

        <BusinessInfo />

        <div className="site-footer-editorial__meta">
          <span>© ICONS</span>
          <span>공식 라이선스 · 무상 카드 리워드 · 결제사 승인 확인 후 주문 확정</span>
        </div>
      </div>
    </footer>
  );
}
