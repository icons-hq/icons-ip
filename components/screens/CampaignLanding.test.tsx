import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CampaignLandingSnapshot, ResolvedCampaignSection } from '@/lib/campaigns.server';
import { CampaignLanding } from './CampaignLanding';

vi.mock('@/app/events/participation-actions', () => ({
  attendanceCheckInAction: vi.fn(),
  exchangeCoinsAction: vi.fn(),
}));

const OFFER_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const LOGIN_HREF = `/login?next=${encodeURIComponent('/events/summer')}`;

const SECTIONS: ResolvedCampaignSection[] = [
  { type: 'intro', anchor: '소개', copy: '여름 내내 출석하고 카드팩을 받아 가세요.' },
  { type: 'image', image_path: 'https://cdn.test/mid.png', alt: '캠페인 안내 이미지' },
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
      coin={{ balance: 40, attendedToday: false }}
      operationId={OPERATION_ID}
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

  it('교환 상품을 못 찾으면 자리는 남기고 안내만 바꾼다', () => {
    const html = render({
      campaign: snapshot({
        resolvedSections: [{ type: 'exchange', anchor: '교환', offer_id: OFFER_ID, offer: null }],
      }),
    });

    expect(html).toContain('지금은 교환할 수 없어요.');
    expect(html).toContain('href="#campaign-section-0"');
    expect(html).not.toContain('카드팩 교환하기');
  });

  it('종료된 캠페인은 참여 패널 자리를 종료 안내로 바꾸되 본문은 그대로 연다', () => {
    const html = render({ campaign: snapshot({ displayState: 'ended', status: 'ended' }) });

    expect(html).toContain('종료된 이벤트예요.');
    expect(html).toContain('여름 내내 출석하고 카드팩을 받아 가세요.');
    expect(html).not.toContain('출석 체크하기');
    expect(html).not.toContain('카드팩 교환하기');
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
