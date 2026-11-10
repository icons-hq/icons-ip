import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CampaignLandingSnapshot, ResolvedCampaignSection } from '@/lib/campaigns.server';
import { CampaignLanding } from './CampaignLanding';

vi.mock('@/app/events/participation-actions', () => ({
  attendanceCheckInAction: vi.fn(),
  exchangeCoinsAction: vi.fn(),
}));
/* 굿즈 진열 카드의 목록 하트(L4b)가 라우터·위시 액션을 쓴다. */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));

const OFFER_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_OFFER_ID = '44444444-4444-4444-8444-444444444444';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_OPERATION_ID = '55555555-5555-4555-8555-555555555555';
const LOGIN_HREF = `/login?next=${encodeURIComponent('/events/summer')}`;

/* 교환 블록은 인덱스 7 이다 — 멱등 키 맵의 키가 그 자리와 맞물린다. */
const EXCHANGE_INDEX = 7;

const SECTIONS: ResolvedCampaignSection[] = [
  { type: 'intro', anchor: '소개', copy: '여름 내내 출석하고 카드팩을 받아 가세요.' },
  {
    type: 'image',
    image_path: 'campaigns/mid.png',
    imageUrl: 'https://cdn.test/public-media/campaigns/mid.png',
    alt: '캠페인 안내 이미지',
  },
  { type: 'text', heading: '참여 방법', body: '매일 출석하면 코인이 쌓여요.' },
  { type: 'notice', anchor: '유의사항', items: ['코인은 기간 내에만 교환할 수 있어요.'] },
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
  {
    type: 'exchange',
    anchor: '교환',
    offer_id: OFFER_ID,
    offer: { id: OFFER_ID, label: '카드팩 1개', coinCost: 30, ticketCount: 1 },
  },
];

function snapshot(overrides: Partial<CampaignLandingSnapshot> = {}): CampaignLandingSnapshot {
  return {
    id: 'summer',
    kind: 'event',
    title: '여름 코인 이벤트',
    subtitle: '출석하고 카드팩 받기',
    cardImagePath: null,
    bannerImagePath: null,
    heroImagePath: 'https://cdn.test/hero.png',
    featuredOrder: null,
    startsAt: '2026-08-06T15:00:00.000Z',
    endsAt: '2026-08-31T14:59:00.000Z',
    status: 'published',
    displayState: 'ongoing',
    sections: [],
    resolvedSections: SECTIONS,
    ...overrides,
  };
}

function render(props: Partial<Parameters<typeof CampaignLanding>[0]> = {}) {
  return renderToStaticMarkup(
    <CampaignLanding
      campaign={snapshot()}
      cardRewardsEnabled
      coin={{ balance: 40, attendedToday: false }}
      exchangeOperationIds={{ [EXCHANGE_INDEX]: OPERATION_ID }}
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

    expect(html).toContain('여름 내내 출석하고 카드팩을 받아 가세요.');
    expect(html).toContain('aria-label="캠페인 안내 이미지"');
    /* 히어로와 같은 Storage 경로다 — 로더가 해석한 공개 URL 을 배경으로 쓴다.
       원문 경로가 그대로 흘러가면 이 블록만 배경이 빈다. */
    expect(html).toContain('https://cdn.test/public-media/campaigns/mid.png');
    expect(html).not.toContain('url(&quot;campaigns/mid.png&quot;)');
    expect(html).toContain('참여 방법');
    expect(html).toContain('코인은 기간 내에만 교환할 수 있어요.');
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
    expect(html).toContain('href="#campaign-section-7"');
    expect(html).not.toContain('href="#campaign-section-1"');
    expect(html).toContain('id="campaign-section-1"');
  });

  /* 목차로 이동하면 포커스가 섹션 제목으로 온다(CampaignAnchorNav) — 기본 해시 이동이 옮기던
     '이어 읽을 자리'다. 제목은 탭 순서에 끼어들지 않는다. */
  it('앵커 섹션 제목을 탭 순서 밖의 포커스 대상으로 둔다', () => {
    const html = render();

    expect(html).toContain('<h2 class="wc-campaign-section__heading" tabindex="-1">유의사항</h2>');
    expect(html.match(/class="wc-campaign-section__heading" tabindex="-1"/g)).toHaveLength(4);
    expect(html).not.toMatch(/wc-campaign-section__heading"[^>]*tabindex="0"/);
  });

  it('로그인 상태에서는 잔액과 교환 비용을 노출한다', () => {
    const html = render();

    expect(html).toContain('<p class="wc-campaign-nav__coin">코인 <strong>40</strong></p>');
    expect(html).toContain('코인 <strong>30</strong>개 · 카드팩 1개');
    expect(html).toContain('카드팩 1개');
    expect(html).toContain('카드팩 교환하기');
    expect(html).toContain(`value="${OPERATION_ID}"`);
    expect(html).toContain(`value="${OFFER_ID}"`);
  });

  /* R-06 §2.2 문법 — 게스트에게는 같은 자리에 로그인 CTA 가 온다(코인 박스·출석·교환 3곳). */
  it('게스트에게는 세 자리 모두 로그인 CTA로 치환한다', () => {
    const html = render({ coin: null, signedIn: false });

    expect(html.match(new RegExp(`href="${LOGIN_HREF.replace('?', '\\?')}"`, 'g'))).toHaveLength(3);
    expect(html).toContain('로그인하고 코인 확인');
    expect(html).toContain('로그인하고 출석하기');
    expect(html).toContain('로그인하고 교환하기');
    expect(html).not.toContain('출석 체크하기');
  });

  it('오늘 출석했으면 버튼을 비활성 문구로 바꾼다', () => {
    const html = render({ coin: { balance: 40, attendedToday: true } });

    expect(html).toContain('오늘은 출석했어요');
    expect(html).not.toContain('출석 체크하기');
  });

  /* 비활성만 남기면 왜 못 누르는지 화면에 없다(DESIGN §9). */
  it('잔액이 모자라면 버튼을 잠그고 이유를 적는다', () => {
    const html = render({ coin: { balance: 2, attendedToday: false } });

    expect(html).toContain('코인이 부족해요.');
    expect(html).toContain('disabled=""');
  });

  it('교환할 카드팩을 못 찾으면 자리는 남기고 안내만 바꾼다', () => {
    const html = render({
      campaign: snapshot({
        resolvedSections: [{ type: 'exchange', anchor: '교환', offer_id: OFFER_ID, offer: null }],
      }),
    });

    expect(html).toContain('지금은 교환할 수 없어요.');
    expect(html).toContain('교환할 카드팩이 준비되면 다시 안내해 드릴게요.');
    expect(html).toContain('href="#campaign-section-0"');
    expect(html).not.toContain('카드팩 교환하기');
  });

  /* 한 페이지에 교환 블록이 여러 개일 수 있다. 키를 공유하면 첫 교환이 성립한 뒤
     다른 교환 설정 제출이 already_exchanged 로 답해 가짜 성공이 된다. */
  it('교환 블록마다 자기 멱등 키를 심는다', () => {
    const html = render({
      campaign: snapshot({
        resolvedSections: [
          {
            type: 'exchange',
            offer_id: OFFER_ID,
            offer: { id: OFFER_ID, label: '카드팩 1개', coinCost: 10, ticketCount: 1 },
          },
          {
            type: 'exchange',
            offer_id: SECOND_OFFER_ID,
            offer: { id: SECOND_OFFER_ID, label: '카드팩 3개', coinCost: 20, ticketCount: 3 },
          },
        ],
      }),
      exchangeOperationIds: { 0: OPERATION_ID, 1: SECOND_OPERATION_ID },
    });

    expect(html).toContain(`value="${OPERATION_ID}"`);
    expect(html).toContain(`value="${SECOND_OPERATION_ID}"`);
    expect(html).toContain(`value="${OFFER_ID}"`);
    expect(html).toContain(`value="${SECOND_OFFER_ID}"`);
  });

  /* /packs·게임·마이 메뉴는 게이트 OFF 에서 표면을 감춘다. 캠페인 랜딩만 교환 CTA 를
     남기면 누를 수 있는데 서버가 거절하는 버튼이 된다. */
  it('카드 리워드 게이트가 내려가면 교환 블록을 목차까지 통째로 뺀다', () => {
    const html = render({ cardRewardsEnabled: false });

    expect(html).not.toContain('카드팩 교환하기');
    expect(html).not.toContain('지금은 교환할 수 없어요.');
    expect(html).not.toContain(`value="${OFFER_ID}"`);
    expect(html).not.toContain('>교환</a>');
    /* 출석·코인 박스는 게이트와 무관하다 — 코인은 카드가 아니라 참여 재화다. */
    expect(html).toContain('출석 체크하기');
    expect(html).toContain('<p class="wc-campaign-nav__coin">코인 <strong>40</strong></p>');
    /* 나머지 본문은 그대로 열린다. */
    expect(html).toContain('여름 내내 출석하고 카드팩을 받아 가세요.');
    expect(html).toContain('아크릴 블록');
  });

  it('게이트가 내려가도 교환 블록이 없는 캠페인은 그대로다', () => {
    const enabled = render({
      campaign: snapshot({ resolvedSections: [{ type: 'attendance', anchor: '출석' }] }),
    });
    const disabled = render({
      campaign: snapshot({ resolvedSections: [{ type: 'attendance', anchor: '출석' }] }),
      cardRewardsEnabled: false,
    });

    expect(disabled).toBe(enabled);
  });

  it('종료된 캠페인은 참여 패널 자리를 종료 안내로 바꾸되 본문은 그대로 연다', () => {
    const html = render({ campaign: snapshot({ displayState: 'ended', status: 'ended' }) });

    expect(html).toContain('종료된 이벤트예요.');
    expect(html).toContain('여름 내내 출석하고 카드팩을 받아 가세요.');
    expect(html).not.toContain('출석 체크하기');
    expect(html).not.toContain('카드팩 교환하기');
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

  /* 이동 버튼은 카드 리워드와 무관한 블록이다 — 게이트가 내려가도 그대로 남는다. */
  it('카드 리워드 게이트와 무관하게 이동 버튼을 남긴다', () => {
    const html = render({
      campaign: snapshot({ resolvedSections: [{ type: 'cta', label: '홈으로', href: '/' }] }),
      cardRewardsEnabled: false,
    });

    expect(html).toContain('href="/">홈으로</a>');
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
});
