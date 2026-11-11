'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { stopDiscountPromotionAction } from '@/app/admin/discount-promotion-actions';
import { GroupTable, useGoodsGroupSession } from '@/components/admin/GoodsGroupOperation';
import { AdminNotice, AdminPageHeader, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import type { GoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { statusTone } from '@/lib/admin/status-tone';
import { formatOrderDateTime } from '@/lib/orders';
import {
  DISCOUNT_PROMOTION_PHASE_LABELS,
  DISCOUNT_PROMOTION_TARGET_LABELS,
  discountPromotionListHref,
  discountPromotionPhase,
  discountPromotionSkipLabel,
  discountRuleLabel,
  type DiscountPromotionDetail,
  type DiscountPromotionDetailGood,
} from '@/lib/admin/discount-promotions';

const won = (value: number | null) => value === null ? '—' : `${value.toLocaleString('ko-KR')}원`;
const range = (min: number | null, max: number | null) => min === max ? won(min) : `${won(min)} ~ ${won(max)}`;
const ROW = 'grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)]';
const TERM = 'text-sm text-muted-foreground';

/** 상품 한 줄의 할인 상태. 진행·예정 > 중지 > 종료 순으로 대표 상태를 고르고, 나머지는 건수로 덧붙인다. */
function goodDiscountState(row: DiscountPromotionDetailGood) {
  if (row.skip) return { tone: statusTone('goodReference', 'blocked'), label: '건너뜀', detail: discountPromotionSkipLabel(row.skip) };
  const parts = [row.discounts.active ? `진행·예정 ${row.discounts.active}건` : '', row.discounts.disabled ? `중지 ${row.discounts.disabled}건` : '', row.discounts.ended ? `종료 ${row.discounts.ended}건` : ''].filter(Boolean).join(' · ');
  if (row.discounts.active) return { tone: statusTone('display', 'active'), label: '할인 중·예정', detail: parts };
  if (row.discounts.disabled) return { tone: statusTone('display', 'inactive'), label: '중지', detail: parts };
  return { tone: statusTone('display', 'ended'), label: '종료', detail: parts };
}

/**
 * 할인 프로모션 상세(1014-109). 묶음의 대상·규칙과 상품마다 실제로 건 할인(기간할인 원장)의 상태를 보이고, 묶음 단위로 중지한다.
 * 중지는 이 프로모션이 만든 진행·예정 할인만 끈다 — 상품에 개별로 건 할인과 다른 프로모션의 할인은 그대로다.
 */
export function DiscountPromotionDetailScreen({ promotion, identity, canManage }: { promotion: DiscountPromotionDetail; identity: GoodsGroupIdentity | null; canManage: boolean }) {
  const router = useRouter();
  const session = useGoodsGroupSession(identity?.actorId ?? '', identity?.sessionId ?? null);
  const [dialog, setDialog] = useState(false), [acknowledged, setAcknowledged] = useState(false), [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();
  const operation = useRef<string | null>(null), busy = useRef(false);
  const phase = discountPromotionPhase(promotion, promotion.checkedAt);
  const activeGoods = promotion.goods.filter(row => row.discounts.active > 0).length;
  const stoppable = canManage && promotion.state === 'active' && phase !== 'ended';
  function stop() {
    if (!identity || !acknowledged || busy.current || pending || !session.current()) return;
    /* 같은 화면에서 다시 누르면 같은 요청번호로 보낸다 — 응답이 끊겼어도 두 번 중지되지 않고 저장된 결과를 돌려받는다. */
    operation.current ??= crypto.randomUUID();
    const operationId = operation.current;
    busy.current = true; setMessage(''); startTransition(async () => {
      try {
        const result = await stopDiscountPromotionAction(promotion.id, operationId, identity);
        if (!session.current()) return;
        if ('error' in result) { setMessage(result.error); if (result.authChanged) session.deny(); return; }
        setDialog(false); setMessage('');
        router.refresh();
      } catch { if (session.current()) setMessage('중지 결과가 불명확합니다. 다시 누르면 같은 요청으로 결과를 확인합니다.'); }
      finally { busy.current = false; }
    });
  }
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="discount-promotion-detail">
    <AdminPageHeader title={promotion.name} description="이 프로모션이 상품에 건 할인과 건너뛴 상품을 봅니다. 가격은 지금 상품의 판매 옵션 기준입니다."
      actions={<><Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={discountPromotionListHref(promotion.target.kind === 'campaign' && promotion.target.id ? { campaign: promotion.target.id } : {})}>목록으로</Link>
        {stoppable ? <Button onClick={() => { setDialog(true); setAcknowledged(false); setMessage(''); }} type="button" variant="destructive">프로모션 중지</Button> : null}</>} />
    <section aria-label="프로모션 요약" className="flex min-w-0 flex-col gap-2.5 rounded-xl border bg-card p-4 text-sm text-card-foreground">
      <div className={ROW}><span className={TERM}>상태</span><span><AdminStatusBadge tone={statusTone('discountPromotion', phase)}>{DISCOUNT_PROMOTION_PHASE_LABELS[phase]}</AdminStatusBadge></span></div>
      <div className={ROW}><span className={TERM}>할인 기간</span><span className="tabular-nums">{formatOrderDateTime(promotion.startsAt)} ~ {formatOrderDateTime(promotion.endsAt)}</span></div>
      <div className={ROW}><span className={TERM}>대상</span><span>{DISCOUNT_PROMOTION_TARGET_LABELS[promotion.target.kind]}{promotion.target.label ? ` · ${promotion.target.label}` : ''}{promotion.target.id ? <small className="ml-1 text-xs text-muted-foreground">{promotion.target.id}</small> : null}</span></div>
      <div className={ROW}><span className={TERM}>일괄 할인</span><span>{discountRuleLabel(promotion.rule)}{promotion.exceptionCount ? ` · 상품별 예외 ${promotion.exceptionCount}개` : ''}</span></div>
      <div className={ROW}><span className={TERM}>상품</span><span className="tabular-nums">대상 {promotion.goodsCount.toLocaleString('ko-KR')}개 · 할인 적용 {promotion.appliedCount.toLocaleString('ko-KR')}개 · 건너뜀 {(promotion.goodsCount - promotion.appliedCount).toLocaleString('ko-KR')}개</span></div>
      <div className={ROW}><span className={TERM}>옵션 할인</span><span className="tabular-nums">진행·예정 {promotion.discounts.active.toLocaleString('ko-KR')}건 · 종료 {promotion.discounts.ended.toLocaleString('ko-KR')}건 · 중지 {promotion.discounts.disabled.toLocaleString('ko-KR')}건</span></div>
      <div className={ROW}><span className={TERM}>등록</span><span className="tabular-nums">{formatOrderDateTime(promotion.createdAt)}{promotion.createdByName ? ` · ${promotion.createdByName}` : ''}</span></div>
      {promotion.stoppedAt ? <div className={ROW}><span className={TERM}>중지</span><span className="tabular-nums">{formatOrderDateTime(promotion.stoppedAt)}{promotion.stoppedByName ? ` · ${promotion.stoppedByName}` : ''}{promotion.stopReceipt ? ` · 할인 ${promotion.stopReceipt.disabledCount.toLocaleString('ko-KR')}건을 껐습니다` : ''}</span></div> : null}
    </section>
    {message && !dialog ? <p className="text-sm text-destructive" role="alert">{message}</p> : null}
    <GroupTable label="프로모션 상품" layout="fixed"><TableHeader><TableRow><TableHead className="w-[34%]">상품명·판매자상품코드</TableHead><TableHead className="w-[18%]">할인 규칙</TableHead><TableHead className="w-[16%]">현재 판매가</TableHead><TableHead className="w-[14%]">할인가</TableHead><TableHead>할인 상태</TableHead></TableRow></TableHeader>
      <TableBody>{promotion.goods.map(row => {
        const state = goodDiscountState(row);
        return <TableRow className="data-[skipped]:text-muted-foreground" data-skipped={row.skip ? 'true' : undefined} key={row.id}>
          <TableCell className="whitespace-normal wrap-anywhere"><Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/admin/catalog/goods?goodId=${encodeURIComponent(row.id)}`}>{row.name}</Link><small className="block text-xs text-muted-foreground">{row.code ?? row.id}{row.archived ? ' · 보관됨' : ''}</small></TableCell>
          <TableCell className="whitespace-normal">{discountRuleLabel(row.rule)}<small className="block text-xs text-muted-foreground">{row.rule.source === 'exception' ? '상품별 예외' : '일괄'}</small></TableCell>
          <TableCell className="whitespace-normal tabular-nums">{range(row.priceMin, row.priceMax)}</TableCell>
          <TableCell className="whitespace-normal tabular-nums">{row.skip ? '—' : range(row.discounts.minPrice, row.discounts.maxPrice)}</TableCell>
          <TableCell className="whitespace-normal"><AdminStatusBadge tone={state.tone}>{state.label}</AdminStatusBadge>{state.detail ? <small className="mt-0.5 block text-xs text-muted-foreground">{state.detail}</small> : null}</TableCell>
        </TableRow>;
      })}</TableBody></GroupTable>
    {dialog ? <CustomerServiceDialog busy={pending} onClose={() => { if (!pending) setDialog(false); }} title="할인 프로모션 중지">
      <div className="flex min-w-0 flex-col gap-4 text-sm">
        <p>‘{promotion.name}’이 만든 진행 중·예정 할인 {promotion.discounts.active.toLocaleString('ko-KR')}건(상품 {activeGoods.toLocaleString('ko-KR')}개)을 지금 끕니다.</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>상품에 개별로 건 할인과 다른 프로모션의 할인은 그대로입니다.</li>
          <li>이미 끝난 기간의 할인은 이력으로 남고, 기존 주문 금액은 바뀌지 않습니다.</li>
          <li>중지한 프로모션은 다시 켤 수 없습니다. 다시 할인하려면 새 프로모션을 만드세요.</li>
        </ul>
        <label className="flex cursor-pointer items-center gap-2"><input checked={acknowledged} disabled={pending} onChange={event => setAcknowledged(event.target.checked)} type="checkbox" />꺼질 할인과 영향을 확인했습니다.</label>
        {message ? <p className="text-destructive" role="alert">{message}</p> : null}
        {!identity || session.blocked ? <p className="text-destructive" role="alert">로그인 계정 또는 세션을 확인하지 못했습니다. 화면을 다시 열어주세요.</p> : null}
        <div className="flex flex-wrap justify-end gap-2"><Button disabled={pending} onClick={() => setDialog(false)} type="button" variant="outline">취소</Button>
          <Button disabled={pending || !acknowledged || !identity || session.blocked} onClick={stop} type="button" variant="destructive">{pending ? '중지하는 중…' : '프로모션 중지'}</Button></div>
      </div>
    </CustomerServiceDialog> : null}
  </div>;
}
