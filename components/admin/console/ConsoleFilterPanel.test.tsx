import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsoleFilterPanel } from './ConsoleFilterPanel';

/** KST 2026-08-18 정오. 프리셋 기준일을 고정한다. */
const NOW = new Date('2026-08-18T03:00:00.000Z');

const STATUSES = [
  { label: '전체', value: 'all' },
  { label: '결제완료', value: 'paid' },
];

const SEARCH_FIELDS = [
  { label: '주문번호', value: 'orderNo' },
  { label: '구매자명', value: 'buyer' },
];

describe('ConsoleFilterPanel', () => {
  /* 서버 컴포넌트로 남으려면 상태 없는 GET 폼이어야 한다. 필터가 URL에 남아야
     딥링크·새로고침·뒤로가기가 산다. */
  it('클라이언트 상태 없이 GET 폼으로 렌더한다', () => {
    const html = renderToStaticMarkup(
      <ConsoleFilterPanel action="/admin/orders" hiddenFields={{ tab: 'delivery' }} now={NOW} />,
    );

    expect(html).toContain('<form class="admin-console-filters card" action="/admin/orders" method="get">');
    expect(html).toContain('<input type="hidden" name="tab" value="delivery"/>');
  });

  it('기간 프리셋을 KST 기준으로 계산한 링크로 만든다', () => {
    const html = renderToStaticMarkup(
      <ConsoleFilterPanel action="/admin/orders" dateRange={{ from: null, to: null }} now={NOW} />,
    );

    expect(html).toContain('오늘');
    expect(html).toContain('1주');
    expect(html).toContain('1개월');
    expect(html).toContain('3개월');
    /* 1주 = 오늘 포함 7일 */
    expect(html).toContain('from=2026-08-12');
    /* 3개월 */
    expect(html).toContain('from=2026-05-18');
    expect(html).toContain('to=2026-08-18');
  });

  /* 기간을 좁힌 뒤에도 5페이지에 남아 있으면 결과가 비어 보인다. */
  it('프리셋 링크는 현재 조건을 유지하되 페이지를 1로 되돌린다', () => {
    const html = renderToStaticMarkup(
      <ConsoleFilterPanel
        action="/admin/orders"
        dateRange={{ from: null, to: null }}
        hiddenFields={{ tab: 'delivery' }}
        now={NOW}
        search={{ fields: SEARCH_FIELDS, fieldValue: 'buyer', value: '아이콘' }}
        statusFilter={{ options: STATUSES, value: 'paid' }}
      />,
    );

    expect(html).toContain('tab=delivery');
    expect(html).toContain('status=paid');
    expect(html).toContain('searchField=buyer');
    expect(html).toContain('page=1');
  });

  it('현재 값과 정확히 일치하는 프리셋만 활성으로 표시한다', () => {
    const html = renderToStaticMarkup(
      <ConsoleFilterPanel
        action="/admin/orders"
        dateRange={{ from: '2026-08-12', to: '2026-08-18' }}
        now={NOW}
      />,
    );

    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="true"[^>]*>1주</);
  });

  it('프리셋 href 생성기를 콘솔이 직접 넘길 수 있다', () => {
    const html = renderToStaticMarkup(
      <ConsoleFilterPanel
        action="/admin/claims"
        dateRange={{
          from: null,
          presetHref: (range, preset) => `/admin/claims/${preset}?s=${range.from}`,
          presets: ['today'],
          to: null,
        }}
        now={NOW}
      />,
    );

    expect(html).toContain('href="/admin/claims/today?s=2026-08-18"');
  });

  it('직접 입력 날짜 칸에 현재 값을 채우고 name을 바꿀 수 있다', () => {
    const html = renderToStaticMarkup(
      <ConsoleFilterPanel
        action="/admin/orders"
        dateRange={{
          from: '2026-07-01',
          fromName: 'paidFrom',
          to: '2026-07-31',
          toName: 'paidTo',
        }}
        now={NOW}
      />,
    );

    expect(html).toContain('name="paidFrom"');
    expect(html).toContain('value="2026-07-01"');
    expect(html).toContain('name="paidTo"');
    expect(html).toContain('value="2026-07-31"');
  });

  it('상태 필터와 검색 유형 드롭다운의 현재 값을 선택 상태로 렌더한다', () => {
    const html = renderToStaticMarkup(
      <ConsoleFilterPanel
        action="/admin/orders"
        now={NOW}
        search={{ fields: SEARCH_FIELDS, fieldValue: 'buyer', name: 'q', value: '아이콘' }}
        statusFilter={{ options: STATUSES, value: 'paid' }}
      />,
    );

    expect(html).toContain('value="paid" selected=""');
    expect(html).toContain('value="buyer" selected=""');
    expect(html).toContain('name="q"');
    expect(html).toContain('value="아이콘"');
    expect(html).toContain('aria-label="검색 유형"');
  });

  it('넘기지 않은 필터 영역은 아예 렌더하지 않는다', () => {
    const html = renderToStaticMarkup(
      <ConsoleFilterPanel action="/admin/reviews" now={NOW} />,
    );

    expect(html).not.toContain('<select');
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain('조회기간');
  });

  it('초기화 링크는 고정 파라미터만 남긴다', () => {
    const html = renderToStaticMarkup(
      <ConsoleFilterPanel
        action="/admin/orders"
        hiddenFields={{ tab: 'delivery' }}
        now={NOW}
        statusFilter={{ options: STATUSES, value: 'paid' }}
      />,
    );

    expect(html).toContain('href="/admin/orders?tab=delivery"');
    expect(html).toContain('초기화');
  });

  it('추가 필터 컨트롤을 액션 버튼 앞에 끼워 넣는다', () => {
    const html = renderToStaticMarkup(
      <ConsoleFilterPanel action="/admin/orders" now={NOW} submitLabel="조회">
        <p>추가 컨트롤</p>
      </ConsoleFilterPanel>,
    );

    expect(html.indexOf('추가 컨트롤')).toBeLessThan(html.indexOf('admin-console-filter-actions'));
    expect(html).toContain('조회');
  });
});
