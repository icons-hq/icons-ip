'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BUSINESS_INFO, businessInfoRows, type BusinessInfo as BusinessInfoData, type BusinessInfoRow } from '@/lib/legal/business-info';
import { LEGAL_DOCUMENT_LABELS, LEGAL_DOCUMENT_SLUGS, legalDocumentHref } from '@/lib/legal/links';
import {
  FOOTER_BULK_PURCHASE_LABEL,
  FOOTER_COMMUNITY_STAFF_ITEMS,
  FOOTER_DEMO_ITEMS,
  UTIL_HELP_ITEM,
  bulkPurchaseMailto,
  hidesSiteFooter,
  hrefFor,
  isStandaloneShellPath,
  withoutHiddenCollectibleItems,
} from '@/lib/routes';
import { useCollectibleFeatures } from './CollectibleFeatures';
import { SITE_FOOTER_ID } from './site-footer-jump';
import { useCommunityStaffPreviewVisible, useSecondaryMarketDemoVisible } from './StaffPreviewAvailability';
import { DEFAULT_STOREFRONT_BRANDING, STORE_SOCIAL_LABELS, type StorefrontBranding } from '@/lib/store-branding';
import { AdminConsoleLink, useAdminConsoleVisible } from './AdminConsoleLink';

/* X SQUARE 푸터(Figma Site Footer, ADR-0043). 한 줄 링크(약관·안내 | 고객센터·SNS) → 사업자 정보 두 줄 → (스태프 블록) → 저작권이다.
   법정 표기(상호·대표자·주소·사업자등록번호·통신판매업 신고번호·전화·이메일·호스팅)와 법정 고지 3종은 그대로 두고 접지 않는다 —
   값은 전부 businessInfo(어드민 사업자 정보 설정)에서 온다. 상호·주소의 라벨은 화면에서만 감추고(Figma) 접근 이름으로는 남긴다.
   목적지 없는 Figma 항목(공지사항·서비스 가이드라인·X)은 죽은 링크를 만들지 않으려 그리지 않는다. 루트 요소는 푸터 점프·시트 inert 목록이
   쓰는 `footer.wc-footer#site-footer` 그대로다. */

/* 법정 고지 링크 이름 — 첫 항목은 Figma 표기('아이콘스 이용약관')를 쓰고 나머지는 문서 이름 그대로다. */
const FOOTER_LEGAL_LABELS = { ...LEGAL_DOCUMENT_LABELS, terms: `아이콘스 ${LEGAL_DOCUMENT_LABELS.terms}` };

/* 사업자 정보 두 줄 — 1줄: 상호·주소·대표자·사업자등록번호·통신판매업 신고번호, 2줄: 전화·이메일·호스팅. 비어 있는 항목은 행이 사라진다. */
const BUSINESS_LINES: ReadonlyArray<{ label: string; keys: ReadonlyArray<BusinessInfoRow['key']> }> = [
  { label: '사업자 정보', keys: ['companyName', 'address', 'representative', 'registrationNumber', 'mailOrderNumber'] },
  { label: '연락처·호스팅', keys: ['phone', 'email', 'hostingProvider'] },
];
/* 값이 자명한 항목은 라벨을 화면에서 감춘다(Figma는 값만 적는다) — 접근 이름으로는 남는다. */
const LABEL_HIDDEN_KEYS: ReadonlyArray<BusinessInfoRow['key']> = ['companyName', 'address'];

function BusinessLines({ info }: { info: BusinessInfoData }) {
  const rows = businessInfoRows(info);
  return BUSINESS_LINES.map((line) => {
    const lineRows = line.keys.flatMap((key) => rows.filter((row) => row.key === key));
    if (lineRows.length === 0) return null;
    return (
      <dl key={line.label} aria-label={line.label} className="wc-x-footer__biz">
        {lineRows.map((row) => (
          <div key={row.key} className={`wc-x-footer__biz-row${LABEL_HIDDEN_KEYS.includes(row.key) ? ' wc-x-footer__biz-row--bare' : ''}`}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    );
  });
}

/* SNS는 운영 브랜딩 설정에서 켠 것만 그린다. 인스타그램은 Figma 원본 글리프(18px), 블로그·페이스북은 원본 자산이 없어 글자 링크다. */
function SocialLinks({ socials }: { socials: StorefrontBranding['socials'] }) {
  return socials.map(({ platform, url }) => (
    <li key={platform}>
      {platform === 'instagram' ? (
        <a aria-label={`${STORE_SOCIAL_LABELS[platform]}(새 창)`} className="wc-x-footer__social" href={url} rel="noopener noreferrer" target="_blank">
          {/* Bundled brand asset: Figma Instagram glyph (72px source for the 18px slot). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" height={18} src="/brand/social-instagram.png" width={18} />
        </a>
      ) : (
        <a href={url} rel="noopener noreferrer" target="_blank">{STORE_SOCIAL_LABELS[platform]}<span className="wc-sr-only"> 새 창</span></a>
      )}
    </li>
  ));
}

export function SiteFooter({
  businessInfo = BUSINESS_INFO,
  branding = DEFAULT_STOREFRONT_BRANDING,
  copyrightYear = new Date().getFullYear(),
}: {
  businessInfo?: BusinessInfoData;
  branding?: StorefrontBranding;
  /** 저작권 줄의 연도 — 서버 레이아웃이 KST 기준으로 넘긴다. */
  copyrightYear?: number;
}) {
  const pathname = usePathname();
  /* 마켓·트레이드 시연은 그 기능의 DB 공개 스위치가 켜져 있을 때만 남는다 — 둘 다 꺼지면 블록 자체가 없다(lib/collectible-features.ts). */
  const demoItems = withoutHiddenCollectibleItems(FOOTER_DEMO_ITEMS, useCollectibleFeatures());
  const demoVisible = useSecondaryMarketDemoVisible() && demoItems.length > 0;
  const communityPreviewVisible = useCommunityStaffPreviewVisible();
  const adminConsoleVisible = useAdminConsoleVisible();
  // 숨김 범위는 Nav보다 좁다 — 초대·비밀번호 변경·정지 안내(집중형 셸)와 어드민(자체 작업대)만 비운다. 캠페인·게임은
  // 내비·문의 위젯이 없는 독립 경험이어도 사업자 정보·법정 고지 푸터는 그 아래에 둔다(1014-X36, lib/routes.ts hidesSiteFooter).
  if (hidesSiteFooter(pathname)) return null;
  /* 독립 경험에는 모바일 탭바가 없다 — 탭바 몫으로 여는 모바일 바닥을 쓰지 않는다(wc-chrome.css .wc-footer--standalone). */
  const standalone = isStandaloneShellPath(pathname);
  const bulkPurchaseHref = bulkPurchaseMailto(businessInfo.email);

  return (
    <footer className={standalone ? 'wc-root wc-footer wc-footer--standalone' : 'wc-root wc-footer'} id={SITE_FOOTER_ID} tabIndex={-1}>
      <div className="wc-container wc-container--wide wc-x-footer__inner">
        <div className="wc-x-footer__bar">
          <nav aria-label="약관·안내" className="wc-x-footer__links">
            <ul>
              {LEGAL_DOCUMENT_SLUGS.map((slug) => (
                <li key={slug}><Link href={legalDocumentHref(slug)}>{FOOTER_LEGAL_LABELS[slug]}</Link></li>
              ))}
              {bulkPurchaseHref ? <li><a href={bulkPurchaseHref}>{FOOTER_BULK_PURCHASE_LABEL}</a></li> : null}
            </ul>
          </nav>
          <nav aria-label="고객센터·SNS" className="wc-x-footer__aside">
            <ul>
              <li><Link href={hrefFor(UTIL_HELP_ITEM.id)}>{UTIL_HELP_ITEM.label}</Link></li>
              <SocialLinks socials={branding.socials} />
            </ul>
          </nav>
        </div>

        <BusinessLines info={businessInfo} />

        {/* 관리자 페이지 바로가기 — 어드민 콘솔에 들어갈 수 있는 운영자에게만 마크업이 생긴다(운영 권한 readback). 유틸 메뉴가
            없는 모바일 상품 상세·장바구니·결제와 공용 내비가 없는 캠페인·게임에서도 닿도록 푸터 스태프 블록 맨 앞에 둔다. */}
        {adminConsoleVisible ? (
          <nav aria-label="관리자 바로가기" className="wc-footer__demo">
            <h2 className="wc-footer__demo-heading">관리자 · 스태프 전용</h2>
            <ul>
              <li><AdminConsoleLink /></li>
            </ul>
          </nav>
        ) : null}

        {/* 세컨더리 마켓 시연 진입점 — 로그인 계정의 ICONS 운영 권한 조회가 참일 때만 마크업에
            존재한다. 공개 푸터·SSR 결과에는 없고, 실제 권한 판정은 라우트 서버 게이트가 한다. */}
        {demoVisible ? (
          <nav aria-label="스태프 시연 메뉴" className="wc-footer__demo">
            <h2 className="wc-footer__demo-heading">세컨더리 마켓 시연 · 스태프 전용</h2>
            <ul>
              {demoItems.map((item) => (
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

        <p className="wc-x-footer__copy">© {copyrightYear} ICONS</p>
      </div>
    </footer>
  );
}
