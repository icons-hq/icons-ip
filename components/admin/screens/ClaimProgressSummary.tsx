import type { AdminClaimDetail } from '@/lib/admin/claims.server';
import { adminClaimReceivedOnLabel, adminClaimStageLabel } from '@/lib/admin/claims';
import { orderClaimEffectiveStage } from '@/lib/orders/claims';
import { Check } from 'lucide-react';
import { formatOrderDateTime, refundStatusLabel } from '@/lib/orders';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { adminClaimReshipmentProgress } from '@/lib/admin/claim-reshipments';
import type { ReactNode } from 'react';

/* detail이 빈 글이면 작은 글 줄을 그리지 않는다. */
type Fact = { label: string; value: ReactNode; detail: string; href: string; link: string };
type Props = Pick<AdminClaimDetail, 'claim' | 'refund'>;

/** 단계 표시의 동그란 번호(반품 처리 칸과 같은 모양). 끝난 단계는 초록 체크, 지금 단계는 주 색이다. */
export const CLAIM_STEP_MARK_CLASS = 'inline-grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums data-[step-state=current]:border-primary data-[step-state=current]:bg-primary data-[step-state=current]:text-primary-foreground data-[step-state=done]:border-success-border data-[step-state=done]:bg-success-soft data-[step-state=done]:text-success';
const EXCHANGE_STEPS = ['검토·승인', '회수 확인', '재출고', '도착 확인'] as const;
type ExchangeStepState = 'done' | 'current' | 'todo';
const EXCHANGE_STEP_CAPTION: Record<ExchangeStepState, string> = { done: '완료', current: '지금 할 일', todo: '남은 단계' };

/** 교환 처리 칸의 단계 표시. 반품 칸과 같은 말(완료·지금 할 일·남은 단계)로 어디까지 왔는지 보인다. 저장된 처리 기록에서만 읽고 아무것도 바꾸지 않는다. */
export function ClaimExchangeSteps({ claim }: Pick<AdminClaimDetail, 'claim'>) {
  if (claim.stage === 'rejected' || claim.stage === 'withdrawn') return null;
  const effective = orderClaimEffectiveStage(claim.stage, claim.heldFrom);
  const progress = adminClaimReshipmentProgress(claim);
  /* 모든 배송 건을 재출고하면 요청은 처리완료가 된다. 고객 도착은 송장마다 따로 기록하므로, 모두 확인되기 전에는 '도착 확인'을 완료로 칠하지 않는다.
     출고지가 둘 이상이면 한 곳을 먼저 재출고해도(회수 생략 포함) 재출고 단계가 지금 할 일이다. */
  const current = claim.stage === 'completed' ? (progress.delivered >= progress.total ? EXCHANGE_STEPS.length : 3)
    : effective === 'requested' || effective === 'in_review' ? 0
      : progress.reshipped > 0 ? 2
        : effective === 'collecting' || !claim.collectionComplete ? 1
          : 2;
  const counted = progress.total > 1;
  const labels = EXCHANGE_STEPS.map((label, index) => !counted ? label
    : index === 2 ? `${label} ${progress.reshipped}/${progress.total}` : index === 3 ? `${label} ${progress.delivered}/${progress.total}` : label);
  return <ol aria-label="교환 처리 단계" className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-claim-exchange-steps="">
    {labels.map((label, index) => {
      const state: ExchangeStepState = index < current ? 'done' : index === current ? 'current' : 'todo';
      return <li aria-current={state === 'current' ? 'step' : undefined} className="flex min-w-0 items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-muted-foreground data-[step-state=current]:border-primary data-[step-state=current]:bg-primary-soft data-[step-state=current]:text-primary-soft-foreground data-[step-state=done]:text-foreground" data-step-state={state} key={label}>
        <span aria-hidden="true" className={CLAIM_STEP_MARK_CLASS} data-step-state={state}>{state === 'done' ? <Check className="size-3.5" /> : index + 1}</span>
        <span className="flex min-w-0 flex-col"><span className="text-xs font-normal">{EXCHANGE_STEP_CAPTION[state]}</span><span className="font-medium">{label}</span></span>
      </li>;
    })}
  </ol>;
}

/**
 * 환불 기록 한 줄 요약. 운영자가 한 일로 말하고('환불 접수함'), 저장 상태를 그대로 옮기지 않는다('기록 있음·시각 없음' 같은 말투).
 * 요청이 처리완료라는 것만으로 환불 완료로 읽지 않는다 — 환불 기록의 완료 시각이 있을 때만 '환불 완료'다.
 */
function refundSummary(refund: Props['refund']): { value: string; detail: string } {
  if (!refund) return { value: '환불 기록 없음', detail: '' };
  if (refund.status === 'awaiting_transfer') return { value: '환불 송금 대기', detail: '재고 복원 완료 · 송금 완료 기록 전' };
  if (refund.completedAt) return { value: '환불 완료', detail: formatOrderDateTime(refund.completedAt) };
  if (refund.status === 'done') return { value: '환불 완료 시각 없음', detail: '완료 시각이 비어 있습니다. 환불 칸에서 기록을 확인해주세요.' };
  if (refund.filedAt) return { value: '환불 접수함', detail: refund.status === 'requested' ? '완료 전' : refundStatusLabel(refund.status) };
  return { value: '환불 전', detail: '아직 접수하지 않았습니다.' };
}

/** Read the existing evidence independently. A closed claim is not proof of a refund or delivery. */
export function ClaimProgressSummary({ claim, refund }: Props) {
  /* 요약은 처리 칸(반품 단계별 처리)과 같은 말로 같은 사실을 읽는다 — 회수 정보를 못 읽었으면 그렇다고만 말한다. */
  const collection: Fact = { label: '회수 확인', value: '회수 정보를 불러오지 못했습니다', detail: '새로고침해주세요.', href: '#claim-process', link: '회수 내역 보기' };
  if (claim.collectionPolicy !== null) {
    if (claim.claimType === 'cancel' && claim.collectionComplete && claim.collections.length === 0) {
      collection.value = '회수 대상 없음';
      collection.detail = '상품 회수가 필요하지 않은 취소입니다.';
    } else if (claim.collectionPolicy === 'origin') {
      const checked = claim.collections.filter(item => item.collectedAt !== null).length;
      collection.value = claim.collections.length ? `출고지 ${claim.collections.length}곳 가운데 ${checked}곳 회수 확인` : '회수할 출고지 확인 전';
      /* 회수 생략·배송 분실로 끝난 출고지는 확인 수에 들지 않는다 — 끝났는지는 서버의 전체 회수 판정이 말한다. */
      collection.detail = claim.collectionComplete && claim.collections.length ? '회수 끝' : '';
    } else {
      // The legacy completion flag bypasses the newer origin gate. Only the receipt proves collection.
      collection.value = claim.collectedAt ? '입고 확인함' : '입고 확인 전';
      /* 환불 기한은 실제 입고일부터 센다(1027T-033). 입고일이 있으면 확인 시각과 나눠 보인다(출고지별 회수 칸과 같은 형식). */
      collection.detail = !claim.collectedAt ? ''
        : claim.collectionReceivedOn ? `실제 입고일 ${adminClaimReceivedOnLabel(claim.collectionReceivedOn)} · 확인 ${formatOrderDateTime(claim.collectedAt)}`
          : `입고 ${formatOrderDateTime(claim.collectedAt)}`;
    }
  }

  const progress = adminClaimReshipmentProgress(claim);
  const settlement: Fact = claim.claimType === 'exchange'
    ? progress.total > 1 || (claim.reshipments ?? []).length > 0
      ? {
        /* 배송 건(출고지)별 재출고: 송장마다 재출고·배송완료를 센다. */
        label: '교환 배송',
        value: progress.reshipped === 0 ? '재출고 전'
          : progress.delivered >= progress.total ? '배송완료 확인함'
            : progress.reshipped >= progress.total ? '재출고 완료' : `재출고 ${progress.reshipped}/${progress.total}`,
        detail: `${progress.total > 1 ? `출고지 ${progress.total}곳 · ` : ''}배송완료 확인 ${progress.delivered}/${progress.total}${progress.waived ? ` · 회수 생략 ${progress.waived}곳` : ''}`,
        href: '#claim-process', link: '교환 처리 보기',
      }
      : {
        label: '교환 배송',
        value: claim.reshipDeliveredAt ? '배송완료 확인함' : claim.reshippedAt ? '재출고함' : '재출고 전',
        detail: claim.reshipDeliveredAt ? `배송완료 ${formatOrderDateTime(claim.reshipDeliveredAt)}`
          : claim.reshippedAt ? `재출고 ${formatOrderDateTime(claim.reshippedAt)} · 배송완료 확인 전` : '',
        href: '#claim-process', link: '교환 처리 보기',
      }
    : { label: '환불 기록', ...refundSummary(refund), href: '#claim-refund', link: '환불 내역 보기' };
  const facts: Fact[] = [
    {
      label: '처리 상태', value: <AdminStatusBadge tone={statusTone('claim', claim.stage)}>{adminClaimStageLabel(claim.claimType, claim.stage)}</AdminStatusBadge>,
      detail: claim.stage === 'on_hold'
        ? `보류 전 ${claim.heldFrom ? adminClaimStageLabel(claim.claimType, claim.heldFrom) : '단계 확인 필요'}`
        : `최근 변경 ${formatOrderDateTime(claim.updatedAt)}`,
      href: '#claim-process', link: '처리 항목 보기',
    },
    collection,
    settlement,
  ];

  /* 처리 현황은 한 줄 요약이다 — 카드 세 개로 키우면 지금 할 일(처리 칸)이 첫 화면 아래로 밀린다. */
  return <section aria-label="취소·반품·교환 처리 현황" className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card px-4 py-3 text-sm text-card-foreground" data-admin-kit="claim-progress">
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3 sm:divide-x">{facts.map(fact => <div className="flex min-w-0 flex-col gap-1 sm:pl-6 sm:first:pl-0" key={fact.label}>
      <dt className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">{fact.label}<a className="shrink-0 underline underline-offset-4 hover:text-foreground" href={fact.href}>{fact.link}</a></dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 break-words">
        <strong className="font-semibold">{fact.value}</strong>
        {fact.detail ? <span className="text-xs text-muted-foreground">{fact.detail}</span> : null}
      </dd>
    </div>)}</dl>
    {claim.stage === 'on_hold' && claim.holdReason ? <p className="break-words text-muted-foreground">보류 사유: {claim.holdReason}</p> : null}
  </section>;
}
