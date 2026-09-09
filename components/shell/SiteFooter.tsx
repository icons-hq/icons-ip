'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BUSINESS_INFO, businessContactWords, type BusinessInfo as BusinessInfoData } from '@/lib/legal/business-info';
import { LEGAL_DOCUMENT_LABELS, LEGAL_DOCUMENT_SLUGS, legalDocumentHref } from '@/lib/legal/links';
import {
  FOOTER_ACCOUNT_ITEMS,
  FOOTER_COMMUNITY_STAFF_ITEMS,
  FOOTER_DEMO_ITEMS,
  FOOTER_DISCOVER_ITEMS,
  FOOTER_PRIMARY_ITEMS,
  hrefFor,
  isStandaloneShellPath,
} from '@/lib/routes';
import { BusinessInfo } from './BusinessInfo';
import { useCardRewardsEnabled } from './CardRewardAvailability';
import { useCommunityStaffPreviewVisible, useSecondaryMarketDemoVisible } from './StaffPreviewAvailability';

/* White Catalog 푸터. 링크 목록은 전부 lib/routes.ts가 진실원이고 여기서는 배치만 한다.
 * 법정 고지 3종은 회사·정책 행 뒤에 이어 붙는다 — 사업자 정보와 함께 표시 의무가 걸린 블록이라
 * 접이식(details) 안이라도 마크업에서 사라지지 않는다. */
export function SiteFooter({businessInfo=BUSINESS_INFO}:{businessInfo?:BusinessInfoData}) {
  const pathname = usePathname();
  const cardRewardsEnabled = useCardRewardsEnabled();
  const demoVisible = useSecondaryMarketDemoVisible();
  const communityPreviewVisible = useCommunityStaffPreviewVisible();
  // 숨김 범위는 Nav와 같다 — 게임은 자기완결 번들, 어드민은 자체 작업대, 인증은 집중형 셸을 사용한다.
  if (isStandaloneShellPath(pathname)) return null;

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
            <p className="wc-footer__cs-lines">{businessContactWords(businessInfo)}</p>
            <details className="wc-footer__biz">
              <summary>{businessInfo.companyName} 사업자 정보</summary>
              <BusinessInfo info={businessInfo} className="wc-footer__biz-rows" />
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

        {/* 세컨더리 마켓 시연 진입점 — 로그인한 staff/admin 의 is_staff readback 이 참일 때만 마크업에
            존재한다. 공개 푸터·SSR 결과에는 없고, 실제 권한 판정은 라우트 서버 게이트가 한다. */}
        {demoVisible ? (
          <nav aria-label="스태프 시연 메뉴" className="wc-footer__demo">
            <h2 className="wc-footer__demo-heading">세컨더리 마켓 시연 · 스태프 전용</h2>
            <ul>
              {FOOTER_DEMO_ITEMS.map((item) => (
                <li key={item.id}><Link href={hrefFor(item.id)}>{item.label}</Link></li>
              ))}
            </ul>
            <p className="wc-footer__demo-note">로그인한 스태프·관리자에게만 보이는 mock 시연 진입점입니다. 실제 결제·체결은 일어나지 않습니다.</p>
          </nav>
        ) : null}

        {/* 커뮤니티 스태프 프리뷰 진입점 — 임시 비공개 커뮤니티로 가는 유일한 링크다. 위 시연 블록과
            분리하는 이유는 이쪽이 mock 이 아니라 실제 DB 를 읽는 표면이라서다(lib/routes.ts 주석). */}
        {communityPreviewVisible ? (
          <nav aria-label="스태프 전용 커뮤니티 메뉴" className="wc-footer__demo">
            <h2 className="wc-footer__demo-heading">커뮤니티 · 스태프 전용</h2>
            <ul>
              {FOOTER_COMMUNITY_STAFF_ITEMS.map((item) => (
                <li key={item.id}><Link href={hrefFor(item.id)}>{item.label}</Link></li>
              ))}
            </ul>
            <p className="wc-footer__demo-note">임시 비공개 상태의 커뮤니티입니다. 로그인한 스태프·관리자만 열람할 수 있고, 글쓰기는 DB 게이트가 따로 닫아 두었습니다.</p>
          </nav>
        ) : null}

        <div className="wc-footer__line">
          <span>© ICONS</span>
          <span>공식 라이선스 · 무상 카드 리워드 · 결제사 승인 확인 후 주문 확정</span>
        </div>
      </div>
    </footer>
  );
}
