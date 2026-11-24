import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CampaignLandingSnapshot, ResolvedCampaignSection } from '@/lib/campaigns.server';
import { CampaignLanding } from './CampaignLanding';

vi.mock('@/app/events/participation-actions', () => ({
  attendanceCheckInAction: vi.fn(),
}));
/* 굿즈 진열 카드의 목록 하트(L4b)가 라우터·위시 액션을 쓴다. */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));

const LOGIN_HREF = `/login?next=${encodeURIComponent('/events/summer')}`;

const SECTIONS: ResolvedCampaignSection[] = [
  { type: 'intro', anchor: '소개', copy: '여름 내내 출석하고 코인을 모아 가세요.' },
  {
    type: 'image',
    image_path: 'campaigns/mid.png',
    imageUrl: 'https://cdn.test/public-media/campaigns/mid.png',
    alt: '캠페인 안내 이미지',
  },
  { type: 'text', heading: '참여 방법', body: '매일 출석하면 코인이 쌓여요.' },
  { type: 'notice', anchor: '유의사항', items: ['출석은 하루 한 번만 적립돼요.'] },
  { type: 'coupon', coupon_code: 'SUMMER10', description: '여름 한정 할인' },
  {
    type: 'goods',
    good_ids: ['g13'],
    goods: [{
      id: 'g13',
      name: '아크릴 블록',
      price: 12000,
      compareAtPrice: null,
      badge: '신상',
      soldOut: false,
      imageBackground: 'linear-gradient(#111, #222)',
    }],
  },
  { type: 'attendance', anchor: '출석' },
];

function snapshot(overrides: Partial<CampaignLandingSnapshot> = {}): CampaignLandingSnapshot {
  return {
    id: 'summer',
    kind: 'event',
    title: '여름 코인 이벤트',
    subtitle: '출석하고 코인 받기',
    cardImagePath: null,
    bannerImagePath: null,
    heroImagePath: 'https://cdn.test/hero.png',
    featuredOrder: null,
    startsAt: '2026-08-06T15:00:00.000Z',
    endsAt: '2026-08-31T14:59:00.000Z',
    status: 'published',
    displayState: 'ongoing',
    presentation: null,
    sections: [],
    resolvedSections: SECTIONS,
    ...overrides,
  };
}

function render(props: Partial<Parameters<typeof CampaignLanding>[0]> = {}) {
  return renderToStaticMarkup(
    <CampaignLanding
      campaign={snapshot()}
      coin={{ balance: 40, attendedToday: false }}
      signedIn
      {...props}
    />,
  );
}

describe('CampaignLanding', () => {
  it('헤더에 제목·기간·상태 뱃지를 함께 낸다', () => {
    const html = render();

    expect(html).toContain('여름 코인 이벤트');
    expect(html).toContain('2026.8.7 – 8.31');
    expect(html).toContain('wc-campaign-state--ongoing');
  });

  /* draft 상세는 RLS 상 운영자만 연다 — 미리보기라는 사실이 헤더에서 읽혀야 한다. */
  it('draft 캠페인 헤더는 비공개 뱃지를 단다', () => {
    const html = render({ campaign: snapshot({ status: 'draft' }) });

    expect(html).toContain('비공개');
    expect(html).toContain('wc-campaign-state--draft');
    expect(html).not.toContain('wc-campaign-state--ongoing');
  });

  it('본문 블록을 종류별로 그린다', () => {
    const html = render();

    expect(html).toContain('여름 내내 출석하고 코인을 모아 가세요.');
    expect(html).toContain('aria-label="캠페인 안내 이미지"');
    /* 히어로와 같은 Storage 경로다 — 로더가 해석한 공개 URL 을 배경으로 쓴다.
       원문 경로가 그대로 흘러가면 이 블록만 배경이 빈다. */
    expect(html).toContain('https://cdn.test/public-media/campaigns/mid.png');
    expect(html).not.toContain('url(&quot;campaigns/mid.png&quot;)');
    expect(html).toContain('참여 방법');
    expect(html).toContain('출석은 하루 한 번만 적립돼요.');
    expect(html).toContain('SUMMER10');
    expect(html).toContain('href="/cart"');
    expect(html).toContain('아크릴 블록');
    expect(html).toContain('href="/shop/g13"');
  });

  /* 운영자 앵커 문자열은 라벨로만 쓰고 DOM id 는 순서에서 만든다 —
     공백·특수문자가 섞여도 목차 링크가 깨지지 않는다. */
  it('앵커가 있는 블록만 목차에 올린다', () => {
    const html = render();

    expect(html).toContain('href="#campaign-section-0"');
    expect(html).toContain('href="#campaign-section-3"');
    expect(html).toContain('href="#campaign-section-6"');
    expect(html).not.toContain('href="#campaign-section-7"');
    expect(html).not.toContain('href="#campaign-section-1"');
    expect(html).toContain('id="campaign-section-1"');
  });

  /* 목차로 이동하면 포커스가 섹션 제목으로 온다(CampaignAnchorNav) — 기본 해시 이동이 옮기던
     '이어 읽을 자리'다. 제목은 탭 순서에 끼어들지 않는다. */
  it('앵커 섹션 제목을 탭 순서 밖의 포커스 대상으로 둔다', () => {
    const html = render();

    expect(html).toContain('<h2 class="wc-campaign-section__heading" tabindex="-1">유의사항</h2>');
    expect(html.match(/class="wc-campaign-section__heading" tabindex="-1"/g)).toHaveLength(3);
    expect(html).not.toMatch(/wc-campaign-section__heading"[^>]*tabindex="0"/);
  });

  it('로그인 상태에서는 잔액을 노출한다', () => {
    const html = render();

    expect(html).toContain('<p class="wc-campaign-nav__coin">코인 <strong>40</strong></p>');
  });

  /* R-06 §2.2 문법 — 게스트에게는 같은 자리에 로그인 CTA 가 온다(코인 박스·출석 2곳). */
  it('게스트에게는 두 자리 모두 로그인 CTA로 치환한다', () => {
    const html = render({ coin: null, signedIn: false });

    expect(html.match(new RegExp(`href="${LOGIN_HREF.replace('?', '\\?')}"`, 'g'))).toHaveLength(2);
    expect(html).toContain('로그인하고 코인 확인');
    expect(html).toContain('로그인하고 출석하기');
    expect(html).not.toContain('로그인하고 교환하기');
    expect(html).not.toContain('출석 체크하기');
  });

  it('오늘 출석했으면 버튼을 비활성 문구로 바꾼다', () => {
    const html = render({ coin: { balance: 40, attendedToday: true } });

    expect(html).toContain('오늘은 출석했어요');
    expect(html).not.toContain('출석 체크하기');
  });

  /* 카드팩 교환(exchange) 블록은 2026-11-24 일반 쇼핑몰 전환으로 지웠다(ADR-0052) — 로더가 버려 랜딩에 오지 않는다. */
  it('카드팩 교환 블록이나 교환 버튼을 그리지 않는다', () => {
    const html = render();

    expect(html).not.toContain('카드팩');
    expect(html).not.toContain('교환하기');
    expect(html).not.toContain('wc-campaign-exchange');
  });

  it('종료된 캠페인은 참여 패널 자리를 종료 안내로 바꾸되 본문은 그대로 연다', () => {
    const html = render({ campaign: snapshot({ displayState: 'ended', status: 'ended' }) });

    expect(html).toContain('종료된 이벤트예요.');
    expect(html).toContain('여름 내내 출석하고 코인을 모아 가세요.');
    expect(html).not.toContain('출석 체크하기');
  });

  /* EV-03 — 이동 버튼은 ICONS 안의 경로로 가는 잉크 버튼이다(R-06 §2.2, LD-18). */
  it('이동 버튼 블록을 내부 경로 링크 버튼으로 그린다', () => {
    const html = render({
      campaign: snapshot({
        resolvedSections: [
          { type: 'intro', copy: '가을 굿즈를 모았어요.' },
          { type: 'cta', anchor: '굿즈', label: '가을 굿즈 보러 가기', href: '/shop?ip=bt21' },
        ],
      }),
    });

    expect(html).toContain('class="wc-campaign-section wc-campaign-section--cta"');
    expect(html).toMatch(/<a class="wc-btn primary" href="\/shop\?ip=bt21">가을 굿즈 보러 가기<\/a>/);
    expect(html).toContain('href="#campaign-section-1"');
  });

  /* L4b · CL-01·CL-02 — 굿즈 진열 카드도 목록 카드처럼 하트(링크 밖 형제)와 리뷰가 있을 때만 별점을 단다. */
  it('굿즈 진열 카드에 위시 상태로 하트를, 로더가 실은 별점을 단다', () => {
    const goodsSection = SECTIONS[5] as Extract<ResolvedCampaignSection, { type: 'goods' }>;
    const sections = SECTIONS.map((section, index) => (index === 5 ? {
      ...goodsSection,
      goods: [{ ...goodsSection.goods[0], reviewSummary: { count: 9, average: 4.78 } }, { ...goodsSection.goods[0], id: 'g14', name: '오로라 키링' }],
    } : section));
    const html = render({ campaign: snapshot({ resolvedSections: sections }), wishlist: { viewerId: 'viewer-1', goodIds: ['g14'] } });
    const goods = html.slice(html.indexOf('wc-campaign-goods'), html.indexOf('wc-campaign-section--attendance'));

    expect(goods.match(/class="wc-product-card__action"/g)).toHaveLength(2);
    expect(goods).toContain('aria-label="아크릴 블록 위시리스트에 담기"');
    expect(goods).toContain('aria-label="오로라 키링 위시리스트에서 빼기"');
    expect(goods.match(/class="wc-product-card__rating"/g)).toHaveLength(1);
    expect(goods).toContain('평점 5점 만점에 4.8점, 리뷰 9개');
    /* 게스트도 하트를 보고(누르면 로그인 벽), 위시 상태를 받지 않은 렌더는 하트가 없다. */
    expect(render({ campaign: snapshot({ resolvedSections: sections }), wishlist: { viewerId: null, goodIds: [] }, signedIn: false, coin: null })).toContain('wc-list-heart');
    expect(render()).not.toContain('wc-list-heart');
  });

  it('본문이 비면 빈 상태를 그린다', () => {
    const html = render({ campaign: snapshot({ resolvedSections: [] }) });

    expect(html).toContain('아직 공개된 내용이 없어요');
  });

  /* 코인 소진처 UI 에서도 '가챠/뽑기' 어휘 금지는 유지된다(CONTEXT.md · DESIGN §12). */
  it('상세 카피에 금지 어휘가 없다', () => {
    for (const html of [render(), render({ coin: null, signedIn: false })]) {
      expect(html).not.toContain('가챠');
      expect(html).not.toContain('뽑기');
      expect(html).not.toContain('충전');
    }
  });

  /* POP-UP 캠페인 상세 — 같은 랜딩 블록에 장소 줄과 /popups 경로만 더한다(스펙 C §2.6). */
  describe('POP-UP 캠페인 (basePath·venue)', () => {
    const POPUP_LOGIN_HREF = `/login?next=${encodeURIComponent('/popups/summer')}`;

    it('일반 EVENT 랜딩에는 장소 줄이 없고 유형 글자는 EVENT 다', () => {
      const html = render();

      expect(html).not.toContain('wc-campaign__venue');
      expect(html).toContain('>EVENT<');
    });

    it('기간 아래에 "장소 방식 · 장소" 한 줄을 그리고 유형 글자를 POP-UP 으로 바꾼다', () => {
      const html = render({ basePath: '/popups', venue: { mode: 'offline', location: '서울 마포구 월드컵로8길 69 1층' } });

      expect(html).toContain('<p class="wc-campaign__venue"><strong>장소</strong> <span>오프라인 · 서울 마포구 월드컵로8길 69 1층</span></p>');
      expect(html).toContain('>POP-UP<');
      expect(html).not.toContain('>EVENT<');
      /* 기간 줄 바로 아래다. */
      expect(html.indexOf('wc-campaign__venue')).toBeGreaterThan(html.indexOf('wc-campaign__period'));
    });

    it('장소가 없으면 방식만 싣는다(브랜드 문구는 넣지 않는다)', () => {
      const online = render({ basePath: '/popups', venue: { mode: 'online', location: null } });
      const hybrid = render({ basePath: '/popups', venue: { mode: 'hybrid', location: null } });

      expect(online).toContain('<span>온라인</span>');
      expect(hybrid).toContain('<span>온·오프라인</span>');
    });

    /* 로그인 뒤에는 이 POP-UP 으로 돌아온다 — /events 로 하드코딩하면 일반 EVENT 로 떨어진다. */
    it('로그인 복귀 경로가 basePath 를 따른다', () => {
      const html = render({ basePath: '/popups', coin: null, signedIn: false, venue: { mode: 'offline', location: null } });

      expect(html.match(new RegExp(`href="${POPUP_LOGIN_HREF.replace('?', '\\?')}"`, 'g'))).toHaveLength(2);
      expect(html).not.toContain(`href="${LOGIN_HREF}"`);
    });

    it('종료 안내가 POP-UP 목록으로 돌려보낸다', () => {
      const html = render({
        basePath: '/popups',
        campaign: snapshot({ displayState: 'ended', status: 'ended' }),
        venue: { mode: 'online', location: null },
      });

      expect(html).toContain('종료된 POP-UP이에요.');
      expect(html).toContain('<a class="wc-campaign-panel__link" href="/popups">POP-UP 목록 보기</a>');
      expect(html).not.toContain('종료된 이벤트예요.');
    });

    it('일반 EVENT 종료 안내는 /events 로 돌려보낸다', () => {
      const html = render({ campaign: snapshot({ displayState: 'ended', status: 'ended' }) });

      expect(html).toContain('<a class="wc-campaign-panel__link" href="/events">이벤트 목록 보기</a>');
    });
  });
});
