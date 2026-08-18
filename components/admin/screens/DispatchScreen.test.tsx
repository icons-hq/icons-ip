import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminDispatchConsoleData, AdminDispatchFilters } from '@/lib/admin/dispatch';
import { DispatchScreen } from './DispatchScreen';

vi.mock('@/app/admin/order-actions', () => ({
  bulkConfirmAdminOrdersAction: vi.fn(),
  bulkRegisterAdminOrderTrackingAction: vi.fn(),
  saveAdminOrderDispatchDelayAction: vi.fn(),
  updateAdminOrderStatusAction: vi.fn(),
}));

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORDER_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-08-18T06:00:00.000Z');
const REFERENCE = ORDER_ID.replaceAll('-', '').slice(-8).toUpperCase();

const CARRIERS = [
  {
    code: 'hanjin',
    label: '한진택배',
    active: true,
    trackingUrlTemplate: 'https://example.test/track?no={trackingNumber}',
  },
];

function filters(overrides: Partial<AdminDispatchFilters> = {}): AdminDispatchFilters {
  return { tab: 'new', from: null, to: null, query: '', page: 1, ...overrides };
}

function data(overrides: Partial<AdminDispatchConsoleData> = {}): AdminDispatchConsoleData {
  return {
    carriers: CARRIERS,
    counts: { new: 2, ready: 3, delayed: 1 },
    filters: filters(),
    pageSize: 20,
    total: 2,
    rows: [
      {
        id: ORDER_ID,
        buyerName: 'maple_fan',
        createdAt: '2026-08-18T03:00:00.000Z',
        confirmedAt: '2026-08-14T03:00:00.000Z',
        total: 57000,
        paymentProvider: 'korpay',
        items: { leadName: '홍실 아크릴 블록', otherCount: 2, totalQty: 4 },
        delayNote: null,
      },
      {
        id: OTHER_ORDER_ID,
        buyerName: 'second_fan',
        createdAt: '2026-08-15T06:00:00.000Z',
        confirmedAt: null,
        total: 30000,
        paymentProvider: null,
        items: { leadName: '화산강림 스탠드', otherCount: 0, totalQty: 1 },
        delayNote: null,
      },
    ],
    ...overrides,
  };
}

describe('DispatchScreen', () => {
  it('신규주문 컬럼을 스마트스토어 순서 그대로 보여준다', () => {
    const html = renderToStaticMarkup(<DispatchScreen data={data()} now={NOW} />);

    for (const column of ['주문번호', '주문일시', '구매자', '굿즈', '수량', '결제사', '결제금액', '경과시간']) {
      expect(html).toContain(column);
    }
    /* 이슈는 "결제수단"을 요구하지만 카드·무통장은 staff 읽기 표면에 없다.
     * 값이 결제사인데 헤더만 결제수단이면 운영자가 전 행 "토스페이먼츠"를
     * 결제수단으로 읽고 입금 확인 없이 발주확인을 누른다. */
    expect(html).not.toContain('결제수단');
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
    expect(html).toContain(`aria-label="주문 ${REFERENCE} 선택"`);
    expect(html).toContain(`value="${ORDER_ID}"`);
  });

  /* 0건 칩을 감추면 "정말 0건"과 "집계를 못 불러옴"을 구분할 수 없다. */
  it('탭 건수는 0건도 그대로 보여준다', () => {
    const html = renderToStaticMarkup(
      <DispatchScreen
        data={data({ counts: { new: 0, ready: 0, delayed: 0 }, rows: [], total: 0 })}
        now={NOW}
      />,
    );

    expect(html).toContain('aria-label="신규주문 0건"');
    expect(html).toContain('발주확인을 기다리는 신규주문이 없습니다.');
  });

  it('발송 대기·발송지연 탭 건수를 함께 보여준다', () => {
    const html = renderToStaticMarkup(<DispatchScreen data={data()} now={NOW} />);

    expect(html).toContain('aria-label="발송 대기 3건"');
    expect(html).toContain('aria-label="발송지연 1건"');
    expect(html).toContain('tab=ready');
    expect(html).toContain('tab=delayed');
  });

  /* 행 링크가 늘 status=paid 를 가리키면 발송 대기 행을 눌렀을 때 빈 목록이 뜬다. */
  it('행 링크가 현재 탭의 상태를 따라간다', () => {
    const html = renderToStaticMarkup(
      <DispatchScreen data={data({ filters: filters({ tab: 'ready' }) })} now={NOW} />,
    );

    expect(html).toContain('status=confirmed');
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

describe('DispatchScreen · 발송 대기', () => {
  const readyData = () => data({ filters: filters({ tab: 'ready' }) });

  it('발주확인일과 경과일을 컬럼으로 세운다', () => {
    const html = renderToStaticMarkup(<DispatchScreen data={readyData()} now={NOW} />);

    expect(html).toContain('발송 대기 목록');
    expect(html).toContain('발주확인일');
    expect(html).toContain('경과일');
    expect(html).toContain('4일');
  });

  /* 숫자만으로는 3일과 4일이 같은 무게로 읽힌다. 목록이 길어지면 늦은 주문이 묻힌다. */
  it('지연 임계값을 넘긴 경과일을 표시로 구분한다', () => {
    const html = renderToStaticMarkup(<DispatchScreen data={readyData()} now={NOW} />);

    expect(html).toContain('data-delayed="true"');
  });

  /* 발주확인 기록이 없는 주문을 0일로 접으면 방금 확인한 주문과 구분되지 않는다. */
  it('발주확인 기록이 없으면 경과일을 지어내지 않는다', () => {
    const html = renderToStaticMarkup(<DispatchScreen data={readyData()} now={NOW} />);

    expect(html).toContain('미기록');
  });

  it('행마다 택배사 드롭다운·운송장 입력·발송처리 버튼을 연다', () => {
    const html = renderToStaticMarkup(<DispatchScreen data={readyData()} now={NOW} />);

    expect(html).toContain(`aria-label="주문 ${REFERENCE} 택배사"`);
    expect(html).toContain(`aria-label="주문 ${REFERENCE} 운송장번호"`);
    expect(html).toContain('발송처리');
    expect(html).toContain('>한진택배</option>');
    /* 상태는 폼이 실어 보낸다 — 전이 대상이 화면마다 달라지면 안 된다. */
    expect(html).toContain('value="shipping"');
  });

  /* 고를 수 있는 택배사가 하나뿐이면 미리 골라 둔다. 둘 이상이면 비운다 —
     기본값이 있는 드롭다운은 잘못 고른 것도 고른 것처럼 지나간다. */
  it('활성 택배사가 하나뿐이면 미리 선택해 둔다', () => {
    const html = renderToStaticMarkup(<DispatchScreen data={readyData()} now={NOW} />);

    expect(html).toContain('<option value="hanjin" selected="">한진택배</option>');
  });

  it('엑셀 일괄 운송장 등록 패널을 상단에 연다', () => {
    const html = renderToStaticMarkup(<DispatchScreen data={readyData()} now={NOW} />);

    expect(html).toContain('엑셀 일괄 운송장 등록');
    expect(html).toContain('주문번호');
    expect(html).toContain('hanjin(한진택배)');
    /* WMS 이중 입력 주의(#177) — 어드민을 운송장 진실원으로 선언하지 않는다. */
    expect(html).toContain('WMS');
  });

  /* 행마다 폼이 붙으므로 목록 전체를 감싸는 일괄 폼을 두면 폼 안에 폼이 된다. */
  it('발송 대기에서는 일괄 발주확인 선택을 열지 않는다', () => {
    const html = renderToStaticMarkup(<DispatchScreen data={readyData()} now={NOW} />);

    expect(html).not.toContain('aria-label="전체 선택"');
    expect(html).not.toContain('name="bulkConfirm"');
    expect(html).not.toContain('name="orderIds"');
  });
});

describe('DispatchScreen · 발송지연', () => {
  const delayedData = () => data({
    filters: filters({ tab: 'delayed' }),
    rows: [{
      id: ORDER_ID,
      buyerName: 'maple_fan',
      createdAt: '2026-08-10T03:00:00.000Z',
      confirmedAt: '2026-08-14T03:00:00.000Z',
      total: 57000,
      paymentProvider: 'korpay',
      items: { leadName: '홍실 아크릴 블록', otherCount: 0, totalQty: 1 },
      delayNote: {
        reason: '작가 재입고 지연',
        expectedShipDate: '2026-08-20',
        updatedAt: '2026-08-17T03:00:00.000Z',
      },
    }],
  });

  it('지연 메모와 발송 예정일을 편집할 수 있게 채워 준다', () => {
    const html = renderToStaticMarkup(<DispatchScreen data={delayedData()} now={NOW} />);

    expect(html).toContain('발송지연 목록');
    expect(html).toContain(`aria-label="주문 ${REFERENCE} 지연 사유"`);
    expect(html).toContain('작가 재입고 지연');
    expect(html).toContain('value="2026-08-20"');
  });

  /* 해제 수단이 없으면 운영자가 사유를 '해결'로 덮어쓰고 목록이 줄지 않는다. */
  it('사유를 비우면 해제된다는 것을 입력 자리에서 알린다', () => {
    const html = renderToStaticMarkup(<DispatchScreen data={delayedData()} now={NOW} />);

    expect(html).toContain('비우면 해제');
  });

  it('지연 목록에서도 곧바로 발송처리할 수 있다', () => {
    const html = renderToStaticMarkup(<DispatchScreen data={delayedData()} now={NOW} />);

    expect(html).toContain(`aria-label="주문 ${REFERENCE} 운송장번호"`);
    expect(html).toContain('발송처리');
  });

  it('지연 기준을 빈 목록 문구에서 밝힌다', () => {
    const html = renderToStaticMarkup(
      <DispatchScreen
        data={data({ filters: filters({ tab: 'delayed' }), rows: [], total: 0 })}
        now={NOW}
      />,
    );

    expect(html).toContain('발주확인 후 3일이 지난 주문이 없습니다.');
  });
});
