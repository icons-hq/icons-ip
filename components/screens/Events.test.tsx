import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FandomEvent, Ip } from '@/lib/data';
import { Events, offlinePopupStateVariant } from './Events';

function ip(id: string, title: string): Ip {
  return {
    id,
    title,
    sub: 'ORIGINAL IP',
    v: { key: 'webtoon', label: '웹툰', color: '#38F0C0' },
    glyph: '火',
    tagline: '태그라인',
    synopsis: '소개',
    bg: 'linear-gradient(#111, #222)',
    fans: 100,
    goods: 0,
    cards: 0,
    featured: false,
  };
}

function event(id: string, overrides: Partial<FandomEvent> = {}): FandomEvent {
  return {
    id,
    title: `팝업 ${id}`,
    ip: 'ip1',
    mode: '오프라인',
    status: '예매중',
    date: '7.25 - 7.28',
    loc: '성수 ICONS 스튜디오',
    accent: '#38F0C0',
    img: 'linear-gradient(#111, #222)',
    ...overrides,
  };
}

const ips = [ip('ip1', '화산강림'), ip('ip2', '리락쿠마')];

function render(events: FandomEvent[], extra: Partial<Parameters<typeof Events>[0]> = {}) {
  return renderToStaticMarkup(<Events catalog={{ ips, events }} {...extra} />);
}

/** 카드 본체 링크 하나의 마크업 — 카드 아래 보조 링크와 가른다. */
function cardLinkHtml(html: string, id: string) {
  const start = html.indexOf(`<a class="wc-offline-card__link" href="/offline-popups/${id}">`);
  /* 마커를 못 찾으면 빈 문자열로 접혀 not.toContain 단언이 공허하게 통과한다 — 여기서 막는다. */
  expect(start, `카드 링크 ${id}`).toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf('</a>', start) + 4);
}

describe('Events', () => {
  it('explains provider-confirmed ticket issuance without naming a legacy provider', () => {
    const html = renderToStaticMarkup(<Events catalog={{ ips: [], events: [] }} />);

    expect(html).toContain('결제사 승인 확인 후 티켓이 발급돼요');
    expect(html).not.toContain('토스페이먼츠로 결제해요');
  });

  /* 11 §8 EV-04 — White Catalog 지면 안으로 이행한다. 구 조판의 인라인 스타일·HM 토큰·
     등장 연출 클래스를 남기지 않는다(카드 썸네일의 이벤트 아트 배경만 데이터 그대로 쓴다). */
  it('White Catalog 지면에 왼쪽 정렬 제목과 리드를 두고 구 조판 흔적을 남기지 않는다', () => {
    const html = render([event('e1'), event('e2', { ip: 'ip2', status: '진행중' })]);

    expect(html).toContain('class="wc-root wc-offline"');
    expect(html).toContain('<h1 class="wc-offline__title">오프라인 팝업</h1>');
    expect(html).toContain('공식 오프라인 팝업스토어를 발견하고, 예매부터 QR 입장까지 한 번에.');
    for (const legacy of ['var(--mint)', 'var(--cyan)', 'clamp(', 'btn-holo', 'eyebrow', 'rise', 'event-grid', 'event-guide-grid', 'h-xl']) {
      expect(html, legacy).not.toContain(legacy);
    }
    expect(html.match(/style="/g)).toHaveLength(2);
  });

  /* R-06 §1.4 카드 문법 + DESIGN §6 campaign-hub 보완 규칙(기간·상태 뱃지). */
  it('카드는 상세로 가는 링크 하나에 유형 뱃지·제목·장소·기간·상태를 싣는다', () => {
    const html = render([event('e1')]);
    const card = cardLinkHtml(html, 'e1');

    expect(card).toContain('class="wc-offline-card__media"');
    expect(card).toContain('<span class="wc-offline-card__kind">오프라인</span>');
    expect(card).toContain('<p class="wc-offline-card__ip">화산강림</p>');
    expect(card).toContain('<h2 class="wc-offline-card__title">팝업 e1</h2>');
    expect(card).toContain('성수 ICONS 스튜디오');
    expect(card).toContain('<span class="wc-offline-card__period">7.25 - 7.28</span>');
    expect(card).toContain('<span class="wc-offline-state wc-offline-state--open">예매중</span>');
  });

  it('일정·장소가 비면 공개 예정으로 적는다', () => {
    const card = cardLinkHtml(render([event('e1', { date: '', loc: '' })]), 'e1');

    expect(card).toContain('일정 공개 예정');
    expect(card).toContain('장소 공개 예정');
  });

  /* 링크 안의 링크는 만들 수 없다 — 게임 진입은 카드 링크 밖의 보조 링크다. */
  it('참여형 게임 진입 링크는 카드 링크 밖에 둔다', () => {
    const html = render([event('e1')], { gameLinks: [{ eventId: 'e1', gameId: 'marble', title: '마블 룰렛' }] });

    expect(cardLinkHtml(html, 'e1')).not.toContain('/games/marble');
    expect(html).toContain('<a class="wc-offline-card__game" href="/games/marble">마블 룰렛 플레이</a>');
  });

  it('진행중 → 예매중 → 예정 순서로 싣는다', () => {
    const html = render([
      event('soon', { status: '예정' }),
      event('booking', { status: '예매중' }),
      event('live', { status: '진행중' }),
    ]);

    const order = ['live', 'booking', 'soon'].map((id) => html.indexOf(`href="/offline-popups/${id}"`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('필터는 누른 상태를 aria-pressed 로 알리고 IP 딥링크를 선택한 채 연다', () => {
    const html = render([event('e1'), event('e2', { ip: 'ip2', status: '진행중' })], { initialIpId: 'ip2' });

    expect(html).toContain('<div aria-label="IP 필터" class="wc-offline-filters__group" role="group">');
    expect(html).toMatch(/<button aria-pressed="true" class="wc-offline-chip"[^>]*>리락쿠마<\/button>/);
    expect(html).toMatch(/<button aria-pressed="false" class="wc-offline-chip"[^>]*>전체 IP<\/button>/);
    expect(html).toContain('aria-label="상태 필터"');
    /* 딥링크 IP 로 좁혀진 목록이다. */
    expect(html).toContain('href="/offline-popups/e2"');
    expect(html).not.toContain('href="/offline-popups/e1"');
  });

  /* 고를 것이 하나뿐인 축은 눌러도 목록이 바뀌지 않는 버튼이다 — 내놓지 않는다. */
  it('선택지가 하나뿐인 상태·모드 축은 필터로 내놓지 않는다', () => {
    const html = render([event('e1'), event('e2', { ip: 'ip2' })]);

    expect(html).toContain('aria-label="IP 필터"');
    expect(html).not.toContain('aria-label="상태 필터"');
    expect(html).not.toContain('aria-label="모드 필터"');
  });

  /* 고객 화면에 개발 안내(Supabase seed 등)를 남기지 않는다. 빈 상태에는 다음 행동 하나(DESIGN §9). */
  it('등록된 팝업이 없으면 빈 상태와 다음 행동 하나를 낸다', () => {
    const html = render([]);

    expect(html).toContain('등록된 오프라인 팝업이 아직 없어요');
    expect(html).toContain('href="/"');
    expect(html).not.toContain('Supabase');
    expect(html).not.toContain('admin');
    expect(html).not.toContain('wc-offline-filters');
  });
});

describe('offlinePopupStateVariant', () => {
  it('상태 글자마다 뱃지 변형이 정해져 있다', () => {
    expect(offlinePopupStateVariant('예매중')).toBe('open');
    expect(offlinePopupStateVariant('진행중')).toBe('live');
    expect(offlinePopupStateVariant('예정')).toBe('upcoming');
    expect(offlinePopupStateVariant('종료')).toBe('ended');
    expect(offlinePopupStateVariant('알 수 없음')).toBe('other');
  });
});
