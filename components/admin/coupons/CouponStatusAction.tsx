'use client';
import { useActionState, useRef } from 'react';
import { setAdminCouponStatusAction, type AdminCouponActionState } from '@/app/admin/coupon-actions';
import type { AdminCouponRecord } from '@/lib/admin/coupons';
export function CouponStatusAction({ coupon }: { coupon: AdminCouponRecord }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(setAdminCouponStatusAction, {} as AdminCouponActionState);
  const stopped = coupon.status === 'archived';
  return <div className="admin-coupon-status-action"><button type="button" onClick={() => dialog.current?.showModal()}>{stopped ? '재개' : '중지'}</button>
    <dialog className="admin-grid-settings-dialog" aria-label="혜택 상태 변경" ref={dialog}>
      <header><h2>혜택 {stopped ? '재개' : '중지'}</h2><button type="button" className="admin-grid-settings-close" aria-label="상태 변경 닫기" onClick={() => dialog.current?.close()}>×</button></header>
      <form action={action}><div className="admin-grid-settings-body"><p><strong>{coupon.name}</strong> 혜택을 {stopped ? '다시 적용' : '중지'}합니다.</p><p>{stopped ? '설정된 기간·한도·대상 조건에 따라 발급과 사용이 다시 허용됩니다.' : '새 발급과 기존에 발급된 쿠폰의 사용이 함께 중지됩니다. 이미 완료된 주문은 바뀌지 않습니다.'}</p>
        <input type="hidden" name="code" value={coupon.code} /><input type="hidden" name="revision" value={coupon.termsRevision ?? ''} /><input type="hidden" name="status" value={stopped ? 'active' : 'archived'} />
        {state.errors?.form ? <p role="alert">{state.errors.form}</p> : null}{state.message ? <p role="status">{state.message}</p> : null}
      </div><div className="admin-coupon-confirm-actions"><button type="button" disabled={pending} onClick={() => dialog.current?.close()}>닫기</button><button className="admin-coupon-primary" disabled={pending || Boolean(state.message)} type="submit">{pending ? '처리 중…' : `${stopped ? '재개' : '중지'} 확인`}</button></div></form>
    </dialog>
  </div>;
}
