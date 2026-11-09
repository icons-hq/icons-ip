'use client';

import { useActionState, type MouseEvent, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { setAdminGoodPublishedAction } from '@/app/admin/goods-publish-actions';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { goodReadinessAction, goodReadinessPlan, goodReadinessReasonAnchor } from '@/lib/admin/good-workspace';
import type { AdminGoodsReadiness } from '@/lib/admin/goods-readiness';
import { AdminNotice } from './console/AdminKit';
import { focusGoodWorkspaceTarget } from './GoodWorkspace';

type Reason = AdminGoodsReadiness['reasons'][number];

const moveToReason = (anchor: string) => (event: MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); focusGoodWorkspaceTarget(anchor); };
/* 접힌 줄은 좁게 두고 펼치면 한 줄을 다 쓴다(open:basis-full). 판매 준비 카드가 입력칸을 밀어내지 않게 한다. */
const FOLD_CLASS = 'min-w-0 outline-none open:basis-full';
const FOLD_SUMMARY_CLASS = 'flex w-fit cursor-pointer list-none items-center gap-1 rounded-md outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden';
const FOLD_CHEVRON_CLASS = 'size-3.5 shrink-0 transition-transform motion-reduce:transition-none';

/** 지금 처리할 항목 하나와 그 자리로 가는 버튼. 그 밖의 항목은 이름만 잇는다. */
function GoodReadinessStep({ title, reason, others, variant, note, children }: {
  title: string; reason: Reason; others: Reason[]; variant: 'default' | 'soft' | 'outline'; note?: string; children?: ReactNode;
}) {
  const anchor = goodReadinessReasonAnchor(reason);
  return <div className="flex min-w-0 flex-col gap-2" data-good-readiness-next="">
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <AdminNotice className="min-w-[min(100%,16rem)] flex-1" title={`${title} · ${reason.label}`} tone="warning">{reason.detail}{note ? ` ${note}` : ''}</AdminNotice>
      <a className={buttonVariants({ variant })} data-slot="button" href={`#${anchor}`} onClick={moveToReason(anchor)}>{goodReadinessAction(reason.code)}</a>
      {children}
    </div>
    {others.length ? <p className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-sm"><span className="text-muted-foreground">그 밖에</span>{others.map((item) => { const target = goodReadinessReasonAnchor(item); return <a className="underline underline-offset-4" href={`#${target}`} key={item.code} onClick={moveToReason(target)} title={item.detail}>{item.label}</a>; })}</p> : null}
  </div>;
}

/*
 * 템플릿 룩(ADR-0028). 게시 상태만 바꾸는 독립 작업 — 기본 상품 폼 밖, 판매 준비 카드 안에 둔다.
 * 초안에서 주 행동은 하나다: 막는 항목이 남으면 다음 할 일, 없으면 공개로 전환, 저장하지 않은 입력이 있으면 저장 막대의 저장 후 공개.
 * 공개 중인 상품을 내리는 작업은 빨간 글자의 보조 버튼으로 접어 두고, 펼친 뒤 확인을 거친다(`#good-operation-publish` 링크는 열어서 들어온다).
 */
export function GoodPublishControls({ id, publishedAt, archivedAt, readiness, unsaved = false, publishOnSave = false, priceZero = false }: {
  id: string; publishedAt: string | null; archivedAt: string | null;
  /** 서버의 판매 준비 판정. 없으면 판정을 추정하지 않고 공개를 보조 버튼으로 둔다(서버가 다시 확인한다). */
  readiness?: AdminGoodsReadiness | null;
  /** 저장하지 않은 입력이 있다. 여기서 공개하면 그 입력이 빠지므로 공개 버튼을 저장 막대로 넘긴다. */
  unsaved?: boolean;
  /** 저장 막대에 저장 후 공개가 보인다(저장하지 않은 입력까지 공개 조건을 채웠다). */
  publishOnSave?: boolean;
  /** 저장된 판매가가 0원이다. 서버 공개 조건은 아니지만 실수면 0원에 공개되므로 주 행동으로 권하지 않는다. */
  priceZero?: boolean;
}) {
  const [state, action, pending] = useActionState(setAdminGoodPublishedAction, {});
  const published = Boolean(publishedAt);
  const plan = goodReadinessPlan(readiness);
  const publishForm = (variant: 'default' | 'outline') => <form action={action} className="shrink-0">
    <input name="id" type="hidden" value={id}/><input name="published" type="hidden" value="true"/>
    <button className={buttonVariants({ variant })} data-slot="button" disabled={pending}>{pending ? '처리 중…' : '공개로 전환'}</button>
  </form>;
  return <div className="flex min-w-0 scroll-mt-24 flex-col gap-3 text-sm outline-none" data-good-publish="" id={published ? undefined : 'good-operation-publish'} tabIndex={published ? undefined : -1}>
    {archivedAt ? <p className="text-muted-foreground">복원하면 초안으로 돌아옵니다. 공개하려면 필수 항목을 확인해주세요.</p>
      : published ? (plan.next ? <GoodReadinessStep others={plan.others} reason={plan.next} title="확인 필요" variant="outline" /> : null)
      : plan.next ? <GoodReadinessStep note={unsaved ? '저장하면 다시 확인합니다.' : undefined} others={plan.others} reason={plan.next} title="다음 할 일" variant={unsaved ? 'soft' : 'default'}>{plan.publish && !unsaved ? publishForm('outline') : null}</GoodReadinessStep>
      : unsaved ? <AdminNotice title="저장하지 않은 입력이 있습니다" tone="info">{publishOnSave ? '저장 막대의 저장 후 공개를 누르면 수정한 내용까지 함께 공개됩니다.' : '저장한 뒤 공개할 수 있습니다.'}</AdminNotice>
      : plan.publish === 'primary' ? <div className="flex min-w-0 flex-wrap items-center gap-2">
        {priceZero ? <AdminNotice className="min-w-[min(100%,16rem)] flex-1" title="판매가가 0원입니다" tone="warning">공개하면 0원으로 판매됩니다. 판매가를 확인해주세요.</AdminNotice> : <AdminNotice className="min-w-[min(100%,16rem)] flex-1" title="공개할 수 있습니다" tone="success">공개하면 고객 화면에 바로 보입니다.</AdminNotice>}
        {publishForm(priceZero ? 'outline' : 'default')}
      </div> : <div>{publishForm('outline')}</div>}
    {state.error && <p className="text-destructive" role="alert">{state.error}</p>}{state.message && <p className="font-medium text-success" role="status">{state.message}</p>}
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      {published && !archivedAt ? <details className={`group/unpublish scroll-mt-24 ${FOLD_CLASS}`} id="good-operation-publish" tabIndex={-1}>
        <summary className={buttonVariants({ variant: 'outline', size: 'sm', className: 'w-fit cursor-pointer list-none text-destructive hover:text-destructive [&::-webkit-details-marker]:hidden' })} data-slot="button"><ChevronRight aria-hidden="true" className={`${FOLD_CHEVRON_CLASS} group-open/unpublish:rotate-90`} />초안으로 되돌리기</summary>
        <div className="mt-2 flex min-w-0 flex-col gap-3">
          <AdminNotice title="판매 중인 상품이 고객 화면에서 내려갑니다" tone="danger">목록·검색·상품 상세에서 숨겨지고, 장바구니에서는 판매 종료로 표시되어 새 주문을 할 수 없습니다. 기존 주문과 결제·취소 처리는 유지됩니다.</AdminNotice>
          <form action={action} className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <input name="id" type="hidden" value={id}/><input name="published" type="hidden" value="false"/>
            <label className="flex items-start gap-2 text-sm"><input className="mt-0.5" name="confirmUnpublish" required type="checkbox" value="yes"/> 초안 전환의 영향을 확인했습니다</label>
            <button className={buttonVariants({ variant: 'destructive' })} data-slot="button" disabled={pending}>{pending ? '처리 중…' : '초안으로 되돌리기'}</button>
          </form>
        </div>
      </details> : null}
      <details className={`group/readiness-guide ${FOLD_CLASS}`} data-good-readiness-guide="">
        <summary className={`${FOLD_SUMMARY_CLASS} text-xs text-muted-foreground`}><ChevronRight aria-hidden="true" className={`${FOLD_CHEVRON_CLASS} group-open/readiness-guide:rotate-90`} />판매 준비 안내</summary>
        <div className="mt-2 flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-3 text-muted-foreground">
          {!published && !archivedAt ? <p>공개하려면 상품 유형·대표 이미지·상품정보제공고시 7칸·출고지·옵션과 KC 검토 완료가 필요합니다. 연결 IP도 공개되어야 고객에게 보입니다.</p> : null}
          <p>게시·판매 설정·KC 검토는 별도 조건입니다. 준비 완료가 결제사 승인이나 실제 구매 성공을 보증하지는 않습니다.</p>
          <p>게시 상태를 바꿔도 저장하지 않은 입력은 함께 저장되지 않고 화면에 그대로 남습니다.</p>
          <p>모델·옵션·고시정보를 수정하면 실제 상품과 검토 근거가 달라질 수 있어 초안 전환과 KC 재검토가 필요합니다. 수정 후 KC 검토를 완료하고 다시 공개해주세요.</p>
          <p>해당 없음도 검토 생략을 뜻하지 않습니다. KC 영역에서 적용 제도와 판단 사유·근거·고객 안내·적용 옵션을 기록하고 현재 검토 절차를 진행합니다.</p>
          <p>기존 공개 · KC 미기록 상품은 자동 승인이나 자동 공개 중지로 처리하지 않습니다. 초안으로 전환한 뒤 재공개하려면 현재 KC 검토 요건을 충족해야 합니다.</p>
          {readiness ? <small className="text-xs">확인 시각 {readiness.checkedAt ? new Date(readiness.checkedAt).toLocaleString('ko-KR') : '확인 필요'} · 저장하지 않은 입력은 저장한 뒤 판정에 반영됩니다.</small> : null}
        </div>
      </details>
    </div>
  </div>;
}
