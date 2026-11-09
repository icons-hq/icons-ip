import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeftRight, ChevronRight, ClipboardList, CreditCard, Info, MessageSquareText, Package, ShoppingBag, type LucideIcon } from 'lucide-react';
import { Card, CardAction, CardContent, CardHeader } from '@/components/admin/kit/ui/card';
import type { AdminInsights } from '@/lib/admin/insights.server';
import type { AdminHomeSummary } from '@/lib/admin/home-summary';
import { ADMIN_WORK_QUEUES, visibleAdminWorkQueues, type AdminWorkQueueData } from '@/lib/admin/work-queue';
import { goodsListHref, normalizeGoodsListFilters } from '@/lib/admin/goods-list';
import { ADMIN_ORDER_STATUS_LABELS, adminOrdersHref, normalizeAdminOrderFilters } from '@/lib/admin/orders';
import { formatKrwExact, metricChange } from '../format';
import { MetricChangeBadge } from '../MetricCard';
import { adminReviewHref, DEFAULT_ADMIN_REVIEW_FILTERS } from '@/lib/admin/reviews';

/*
 * 홈 요약 카드(ADR-0029). 카드 머리 아이콘은 주 색 옅은 칸에 담고, 숫자는 foreground다. 의미색 칩은 지금 처리할 건수에만 쓴다 —
 * "처리할 업무"·"취소·반품·교환" 패널의 건수와, 다른 패널에서는 품절·낮은 평점처럼 위험한 건수뿐이다. 0건은 조용히 둔다.
 * 숫자 줄은 누르면 목록으로 간다(줄 끝 화살표).
 */

function SummaryPanel({ id, title, description, icon: PanelIcon, href, children, className = '' }: {
  id: string; title: string; description: string; icon: LucideIcon; href: string; children: ReactNode; className?: string;
}) {
  return <Card className={`min-w-0 ${className}`} data-home-panel={id}>
    <CardHeader>
      <h2 className="text-base leading-snug font-semibold">
        <Link className="inline-flex items-center gap-2 underline-offset-4 hover:underline" href={href}>
          <span aria-hidden="true" className="grid size-7 place-items-center rounded-lg bg-primary-soft text-primary-soft-foreground"><PanelIcon className="size-4" /></span>{title}
        </Link>
      </h2>
      <CardAction>
        <span aria-label={description} className="flex size-6 items-center justify-center text-muted-foreground/40 transition-colors hover:text-muted-foreground" role="img" title={description}>
          <Info aria-hidden="true" className="size-4" />
        </span>
      </CardAction>
    </CardHeader>
    <CardContent className="flex flex-1 flex-col gap-1">{children}</CardContent>
  </Card>;
}

/** 집계 실패는 0건과 다르게 작은 회색 글자로, 칩을 켠 건수는 0보다 클 때만 의미색으로 읽힌다(지연·낮은 평점·품절은 위험, 나머지는 주의). */
function countClass(value: number | null | undefined, attention: boolean, danger: boolean) {
  if (value == null) return 'shrink-0 text-sm font-medium text-muted-foreground';
  if (attention && value > 0) return `shrink-0 rounded-full px-2.5 py-0.5 text-base font-semibold tabular-nums ${danger ? 'bg-danger-soft text-destructive' : 'bg-warning-soft text-warning'}`;
  return 'shrink-0 text-lg font-semibold tabular-nums';
}

function CountLink({ label, value, href, unit = '건', attention = false, danger = false }: {
  label: string; value: number | null | undefined; href: string; unit?: string; attention?: boolean; danger?: boolean;
}) {
  const reading = value == null ? '확인 필요' : value.toLocaleString('ko-KR');
  return <Link
    aria-label={`${label} ${reading}${value == null ? '' : unit}`}
    className="group/count -mx-2 flex min-h-9 min-w-0 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-muted"
    href={href}
    prefetch={false}
  ><span className="mr-auto min-w-0 truncate text-muted-foreground group-hover/count:text-foreground">{label}</span><strong className={countClass(value, attention, danger)}>{reading}</strong><RowChevron /></Link>;
}

/** 줄을 누르면 목록으로 간다는 표시. */
function RowChevron() {
  return <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover/count:translate-x-0.5 group-hover/count:text-foreground" />;
}

function SummaryNote({ children }: { children: ReactNode }) {
  return <p className="mt-auto pt-2 text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

export function SellerOverviewSummary({ insights, workQueue, summary, days }: {
  insights: AdminInsights | null; workQueue?: AdminWorkQueueData; summary?: AdminHomeSummary; days: number;
}) {
  const queueValue = (id: typeof ADMIN_WORK_QUEUES[number]['id']) => {
    const value = workQueue?.counts[id];
    return value?.state === 'ready' ? value.count : null;
  };
  const queueHref = (id: typeof ADMIN_WORK_QUEUES[number]['id']) => ADMIN_WORK_QUEUES.find((queue) => queue.id === id)!.href;
  const visibleQueues = new Set<string>(visibleAdminWorkQueues(workQueue).map((queue) => queue.id));
  const stages = ['paid', 'confirmed', 'shipping', 'delivered', 'done'] as const;
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6" data-admin-home="summary">
    <SummaryPanel className="md:col-span-2 xl:col-span-4" description="전체 기간의 상품 주문 상태별 건수입니다." href="/admin/sales/orders" icon={ShoppingBag} id="sales" title="판매 관리">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-5 sm:gap-1">{stages.map((status, index) => <Link className="flex min-w-0 items-center gap-1 rounded-md p-2 transition-colors hover:bg-muted" href={adminOrdersHref(normalizeAdminOrderFilters({ status }))} key={status} prefetch={false}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="truncate text-sm text-muted-foreground">{ADMIN_ORDER_STATUS_LABELS[status]}</span><strong className="text-2xl font-semibold whitespace-nowrap tabular-nums">{insights ? `${(insights.pipeline.find((stage) => stage.status === status)?.count ?? 0).toLocaleString('ko-KR')}건` : <span className="text-sm font-medium text-muted-foreground">확인 필요</span>}</strong></span>
        {index < stages.length - 1 ? <ChevronRight aria-hidden="true" className="hidden size-4 shrink-0 text-muted-foreground/60 sm:block" /> : null}
      </Link>)}</div>
      <div className="mt-2 grid grid-cols-1 gap-x-6 rounded-lg bg-muted/50 px-3 py-1 sm:grid-cols-2">
        <CountLink href={queueHref('ready')} label="발송 대기" value={queueValue('ready')} />
        <CountLink href={queueHref('inquiries')} label="미응답 문의" value={queueValue('inquiries')} />
      </div>
      <SummaryNote>판매 단계는 주문 수, 발송 대기는 출고지별 배송 건 수입니다. 전체 기간 기준입니다.</SummaryNote>
    </SummaryPanel>
    <SummaryPanel className="md:col-span-2 xl:col-span-2" description={visibleQueues.has('unpaid') ? '발주확인 대기 주문, 발송 지연 배송, 미답변 문의, 입금 확인 전 무통장 주문 건수입니다.' : '발주확인 대기 주문, 발송 지연 배송, 미답변 문의 건수입니다.'} href="/admin/sales/dispatch" icon={ClipboardList} id="work" title="처리할 업무">
      <CountLink attention href={queueHref('orders')} label="신규주문" value={queueValue('orders')} />
      <CountLink attention danger href={queueHref('delayed')} label="발송 지연" value={queueValue('delayed')} />
      <CountLink attention href={queueHref('inquiries')} label="미응답 문의" value={queueValue('inquiries')} />
      {visibleQueues.has('unpaid') ? <CountLink attention href={queueHref('unpaid')} label="무통장 입금 대기" value={queueValue('unpaid')} /> : null}
      {workQueue?.checkedAt ? <SummaryNote><time className="tabular-nums" dateTime={workQueue.checkedAt}>업무 집계 {new Date(workQueue.checkedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} 기준</time></SummaryNote> : null}
    </SummaryPanel>
    <SummaryPanel className="xl:col-span-3" description={visibleQueues.has('refundTransfers') ? '요청 상태인 취소·반품·교환 건수와 계좌로 보낼 무통장 환불 건수입니다.' : '요청 상태인 취소·반품·교환 건수입니다.'} href="/admin/sales/claims/cancels" icon={ArrowLeftRight} id="claims" title="취소 · 반품 · 교환">
      <CountLink attention href="/admin/sales/claims/cancels?stage=requested" label="취소요청" value={summary?.claims.cancel} />
      <CountLink attention href="/admin/sales/claims/returns?stage=requested" label="반품요청" value={summary?.claims.return} />
      <CountLink attention href="/admin/sales/claims/exchanges?stage=requested" label="교환요청" value={summary?.claims.exchange} />
      {visibleQueues.has('refundTransfers') ? <CountLink attention href={queueHref('refundTransfers')} label="환불 송금 대기" value={queueValue('refundTransfers')} /> : null}
    </SummaryPanel>
    <SummaryPanel className="xl:col-span-3" description={`최근 ${days}일 상품·티켓 결제완료 기준입니다.`} href="/admin/stats/sales" icon={CreditCard} id="payment" title="결제 현황">
      <div className="grid gap-x-6 gap-y-1">
        <Link className="group/count -mx-2 flex min-w-0 items-center gap-2 rounded-md p-2 transition-colors hover:bg-muted" href="/admin/stats/sales"><span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="text-sm text-muted-foreground group-hover/count:text-foreground">최근 {days}일 결제금액</span><span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><strong className="text-2xl font-semibold tabular-nums [overflow-wrap:anywhere]">{insights ? formatKrwExact(insights.revenue.current) : <span className="text-sm font-medium text-muted-foreground">확인 필요</span>}</strong>{insights ? <MetricChangeBadge {...metricChange(insights.revenue)} title={`직전 ${days}일 대비`} /> : null}</span></span><RowChevron /></Link>
        <CountLink href="/admin/stats/sales" label={`최근 ${days}일 결제 건수`} value={insights?.paymentCount.current} />
      </div>
      <SummaryNote>상품·티켓 결제완료 기준 · 증감은 직전 {days}일 대비</SummaryNote>
    </SummaryPanel>
    <SummaryPanel className="xl:col-span-3" description="전시중·품절·검토가 필요한 상품 수입니다." href="/admin/catalog/goods" icon={Package} id="goods" title="상품 관리">
      <CountLink href={goodsListHref(normalizeGoodsListFilters({ status: 'published' }))} label="전시중 상품" unit="개" value={summary?.goods.published} />
      <CountLink attention danger href={goodsListHref(normalizeGoodsListFilters({ stock: 'soldout' }))} label="품절 상품" unit="개" value={summary?.goods.soldout} />
      <CountLink href={queueHref('goods')} label="상품 검토 대기" unit="개" value={queueValue('goods')} />
    </SummaryPanel>
    <SummaryPanel className="xl:col-span-3" description="전체 리뷰, 낮은 평점 리뷰와 미답변 리뷰 건수입니다." href="/admin/cs/reviews" icon={MessageSquareText} id="reviews" title="리뷰 현황">
      <CountLink href={adminReviewHref(DEFAULT_ADMIN_REVIEW_FILTERS)} label="전체 리뷰" value={summary?.reviews.total} />
      <CountLink attention danger href={adminReviewHref(DEFAULT_ADMIN_REVIEW_FILTERS, { lowRating: true })} label="낮은 평점 리뷰" value={summary?.reviews.lowRating} />
      <CountLink href={adminReviewHref(DEFAULT_ADMIN_REVIEW_FILTERS, { reply: 'without' })} label="미답변 리뷰" value={summary?.reviews.awaitingReply} />
    </SummaryPanel>
  </div>;
}
