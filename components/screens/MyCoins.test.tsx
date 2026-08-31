import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CoinLedgerEntry } from '@/lib/coins.server';
import { MyCoins } from './MyCoins';

vi.mock('@/components/shell/CardRewardAvailability', () => ({
  useCardRewardsEnabled: () => true,
}));

/* KST 로 그리는지 보이려면 UTC 와 날짜가 갈리는 시각을 써야 한다 —
   2026-08-30T16:30Z 는 UTC 로 8/30 이고 KST 로 8/31 01:30 이다. */
const ATTENDANCE: CoinLedgerEntry = {
  id: '2',
  amount: 1,
  reason: 'attendance',
  attendedOn: '2026-08-31',
  createdAt: '2026-08-30T16:30:00Z',
};

const EXCHANGE: CoinLedgerEntry = {
  id: '1',
  amount: -30,
  reason: 'exchange',
  attendedOn: null,
  createdAt: '2026-08-25T05:00:00Z',
};

/* 코인은 결제 수단이 아니고 소진처도 "카드팩"으로만 부른다(CONTEXT.md).
   화면 전체가 이 어휘를 피하는지 한 자리에서 지킨다. */
const BANNED_WORDS = ['포인트', '충전', '가챠', '뽑기'];

describe('MyCoins 잔액·원장', () => {
  it('보유 코인과 오늘 출석 여부를 상단에 적는다', () => {
    const html = renderToStaticMarkup(
      <MyCoins coin={{ balance: 1200, attendedToday: true }} ledger={[ATTENDANCE]} />,
    );

    expect(html).toContain('보유 코인');
    expect(html).toContain('<strong>1,200</strong>');
    expect(html).toContain('오늘 출석 완료');
  });

  it('미출석과 잔액 조회 실패를 0개·미출석으로 접는다', () => {
    const html = renderToStaticMarkup(<MyCoins coin={null} ledger={[ATTENDANCE]} />);

    expect(html).toContain('<strong>0</strong>');
    expect(html).toContain('오늘 아직 출석하지 않았어요');
  });

  it('적립과 사용을 사유·부호·KST 시각으로 갈라 그린다', () => {
    const html = renderToStaticMarkup(
      <MyCoins coin={{ balance: 1, attendedToday: true }} ledger={[ATTENDANCE, EXCHANGE]} />,
    );

    expect(html).toContain('wc-coin-row--earn');
    expect(html).toContain('출석 체크 적립');
    expect(html).toContain('<strong>+1</strong>개');
    /* UTC 로 그리면 2026.08.30 16:30 이 된다 — 날짜가 하루 밀리는지 여기서 잡는다. */
    expect(html).toContain('2026.08.31 01:30');
    expect(html).toContain('출석일 2026.08.31');

    expect(html).toContain('wc-coin-row--spend');
    expect(html).toContain('카드팩 교환 사용');
    expect(html).toContain('<strong>−30</strong>개');
    expect(html).toContain('2026.08.25 14:00');
  });

  it('내역이 없으면 이벤트 허브로 안내한다', () => {
    const html = renderToStaticMarkup(<MyCoins coin={{ balance: 0, attendedToday: false }} ledger={[]} />);

    expect(html).toContain('아직 코인 내역이 없어요');
    expect(html).toContain('href="/events"');
    expect(html).toContain('이벤트 보러 가기');
    expect(html).not.toContain('wc-coin-row');
  });

  it('안내 박스를 늘 남기고 조회 상한을 그대로 말한다', () => {
    const html = renderToStaticMarkup(<MyCoins coin={null} ledger={[]} />);

    expect(html).toContain('코인 안내');
    expect(html).toContain('결제에는 쓸 수 없어요');
    expect(html).toContain('카드팩으로 바꿀 수 있어요');
    expect(html).toContain('최근 50건');
  });

  it('결제·유료 가챠 어휘를 어느 상태에서도 쓰지 않는다', () => {
    const filled = renderToStaticMarkup(
      <MyCoins coin={{ balance: 1200, attendedToday: true }} ledger={[ATTENDANCE, EXCHANGE]} />,
    );
    const empty = renderToStaticMarkup(<MyCoins coin={null} ledger={[]} />);

    for (const word of BANNED_WORDS) {
      expect(filled).not.toContain(word);
      expect(empty).not.toContain(word);
    }
  });

  it('마이페이지 메뉴에서 코인을 쿠폰함 옆에 세운다', () => {
    const html = renderToStaticMarkup(<MyCoins coin={null} ledger={[]} />);

    expect(html).toContain('href="/my/coins"');
    expect(html).toContain('aria-current="page"');
    expect(html.indexOf('href="/my/coupons"')).toBeLessThan(html.indexOf('href="/my/coins"'));
  });
});
