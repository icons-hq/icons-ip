'use client';

import Link from 'next/link';
import { startTransition, useActionState, useState } from 'react';
import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { deleteReturnAddressAction, saveReturnAddressAction, type ReturnAddressActionState } from '@/app/admin/return-address-actions';
import { AdminField, AdminFormGrid, AdminNotice, AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/admin/kit/ui/alert-dialog';
import { statusTone } from '@/lib/admin/status-tone';
import { FULFILLMENT_ORIGINS_PATH } from '@/lib/admin/fulfillment-origins';
import { RETURN_ADDRESS_FIELD_LABELS, type ReturnAddress, type ReturnAddressField } from '@/lib/admin/return-addresses';
import { useAdminLeaveGuard } from '../useAdminLeaveGuard';

/*
 * 반품/교환지 주소록(S36-040). 상품 등록의 '반품·교환'에서 고르는 반품지다. 상품에서 비우면 출고지 설정의
 * 반품 주소를 쓴다. 반품을 승인하면 그때의 반품지가 회수 주소로 고정되므로, 여기서 고쳐도 이미 접수된 반품의
 * 회수 주소는 바뀌지 않는다. 상품이 고른 반품지는 지울 수 없다.
 */
const ROW = 'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 md:grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)_7rem_5.5rem_4.25rem]';

function latestStamp(server: string, local?: string) { return local && Date.parse(local) > Date.parse(server) ? local : server; }

function Feedback({ state }: { state: ReturnAddressActionState }) {
  return <>{state.errors?.form ? <AdminNotice role="alert" tone="danger">{state.errors.form}</AdminNotice> : null}
    {state.message ? <AdminNotice role="status" tone="success">{state.message}</AdminNotice> : null}</>;
}

function ReturnAddressForm({ entry, canEdit }: { entry?: ReturnAddress; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveReturnAddressAction, {});
  const { formRef } = useAdminLeaveGuard({ serverState: state });
  const key = entry?.id ?? 'new';
  return <form action={action} className="flex min-w-0 flex-col gap-4" ref={formRef}>
    {entry ? <><input type="hidden" name="id" value={entry.id} /><input type="hidden" name="updatedAt" value={latestStamp(entry.updatedAt, state.updatedAt)} /></> : null}
    <AdminFormGrid>{(Object.keys(RETURN_ADDRESS_FIELD_LABELS) as ReturnAddressField[]).map((field) => {
      const inputId = `return-address-${key}-${field}`;
      const hint = field === 'name' ? '상품 등록에서 고를 때 보이는 이름입니다. 예: 서울 반품지'
        : field === 'address' ? '고객이 반품·교환 상품을 보내는 주소입니다. 상품 상세와 승인 뒤 고객 반품 안내에 보입니다.'
          : '반품 운송장의 받는 분 연락처입니다. 승인 뒤 고객 반품 안내에 보입니다.';
      return <div className={field === 'address' ? 'col-span-full min-w-0' : 'min-w-0'} key={field}>
        <AdminField label={RETURN_ADDRESS_FIELD_LABELS[field]} inputId={inputId} hint={hint} error={state.errors?.[field]}>
          <Input id={inputId} name={field} defaultValue={state.values?.[field] ?? entry?.[field] ?? ''} maxLength={field === 'name' ? 60 : field === 'address' ? 500 : 20}
            readOnly={!canEdit} required inputMode={field === 'phone' ? 'tel' : undefined} aria-invalid={Boolean(state.errors?.[field])}
            aria-describedby={state.errors?.[field] ? `${inputId}-error` : `${inputId}-hint`} />
        </AdminField>
      </div>;
    })}</AdminFormGrid>
    <Feedback state={state} />
    {canEdit ? <Button className="w-fit" disabled={pending} type="submit"><Check aria-hidden="true" />{pending ? '저장 중…' : entry ? '반품지 저장' : '반품지 등록'}</Button> : null}
  </form>;
}

function DeleteReturnAddress({ entry }: { entry: ReturnAddress }) {
  const [state, action, pending] = useActionState(deleteReturnAddressAction, {});
  const [open, setOpen] = useState(false);
  const confirm = () => {
    const data = new FormData();
    data.set('id', entry.id); data.set('updatedAt', entry.updatedAt);
    setOpen(false);
    startTransition(() => action(data));
  };
  return <div className="flex flex-col gap-2 border-t pt-3">
    {entry.goodsCount > 0
      ? <p className="text-sm text-muted-foreground">이 반품지를 고른 상품 {entry.goodsCount.toLocaleString('ko-KR')}개가 있어 지울 수 없습니다. 상품의 반품/교환지를 먼저 바꿔주세요.</p>
      : <Button className="w-fit" disabled={pending} onClick={() => setOpen(true)} size="sm" variant="destructive"><Trash2 aria-hidden="true" />{pending ? '삭제 중' : '반품지 삭제'}</Button>}
    <Feedback state={state} />
    <AlertDialog onOpenChange={setOpen} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>‘{entry.name}’ 반품지를 삭제할까요?</AlertDialogTitle>
          <AlertDialogDescription>이 반품지를 고른 상품이 없습니다. 이미 접수된 반품의 회수 주소는 그대로 남고, 삭제 기록은 감사 로그에 남습니다.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} variant="danger">삭제</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

export function ReturnAddressesScreen({ addresses, canEdit }: { addresses: ReturnAddress[]; canEdit: boolean }) {
  /* 목록이 비었을 때만 처음부터 펼친다. 첫 반품지를 등록하면 목록 길이가 바뀌는데, 길이로 열림을 정하면 폼이 접혀 완료 문장이 사라진다(QA2).
     이후에는 운영자가 연 상태를 그대로 둔다. */
  const [addOpen, setAddOpen] = useState(addresses.length === 0);
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="return-addresses">
    <AdminPageHeader title="반품/교환지 관리" description="상품마다 고를 반품/교환지를 등록합니다. 상품에서 비우면 출고지 설정의 반품 주소를 씁니다." />
    <AdminNotice tone="info">
      반품을 승인하면 그때의 반품지가 회수 주소로 고정됩니다. 여기서 주소를 고쳐도 이미 접수된 반품의 회수 주소는 바뀌지 않습니다.
      한 배송 건 안에서 상품마다 반품지가 다르면 회수를 반품지별로 나눠 받습니다. 출고지 기본 반품 주소는{' '}
      <Link className="underline underline-offset-2" href={FULFILLMENT_ORIGINS_PATH}>배송정보 관리</Link>에서 고칩니다.
    </AdminNotice>
    <AdminSectionCard title="반품/교환지 목록" requirement={`${addresses.length}곳`}>
      {addresses.length ? <div className="min-w-0 overflow-hidden rounded-lg border" data-return-address-list="">
        <div aria-hidden="true" className={`${ROW} h-9 border-b bg-muted text-xs font-semibold text-secondary-foreground`}>
          <span>반품지 이름</span><span className="hidden md:block">주소</span><span className="hidden md:block">연락처</span><span>사용 상품</span><span className="text-right">관리</span>
        </div>
        {addresses.map((entry) => <details className="group border-b last:border-b-0" key={entry.id}>
          <summary className={`${ROW} min-h-11 cursor-pointer list-none py-2 hover:bg-primary-soft/40 [&::-webkit-details-marker]:hidden`}>
            <strong className="min-w-0 truncate font-semibold">{entry.name}</strong>
            <span className="hidden min-w-0 truncate text-muted-foreground md:block" title={entry.address}>{entry.address}</span>
            <span className="hidden min-w-0 truncate tabular-nums text-muted-foreground md:block">{entry.phone}</span>
            <AdminStatusBadge tone={statusTone('setting', entry.goodsCount ? 'active' : 'inactive')}>{entry.goodsCount ? `${entry.goodsCount.toLocaleString('ko-KR')}개` : '없음'}</AdminStatusBadge>
            <span className={`${buttonVariants({ size: 'xs', variant: 'outline' })} justify-self-end`} data-slot="button">{canEdit ? '수정' : '보기'}<ChevronDown aria-hidden="true" className="transition-transform group-open:rotate-180" /></span>
          </summary>
          <div className="flex flex-col gap-4 border-t bg-muted/30 p-4">
            <ReturnAddressForm entry={entry} canEdit={canEdit} />
            {canEdit ? <DeleteReturnAddress entry={entry} /> : null}
          </div>
        </details>)}
      </div> : <p className="text-muted-foreground">등록한 반품/교환지가 없습니다. 모든 상품이 출고지 반품 주소를 씁니다.</p>}
      {canEdit ? <details className="group rounded-lg border" open={addOpen} onToggle={(event) => setAddOpen(event.currentTarget.open)}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm font-medium hover:bg-muted [&::-webkit-details-marker]:hidden"><Plus aria-hidden="true" className="size-4" />반품지 추가<ChevronDown aria-hidden="true" className="ml-auto size-3.5 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
        <div className="border-t p-4"><ReturnAddressForm canEdit /></div>
      </details> : <p className="text-sm text-muted-foreground">현재 계정은 반품/교환지를 조회할 수 있습니다. 변경 권한이 있는 매니저에게 요청해주세요.</p>}
    </AdminSectionCard>
  </div>;
}
