'use client';
import Link from 'next/link';
import { useActionState, useRef } from 'react';
import { setAdminCouponStatusAction, type AdminCouponActionState } from '@/app/admin/coupon-actions';
import type { AdminCouponRecord } from '@/lib/admin/coupons';
import { MoreHorizontal, X } from 'lucide-react';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/admin/kit/ui/dropdown-menu';

/*
 * 혜택 한 줄의 관리 버튼(템플릿 룩, ADR-0028). 자주 누르는 수정·발급만 줄에 두고 복사·중지는 더보기에 넣는다 —
 * 빨간 중지가 줄마다 반복되면 표에서 제일 튀고 수정 옆이라 잘못 누르기 쉽다. 위험 표시는 메뉴와 확인 창에서 한다.
 * 중지·재개 확인은 네이티브 dialog(showModal)가 포커스·Esc를 맡고, 모양만 kit Dialog와 같다.
 */
export function CouponRowActions({ coupon, onEdit, copyHref, issueHref }: { coupon: AdminCouponRecord; onEdit: () => void; copyHref: string; issueHref: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(setAdminCouponStatusAction, {} as AdminCouponActionState);
  const stopped = coupon.status === 'archived';
  return <div className="flex items-center gap-1 print:hidden">
    <Button onClick={onEdit} size="xs" type="button" variant="outline">수정</Button>
    <Link className={buttonVariants({ size: 'xs', variant: 'outline' })} data-slot="button" href={issueHref}>발급</Link>
    {/* 메뉴가 화면을 잠그면(modal) 메뉴가 닫히기 전에 연 확인 창까지 잠겨 포커스를 못 받는다. */}
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger render={<Button aria-label={`${coupon.name} 더보기`} size="icon-xs" type="button" variant="ghost" />}><MoreHorizontal aria-hidden="true" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-28">
        <DropdownMenuItem render={<Link href={copyHref} />}>복사</DropdownMenuItem>
        <DropdownMenuItem onClick={() => dialog.current?.showModal()} variant={stopped ? 'default' : 'destructive'}>{stopped ? '재개' : '중지'}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <dialog className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-xl border-0 bg-popover p-0 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none backdrop:bg-black/50" aria-label="혜택 상태 변경" ref={dialog}>
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3"><h2 className="text-base leading-none font-semibold">혜택 {stopped ? '재개' : '중지'}</h2><Button type="button" size="icon-sm" variant="ghost" aria-label="상태 변경 닫기" onClick={() => dialog.current?.close()}><X aria-hidden="true" /></Button></header>
      <form action={action}><div className="flex flex-col gap-2 p-4 whitespace-normal"><p><strong className="font-medium">{coupon.name}</strong> 혜택을 {stopped ? '다시 적용' : '중지'}합니다.</p><p className="text-muted-foreground">{stopped ? '설정된 기간·한도·대상 조건에 따라 발급과 사용이 다시 허용됩니다.' : '새 발급과 기존에 발급된 쿠폰의 사용이 함께 중지됩니다. 이미 완료된 주문은 바뀌지 않습니다.'}</p>
        <input type="hidden" name="code" value={coupon.code} /><input type="hidden" name="revision" value={coupon.termsRevision ?? ''} /><input type="hidden" name="status" value={stopped ? 'active' : 'archived'} />
        {state.errors?.form ? <p className="text-destructive" role="alert">{state.errors.form}</p> : null}{state.message ? <p className="text-success" role="status">{state.message}</p> : null}
      </div><div className="flex justify-end gap-2 border-t px-4 py-3"><Button type="button" variant="outline" disabled={pending} onClick={() => dialog.current?.close()}>닫기</Button><Button disabled={pending || Boolean(state.message)} type="submit" variant={stopped ? 'default' : 'destructive'}>{pending ? '처리 중…' : `${stopped ? '재개' : '중지'} 확인`}</Button></div></form>
    </dialog>
  </div>;
}
