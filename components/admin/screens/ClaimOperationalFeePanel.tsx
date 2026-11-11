'use client';

import { adminFormRemountKey, preservedFormValues } from '@/lib/admin/form-state';
import { useActionState } from 'react';
import {
  recordOrderClaimOperationalFeeAction,
  type AdminClaimActionState,
} from '@/app/admin/claim-actions';
import {
  ADMIN_CLAIM_OPERATIONAL_FEE_KINDS,
  type AdminClaimOperationalFee,
} from '@/lib/admin/claims';
import { krw } from '@/lib/format';
import type { OrderClaimType } from '@/lib/orders/claims';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { SalesDisclosureCard } from '@/components/admin/sales/SalesConsole';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { useClaimPreviewBusy } from './ClaimPreviewDialog';

const EMPTY_STATE: AdminClaimActionState = {};
const KIND_LABELS: Record<(typeof ADMIN_CLAIM_OPERATIONAL_FEE_KINDS)[number], string> = {
  return_shipping: '반품 배송비',
  exchange_shipping: '교환 배송비',
  other: '기타 운영 비용',
};

export function ClaimOperationalFeePanel({
  claimId,
  claimType,
  fee,
}: {
  claimId: string;
  claimType: OrderClaimType;
  fee: AdminClaimOperationalFee;
}) {
  const [state, action, pending] = useActionState(recordOrderClaimOperationalFeeAction, EMPTY_STATE);
  useClaimPreviewBusy(pending); /* 목록 위 클레임 팝업(R8)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  const values = preservedFormValues(state, claimId, { scopeKey: 'claimId' });
  /* 승인 전에 채우는 칸이 아니다 — 선택 입력임을 제목 옆에 밝히고 접어 둔다. 기록이 있으면 접힌 줄에서 금액을 본다. */
  return <SalesDisclosureCard closeLabel="접기" openLabel="펼치기" status={<AdminStatusBadge tone="neutral">{fee.amount !== null ? '기록됨' : '선택 입력'}</AdminStatusBadge>}
    summary={fee.amount !== null ? `${fee.kind ? `${KIND_LABELS[fee.kind]} · ` : ''}${krw(fee.amount)}` : '실제로 확인한 비용이 있을 때만 기록합니다.'} title="운영 확인액">
    <section aria-label="운영 확인액 기록" className="flex min-w-0 flex-col gap-3 text-sm" data-claim-operational-fee="">
    <p className="text-muted-foreground">
      CS가 실제로 확인한 금액과 근거만 기록합니다. 이 기록은 고객에게 추가 청구하거나 환불액에서 차감하지 않으며, 클레임 접수를 막지 않습니다.
      금액을 모르면 비워 두고 저장하세요. 0원은 확인된 무료 비용으로 구분됩니다.
    </p>
    <form action={action} key={adminFormRemountKey(state, fee)}>
      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={pending}>
      <input name="claimId" type="hidden" value={claimId} />
      <input name="claimType" type="hidden" value={claimType} />
      <input name="expectedUpdatedAt" type="hidden" value={values?.expectedUpdatedAt ?? fee.updatedAt} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="claim-operational-fee-kind">비용 유형</Label>
          <NativeSelect className="w-full" defaultValue={values?.feeKind ?? fee.kind ?? ''} id="claim-operational-fee-kind" name="feeKind" disabled={pending}>
            <option value="">선택 안 함</option>
            {ADMIN_CLAIM_OPERATIONAL_FEE_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
          </NativeSelect>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="claim-operational-fee-amount">확인 금액 (원)</Label>
          <Input className="tabular-nums" defaultValue={values?.amount ?? (fee.amount === null ? '' : String(fee.amount))} id="claim-operational-fee-amount" inputMode="numeric" max={1000000} min={0} name="amount" type="number" />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="claim-operational-fee-note">금액 의미·메모</Label>
        <Input defaultValue={values?.note ?? fee.note ?? ''} id="claim-operational-fee-note" maxLength={500} name="note" placeholder="예: 고객 귀책 왕복 배송비 확인" type="text" />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="claim-operational-fee-evidence">확인 근거</Label>
        <Textarea defaultValue={values?.evidence ?? fee.evidence ?? ''} id="claim-operational-fee-evidence" maxLength={1000} name="evidence" rows={3} placeholder="CS 상담 기록·택배 회신 등 실제 근거" />
      </div>
      <Button className="w-fit" disabled={pending} size="sm" type="submit">{pending ? '저장 중…' : fee.amount === null ? '운영 확인액 기록' : '운영 확인액 갱신'}</Button>
      {state.error ? <p className="text-destructive" role="alert">{state.error}</p> : null}
      {state.message ? <p className="text-muted-foreground" role="status">{state.message}</p> : null}
      </fieldset>
    </form>
    </section>
  </SalesDisclosureCard>;
}
