'use client';
import { useActionState, useRef } from 'react';
import { setAdminCouponStatusAction, type AdminCouponActionState } from '@/app/admin/coupon-actions';
import type { AdminCouponRecord } from '@/lib/admin/coupons';
import { X } from 'lucide-react';
import { Button } from '@/components/admin/kit/ui/button';
/* 혜택 중지·재개 확인(템플릿 룩, ADR-0028). 네이티브 dialog(showModal)가 포커스·Esc를 맡고, 모양만 kit Dialog와 같다. */
export function CouponStatusAction({ coupon }: { coupon: AdminCouponRecord }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(setAdminCouponStatusAction, {} as AdminCouponActionState);
  const stopped = coupon.status === 'archived';
  return <div className="inline-flex"><Button type="button" size="xs" variant="outline" onClick={() => dialog.current?.showModal()}>{stopped ? '재개' : '중지'}</Button>
    <dialog className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-xl border-0 bg-popover p-0 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none backdrop:bg-black/50" aria-label="혜택 상태 변경" ref={dialog}>
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3"><h2 className="text-base leading-none font-semibold">혜택 {stopped ? '재개' : '중지'}</h2><Button type="button" size="icon-sm" variant="ghost" aria-label="상태 변경 닫기" onClick={() => dialog.current?.close()}><X aria-hidden="true" /></Button></header>
      <form action={action}><div className="flex flex-col gap-2 p-4 whitespace-normal"><p><strong className="font-medium">{coupon.name}</strong> 혜택을 {stopped ? '다시 적용' : '중지'}합니다.</p><p className="text-muted-foreground">{stopped ? '설정된 기간·한도·대상 조건에 따라 발급과 사용이 다시 허용됩니다.' : '새 발급과 기존에 발급된 쿠폰의 사용이 함께 중지됩니다. 이미 완료된 주문은 바뀌지 않습니다.'}</p>
        <input type="hidden" name="code" value={coupon.code} /><input type="hidden" name="revision" value={coupon.termsRevision ?? ''} /><input type="hidden" name="status" value={stopped ? 'active' : 'archived'} />
        {state.errors?.form ? <p className="text-destructive" role="alert">{state.errors.form}</p> : null}{state.message ? <p className="text-[var(--wc-success)]" role="status">{state.message}</p> : null}
      </div><div className="flex justify-end gap-2 border-t px-4 py-3"><Button type="button" variant="outline" disabled={pending} onClick={() => dialog.current?.close()}>닫기</Button><Button disabled={pending || Boolean(state.message)} type="submit" variant={stopped ? 'default' : 'destructive'}>{pending ? '처리 중…' : `${stopped ? '재개' : '중지'} 확인`}</Button></div></form>
    </dialog>
  </div>;
}
