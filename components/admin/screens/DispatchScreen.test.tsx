import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminDispatchConsoleData } from '@/lib/admin/dispatch';
import { DispatchScreen } from './DispatchScreen';

vi.mock('@/app/admin/order-actions', () => ({
  bulkConfirmAdminOrdersAction: vi.fn(),
}));

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORDER_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-08-18T06:00:00.000Z');

function data(overrides: Partial<AdminDispatchConsoleData> = {}): AdminDispatchConsoleData {
  return {
    counts: { new: 2 },
    filters: { tab: 'new', from: null, to: null, query: '', page: 1 },
    pageSize: 20,
    total: 2,
    rows: [
      {
        id: ORDER_ID,
        buyerName: 'maple_fan',
        createdAt: '2026-08-18T03:00:00.000Z',
        total: 57000,
        paymentProvider: 'korpay',
        items: { leadName: '홍실 아크릴 블록', otherCount: 2, totalQty: 4 },
      },
      {
        id: OTHER_ORDER_ID,
        buyerName: 'second_fan',
        createdAt: '2026-08-15T06:00:00.000Z',
        total: 30000,
        paymentProvider: null,
        items: { leadName: '화산강림 스탠드', otherCount: 0, totalQty: 1 },
      },
    ],
    ...overrides,
  };
}

describe('DispatchScreen', () => {
  it('신규주문 컬럼을 스마트스토어 순서 그대로 보여준다', () => {
    const html = renderToStaticMarkup(<DispatchScreen data={data()} now={NOW} />);

    for (const column of ['주문번호', '주문일시', '구매자', '굿즈', '수량', '결제수단', '결제금액', '경과시간']) {
      expect(html).toContain(column);
    }
    expect(html).toContain('홍실 아크릴 블록 외 2건');
    expect(html).toContain('4개');
    expect(html).toContain('3시간');
    expect(html).toContain('3일');
  });

  /* 금액을 만 단위로 접으면 결제 원장과 대조할 수 없다. */
  it('결제금액을 축약하지 않고 원 단위로 보여준다', () => {
    const html = renderToStaticMarkup(<DispatchScreen data={data()} now={NOW} />);

    expect(html).toContain('₩57,000');
    expect(html).not.toContain('₩6만');
  });

  /* 카드·무통장 같은 실제 결제수단은 staff 읽기 표면에 없다. 없는 값을 지어내면
     무통장 주문을 입금 확인 없이 발주확인하게 된다. */
  it('확인할 수 없는 결제수단을 지어내지 않는다', () => {
    const html = renderToStaticMarkup(<DispatchScreen data={data()} now={NOW} />);

    expect(html).toContain('Korpay');
    expect(html).toContain('확인 필요');
  });

  it('행 선택과 선택 목록 전달을 위한 체크박스·hidden 이름을 건다', () => {
    const html = renderToStaticMarkup(<DispatchScreen data={data()} now={NOW} />);

    expect(html).toContain('aria-label="전체 선택"');
    expect(html).toContain(`aria-label="주문 ${ORDER_ID.replaceAll('-', '').slice(-8).toUpperCase()} 선택"`);
    expect(html).toContain(`value="${ORDER_ID}"`);
  });

  /* 0건 칩을 감추면 "정말 0건"과 "집계를 못 불러옴"을 구분할 수 없다. */
  it('탭 건수는 0건도 그대로 보여준다', () => {
    const html = renderToStaticMarkup(
      <DispatchScreen data={data({ counts: { new: 0 }, rows: [], total: 0 })} now={NOW} />,
    );

    expect(html).toContain('aria-label="신규주문 0건"');
    expect(html).toContain('발주확인을 기다리는 신규주문이 없습니다.');
  });

  it('필터와 페이지 링크가 탭을 유지한다', () => {
    const html = renderToStaticMarkup(
      <DispatchScreen data={data({ total: 45 })} now={NOW} />,
    );

    expect(html).toContain('action="/admin/sales/dispatch"');
    expect(html).toContain('name="tab"');
    expect(html).toContain('href="/admin/sales/dispatch?tab=new&amp;page=2"');
  });
});
