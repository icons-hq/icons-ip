import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DATA } from '@/lib/data';
import { MARKET_LISTINGS, sellerPayout } from '@/lib/secondary-market-demo';
import { MarketDemo, PurchaseDialog, SellDialog } from './MarketDemo';

/* 스태프 전용 시연 화면의 표시 계약 — 옛 프로토타입에서 되살린 에스크로 흐름이 White Catalog
 * 지면 위에 전부 올라와 있고, 시연임을 밝히는 안내가 빠지지 않는지 잠근다.
 * renderToStaticMarkup 이라 effect·포털은 돌지 않는다 — 다이얼로그는 직접 렌더한다. */

describe('MarketDemo 시연 표면', () => {
  const html = renderToStaticMarkup(<MarketDemo />);

  it('시연임을 밝히고 mock 매물 전부를 에스크로 구매 버튼과 함께 나열한다', () => {
    expect(html).toContain('스태프 전용 시연 화면이에요');
    expect(html).toContain('중고 마켓');
    for (const listing of MARKET_LISTINGS) {
      expect(html).toContain(listing.name);
      expect(html).toContain(`@${listing.seller}`);
    }
    expect(html.match(/에스크로 구매/g)?.length).toBe(MARKET_LISTINGS.length);
    expect(html).toContain('검수완료');
    expect(html).toContain('검수 대기');
    expect(html).toContain('판매 등록');
  });

  it('매물이 있는 IP 만 필터 칩으로 세운다', () => {
    const withItems = DATA.IPS.filter((ip) => MARKET_LISTINGS.some((listing) => listing.ip === ip.id));
    const without = DATA.IPS.filter((ip) => !withItems.includes(ip));

    expect(html).toContain('aria-pressed="true"');
    for (const ip of withItems) expect(html).toContain(`>${ip.title}</button>`);
    for (const ip of without) expect(html).not.toContain(`>${ip.title}</button>`);
  });

  it('안전 거래 프로세스 3단계와 수수료가 예시임을 밝힌다', () => {
    expect(html).toContain('검수센터 입고');
    expect(html).toContain('에스크로 결제');
    expect(html).toContain('확정 후 정산');
    expect(html).toContain('시연용 예시');
  });

  it('White Catalog 지면과 카탈로그 그리드를 쓴다', () => {
    expect(html).toContain('class="wc-root"');
    expect(html).toContain('wc-product-grid');
    expect(html).toContain('wc-c2c__notice');
  });
});

describe('MarketDemo 다이얼로그', () => {
  const listing = MARKET_LISTINGS[0];
  const ip = DATA.IPS.find((candidate) => candidate.id === listing.ip);

  it('에스크로 구매는 결제 금액·판매자 정산 예정액을 보여주고 시연 결제임을 밝힌다', () => {
    const html = renderToStaticMarkup(
      <PurchaseDialog ip={ip} listing={listing} onClose={() => {}} onComplete={() => {}} />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain(listing.name);
    expect(html).toContain('에스크로 결제 금액');
    expect(html).toContain(`₩${sellerPayout(listing.price).toLocaleString('ko-KR')}`);
    expect(html).toContain('시연 결제예요');
    expect(html).toContain('에스크로로 결제');
  });

  it('판매 등록 폼은 검수 대기로 시작함을 안내한다', () => {
    const html = renderToStaticMarkup(<SellDialog onClose={() => {}} onSubmit={() => {}} />);

    expect(html).toContain('상품명');
    expect(html).toContain('희망가');
    expect(html).toContain('검수 대기');
    for (const candidate of DATA.IPS) expect(html).toContain(`>${candidate.title}</option>`);
  });
});
