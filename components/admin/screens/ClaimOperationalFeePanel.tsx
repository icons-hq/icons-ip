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

/*
 * 운영 확인액 — CS가 실제로 확인한 비용을 적어 두는 기록용 칸이다. 이 값은 청구·환불·정산·엑셀 어디에도 쓰이지 않고(요청 상세와
 * 사유 정정 확인창에만 보인다) 환불·청구 금액을 바꾸지 않는다. 칸을 없애려면 DB 변경이 필요해 이번에는 이름과 안내만 사실대로 고쳤다.
 * 금액을 적으면 비용 유형·비용 메모·확인 근거가 모두 필요하다(DB가 넷을 함께 요구한다). 모두 비우고 저장하면 기록이 지워진다.
 */
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
    <p className="text-muted-foreground">기록용 메모입니다. 환불·청구 금액은 바뀌지 않습니다.</p>
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
          <Input className="tabular-nums" defaultValue={values?.amount ?? (fee.amount === null ? '' : String(fee.amount))} id="claim-operational-fee-amount" inputMode="numeric" max={1000000} min={0} name="amount" placeholder="예: 6000" type="number" />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="claim-operational-fee-note">비용 메모</Label>
        <Input defaultValue={values?.note ?? fee.note ?? ''} id="claim-operational-fee-note" maxLength={500} name="note" placeholder="예: 고객 귀책 왕복 택배비" type="text" />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="claim-operational-fee-evidence">확인 근거</Label>
        <Textarea defaultValue={values?.evidence ?? fee.evidence ?? ''} id="claim-operational-fee-evidence" maxLength={1000} name="evidence" rows={3} placeholder="예: 11/26 택배사 정산서 확인, 고객 통화" />
      </div>
      <p className="text-xs text-muted-foreground">금액을 적으면 비용 유형·비용 메모·확인 근거도 모두 적어야 저장됩니다. 비용이 없다고 확인했으면 0을 적고, 모두 비우고 저장하면 기록이 지워집니다.</p>
      <Button className="w-fit" disabled={pending} size="sm" type="submit">{pending ? '저장 중…' : fee.amount === null ? '운영 확인액 기록' : '운영 확인액 갱신'}</Button>
      {state.error ? <p className="text-destructive" role="alert">{state.error}</p> : null}
      {state.message ? <p className="text-muted-foreground" role="status">{state.message}</p> : null}
      </fieldset>
    </form>
    </section>
  </SalesDisclosureCard>;
}
