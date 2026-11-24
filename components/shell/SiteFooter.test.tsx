import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss, { type AtRule } from 'postcss';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUSINESS_INFO, businessInfoRows } from '@/lib/legal/business-info';
import { SiteFooter } from './SiteFooter';

const mocks = vi.hoisted(() => ({
  adminConsoleVisible: false,
  communityPreviewVisible: false,
  pathname: '/shop',
}));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('./StaffPreviewAvailability', () => ({
  useAdminConsoleVisible: () => mocks.adminConsoleVisible,
  useCommunityStaffPreviewVisible: () => mocks.communityPreviewVisible,
}));

function render() {
  return renderToStaticMarkup(<SiteFooter copyrightYear={2026} />);
}

beforeEach(() => {
  mocks.adminConsoleVisible = false;
  mocks.communityPreviewVisible = false;
  mocks.pathname = '/shop';
});

describe('SiteFooter 법정 고지 링크', () => {
  it('이용약관·개인정보처리방침·배송·반품 정책을 실제 링크로 건다(Figma 표기)', () => {
    const html = render();

    expect(html).toContain('<a href="/legal/terms">엑스스퀘어 이용약관</a>');
    expect(html).toContain('<a href="/legal/privacy">개인정보처리방침</a>');
    expect(html).toContain('<a href="/legal/shipping">배송·반품 정책</a>');
    /* 법정 고지가 링크 없는 글자로 남지 않는다. */
    expect(html).not.toContain('<span>이용약관</span>');
    expect(html).not.toContain('<span>개인정보처리방침</span>');
  });

  it('법정 고지 화면 자체와 로그인 화면에서도 푸터가 유지된다', () => {
    for (const pathname of ['/legal/privacy', '/login']) {
      mocks.pathname = pathname;
      expect(render(), pathname).toContain('href="/legal/terms"');
    }
  });

  /* 1014-X36 "인증 화면 빼고 전부" — 캠페인(/ip/aouad)·게임(/games)은 내비·문의 위젯이 없는 독립 경험이어도
     통신판매업자 신원 정보와 약관 링크는 하단에 둔다. 비밀번호 변경·계정 정지·매니저 초대와 어드민에만 없다. */
  it.each(['/ip/aouad', '/games', '/games/hyosan-memories'])('%s 하단에도 사업자 정보와 법정 고지 링크를 그린다', (pathname) => {
    mocks.pathname = pathname;
    const html = render();

    expect(html).toContain('<footer class="wc-root wc-footer wc-footer--standalone" id="site-footer" tabindex="-1">');
    expect(html).toContain(BUSINESS_INFO.companyName);
    for (const href of ['/legal/terms', '/legal/privacy', '/legal/shipping']) expect(html).toContain(`href="${href}"`);
  });

  it.each(['/update-password', '/account-suspended', '/manager-invitation', '/admin', '/admin/orders'])('%s 에서는 푸터를 그리지 않는다', (pathname) => {
    mocks.pathname = pathname;

    expect(render()).toBe('');
  });

  it('공용 크롬이 있는 화면의 푸터는 독립 경험 표시 없이 그린다', () => {
    for (const pathname of ['/', '/shop', '/login', '/legal/terms']) {
      mocks.pathname = pathname;
      expect(render(), pathname).toContain('<footer class="wc-root wc-footer" id="site-footer" tabindex="-1">');
    }
  });

  /* 독립 경험에는 모바일 탭바(62)가 없다 — 탭바 몫(122)으로 연 바닥을 데스크톱과 같은 60으로 되돌린다. */
  it('독립 경험 푸터는 모바일에서 탭바 몫의 바닥을 열지 않는다', () => {
    const sheet = postcss.parse(readFileSync(new URL('../../app/styles/wc-chrome.css', import.meta.url), 'utf8'));
    const bottoms: Record<string, string> = {};
    sheet.walkRules((rule) => {
      const parent = rule.parent;
      const media = parent && parent.type === 'atrule' && (parent as AtRule).name === 'media' ? (parent as AtRule).params : 'base';
      if (media !== '(max-width: 989px)') return;
      for (const selector of rule.selectors) {
        rule.walkDecls('padding-bottom', (decl) => { bottoms[selector.trim()] = decl.value; });
      }
    });
    expect(bottoms['.wc-footer']).toBe('max(122px, calc(var(--wc-store-analytics-clearance, 0px) + 16px))');
    expect(bottoms['.wc-footer.wc-footer--standalone']).toBe('max(60px, calc(var(--wc-store-analytics-clearance, 0px) + 16px))');
  });
});

/* 사업자 정보는 전자상거래법상 표시 의무가 걸린 법정 표기다 — Figma 구성으로 단순화해도 접지 않고 항목을 줄이지 않는다. */
describe('SiteFooter 사업자 정보(법정 표기)', () => {
  it('설정값 전부(상호·주소·대표자·사업자등록번호·통신판매업 신고번호·전화·이메일·호스팅)를 접지 않고 펼쳐 표기한다', () => {
    const html = render();

    expect(html).not.toContain('<details');
    expect(html).not.toContain('<summary');
    for (const row of businessInfoRows()) {
      expect(html, row.label).toContain(row.label);
      expect(html, row.label).toContain(row.value);
    }
  });

  it('1줄은 상호·주소·대표자·사업자등록번호·통신판매업 신고번호, 2줄은 전화·이메일·호스팅이다', () => {
    const html = render();
    const lineOf = (label: string) => html.slice(html.indexOf(`aria-label="${label}"`), html.indexOf('</dl>', html.indexOf(`aria-label="${label}"`)));
    const first = lineOf('사업자 정보');
    const second = lineOf('연락처·호스팅');

    const order = (line: string, labels: string[]) => labels.map((label) => line.indexOf(`<dt>${label}</dt>`));
    const firstOrder = order(first, ['상호', '사업장 주소', '대표자', '사업자등록번호', '통신판매업 신고번호']);
    expect(firstOrder.every((index) => index > -1)).toBe(true);
    expect([...firstOrder].sort((a, b) => a - b)).toEqual(firstOrder);
    const secondOrder = order(second, ['전화', '이메일', '호스팅 제공자']);
    expect(secondOrder.every((index) => index > -1)).toBe(true);
    expect([...secondOrder].sort((a, b) => a - b)).toEqual(secondOrder);
    expect(html.indexOf('aria-label="사업자 정보"')).toBeLessThan(html.indexOf('aria-label="연락처·호스팅"'));
  });

  /* Figma는 상호·주소의 라벨 없이 값만 적는다 — 화면에서만 감추고 접근 이름(dt)으로는 남는다. */
  it('상호·주소 라벨은 화면에서만 감추고 마크업에는 남긴다', () => {
    const html = render();

    expect(html).toContain('<div class="wc-x-footer__biz-row wc-x-footer__biz-row--bare"><dt>상호</dt>');
    expect(html).toContain('<div class="wc-x-footer__biz-row wc-x-footer__biz-row--bare"><dt>사업장 주소</dt>');
    expect(html).toContain('<div class="wc-x-footer__biz-row"><dt>대표자</dt>');
  });

  it('현재 설정값을 반영하고 비운 항목은 행이 사라진다(줄이 비면 그 줄도)', () => {
    const html = renderToStaticMarkup(<SiteFooter businessInfo={{ ...BUSINESS_INFO, companyName: '설정회사', phone: '', email: 'new@example.test' }} copyrightYear={2026} />);

    expect(html).toContain('설정회사');
    expect(html).toContain('new@example.test');
    expect(html).not.toContain(BUSINESS_INFO.phone);
    expect(html).not.toContain('<dt>전화</dt>');

    const emptyContact = renderToStaticMarkup(<SiteFooter businessInfo={{ ...BUSINESS_INFO, phone: '', email: '', hostingProvider: '' }} copyrightYear={2026} />);
    expect(emptyContact).not.toContain('aria-label="연락처·호스팅"');
    expect(emptyContact).toContain('aria-label="사업자 정보"');
  });

  it('저작권 줄은 서버가 넘긴 연도를 쓴다', () => {
    expect(render()).toContain('<p class="wc-x-footer__copy">© 2026 X SQUARE</p>');
    expect(renderToStaticMarkup(<SiteFooter copyrightYear={2031} />)).toContain('© 2031 X SQUARE');
  });

  it('결제 확정 원칙·무상 카드 리워드 약속 문구는 Figma 푸터에 없다', () => {
    const html = render();

    expect(html).not.toContain('결제사 승인 확인 후 주문 확정');
    expect(html).not.toContain('카드 리워드');
    expect(html).not.toContain('공식 라이선스');
  });
});

describe('SiteFooter Figma 진입점', () => {
  it('1행 오른쪽에 고객센터(/help)를 둔다', () => {
    const html = render();

    expect(html).toContain('aria-label="고객센터·SNS"');
    expect(html).toContain('<a href="/help">고객센터</a>');
  });

  /* 대량구매는 문의 게시판이 아직 없어 대표 이메일 mailto 로 연다 — 값은 어드민 사업자 정보 설정이다(코드에 쓰지 않는다). */
  it('대량구매는 대표 이메일 mailto 이고 이메일이 없으면 링크를 그리지 않는다', () => {
    const subject = encodeURIComponent('[대량구매 문의]');
    expect(render()).toContain(`<a href="mailto:${BUSINESS_INFO.email}?subject=${subject}">대량구매</a>`);
    expect(renderToStaticMarkup(<SiteFooter businessInfo={{ ...BUSINESS_INFO, email: 'bulk@example.test' }} copyrightYear={2026} />)).toContain(`href="mailto:bulk@example.test?subject=${subject}"`);

    for (const email of ['', '  ', 'not-an-address']) {
      const html = renderToStaticMarkup(<SiteFooter businessInfo={{ ...BUSINESS_INFO, email }} copyrightYear={2026} />);
      expect(html, email).not.toContain('mailto:');
      expect(html, email).not.toContain('대량구매');
    }
  });

  /* 공지사항·서비스 가이드라인·X는 Figma에 있지만 목적지가 없다 — 죽은 링크를 만들지 않는다(스펙 §6). */
  it('목적지 없는 Figma 항목(공지사항·서비스 가이드라인·X)과 빠진 링크 열을 그리지 않는다', () => {
    const html = render();

    for (const missing of ['공지사항', '서비스 가이드라인', 'X (Twitter)', 'twitter', 'x.com']) expect(html, missing).not.toContain(missing);
    /* 로고·소개·회사 소개·오프라인 팝업·발견·내 활동 열은 Figma 푸터에 없다. */
    for (const removed of ['회사 소개', '오프라인 팝업', '자주 묻는 질문', '카드 트레이드', '상품 마켓', 'wc-store-brand-logo', 'aria-label="발견 메뉴"', 'aria-label="내 활동 메뉴"']) expect(html, removed).not.toContain(removed);
    for (const href of ['/about', '/offline-popups', '/tickets', '/orders', '/binder', '/market', '/exchange', '/packs', '/community']) expect(html, href).not.toContain(`href="${href}"`);
  });

  /* SNS는 운영 브랜딩 설정에서 켠 것만 그린다. 인스타그램은 Figma 원본 글리프, 블로그·페이스북은 글자 링크다. */
  it('브랜딩 설정에서 켠 SNS만 그리고 인스타그램은 Figma 아이콘이다', () => {
    expect(render()).not.toContain('instagram');
    const socials = [
      { platform: 'blog' as const, url: 'https://blog.naver.com/shop' },
      { platform: 'instagram' as const, url: 'https://www.instagram.com/example/' },
    ];
    const html = renderToStaticMarkup(<SiteFooter branding={{ displayName: 'ICONS', logoUrl: null, mobileLogoUrl: null, introduction: '스토어 소개', socials }} copyrightYear={2026} />);

    expect(html).toContain('<a aria-label="인스타그램(새 창)" class="wc-x-footer__social" href="https://www.instagram.com/example/" rel="noopener noreferrer" target="_blank">');
    expect(html).toContain('<img alt="" height="18" src="/brand/social-instagram.png" width="18"/>');
    expect(html).toContain('<a href="https://blog.naver.com/shop" rel="noopener noreferrer" target="_blank">네이버 블로그<span class="wc-sr-only"> 새 창</span></a>');
    expect(html).not.toContain('페이스북');
    /* 스토어 소개·대표 이미지는 Figma 푸터에 없다. */
    expect(html).not.toContain('스토어 소개');
  });

  it('로고 없이 약관·안내 → 고객센터·SNS → 사업자 정보 → 저작권 순서다', () => {
    const html = renderToStaticMarkup(<SiteFooter copyrightYear={2026} />);
    const sequence = ['aria-label="약관·안내"', 'aria-label="고객센터·SNS"', 'aria-label="사업자 정보"', 'aria-label="연락처·호스팅"', 'wc-x-footer__copy'].map((needle) => {
      const index = html.indexOf(needle);
      expect(index, needle).toBeGreaterThan(-1);
      return index;
    });
    expect([...sequence].sort((a, b) => a - b)).toEqual(sequence);
  });
});

/* 세컨더리 마켓(굿즈 마켓·카드 트레이드) 스태프 시연은 2026-11-24 일반 쇼핑몰 전환으로 지웠다(ADR-0052). */
describe('SiteFooter 지운 세컨더리 마켓 시연 진입점', () => {
  it('스태프에게도 시연 블록이나 마켓·트레이드 링크가 없다', () => {
    mocks.adminConsoleVisible = true;
    mocks.communityPreviewVisible = true;
    const html = render();

    expect(html).not.toContain('aria-label="스태프 시연 메뉴"');
    expect(html).not.toContain('시연');
    expect(html).not.toContain('href="/market"');
    expect(html).not.toContain('href="/exchange"');
  });
});

describe('SiteFooter 커뮤니티 스태프 프리뷰 진입점', () => {
  /* 커뮤니티는 임시 비공개다 — 공개 푸터·SSR 결과에 링크가 남으면 비공개가 무너진다.
   * 진입점은 로그인 계정의 ICONS 운영 권한 조회가 참일 때만 존재한다. */
  it('기본(비로그인·일반 회원·readback 전)에는 커뮤니티 링크가 마크업에 없다', () => {
    const html = render();

    expect(html).not.toContain('href="/community"');
    expect(html).not.toContain('커뮤니티');
  });

  it('스태프에게는 커뮤니티 링크를 스태프 전용 표기와 함께 연다', () => {
    mocks.communityPreviewVisible = true;
    const html = render();

    expect(html).toContain('aria-label="스태프 전용 커뮤니티 메뉴"');
    expect(html).toContain('커뮤니티 · 스태프 전용');
    expect(html).toContain('href="/community"');
    expect(html).toContain('임시 비공개 상태의 커뮤니티입니다');
  });

  it('커뮤니티 블록에 mock 시연 문구를 붙이지 않는다', () => {
    mocks.communityPreviewVisible = true;
    const html = render();

    expect(html).not.toContain('실제 결제·체결은 일어나지 않습니다');
    expect(html).not.toContain('mock 시연 진입점');
  });
});

describe('SiteFooter 관리자 페이지 바로가기', () => {
  it('기본(비로그인·일반 회원·readback 전)에는 관리자 링크가 마크업에 없다', () => {
    const html = render();

    expect(html).not.toContain('href="/admin"');
    expect(html).not.toContain('관리자');
  });

  /* 관리자 바로가기는 스태프 블록 맨 앞이다 — 커뮤니티 블록과 같은 스킨이지만 별개 블록이라 그쪽 안내를 붙이지 않는다. */
  it('어드민 콘솔 운영자에게는 사업자 정보 아래 스태프 블록 맨 앞에 선다', () => {
    mocks.adminConsoleVisible = true;
    mocks.communityPreviewVisible = true;
    const html = render();

    expect(html).toContain('<nav aria-label="관리자 바로가기" class="wc-footer__demo"><h2 class="wc-footer__demo-heading">관리자 · 스태프 전용</h2><ul><li><a href="/admin">관리자 페이지</a></li></ul></nav>');
    expect(html.indexOf('aria-label="연락처·호스팅"')).toBeLessThan(html.indexOf('aria-label="관리자 바로가기"'));
    expect(html.indexOf('aria-label="관리자 바로가기"')).toBeLessThan(html.indexOf('aria-label="스태프 전용 커뮤니티 메뉴"'));
  });
});

/* 공정위 통신판매사업자 정보 공개 조회 링크(원장 CUS-092·CAT-066) — 사업자등록번호 10자리일 때만 사업자등록번호 값 옆에 건다. */
describe('SiteFooter 사업자정보 확인 링크', () => {
  const anchorOf = (html: string) => html.match(/<a[^>]*wc-x-footer__biz-verify[^>]*>[\s\S]*?<\/a>/)?.[0] ?? '';

  it('사업자등록번호 줄에 공정위 조회 주소로 새 창 링크를 단다', () => {
    const html = renderToStaticMarkup(<SiteFooter businessInfo={{ ...BUSINESS_INFO, registrationNumber: '109-86-27576' }} copyrightYear={2026} escrowNoticeVisible={false} />);
    const anchor = anchorOf(html);

    expect(anchor).toContain('href="https://www.ftc.go.kr/bizCommPop.do?wrkr_no=1098627576"');
    expect(anchor).toContain('target="_blank"');
    expect(anchor).toContain('rel="noopener noreferrer"');
    expect(anchor).toContain('사업자정보 확인');
    expect(anchor).toContain('새 창');
    /* 링크는 사업자등록번호 행 안에 있다. */
    const row = html.slice(html.indexOf('<dt>사업자등록번호</dt>'), html.indexOf('</div>', html.indexOf('<dt>사업자등록번호</dt>')));
    expect(row).toContain('109-86-27576');
    expect(row).toContain('wc-x-footer__biz-verify');
    expect(html.match(/wc-x-footer__biz-verify/g)).toHaveLength(1);
  });

  it('번호가 10자리가 아니거나 비어 있으면 링크를 숨긴다', () => {
    for (const registrationNumber of ['', '109-86', '109-86-275761', 'abc-de-fghij']) {
      const html = renderToStaticMarkup(<SiteFooter businessInfo={{ ...BUSINESS_INFO, registrationNumber }} copyrightYear={2026} escrowNoticeVisible={false} />);
      expect(html, registrationNumber).not.toContain('wc-x-footer__biz-verify');
      expect(html, registrationNumber).not.toContain('ftc.go.kr');
    }
  });
});

/* 구매안전서비스(결제대금예치) 가입 사실 표시(ADR-0049) — 가상계좌 개정(약관의 구매안전서비스 고지)이 시행된 날부터 사업자 정보 아래에 보인다. */
describe('SiteFooter 구매안전서비스 표시', () => {
  const notice = '고객님은 안전거래를 위해 현금 등으로 결제 시 저희 쇼핑몰에서 가입한 토스페이먼츠의 구매안전(에스크로) 서비스를 이용하실 수 있습니다.';

  it('시행 중이면 사업자 정보 아래·저작권 위에 안내와 가입 사실 확인 링크(새 창)를 그린다', () => {
    const html = renderToStaticMarkup(<SiteFooter copyrightYear={2026} escrowNoticeVisible />);
    expect(html).toContain(notice);
    expect(html).toContain('<a class="wc-x-footer__biz-verify" href="https://consumer.tosspayments.com/escrow/detail?mertid=iconsi0xvd" rel="noopener noreferrer" target="_blank">서비스 가입 사실 확인<span class="wc-sr-only"> 새 창</span></a>');
    const escrow = html.indexOf('data-footer-escrow');
    expect(escrow).toBeGreaterThan(html.indexOf('aria-label="연락처·호스팅"'));
    expect(escrow).toBeLessThan(html.indexOf('wc-x-footer__copy'));
  });

  it('토스페이먼츠 공식 에스크로 인증 마크(바꾸지 않은 원본)를 안내 앞에 붙인다', () => {
    const html = renderToStaticMarkup(<SiteFooter copyrightYear={2026} escrowNoticeVisible />);
    expect(html).toContain('<img alt="토스페이먼츠 매매보호(에스크로) 서비스" class="wc-x-footer__escrow-mark" height="28" src="/brand/toss-escrow-mark.png" width="210"/>');
    expect(html.indexOf('wc-x-footer__escrow-mark')).toBeGreaterThan(html.indexOf('data-footer-escrow'));
    expect(html.indexOf('wc-x-footer__escrow-mark')).toBeLessThan(html.indexOf('서비스 가입 사실 확인'));
    // 공식 다운로드 파일 그대로인지(sha256) — 임의로 다시 만든 마크를 쓰지 않는다.
    const bytes = readFileSync(path.join(process.cwd(), 'public/brand/toss-escrow-mark.png'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('323d0b919b5793fab3f2dd0fa04ef024f99b0ef8dd51756945751332222faa3c');
  });

  it('시행 전(또는 예약 없음)에는 그리지 않는다', () => {
    const html = renderToStaticMarkup(<SiteFooter copyrightYear={2026} escrowNoticeVisible={false} />);
    expect(html).not.toContain('data-footer-escrow');
    expect(html).not.toContain('구매안전');
    expect(html).not.toContain('toss-escrow-mark');
  });
});
