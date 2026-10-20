import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { normalizeBenefitReportFilters, type BenefitIssuances, type BenefitReport } from '@/lib/admin/benefit-report';
import { BenefitReportScreen } from './BenefitReportScreen';

const summary = { issued: 51, paidUses: 3, discountAmount: 3000, orderAmount: 15000, released: 1, cohortPaidUses: 1 };
const data: BenefitReport = { summary, daily: [], coupons: [{ code: 'ABC', name: '검수 쿠폰', ...summary }], couponCount: 1, useCount: 3, uses: [{ id: 'use-1', orderId: 'order-1', appliedAt: '2026-10-01T00:00:00Z', releasedAt: null, status: 'paid', discountAmount: 1000, orderAmount: 5000 }] };
const issuances: BenefitIssuances = { totalCount: 51, paidUseCount: 1, asOf: '2026-10-12T00:00:00Z', rows: [{ id: '00000000-0000-4000-8000-000000000051', couponCode: 'ABC', issuedAt: '2026-09-30T15:00:00Z', isPaidUse: false }] };
const filters = normalizeBenefitReportFilters({ code: 'ABC', detail: 'issuances', page: '2', from: '2026-10-01', to: '2026-10-12', q: '검수', bucket: 'month', compare: 'previous' });
const now = new Date('2026-10-12T00:00:00Z');
const href = (html: string, label: string) => html.match(new RegExp(`href="([^"]+)"[^>]*>${label}</a>`))![1].replaceAll('&amp;', '&');

describe('혜택 리포트 발급 상세', () => {
  it('발급 모집단·관측시각·50건 페이지와 상태 의미를 표시한다', () => {
    const html = renderToStaticMarkup(<BenefitReportScreen data={data} comparison={null} issuances={issuances} filters={filters} admin now={now} />);
    expect(html).toContain('쿠폰 발급 상세');
    expect(html).toContain('2026-10-01 00:00:00');
    expect(html).toContain('2026-10-12 09:00:00');
    expect(html).toContain('2 / 2 페이지 · 51개');
    expect(html).toContain('아니오');
    expect(html).toContain('사용 가능이나 환불 완료를 뜻하지 않습니다');
    expect(html).not.toContain('order-1');
    expect(html).toContain('name="detail" value="issuances"');
    expect(html).toContain('name="code" value="ABC"');
    const previous = new URL(href(html, '이전'), 'https://example.test');
    expect(Object.fromEntries(previous.searchParams)).toMatchObject({ detail: 'issuances', code: 'ABC', q: '검수', bucket: 'month', compare: 'previous', from: '2026-10-01', to: '2026-10-12' });
    expect(previous.searchParams.has('page')).toBe(false);
    expect(new URL(href(html, '사용 상세'), 'https://example.test').searchParams.has('detail')).toBe(false);
    expect(new URL(href(html, '발급 상세'), 'https://example.test').searchParams.has('page')).toBe(false);
    expect(href(html, '엑셀 다운로드')).toContain('detail=issuances');
  });
  it('기존 주소는 사용 상세를 유지하고 발급수에서 새 상세로 연결한다', () => {
    const html = renderToStaticMarkup(<BenefitReportScreen data={data} comparison={null} filters={{ ...filters, detail: 'uses', page: 1 }} admin now={now} />);
    expect(html).toContain('쿠폰 사용 상세');
    expect(html).toContain('order-1');
    expect(html).not.toContain('benefit-issuance-heading');
    expect(html).toContain('검수 쿠폰 발급 51장 상세');
    expect(html).toContain('detail=issuances');
  });
  it('0건·범위 밖 페이지·읽기 실패를 서로 구분한다', () => {
    const render = (value: BenefitIssuances | null) => renderToStaticMarkup(<BenefitReportScreen data={data} comparison={null} issuances={value} filters={filters} admin now={now} />);
    expect(render({ ...issuances, totalCount: 0, paidUseCount: 0, rows: [] })).toContain('선택한 조건과 기간에 발급된 쿠폰이 없습니다.');
    expect(render({ ...issuances, rows: [] })).toContain('발급 상세 첫 페이지');
    const failed = render(null);
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('발급 상세를 읽지 못했습니다.');
    expect(failed).not.toContain('혜택 리포트 페이지');
    expect(failed).not.toContain('선택한 조건과 기간에 발급된 쿠폰이 없습니다.');
  });
  it('정확히 10,000건은 내려받고 한도를 넘으면 조건 축소를 안내한다', () => {
    const render = (totalCount: number) => renderToStaticMarkup(<BenefitReportScreen data={data} comparison={null} issuances={{ ...issuances, totalCount }} filters={filters} admin now={now} />);
    expect(render(10000)).toContain('엑셀 다운로드');
    const exceeded = render(10001);
    expect(exceeded).toContain('발급 상세 엑셀은 최대 10,000건입니다. 기간이나 혜택 조건을 줄여주세요.');
    expect(exceeded).not.toContain('/api/admin/benefit-workbook');
  });
});
