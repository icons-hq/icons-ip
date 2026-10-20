import Link from 'next/link';
import Image from 'next/image';
import { Icon } from '@/components/ui/Icon';
import type { AdminInsights } from '@/lib/admin/insights.server';
import type { AdminHomeSummary } from '@/lib/admin/home-summary';
import { ADMIN_WORK_QUEUES, type AdminWorkQueueData } from '@/lib/admin/work-queue';
import { goodsListHref, normalizeGoodsListFilters } from '@/lib/admin/goods-list';
import { ADMIN_ORDER_STATUS_LABELS, adminOrdersHref, normalizeAdminOrderFilters } from '@/lib/admin/orders';
import { formatKrwExact } from '../format';
import { adminReviewHref, DEFAULT_ADMIN_REVIEW_FILTERS } from '@/lib/admin/reviews';
import type { ReactNode } from 'react';

const PANEL_ICON_ASSETS: Record<string, string> = {
  bag: '/admin/seller-icons/sales.svg',
  swap: '/admin/seller-icons/claims.svg',
  grid: '/admin/seller-icons/goods.svg',
  chat: '/admin/seller-icons/reviews.svg',
};

function SummaryPanel({ title, description, icon, tone, href, children, className = '' }: {
  title: string; description: string; icon: string; tone?: string; href: string; children: ReactNode; className?: string;
}) {
  return <section className={`admin-home-panel ${className}`} data-tone={tone}>
    <header>
      <Link href={href}><span className="admin-home-panel-icon">{PANEL_ICON_ASSETS[icon] ? <Image src={PANEL_ICON_ASSETS[icon]} width={32} height={32} alt="" /> : <Icon name={icon} size={17} />}</span><h2>{title}</h2></Link>
      <span className="admin-home-panel-info" title={description} aria-label={description}>ⓘ</span>
    </header>
    <div className="admin-home-panel-body">{children}</div>
  </section>;
}
function CountLink({ label, value, href, unit = '건' }: { label: string; value: number | null | undefined; href: string; unit?: string }) {
  const reading = value == null ? '확인 필요' : value.toLocaleString('ko-KR');
  return <Link className="admin-home-count" href={href} prefetch={false} aria-label={`${label} ${reading}${value == null ? '' : unit}`}><span>{label}</span><strong>{reading}</strong></Link>;
}

export function SellerOverviewSummary({ insights, workQueue, summary, days }: {
  insights: AdminInsights | null; workQueue?: AdminWorkQueueData; summary?: AdminHomeSummary; days: number;
}) {
  const queueValue = (id: typeof ADMIN_WORK_QUEUES[number]['id']) => {
    const value = workQueue?.counts[id];
    return value?.state === 'ready' ? value.count : null;
  };
  const queueHref = (id: typeof ADMIN_WORK_QUEUES[number]['id']) => ADMIN_WORK_QUEUES.find((queue) => queue.id === id)!.href;
  const stages = ['paid', 'confirmed', 'shipping', 'delivered', 'done'] as const;
  return <div className="admin-home-summary">
    <SummaryPanel title="판매 관리" description="전체 기간의 상품 주문 상태별 건수입니다." icon="bag" href="/admin/sales/orders" className="admin-home-sales">
      <div className="admin-home-sales-stages">{stages.map((status, index) => <Link key={status} href={adminOrdersHref(normalizeAdminOrderFilters({ status }))} prefetch={false}>
        <span className="admin-home-stage-reading"><span>{ADMIN_ORDER_STATUS_LABELS[status]}</span><strong>{insights ? `${(insights.pipeline.find((stage) => stage.status === status)?.count ?? 0).toLocaleString('ko-KR')}건` : '확인 필요'}</strong></span>
        {index < stages.length - 1 ? <Icon name="chevronRight" size={18} /> : null}
      </Link>)}</div>
      <div className="admin-home-sales-foot"><CountLink label="발송 대기" value={queueValue('ready')} href={queueHref('ready')} /><CountLink label="미응답 문의" value={queueValue('inquiries')} href={queueHref('inquiries')} /></div>
      <p className="admin-home-summary-note">판매 단계는 주문 수, 발송 대기는 출고지별 배송 건 수입니다. 전체 기간 기준입니다.</p>
    </SummaryPanel>
    <SummaryPanel title="결제 현황" description={`최근 ${days}일 상품·티켓 결제완료 기준입니다.`} icon="card" href="/admin/stats/sales" className="admin-home-payment">
      <Link className="admin-home-count" href="/admin/stats/sales"><span>최근 {days}일 결제금액</span><strong>{insights ? formatKrwExact(insights.revenue.current) : '확인 필요'}</strong></Link>
      <CountLink label={`최근 ${days}일 결제 건수`} value={insights?.paymentCount.current} href="/admin/stats/sales" />
      <p className="admin-home-summary-note">상품·티켓 결제완료 기준</p>
    </SummaryPanel>
    <SummaryPanel title="취소 · 반품 · 교환" description="요청 상태인 취소·반품·교환 건수입니다." icon="swap" tone="danger" href="/admin/sales/claims/cancels" className="admin-home-claims">
      <CountLink label="취소요청" value={summary?.claims.cancel} href="/admin/sales/claims/cancels?stage=requested" />
      <CountLink label="반품요청" value={summary?.claims.return} href="/admin/sales/claims/returns?stage=requested" />
      <CountLink label="교환요청" value={summary?.claims.exchange} href="/admin/sales/claims/exchanges?stage=requested" />
    </SummaryPanel>
    <SummaryPanel title="처리할 업무" description="발주확인 대기 주문, 발송 지연 배송, 미답변 문의 건수입니다." icon="clock" tone="danger" href="/admin/sales/dispatch" className="admin-home-work">
      <CountLink label="신규주문" value={queueValue('orders')} href={queueHref('orders')} />
      <CountLink label="발송 지연" value={queueValue('delayed')} href={queueHref('delayed')} />
      <CountLink label="미응답 문의" value={queueValue('inquiries')} href={queueHref('inquiries')} />
    </SummaryPanel>
    <SummaryPanel title="상품 관리" description="전시중·품절·검토가 필요한 상품 수입니다." icon="grid" tone="goods" href="/admin/catalog/goods" className="admin-home-goods">
      <CountLink label="전시중 상품" value={summary?.goods.published} href={goodsListHref(normalizeGoodsListFilters({ status: 'published' }))} unit="개" />
      <CountLink label="품절 상품" value={summary?.goods.soldout} href={goodsListHref(normalizeGoodsListFilters({ stock: 'soldout' }))} unit="개" />
      <CountLink label="상품 검토 대기" value={queueValue('goods')} href={queueHref('goods')} unit="개" />
    </SummaryPanel>
    <SummaryPanel title="리뷰 현황" description="전체 리뷰, 낮은 평점 리뷰와 미답변 리뷰 건수입니다." icon="chat" tone="reviews" href="/admin/cs/reviews" className="admin-home-reviews">
      <CountLink label="전체 리뷰" value={summary?.reviews.total} href={adminReviewHref(DEFAULT_ADMIN_REVIEW_FILTERS)} />
      <CountLink label="낮은 평점 리뷰" value={summary?.reviews.lowRating} href={adminReviewHref(DEFAULT_ADMIN_REVIEW_FILTERS, { lowRating: true })} />
      <CountLink label="미답변 리뷰" value={summary?.reviews.awaitingReply} href={adminReviewHref(DEFAULT_ADMIN_REVIEW_FILTERS, { reply: 'without' })} />
    </SummaryPanel>
  </div>;
}
