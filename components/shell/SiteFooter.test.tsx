import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUSINESS_INFO, businessInfoRows } from '@/lib/legal/business-info';
import { SiteFooter } from './SiteFooter';

const mocks = vi.hoisted(() => ({
  cardRewardsEnabled: true,
  demoVisible: false,
  communityPreviewVisible: false,
  pathname: '/shop',
}));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('./CardRewardAvailability', () => ({ useCardRewardsEnabled: () => mocks.cardRewardsEnabled }));
vi.mock('./StaffPreviewAvailability', () => ({
  useSecondaryMarketDemoVisible: () => mocks.demoVisible,
  useCommunityStaffPreviewVisible: () => mocks.communityPreviewVisible,
}));

function render() {
  return renderToStaticMarkup(<SiteFooter />);
}

beforeEach(() => {
  mocks.cardRewardsEnabled = true;
  mocks.demoVisible = false;
  mocks.communityPreviewVisible = false;
  mocks.pathname = '/shop';
});

describe('SiteFooter 법정 고지 링크', () => {
  it('이용약관·개인정보처리방침을 실제 링크로 건다', () => {
    const html = render();

    expect(html).toContain('href="/legal/terms"');
    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain('이용약관');
    expect(html).toContain('개인정보처리방침');
  });

  it('배송·반품 정책 링크를 추가한다', () => {
    const html = render();

    expect(html).toContain('href="/legal/shipping"');
    expect(html).toContain('배송·반품 정책');
  });

  it('약관 문구를 링크 없는 span으로 남기지 않는다', () => {
    const html = render();

    expect(html).not.toContain('<span>이용약관</span>');
    expect(html).not.toContain('<span>개인정보처리방침</span>');
  });

  it('법정 고지 화면 자체에서도 푸터가 유지된다', () => {
    mocks.pathname = '/legal/privacy';

    expect(render()).toContain('href="/legal/terms"');
  });

  it('사업자 정보를 접이식 블록으로 푸터에 표기한다', () => {
    const html = render();

    expect(html).toContain(`${BUSINESS_INFO.companyName} 사업자 정보`);
    expect(html).toContain('aria-label="사업자 정보"');
    for (const row of businessInfoRows()) {
      expect(html).toContain(row.label);
      expect(html).toContain(row.value);
    }
  });

  it('결제 확정 원칙을 legacy provider 이름 없이 안내한다', () => {
    const html = render();

    expect(html).toContain('결제사 승인 확인 후 주문 확정');
    expect(html).not.toContain('토스페이먼츠 안전 결제');
  });

  /* S3에서 홈이 공용 셸 위로 올라오면서 '/'는 더 이상 예외가 아니다 — 푸터를 그린다. */
  it('인증 셸·어드민·게임에서는 푸터를 렌더하지 않는다', () => {
    for (const pathname of ['/login', '/update-password', '/account-suspended', '/admin', '/games/roulette']) {
      mocks.pathname = pathname;
      expect(render(), pathname).toBe('');
    }
  });
});

describe('SiteFooter 도메인 용어', () => {
  /* 굿즈 클레임 유형 "교환"(회수 후 재출고)이 생기면서 카드 C2C는 "트레이드"로 개명됐다.
   * 푸터에 옛 표기가 남으면 두 개념이 같은 이름으로 보인다. */
  it('카드 C2C 링크를 트레이드로 부른다', () => {
    const html = render();

    expect(html).toContain('카드 트레이드');
    expect(html).not.toContain('카드 교환');
  });

  /* 카드 리워드 게이트가 닫힌 상태에서 푸터만 카드팩을 계속 광고하면 죽은 링크가 남는다. */
  it('카드 리워드 게이트가 닫히면 카드팩 링크를 지운다', () => {
    mocks.cardRewardsEnabled = false;

    expect(render()).not.toContain('href="/packs"');
  });
});

describe('SiteFooter White Catalog 진입점', () => {
  it('회사·정책 행과 발견·내 활동 열의 진입점을 모두 세운다', () => {
    const html = render();

    expect(html).toContain('wc-footer');
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/help"');
    expect(html).toContain('자주 묻는 질문');
    expect(html).toContain('오프라인 팝업');
    expect(html).toContain('href="/offline-popups"');
    /* 캠페인 허브는 별개 도메인이라 발견 열에 자기 링크를 따로 유지한다. */
    expect(html).toContain('href="/events"');
    /* 티켓 진입점은 푸터가 유일한 상시 표면이다 — TicketEntrypoints.test.tsx와 이중으로 잠근다. */
    expect(html).toContain('href="/tickets"');
    expect(html).toContain('내 티켓');
    expect(html).toContain('href="/my/wishlist"');
    expect(html).toContain('© ICONS');
  });
});

it("현재 설정값을 푸터에 반영하고 비운 전화는 숨긴다",()=>{ const html=renderToStaticMarkup(<SiteFooter businessInfo={{...BUSINESS_INFO,companyName:"설정회사",phone:"",email:"new@example.test"}}/>);expect(html).toContain("설정회사 사업자 정보");expect(html).toContain("new@example.test");expect(html).not.toContain(BUSINESS_INFO.phone); });

describe('SiteFooter 세컨더리 마켓 시연 진입점', () => {
  /* 시연은 로그인한 staff/admin 의 is_staff readback 이 참일 때만 존재한다. 공개 푸터·SSR 결과에
   * 진입점이 남으면 PG 계약 문제로 내린 C2C 표면이 다시 공개로 새는 셈이다. */
  it('기본(비로그인·일반 회원·readback 전)에는 시연 블록이 마크업에 없다', () => {
    const html = render();

    expect(html).not.toContain('wc-footer__demo');
    expect(html).not.toContain('시연');
    /* 공개 링크는 그대로 — v2 플레이스홀더 진입점이다. */
    expect(html).toContain('href="/market"');
    expect(html).toContain('href="/exchange"');
  });

  it('스태프에게는 굿즈 마켓·카드 트레이드 시연 링크를 스태프 전용 표기와 함께 연다', () => {
    mocks.demoVisible = true;
    const html = render();

    expect(html).toContain('aria-label="스태프 시연 메뉴"');
    expect(html).toContain('세컨더리 마켓 시연 · 스태프 전용');
    expect(html).toContain('굿즈 마켓 시연');
    expect(html).toContain('카드 트레이드 시연');
    expect(html).toContain('실제 결제·체결은 일어나지 않습니다');
  });
});

describe('SiteFooter 커뮤니티 스태프 프리뷰 진입점', () => {
  /* 커뮤니티는 임시 비공개다 — 공개 푸터·SSR 결과에 링크가 남으면 비공개가 무너진다.
   * 진입점은 로그인한 staff/admin 의 is_staff readback 이 참일 때만 존재한다. */
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

  /* 두 스태프 블록은 성격이 달라 문구를 공유하면 거짓말이 된다 — 커뮤니티는 mock 이 아니다. */
  it('커뮤니티 블록에 세컨더리 마켓 시연 문구를 붙이지 않는다', () => {
    mocks.communityPreviewVisible = true;
    const html = render();

    expect(html).not.toContain('실제 결제·체결은 일어나지 않습니다');
    expect(html).not.toContain('mock 시연 진입점');
  });

  /* 두 readback 은 서로 독립이다 — 한쪽 스위치를 내려도 다른 블록이 함께 사라지지 않는다. */
  it('세컨더리 마켓 시연과 커뮤니티 프리뷰가 함께 열려도 각자 블록으로 선다', () => {
    mocks.demoVisible = true;
    mocks.communityPreviewVisible = true;
    const html = render();

    expect(html).toContain('aria-label="스태프 시연 메뉴"');
    expect(html).toContain('aria-label="스태프 전용 커뮤니티 메뉴"');
  });
});
