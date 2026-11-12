/* eslint-disable @next/next/no-html-link-for-pages -- 렌더 시험용 마크업이다 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsoleFilterActions, ConsoleFilterPanel } from './ConsoleFilterPanel';

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
  /* 필터가 URL에 남아야 딥링크·새로고침·뒤로가기가 산다. */
  it('필터 조건을 GET 폼으로 제출한다', () => {
    const html = renderToStaticMarkup(
      <ConsoleFilterPanel action="/admin/orders" hiddenFields={{ tab: 'delivery' }} now={NOW} />,
    );

    expect(html).toMatch(/<form class="[^"]*" data-console-filters="" action="\/admin\/orders" method="get">/);
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
    /* 빠른 선택은 링크가 아니라 날짜 칸을 채우는 버튼이다 — [검색]을 눌러야 조회한다(ADM-016 #13). */
    expect(html).not.toContain('from=2026-08-12');
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*type="button"[^>]*>1주</);
  });

  it('현재 값과 정확히 일치하는 프리셋만 활성으로 표시한다', () => {
    const html = renderToStaticMarkup(
      <ConsoleFilterPanel
        action="/admin/orders"
        dateRange={{ from: '2026-08-12', to: '2026-08-18' }}
        now={NOW}
      />,
    );

    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>1주</);
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

  it('긴 검색 대상 안내를 입력 밖에 표시하고 입력과 연결한다', () => {
    const hint = '제목 · 구매자 · 주문번호 · 문의번호';
    const html = renderToStaticMarkup(<ConsoleFilterPanel action="/admin/cs/inquiries" search={{ value: '배송', placeholder: hint }} />);
    expect(html).toContain('id="admin-console-filter-search-hint"');
    expect(html).toContain(`>${hint}</span>`);
    expect(html).toContain('aria-describedby="admin-console-filter-search-hint"');
    expect(html).toContain('placeholder="검색어 입력"');
    expect(html).toContain('value="배송"');
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

    expect(html.indexOf('추가 컨트롤')).toBeLessThan(html.indexOf('>초기화<'));
    expect(html).toContain('조회');
  });
});

describe('ConsoleFilterActions', () => {
  /* 조회 폼을 직접 그리는 화면도 같은 바닥 줄(구분선 아래 오른쪽 [초기화][검색])을 쓴다. */
  it('구분선 아래 오른쪽에 버튼을 둔 순서 그대로 놓는다', () => {
    const html = renderToStaticMarkup(
      <ConsoleFilterActions><a href="/admin/x">초기화</a><button type="submit">검색</button></ConsoleFilterActions>,
    );

    expect(html).toContain('border-t pt-3 justify-end');
    expect(html.indexOf('초기화')).toBeLessThan(html.indexOf('검색'));
  });

  it('왼쪽 안내(start)가 있으면 양끝으로 벌린다', () => {
    const html = renderToStaticMarkup(
      <ConsoleFilterActions start={<p>한국시간 기준</p>}><button type="submit">조회</button></ConsoleFilterActions>,
    );

    expect(html).toContain('justify-between');
    expect(html.indexOf('한국시간 기준')).toBeLessThan(html.indexOf('조회'));
  });
});
