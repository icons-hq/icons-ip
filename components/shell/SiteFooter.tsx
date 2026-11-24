'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BUSINESS_INFO, businessInfoRows, businessRegistrationVerifyHref, type BusinessInfo as BusinessInfoData, type BusinessInfoRow } from '@/lib/legal/business-info';
import { LEGAL_DOCUMENT_LABELS, LEGAL_DOCUMENT_SLUGS, legalDocumentHref } from '@/lib/legal/links';
import {
  FOOTER_BULK_PURCHASE_LABEL,
  FOOTER_COMMUNITY_STAFF_ITEMS,
  UTIL_HELP_ITEM,
  bulkPurchaseMailto,
  hidesSiteFooter,
  hrefFor,
  isStandaloneShellPath,
} from '@/lib/routes';
import { SITE_FOOTER_ID } from './site-footer-jump';
import { useCommunityStaffPreviewVisible } from './StaffPreviewAvailability';
import { DEFAULT_STOREFRONT_BRANDING, STORE_SOCIAL_LABELS, type StorefrontBranding } from '@/lib/store-branding';
import { AdminConsoleLink, useAdminConsoleVisible } from './AdminConsoleLink';
import { virtualAccountTermsRevisionInEffect } from '@/lib/legal/virtual-account-terms-revision';

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
  /* 공정위 통신판매사업자 정보 공개 조회 — 번호가 10자리가 아니면 링크가 없다. */
  const verifyHref = businessRegistrationVerifyHref(info);
  return BUSINESS_LINES.map((line) => {
    const lineRows = line.keys.flatMap((key) => rows.filter((row) => row.key === key));
    if (lineRows.length === 0) return null;
    return (
      <dl key={line.label} aria-label={line.label} className="wc-x-footer__biz">
        {lineRows.map((row) => (
          <div key={row.key} className={`wc-x-footer__biz-row${LABEL_HIDDEN_KEYS.includes(row.key) ? ' wc-x-footer__biz-row--bare' : ''}`}>
            <dt>{row.label}</dt>
            <dd>
              {row.value}
              {row.key === 'registrationNumber' && verifyHref ? (
                <> <a className="wc-x-footer__biz-verify" href={verifyHref} rel="noopener noreferrer" target="_blank">사업자정보 확인<span className="wc-sr-only"> 새 창</span></a></>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    );
  });
}

/*
 * 구매안전서비스(결제대금예치) 가입 사실 표시 — 전자상거래법 제13조·제24조, 토스페이먼츠 에스크로 안내("에스크로를 사용하는 상점은 홈페이지
 * 하단에 에스크로 가입 인증 마크가 필요")(ADR-0049 결정 9). 가상계좌 개정(약관 제11조의 구매안전서비스 고지)이 시행된 날부터 함께 보인다.
 * 가입 사실 확인 링크: 토스페이먼츠 구매자용 에스크로 가입 확인 페이지(consumer.tosspayments.com/escrow/detail, 상점아이디 mertid) —
 * 가상계좌·에스크로를 받는 ICONS 국내 결제 MID(iconsi0xvd, lib/payments/toss-config.mjs)로 건다. MID는 비밀이 아니다. 시행 전 사람이
 * 이 링크에서 ICONS 가입 사실이 보이는지 확인한다(런북 가상계좌 절).
 */
const ESCROW_NOTICE_TEXT = '고객님은 안전거래를 위해 현금 등으로 결제 시 저희 쇼핑몰에서 가입한 토스페이먼츠의 구매안전(에스크로) 서비스를 이용하실 수 있습니다.';
const ESCROW_SERVICE_CHECK_HREF = 'https://consumer.tosspayments.com/escrow/detail?mertid=iconsi0xvd';
/*
 * 토스페이먼츠 에스크로 인증 마크 — 공식 용어 문서 '에스크로'(/resources/glossary/escrow, 2026-11-23 확인)의 다운로드
 * (static.tosspayments.com/docs/glossary/escrow-auth-mark.zip 안의 img_mark01(2x).png, 420×174)를 바꾸지 않고 그대로 둔다
 * (sha256 323d0b91…faa3c). 그림은 위아래 투명 여백 가운데 띠에만 있어, 화면에서는 CSS가 여백만 가린다(.wc-x-footer__escrow-mark).
 */
const ESCROW_MARK_SRC = '/brand/toss-escrow-mark.png';

function EscrowNotice() {
  return (
    <p className="wc-x-footer__biz" data-footer-escrow="">
      {/* Bundled official asset: Toss Payments escrow certification mark (unmodified download). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="토스페이먼츠 매매보호(에스크로) 서비스" className="wc-x-footer__escrow-mark" height={28} src={ESCROW_MARK_SRC} width={210} />
      <span className="wc-x-footer__biz-row">
        <span>
          {ESCROW_NOTICE_TEXT}{' '}
          <a className="wc-x-footer__biz-verify" href={ESCROW_SERVICE_CHECK_HREF} rel="noopener noreferrer" target="_blank">서비스 가입 사실 확인<span className="wc-sr-only"> 새 창</span></a>
        </span>
      </span>
    </p>
  );
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
  escrowNoticeVisible = virtualAccountTermsRevisionInEffect(),
}: {
  businessInfo?: BusinessInfoData;
  branding?: StorefrontBranding;
  /** 저작권 줄의 연도 — 서버 레이아웃이 KST 기준으로 넘긴다. */
  copyrightYear?: number;
  /**
   * 구매안전서비스 가입 사실 표시 여부. 기본은 가상계좌 개정 시행 여부(KST 날짜)다 — 서버 레이아웃이 넘기면 그 값을 쓴다
   * (넘기지 않으면 시행일 0시 무렵 정적 HTML과 브라우저가 다른 날짜로 계산할 수 있다).
   */
  escrowNoticeVisible?: boolean;
}) {
  const pathname = usePathname();
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

        {escrowNoticeVisible ? <EscrowNotice /> : null}

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

        {/* 커뮤니티 스태프 프리뷰 진입점 — 임시 비공개 커뮤니티로 가는 유일한 링크다(lib/routes.ts 주석). */}
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
