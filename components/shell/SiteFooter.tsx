'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BUSINESS_INFO, businessContactWords } from '@/lib/legal/business-info';
import { LEGAL_DOCUMENT_LABELS, LEGAL_DOCUMENT_SLUGS, legalDocumentHref } from '@/lib/legal/links';
import {
  FOOTER_ACCOUNT_ITEMS,
  FOOTER_DISCOVER_ITEMS,
  FOOTER_PRIMARY_ITEMS,
  hrefFor,
  isAuthShellPath,
} from '@/lib/routes';
import { BusinessInfo } from './BusinessInfo';
import { useCardRewardsEnabled } from './CardRewardAvailability';

/* White Catalog 푸터. 링크 목록은 전부 lib/routes.ts가 진실원이고 여기서는 배치만 한다.
 * 법정 고지 3종은 회사·정책 행 뒤에 이어 붙는다 — 사업자 정보와 함께 표시 의무가 걸린 블록이라
 * 접이식(details) 안이라도 마크업에서 사라지지 않는다. */
export function SiteFooter() {
  const pathname = usePathname();
  const cardRewardsEnabled = useCardRewardsEnabled();
  if (pathname === '/' || isAuthShellPath(pathname) || pathname.startsWith('/games') || pathname.startsWith('/admin')) return null;

  /* 카드 리워드가 꺼진 배포에서는 카드팩 진입점을 노출하지 않는다. */
  const discoverItems = FOOTER_DISCOVER_ITEMS.filter((item) => cardRewardsEnabled || item.id !== 'packs');

  return (
    <footer className="wc-root wc-footer">
      <div className="wc-footer__inner">
        <nav aria-label="회사·정책" className="wc-footer__primary">
          <ul>
            {FOOTER_PRIMARY_ITEMS.map((item) => (
              <li key={item.id}><Link href={hrefFor(item.id)}>{item.label}</Link></li>
            ))}
            {LEGAL_DOCUMENT_SLUGS.map((slug) => (
              <li key={slug}><Link href={legalDocumentHref(slug)}>{LEGAL_DOCUMENT_LABELS[slug]}</Link></li>
            ))}
          </ul>
        </nav>

        <p className="wc-footer__logo"><Link aria-label="ICONS 홈" href="/">ICONS</Link></p>

        <div className="wc-footer__middle">
          <div className="wc-footer__cs">
            <h2 className="wc-footer__heading">고객센터</h2>
            <p className="wc-footer__cs-lines">{businessContactWords()}</p>
            <details className="wc-footer__biz">
              <summary>{BUSINESS_INFO.companyName} 사업자 정보</summary>
              <BusinessInfo className="wc-footer__biz-rows" />
            </details>
          </div>

          <div className="wc-footer__cols">
            <nav aria-label="발견 메뉴" className="wc-footer__links">
              <ul>
                {discoverItems.map((item) => (
                  <li key={item.id}><Link href={hrefFor(item.id)}>{item.label}</Link></li>
                ))}
              </ul>
            </nav>
            <nav aria-label="내 활동 메뉴" className="wc-footer__links">
              <ul>
                {FOOTER_ACCOUNT_ITEMS.map((item) => (
                  <li key={item.id}><Link href={hrefFor(item.id)}>{item.label}</Link></li>
                ))}
              </ul>
            </nav>
          </div>
        </div>

        <div className="wc-footer__line">
          <span>© ICONS</span>
          <span>공식 라이선스 · 무상 카드 리워드 · 결제사 승인 확인 후 주문 확정</span>
        </div>
      </div>
    </footer>
  );
}
