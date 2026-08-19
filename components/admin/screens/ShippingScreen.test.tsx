import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminShippingConsoleData, AdminShippingFilters } from '@/lib/admin/shipping';
import { ShippingScreen } from './ShippingScreen';

vi.mock('@/app/admin/order-actions', () => ({
  updateAdminOrderStatusAction: vi.fn(),
}));

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const REFERENCE = ORDER_ID.replaceAll('-', '').slice(-8).toUpperCase();
const NOW = new Date('2026-08-18T06:00:00.000Z');

function filters(overrides: Partial<AdminShippingFilters> = {}): AdminShippingFilters {
  return { tab: 'transit', from: null, to: null, query: '', page: 1, ...overrides };
}

function data(overrides: Partial<AdminShippingConsoleData> = {}): AdminShippingConsoleData {
  return {
    counts: { transit: 2, delivered: 5 },
    filters: filters(),
    pageSize: 20,
    total: 1,
    rows: [{
      id: ORDER_ID,
      buyerName: 'maple_fan',
      createdAt: '2026-08-10T06:00:00.000Z',
      shippedAt: '2026-08-14T06:00:00.000Z',
      deliveredAt: null,
      total: 57000,
      shipment: {
        carrier: 'hanjin',
        carrierLabel: '한진택배',
        trackingNumber: '123456789012',
        trackingUrl: 'https://example.test/track?no=123456789012',
      },
    }],
    ...overrides,
  };
}

describe('ShippingScreen', () => {
  it('배송중·배송완료 건수를 0건까지 그대로 보여준다', () => {
    const html = renderToStaticMarkup(
      <ShippingScreen data={data({ counts: { transit: 0, delivered: 0 } })} now={NOW} />,
    );

    expect(html).toContain('aria-label="배송중 0건"');
    expect(html).toContain('aria-label="배송완료 0건"');
    expect(html).toContain('tab=delivered');
  });

  /* 조회 URL은 레지스트리 템플릿에서 온다(#251). 화면이 택배사별 URL을 조립하지
     않으므로 택배사를 늘려도 여기는 그대로다. */
  it('운송장을 택배사 조회 링크로 건다', () => {
    const html = renderToStaticMarkup(<ShippingScreen data={data()} now={NOW} />);

    expect(html).toContain('한진택배');
    expect(html).toContain('href="https://example.test/track?no=123456789012"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  /* 빈 칸은 "운송장 미등록"으로 읽힌다. 실제로는 등록됐지만 조회할 수 없는
     상태라 대응이 다르다. */
  it('레지스트리에 없는 코드로 저장된 주문은 확인 필요로 적는다', () => {
    const html = renderToStaticMarkup(
      <ShippingScreen data={data({ rows: [{ ...data().rows[0], shipment: null }] })} now={NOW} />,
    );

    expect(html).toContain('운송장 확인 필요');
  });

  it('배송 경과일을 세고 오래된 배송을 표시로 구분한다', () => {
    const html = renderToStaticMarkup(<ShippingScreen data={data()} now={NOW} />);

    expect(html).toContain('4일');
    expect(html).toContain('data-stale="true"');
  });

  it('배송중 행에서만 배송완료 처리를 연다', () => {
    const html = renderToStaticMarkup(<ShippingScreen data={data()} now={NOW} />);

    expect(html).toContain(`aria-label="주문 ${REFERENCE} 배송완료"`);
    expect(html).toContain('value="delivered"');
    expect(html).toContain(`value="${ORDER_ID}"`);
  });

  /* delivered를 되돌리는 전이는 사다리에 없다(#250). 조회 전용 화면에 버튼을
     두면 운영자가 되돌릴 수 있다고 읽는다. */
  it('배송완료 탭은 조회 전용이다', () => {
    const html = renderToStaticMarkup(
      <ShippingScreen
        data={data({
          filters: filters({ tab: 'delivered' }),
          rows: [{ ...data().rows[0], deliveredAt: '2026-08-17T06:00:00.000Z' }],
        })}
        now={NOW}
      />,
    );

    expect(html).toContain('배송완료 목록');
    expect(html).toContain('status=delivered');
    expect(html).not.toContain(`aria-label="주문 ${REFERENCE} 배송완료"`);
    expect(html).not.toContain('name="status"');
  });

  it('발송 기록이 없으면 날짜를 지어내지 않는다', () => {
    const html = renderToStaticMarkup(
      <ShippingScreen data={data({ rows: [{ ...data().rows[0], shippedAt: null }] })} now={NOW} />,
    );

    expect(html).toContain('미기록');
  });

  it('필터와 페이지 링크가 탭을 유지한다', () => {
    const html = renderToStaticMarkup(<ShippingScreen data={data({ total: 45 })} now={NOW} />);

    expect(html).toContain('action="/admin/sales/shipping"');
    expect(html).toContain('name="tab"');
    expect(html).toContain('href="/admin/sales/shipping?tab=transit&amp;page=2"');
  });
});
