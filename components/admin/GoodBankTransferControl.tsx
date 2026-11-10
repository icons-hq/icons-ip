'use client';

import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { useActionState } from 'react';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import {
  setGoodBankTransferAction,
  type AdminGoodBankTransferActionState,
} from '../../app/admin/good-bank-transfer-actions';

const bankTransferInitialState: AdminGoodBankTransferActionState = {};

/**
 * 굿즈 무통장 토글 (#256).
 *
 * 재고를 24시간 묶어도 되는 굿즈인지에 대한 운영 판단이다. 상품 정보 수정과
 * 분리해 두는 이유는 고시정보 7칸을 다시 채우지 않고도 즉시 끌 수 있어야
 * 하기 때문이다 — 한정 드롭 오픈 직전에 필요한 스위치다.
 */
export function GoodBankTransferControl({
  allowBankTransfer,
  id,
}: {
  allowBankTransfer: boolean;
  id: string;
}) {
  const [state, action, pending] = useActionState(
    setGoodBankTransferAction,
    bankTransferInitialState,
  );

  return (
    <form action={action} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-sm text-card-foreground">
      <div className="flex flex-col gap-1">
        <strong className="font-medium">무통장 입금</strong>
        <p className="text-xs text-muted-foreground">
          {allowBankTransfer
            ? adminGoodsCopy('이 굿즈는 무통장 주문을 받습니다. 재고가 최대 24시간 선점됩니다.')
            : adminGoodsCopy('이 굿즈는 카드 결제만 받습니다.')}
        </p>
      </div>
      <input name="id" type="hidden" value={id} />
      <input name="allowed" type="hidden" value={allowBankTransfer ? 'false' : 'true'} />
      <button className={`${buttonVariants({ variant: 'outline' })} self-start`} data-slot="button" disabled={pending}>
        {pending
          ? '변경하는 중'
          : allowBankTransfer ? '무통장 입금 닫기' : '무통장 입금 열기'}
      </button>
      {state.error && <p className="text-sm text-destructive" role="alert">{state.error}</p>}
      {state.message && <p className="text-sm font-medium text-[var(--wc-success)]" role="status">{state.message}</p>}
    </form>
  );
}
