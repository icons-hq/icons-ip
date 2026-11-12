import Link from 'next/link';
import { Plus } from 'lucide-react';
import { AdminNotice, AdminPageHeader, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { ConsoleGrid, type ConsoleGridColumn } from '@/components/admin/console/ConsoleGrid';
import { ConsoleListCard } from '@/components/admin/console/ConsoleListCard';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { statusTone } from '@/lib/admin/status-tone';
import { formatOrderDateTime } from '@/lib/orders';
import {
  DISCOUNT_PROMOTION_LIST_PAGE_SIZE,
  DISCOUNT_PROMOTION_PHASE_LABELS,
  DISCOUNT_PROMOTION_TARGET_LABELS,
  discountPromotionHref,
  discountPromotionListHref,
  discountPromotionPhase,
  discountRuleLabel,
  newDiscountPromotionHref,
  type DiscountPromotionList,
  type DiscountPromotionSummary,
} from '@/lib/admin/discount-promotions';

/* 첫 열(이름·등록)이 남는 폭만 받아 4~5줄로 접히지 않게 폭을 먼저 잡고, 기간은 시작·종료 두 줄로 줄인다(QA1 MD). */
const COLUMNS: ConsoleGridColumn[] = [
  { key: 'name', label: '프로모션', width: '240px' },
  { key: 'phase', label: '상태', width: '88px' },
  { key: 'period', label: '할인 기간', width: '176px' },
  { key: 'target', label: '대상', width: '200px' },
  { key: 'rule', label: '할인', width: '130px' },
  { key: 'goods', label: '상품', align: 'end', width: '128px' },
  { key: 'discounts', label: '진행·예정 할인', align: 'end', width: '112px' },
];

function targetLabel(row: DiscountPromotionSummary) {
  const kind = DISCOUNT_PROMOTION_TARGET_LABELS[row.target.kind];
  return row.target.label ? `${kind} · ${row.target.label}` : kind;
}

/** 할인 프로모션 목록(1014-109). 묶음 단위로 상태·대상·할인을 보고, 상세에서 상품별 결과를 확인하거나 중지한다. */
export function DiscountPromotionListScreen({ data, campaign, campaignTitle = null, page, canManage }: { data: DiscountPromotionList; campaign: string | null; campaignTitle?: string | null; page: number; canManage: boolean }) {
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="discount-promotions">
    <AdminPageHeader title="할인 프로모션" description="기획전·IP·선택 상품에 같은 할인을 한 번에 걸고, 한두 상품만 다른 할인율로 정합니다. 묶음 단위로 조회하고 중지하며, 중지해도 상품에 개별로 건 할인은 그대로입니다."
      actions={canManage ? <Link className={buttonVariants()} data-slot="button" href={newDiscountPromotionHref(campaign ? { campaign } : {})}><Plus aria-hidden="true" />새 할인 프로모션</Link> : undefined} />
    {campaign ? <AdminNotice title={campaignTitle ? `기획전 ‘${campaignTitle}’의 할인만 보고 있습니다` : `기획전 ${campaign}의 할인만 보고 있습니다`} tone="info"><Link className="font-medium underline-offset-4 hover:underline" href={discountPromotionListHref()}>전체 프로모션 보기</Link></AdminNotice> : null}
    <ConsoleListCard title="프로모션 목록" total={data.total} description="한 상품에는 한 시점에 할인가가 하나만 적용됩니다. 등록 때 기간이 겹치는 할인이 있던 상품은 건너뛰고, 상세에서 그 이유를 볼 수 있습니다.">
      <ConsoleGrid caption="할인 프로모션 목록" columns={COLUMNS} configurable={false} emptyLabel={campaign ? '이 기획전으로 만든 할인 프로모션이 없습니다.' : '등록한 할인 프로모션이 없습니다.'}
        rows={data.rows.map(row => {
          const phase = discountPromotionPhase(row, data.checkedAt);
          return { id: row.id, cells: [
            <span className="flex min-w-0 flex-col gap-0.5" key="name"><Link className="w-fit font-medium text-primary underline-offset-4 hover:underline [overflow-wrap:anywhere]" href={discountPromotionHref(row.id)}>{row.name}</Link>
              <small className="text-xs text-muted-foreground">등록 {formatOrderDateTime(row.createdAt)}{row.createdByName ? ` · ${row.createdByName}` : ''}</small></span>,
            <AdminStatusBadge key="phase" tone={statusTone('discountPromotion', phase)}>{DISCOUNT_PROMOTION_PHASE_LABELS[phase]}</AdminStatusBadge>,
            <span className="flex flex-col text-[13px] whitespace-nowrap tabular-nums" key="period"><span>{formatOrderDateTime(row.startsAt)} ~</span><span>{formatOrderDateTime(row.endsAt)}</span></span>,
            <span className="[overflow-wrap:anywhere]" key="target">{targetLabel(row)}</span>,
            <span key="rule">{discountRuleLabel(row.rule)}{row.exceptionCount ? <small className="block text-xs text-muted-foreground">예외 {row.exceptionCount.toLocaleString('ko-KR')}개</small> : null}</span>,
            <span className="tabular-nums" key="goods">{row.appliedCount.toLocaleString('ko-KR')} / {row.goodsCount.toLocaleString('ko-KR')}개<small className="block text-xs text-muted-foreground">적용 / 대상</small>{row.goodsCount > row.appliedCount ? <small className="block text-xs text-muted-foreground" data-promotion-skipped="">건너뜀 {(row.goodsCount - row.appliedCount).toLocaleString('ko-KR')}개</small> : null}</span>,
            <span className="tabular-nums" key="discounts">{row.discounts.active.toLocaleString('ko-KR')}건{row.discounts.disabled ? <small className="block text-xs text-muted-foreground">중지 {row.discounts.disabled.toLocaleString('ko-KR')}건</small> : null}</span>,
          ] };
        })} />
      <ConsolePagination hrefForPage={next => discountPromotionListHref({ campaign, page: next })} label="할인 프로모션 페이지" page={page} pageSize={DISCOUNT_PROMOTION_LIST_PAGE_SIZE} total={data.total} unit="개" />
    </ConsoleListCard>
  </div>;
}
