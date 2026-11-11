import type { ReactNode } from 'react';
import { renderToPipeableStream, renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminInsights } from '@/lib/admin/insights.server';
import type { AdminWorkQueueData } from '@/lib/admin/work-queue';
import { RecentOrders } from '../RecentOrders';
import { OrderPipeline } from '../charts/OrderPipeline';
import { OverviewSection } from './Overview';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

const insights: AdminInsights = {
  revenue: { current: 690000, previous: 400000 },
  paymentCount: { current: 12, previous: 9 },
  avgPayment: { current: 57500, previous: 44444 },
  signupCount: { current: 8, previous: 5 },
  dailyRevenue: [{ date: '2026-08-18', goods: 690000, tickets: 0 }],
  pipeline: [{ status: 'paid', count: 3 }],
  recentOrders: [],
  topIps: [],
};

describe('OverviewSection', () => {
  it('한눈에 보는 지표 카드를 그대로 유지한다', () => {
    const html = renderToStaticMarkup(<OverviewSection insights={insights} reports={[]} />);

    expect(html).toContain('30일 매출');
    expect(html).toContain('30일 신규 가입');
    expect(html).toContain('href="/admin/guide">판매자센터 운영 가이드');
    expect(html).not.toContain('업무 집계');
  });

  /*
   * 대시보드는 "지금 어떤가"를 보는 자리로 남기고, 같은 지표를 기간·축으로
   * 파고드는 일은 통계 리포트가 맡는다(#258). 링크가 없으면 운영자가 여기서
   * 더 깊이 보려다 못 찾는다.
   */
  it('세 통계 리포트로 가는 길을 연다', () => {
    const html = renderToStaticMarkup(<OverviewSection insights={insights} reports={[]} />);

    expect(html).toContain('href="/admin/stats/sales"');
    expect(html).toContain('href="/admin/stats/claims"');
    expect(html).toContain('href="/admin/stats/customers"');
  });
  it('집계 실패와 확인된 0건을 구분하고 리뷰 바로가기에 정확한 필터를 전달한다', () => {
    const html = renderToStaticMarkup(<OverviewSection insights={null} reports={[]} summary={{
      claims: { cancel: null, return: 0, exchange: 0 }, goods: { published: 0, soldout: null }, reviews: { total: 0, lowRating: 0, awaitingReply: 0 },
    }} />);
    expect(html).toMatch(/취소요청<\/span><strong[^>]*>확인 필요<\/strong>/);
    expect(html).toContain('aria-label="반품요청 0건"');
    expect(html).toMatch(/반품요청<\/span><strong[^>]*>0<\/strong>/);
    /* 확인된 0건은 처리할 건수가 아니므로 의미색을 입히지 않는다. */
    expect(html).not.toMatch(/반품요청<\/span><strong[^>]*text-destructive/);
    expect(html).toContain('href="/admin/cs/reviews?low=1&amp;page=1"');
    expect(html).toContain('href="/admin/cs/reviews?reply=without&amp;page=1"');
  });

  it('홈 배치를 바꾸어도 결제 지표의 의미와 모든 업무 바로가기를 보존한다', () => {
    const workQueue: AdminWorkQueueData = {
      checkedAt: '2026-10-16T00:00:00Z',
      counts: {
        orders: { state: 'ready', count: 3 },
        ready: { state: 'ready', count: 7 },
        delayed: { state: 'ready', count: 2 },
        inquiries: { state: 'ready', count: 4 },
        goods: { state: 'error', count: null },
        unpaid: { state: 'hidden', count: null },
        refundTransfers: { state: 'hidden', count: null },
      },
      goodsReasons: [],
    };
    const html = renderToStaticMarkup(<OverviewSection insights={insights} reports={[]} workQueue={workQueue} days={7} />);
    expect(html).not.toContain('무통장 입금 대기');
    expect(html).not.toContain('환불 송금 대기');

    expect(html).toContain('결제 현황');
    expect(html).toContain('dateTime="2026-10-16T00:00:00Z"');
    expect(html).toContain('업무 집계 10. 16. 09:00 기준');
    expect(html).toContain('최근 7일 결제금액');
    expect(html).toContain('₩690,000');
    expect(html).not.toContain('정산예정');
    expect(html).not.toContain('오늘정산');
    expect(html).toContain('aria-label="발송 대기 7건"');
    expect(html).toContain('aria-label="발송 지연 2건"');
    expect(html).toContain('aria-label="미응답 문의 4건"');
    expect(html).toContain('aria-label="상품 검토 대기 확인 필요"');
    expect(html).toContain('href="/admin/sales/dispatch?tab=delayed');
    expect(html).toContain('href="/admin/cs/inquiries?status=open');
    expect(html).toContain('href="/admin/catalog/goods?');
    expect(html).toContain('readiness=review_required');
  });

  /* 2026-11-05 IA 재정의 D4: 목적지 화면을 열 수 있는 계정에만 돈 관련 대기열을 보인다. */
  it('무통장 입금 대기와 환불 송금 대기를 권한이 있을 때만 해당 패널에 보인다', () => {
    const workQueue: AdminWorkQueueData = {
      checkedAt: '2026-11-05T00:00:00Z',
      counts: {
        orders: { state: 'ready', count: 0 }, ready: { state: 'ready', count: 0 }, delayed: { state: 'ready', count: 0 },
        inquiries: { state: 'ready', count: 0 }, goods: { state: 'ready', count: 0 },
        unpaid: { state: 'ready', count: 5 }, refundTransfers: { state: 'error', count: null },
      },
      goodsReasons: [],
    };
    const html = renderToStaticMarkup(<OverviewSection insights={insights} reports={[]} workQueue={workQueue} days={7} />);
    expect(html).toContain('aria-label="무통장 입금 대기 5건"');
    expect(html).toContain('href="/admin/sales/unpaid"');
    expect(html).toContain('aria-label="환불 송금 대기 확인 필요"');
    expect(html).toContain('href="/admin/sales/claims/refund-transfers"');
    /* 패널은 다음 패널 표시까지의 조각으로 읽는다 — 카드 순서는 처리할 업무를 앞세우려고 바뀔 수 있다(ADR-0029). */
    const panel = (id: string) => {
      const start = html.indexOf(`data-home-panel="${id}"`);
      expect(start, id).toBeGreaterThanOrEqual(0);
      const next = html.indexOf('data-home-panel=', start + 1);
      return html.slice(start, next < 0 ? undefined : next);
    };
    expect(panel('claims')).toContain('환불 송금 대기');
    expect(panel('work')).toContain('무통장 입금 대기');
    /* 처리할 건수가 0보다 크면 의미색 칩으로 보인다. */
    expect(html).toMatch(/무통장 입금 대기<\/span><strong[^>]*bg-warning-soft[^>]*>5<\/strong>/);
  });

  /* 칩은 지금 처리할 건수에만 쓴다(ADR-0029) — 상품·리뷰 패널은 품절·낮은 평점 같은 위험만 칩이고 나머지는 숫자다. */
  it('처리할 업무·클레임 패널 밖에서는 위험한 건수만 칩으로 보인다', () => {
    const workQueue: AdminWorkQueueData = {
      checkedAt: '2026-11-05T00:00:00Z',
      counts: {
        orders: { state: 'ready', count: 1 }, ready: { state: 'ready', count: 2 }, delayed: { state: 'ready', count: 0 },
        inquiries: { state: 'ready', count: 3 }, goods: { state: 'ready', count: 4 },
        unpaid: { state: 'hidden', count: null }, refundTransfers: { state: 'hidden', count: null },
      },
      goodsReasons: [],
    };
    const html = renderToStaticMarkup(<OverviewSection insights={insights} reports={[]} workQueue={workQueue} days={7} summary={{
      claims: { cancel: 1, return: 0, exchange: 0 }, goods: { published: 3, soldout: 2 }, reviews: { total: 5, lowRating: 1, awaitingReply: 4 },
    }} />);
    expect(html).toMatch(/신규주문<\/span><strong[^>]*bg-warning-soft[^>]*>1<\/strong>/);
    expect(html).toMatch(/취소요청<\/span><strong[^>]*bg-warning-soft[^>]*>1<\/strong>/);
    expect(html).toMatch(/품절 상품<\/span><strong[^>]*bg-danger-soft[^>]*>2<\/strong>/);
    expect(html).toMatch(/낮은 평점 리뷰<\/span><strong[^>]*bg-danger-soft[^>]*>1<\/strong>/);
    expect(html).toMatch(/발송 대기<\/span><strong class="shrink-0 text-lg font-semibold tabular-nums">2<\/strong>/);
    expect(html).toMatch(/상품 검토 대기<\/span><strong class="shrink-0 text-lg font-semibold tabular-nums">4<\/strong>/);
    expect(html).toMatch(/미답변 리뷰<\/span><strong class="shrink-0 text-lg font-semibold tabular-nums">4<\/strong>/);
  });

  it('매출이 없는 기간에는 임의의 숫자 축 대신 빈 상태를 표시한다', () => {
    const empty = { ...insights, dailyRevenue: [{ date: '2026-08-18', goods: 0, tickets: 0 }] };
    const html = renderToStaticMarkup(<OverviewSection insights={empty} reports={[]} />);
    expect(html).toContain('최근 30일 결제 완료 매출이 없습니다.');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('recharts-responsive-container');
    const populated = renderToStaticMarkup(<OverviewSection insights={insights} reports={[]} />);
    expect(populated).not.toContain('최근 30일 결제 완료 매출이 없습니다.');
    expect(populated).toContain('recharts-responsive-container');
  });

  it('최근 주문에서도 원 단위 금액을 보존한다', () => {
    const html = renderToStaticMarkup(<RecentOrders orders={[{ id: 'exact-order', kind: 'good', buyerName: '운영연습', total: 13100, status: 'paid', createdAt: '2026-09-08T00:00:00Z' }]} />);
    expect(html).toContain('₩13,100');
    expect(html).not.toContain('₩1만');
  });

  it.each([
    ['pending', '결제 대기'],
    ['paid', '신규주문'],
    ['confirmed', '발주확인'],
    ['shipping', '배송중'],
    ['delivered', '배송완료'],
    ['done', '거래확정'],
    ['canceled', '취소'],
  ] as const)('주문 파이프라인과 최근 상품 주문의 %s를 %s로 표시한다', (status, label) => {
    const html = renderToStaticMarkup(<><OrderPipeline stages={[{ status, count: 1 }]} />
      <RecentOrders orders={[{ id: 'goods-order', kind: 'good', buyerName: '운영연습', total: 10000, status, createdAt: '2026-09-08T00:00:00Z' }]} /></>);

    expect(html.split(`>${label}</span>`)).toHaveLength(3);
    expect(html).not.toContain(`>${status}</span>`);
    expect(html).not.toContain('구매 확정');
    expect(html).toContain('상품 주문 상태 분포');
  });

  it.each([
    ['pending', '결제 대기'],
    ['paid', '결제 완료'],
    ['canceled', '취소'],
  ])('최근 티켓 주문의 %s는 상품 발주 상태와 구분한다', (status, label) => {
    const html = renderToStaticMarkup(<RecentOrders orders={[{ id: 'ticket-order', kind: 'ticket', buyerName: '예매자', total: 20000, status, createdAt: '2026-09-08T00:00:00Z' }]} />);

    expect(html).toContain(`>${label}</span>`);
    expect(html).toContain('티켓 ·');
    expect(html).not.toContain('신규주문');
    expect(html).not.toContain('발주확인');
    expect(html).not.toContain('거래확정');
  });
});

/* 2026-11-10 실측: 홈 서버 응답 1.5~1.9초. 업무 큐를 먼저 보내고 통계·신고 칸만 나중에 채운다. */
describe('OverviewSection 나중에 채우기', () => {
  async function streamOf(element: ReactNode, finish: () => void) {
    const chunks: string[] = [];
    const { Writable } = await import('node:stream');
    let shellWritten!: () => void;
    const firstChunk = new Promise<void>((resolve) => { shellWritten = resolve; });
    const done = new Promise<void>((resolve, reject) => {
      const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); shellWritten(); callback(); }, final(callback) { resolve(); callback(); } });
      const stream = renderToPipeableStream(element, { onError: reject, onShellReady() { stream.pipe(sink); } });
    });
    await firstChunk;
    const shell = chunks.join('');
    finish();
    await done;
    return { shell, full: chunks.join('') };
  }
  const workQueue: AdminWorkQueueData = {
    checkedAt: '2026-11-10T00:00:00Z',
    counts: {
      orders: { state: 'ready', count: 9 }, ready: { state: 'ready', count: 7 }, delayed: { state: 'ready', count: 0 }, inquiries: { state: 'ready', count: 0 }, goods: { state: 'ready', count: 0 },
      unpaid: { state: 'hidden', count: null }, refundTransfers: { state: 'hidden', count: null },
    },
    goodsReasons: [],
  };

  it('통계가 오기 전에도 업무 큐를 먼저 보이고, 통계 칸은 집계 중 자리만 비워 둔다', async () => {
    let finishInsights!: (value: AdminInsights | null) => void;
    let finishReports!: (value: []) => void;
    const pendingInsights = new Promise<AdminInsights | null>((resolve) => { finishInsights = resolve; });
    const pendingReports = new Promise<[]>((resolve) => { finishReports = resolve; });
    const summary = { claims: { cancel: 0, return: 0, exchange: 0 }, goods: { published: 0, soldout: 0 }, reviews: { total: 0, lowRating: 0, awaitingReply: 0 } };
    const { shell, full } = await streamOf(<OverviewSection insights={pendingInsights} reports={pendingReports} summary={summary} workQueue={workQueue} />, () => { finishInsights(insights); finishReports([]); });

    expect(shell).toContain('aria-label="신규주문 9건"');
    expect(shell).toContain('aria-label="발송 대기 7건"');
    expect(shell).toContain('aria-label="집계 중"');
    expect(shell).toContain('판매 성과 집계 중');
    expect(shell).not.toContain('30일 매출');
    /* 실패 표시와 헷갈리지 않게 오는 중에는 '확인 필요'를 쓰지 않는다. */
    expect(shell).not.toContain('확인 필요');

    expect(full).toContain('30일 매출');
    expect(full).toContain('₩690,000');
    expect(full).toContain('접수된 신고가 없습니다.');
  });

  it('통계 조회가 끝내 실패하면 그 칸만 실패로 안내한다', async () => {
    let finish!: (value: null) => void;
    const pending = new Promise<null>((resolve) => { finish = resolve; });
    const { full } = await streamOf(<OverviewSection insights={pending} reports={null} workQueue={workQueue} />, () => finish(null));
    expect(full).toContain('성과 통계를 불러오지 못했습니다');
    expect(full).toContain('신고 목록을 불러오지 못했습니다.');
  });
});
