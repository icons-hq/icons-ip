import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DATA } from '@/lib/data';
import { TRADE_LISTINGS, formatCountdown, minNextBid, type AuctionTrade, type DirectTrade } from '@/lib/secondary-market-demo';
import { BidDialog, ExchangeDemo, ListTradeDialog, OfferDialog } from './ExchangeDemo';

/* 카드 트레이드 시연의 표시 계약. 공개 플레이스홀더(Exchange.test.tsx)가 금지하는 어휘(입찰·경매·
 * 에스크로)는 이 스태프 전용 표면에서만 허용된다 — 두 테스트가 서로의 경계를 지킨다. */

const auction = TRADE_LISTINGS.find((trade): trade is AuctionTrade => trade.kind === '경매')!;
const direct = TRADE_LISTINGS.find((trade): trade is DirectTrade => trade.kind === '직거래')!;
const ipsById = new Map(DATA.IPS.map((ip) => [ip.id, ip]));
const myCards = DATA.CARDS.filter((card) => card.owned);

describe('ExchangeDemo 시연 표면', () => {
  const html = renderToStaticMarkup(<ExchangeDemo />);

  it('시연임을 밝히고 직거래·경매 mock 을 유형별 행동과 함께 나열한다', () => {
    expect(html).toContain('스태프 전용 시연 화면이에요');
    expect(html).toContain('카드 트레이드');
    for (const trade of TRADE_LISTINGS) {
      expect(html).toContain(trade.card);
      expect(html).toContain(`@${trade.user}`);
    }
    const auctions = TRADE_LISTINGS.filter((trade) => trade.kind === '경매').length;
    const directs = TRADE_LISTINGS.length - auctions;
    expect(html.match(/>입찰<\/button>/g)?.length).toBe(auctions);
    expect(html.match(/트레이드 제안하기/g)?.length).toBe(directs);
  });

  it('유형 필터에 건수를 붙이고 경매 마감 카운트다운을 처음 값으로 그린다', () => {
    expect(html).toContain(`전체 <span class="wc-c2c__chip-count">${TRADE_LISTINGS.length}</span>`);
    expect(html).toContain(`마감 ${formatCountdown(auction.endsInSec)}`);
    expect(html).toContain(`₩${auction.bid.toLocaleString('ko-KR')}`);
    expect(html).toContain(`원함 · </span>${direct.want}`);
  });

  it('체결 방식이 시연임을 밝히고 카드 C2C 를 트레이드로 부른다', () => {
    expect(html).toContain('이 화면의 체결은 시연입니다');
    expect(html).toContain('트레이드 등록');
    /* 카드 C2C 의미의 "교환" 은 굿즈 클레임 용어라 시연에서도 쓰지 않는다. */
    expect(html).not.toContain('교환');
  });
});

describe('ExchangeDemo 다이얼로그', () => {
  it('입찰 다이얼로그는 현재가 + 입찰 단위를 최소 입찰가로 제시한다', () => {
    const html = renderToStaticMarkup(
      <BidDialog elapsed={0} onClose={() => {}} onSubmit={() => {}} trade={auction} />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('최소 입찰가');
    expect(html).toContain(`₩${minNextBid(auction.bid).toLocaleString('ko-KR')}`);
    expect(html).toContain(`value="${minNextBid(auction.bid)}"`);
    expect(html).toContain('시연 입찰이에요');
  });

  it('제안 다이얼로그는 보유 카드만 고르게 한다', () => {
    const html = renderToStaticMarkup(
      <OfferDialog ipsById={ipsById} myCards={myCards} onClose={() => {}} onSubmit={() => {}} trade={direct} />,
    );

    /* 제안 대상 카드는 요약 영역에 나오므로 미보유 부재는 카드 고르기 블록 안에서만 검사한다. */
    const picker = html.slice(html.indexOf('wc-c2c__my-cards'));
    for (const card of myCards) expect(picker).toContain(card.name);
    for (const card of DATA.CARDS.filter((candidate) => !candidate.owned)) expect(picker).not.toContain(card.name);
    expect(html).toContain('제안 보내기');
    expect(html).toContain('disabled=""');
  });

  it('등록 다이얼로그는 직거래·경매 유형을 고르게 한다', () => {
    const html = renderToStaticMarkup(
      <ListTradeDialog elapsed={0} myCards={myCards} onClose={() => {}} onSubmit={() => {}} />,
    );

    expect(html).toContain('name="trade-kind"');
    expect(html).toContain('원하는 카드·조건');
    expect(html).toContain(`>${myCards[0].name} · ${myCards[0].rarity}</option>`);
  });
});
