import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { FandomEvent, Ip } from '@/lib/data';
import type { PublicTicketType } from '@/lib/ticketing.server';
import { EventDetail } from './EventDetail';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/app/offline-popups/actions', () => ({
  reserveTicketsAction: vi.fn(),
}));
vi.mock('@/app/ip/actions', () => ({
  setIpNotificationPreferencesAction: vi.fn(),
}));

const event: FandomEvent = {
  id: 'e100',
  title: '화산강림 여름 팝업',
  ip: 'ip100',
  mode: '오프라인',
  status: '예매중',
  date: '7.25 - 7.28',
  loc: '성수 ICONS 스튜디오',
  accent: '#38F0C0',
  img: 'linear-gradient(#111, #222)',
};

const ip = {
  id: 'ip100',
  title: '화산강림',
  sub: 'ORIGINAL IP',
  v: { key: 'webtoon', label: '웹툰', color: '#38F0C0' },
  glyph: '火',
  tagline: '불꽃처럼 피어나는 이야기',
  synopsis: '화산강림 세계관',
  bg: 'linear-gradient(#111, #222)',
  fans: 10000,
  goods: 3,
  cards: 10,
  featured: true,
} satisfies Ip;

const sessions: PublicTicketType[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    eventId: event.id,
    name: '7월 25일 1회차',
    price: 25000,
    capacity: 80,
    sold: 12,
    remaining: 68,
    maxQuantity: 4,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    eventId: event.id,
    name: '7월 25일 2회차',
    price: 25000,
    capacity: 20,
    sold: 20,
    remaining: 0,
    maxQuantity: 0,
  },
];

function render(overrides: Partial<Parameters<typeof EventDetail>[0]> = {}) {
  return renderToStaticMarkup(
    <EventDetail
      authHref="/login?next=%2Foffline-popups%2Fe100"
      authState="ready"
      event={event}
      ip={ip}
      notificationError={false}
      notificationSaved={false}
      notificationState={null}
      paymentAvailable
      sessions={sessions}
      {...overrides}
    />,
  );
}

describe('EventDetail', () => {
  it('keeps event details public and shows real allocation-based session choices', () => {
    const html = render();

    expect(html).toContain('화산강림 여름 팝업');
    expect(html).toContain('7월 25일 1회차');
    expect(html).toContain('₩25,000');
    expect(html).toContain('잔여 68');
    expect(html).toContain('결제 대기 포함');
    expect(html).toContain('name="ticketTypeId"');
    expect(html).toContain('name="qty"');
    expect(html).toContain('for="event-ticket-qty"');
    expect(html).toContain('id="event-ticket-qty"');
    expect(html).toContain('aria-live="polite"');
  });

  it('preserves the event detail as the login return path', () => {
    const html = render({ authState: 'signed-out' });

    expect(html).toContain('href="/login?next=%2Foffline-popups%2Fe100"');
    expect(html).toContain('로그인하고 예매');
  });

  it('disables sold-out, zero-price, and non-booking event sessions with an explanation', () => {
    const soldOut = render({ sessions: [sessions[1]!] });
    const free = render({ sessions: [{ ...sessions[0]!, price: 0 }] });
    const scheduled = render({ event: { ...event, status: '예정' } });

    expect(soldOut).toContain('정원 마감');
    expect(soldOut).toContain('disabled=""');
    expect(free).toContain('0원 회차는 현재 예매할 수 없어요');
    expect(scheduled).toContain('현재 예매 가능한 오프라인 팝업이 아니에요');
  });

  it('단가가 1,000원 미만이어도 총액을 맞출 수 있으면 최소 수량으로 예매한다', () => {
    const html = render({ sessions: [{ ...sessions[0]!, price: 600 }] });

    expect(html).toContain('value="2"');
    expect(html).toContain('₩1,200');
    expect(html).not.toContain('결제사 최소 금액 미만 회차는 현재 예매할 수 없어요');
  });

  it('최소 결제 총액이 1인 한도 안에서 불가능하면 회차를 비활성화한다', () => {
    const html = render({
      sessions: [{ ...sessions[0]!, price: 200, remaining: 10, maxQuantity: 4 }],
    });

    expect(html).toContain('1인 예매 한도로는 결제사 최소 금액을 맞출 수 없어요');
    expect(html).toContain('disabled=""');
  });

  it('fails closed before reservation when payment is unavailable', () => {
    const html = render({ paymentAvailable: false });

    expect(html).toContain('결제 환경을 확인 중이라 지금은 예매할 수 없어요');
    expect(html).toContain('disabled=""');
  });

  it('explains where the private QR appears after payment', () => {
    const html = render();

    expect(html).toContain('전자티켓 이용 안내');
    expect(html).toContain('결제 확인 후 내 티켓에서 QR을 확인');
    expect(html).toContain('결제사 승인 결과를 서버에서 확인한 뒤 완료를 안내합니다');
    expect(html).not.toContain('웹훅 확인 후');
    expect(html).toContain('href="/tickets"');
  });

  it('shows a secondary auto-follow action outside booking for scheduled IP events', () => {
    const html = render({
      event: { ...event, status: '예정' },
      notificationError: true,
      notificationState: { isFollowed: false, notifyDrops: false, notifyEvents: false },
    });
    const bookingStart = html.indexOf('wc-offline-buybox');
    const bookingEnd = html.indexOf('</form>', bookingStart);
    const notificationAction = html.indexOf('wc-offline-alert');

    expect(html).toContain('팔로우하고 새 이벤트 알림 받기');
    expect(html).toContain('새로운 팝업·이벤트가 공개되면');
    expect(html).toContain('name="autoFollow" value="1"');
    expect(html).toContain('name="notifyEvents" value="1"');
    expect(html).toContain('알림 설정을 저장하지 못했습니다');
    expect(notificationAction).toBeGreaterThan(bookingEnd);
  });

  it('lets a followed user explicitly disable an enabled event channel', () => {
    const html = render({
      event: { ...event, status: '예정' },
      notificationState: { isFollowed: true, notifyDrops: true, notifyEvents: true },
    });

    expect(html).toContain('이 IP 이벤트 알림 끄기');
    expect(html).toContain('name="notifyEvents" value="0"');
    expect(html).not.toContain('name="autoFollow"');
  });

  it('announces a successful event preference update', () => {
    const html = render({
      event: { ...event, status: '예정' },
      notificationSaved: true,
      notificationState: { isFollowed: true, notifyDrops: true, notifyEvents: true },
    });

    expect(html).toContain('role="status"');
    expect(html).toContain('이벤트 알림 설정을 저장했습니다');
  });

  it('hides the event preference action for non-scheduled or joint events', () => {
    const state = { isFollowed: false, notifyDrops: false, notifyEvents: false };
    const booking = render({ notificationState: state });
    const joint = render({
      event: { ...event, ip: null, status: '예정' },
      ip: null,
      notificationState: state,
    });

    expect(booking).not.toContain('wc-offline-alert');
    expect(joint).not.toContain('wc-offline-alert');
  });

  /* 11 §8 EV-04 — White Catalog 지면 안으로 이행한다. 구 조판 클래스·HM 토큰·IP 액센트
     인라인 색을 남기지 않는다(아트 배경만 데이터 그대로 쓴다). */
  it('White Catalog 지면에 안내형 머리를 두고 구 조판 흔적을 남기지 않는다', () => {
    const html = render();

    expect(html).toContain('<main class="wc-root wc-offline-detail">');
    expect(html).toContain('<h1 class="wc-offline-detail__title">화산강림 여름 팝업</h1>');
    expect(html).toContain('<span class="wc-offline-state wc-offline-state--open">예매중</span>');
    expect(html).toContain('<dt>기간</dt><dd>7.25 - 7.28</dd>');
    expect(html).toContain('<dt>장소</dt><dd>성수 ICONS 스튜디오</dd>');
    expect(html).toContain('href="/offline-popups"');
    /* 목록의 피처드 블록을 걷어 낸 뒤 IP 관으로 가는 길은 상세 머리에 남는다. */
    expect(html).toContain('<a class="wc-offline-detail__ip" href="/ip/ip100">화산강림</a>');
    for (const legacy of ['btn-holo', 'btn-ghost', 'h-xl', 'mono', 'checkout-step', 'event-booking-layout', 'sheen', '#0A0813', 'class="sr-only"']) {
      expect(html, legacy).not.toContain(legacy);
    }
    expect(html.match(/style="/g)).toHaveLength(1);
  });

  /* R-04 buybox 문법 — 선택 → 수량 스테퍼 → 1px 잉크 선 위 합계 → 잉크 CTA 순서. */
  it('예매 칸은 선택·수량 스테퍼·합계·잉크 CTA 순서로 읽힌다', () => {
    const html = render();
    const order = [
      'name="ticketTypeId"',
      'class="wc-offline-buybox__selection"',
      'class="wc-stepper"',
      'class="wc-offline-buybox__totals"',
      'class="wc-btn primary wc-offline-buybox__cta"',
    ].map((marker) => html.indexOf(marker));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toMatch(/<input class="wc-stepper__input"[^>]*id="event-ticket-qty"/);
    expect(html).toContain('<div class="wc-offline-buybox__total"><dt>결제 금액</dt><dd>₩25,000</dd></div>');
    expect(html).toContain('예매하고 결제하기');
  });

  it('마감 회차는 이유를 글자로 남기고 선택 회차를 표시한다', () => {
    const html = render();

    expect(html).toContain('class="wc-offline-session is-selected"');
    expect(html).toContain('class="wc-offline-session is-disabled"');
    expect(html).toContain('<legend class="wc-sr-only">티켓 회차</legend>');
  });
});
