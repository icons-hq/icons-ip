'use client';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { useActionState, useState } from 'react';
import { adjustStoreCreditAction, saveStoreCreditPolicyAction, type StoreCreditActionState } from '@/app/admin/store-credit-actions';
import { AdminField, AdminFormGrid, AdminNotice } from '@/components/admin/console/AdminKit';
import type { StoreCreditPolicyRecord } from '@/lib/store-credits';
import { Check } from 'lucide-react';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { CHECK_LABEL, NOTE } from '@/components/admin/settings-kit';

const POLICY_FIELDS = [
  ['earnMaxPerOrder', '주문당 적립 상한 (원)'], ['maxBalance', '보유 적립금 상한 (원)'],
  ['validityDays', '적립금 유효기간 (일)'], ['minUse', '1회 사용 하한 (원)'],
  ['maxUse', '1회 사용 상한 (원)'], ['restoreGraceDays', '만료 후 복원 유효기간 (일)'],
] as const;

export function StoreCreditPolicyForm({ policy, operationId }: { policy: StoreCreditPolicyRecord; operationId: string }) {
  const [state, action, pending] = useActionState(saveStoreCreditPolicyAction, {});
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(policy).map(([key, value]) => [key, value === null ? '' : String(value)])));
  function set(key: string, value: string) { setValues(previous => ({ ...previous, [key]: value })); }
  return <form action={action} className="flex min-w-0 flex-col gap-4" onReset={event => event.preventDefault()}>
    <input type="hidden" name="operationId" value={state.operationId ?? operationId} />
    <input type="hidden" name="version" value={state.policy?.version ?? policy.version} />
    <p className={NOTE}>지급·사용 정책은 빈 값을 허용하는 비활성 초안으로 저장할 수 있습니다. 활성화하려면 모든 수치와 정책 근거를 입력해주세요.</p>
    <AdminFormGrid>
      <AdminField label="거래확정 시 적립 방식" inputId="credit-earnKind"><NativeSelect className="w-full" id="credit-earnKind" name="earnKind" value={values.earnKind} onChange={event => set('earnKind', event.target.value)}>
        <option value="">미설정</option><option value="rate_bps">{adminGoodsCopy("할인 후 굿즈 금액의 정률")}</option><option value="fixed">거래확정 주문당 정액</option>
      </NativeSelect></AdminField>
      <AdminField label={values.earnKind === 'rate_bps' ? '적립률 (0.01% 단위)' : '적립 금액 (원)'} inputId="credit-earnValue" hint="정률은 100이 1%입니다. 배송비와 사용 적립금은 적립 기준에서 제외합니다.">
        <Input id="credit-earnValue" name="earnValue" type="number" min="0" step="1" value={values.earnValue} onChange={event => set('earnValue', event.target.value)} />
      </AdminField>
      {POLICY_FIELDS.map(([key, label]) => <AdminField key={key} label={label} inputId={`credit-${key}`} hint={key === 'restoreGraceDays' ? '명시적으로 0일을 설정하면 이미 만료된 사용분은 복원 시에도 사용할 수 없습니다.' : undefined}>
        <Input id={`credit-${key}`} name={key} type="number" min={key === 'validityDays' ? '1' : '0'} step="1" value={values[key]} onChange={event => set(key, event.target.value)} />
      </AdminField>)}
      <AdminField label="환불 주문에서 이미 사용한 원적립금" inputId="credit-refundEarnedCreditMode">
        <NativeSelect className="w-full" id="credit-refundEarnedCreditMode" name="refundEarnedCreditMode" value={values.refundEarnedCreditMode} onChange={event => set('refundEarnedCreditMode', event.target.value)}>
          <option value="">미설정</option><option value="offset_future_credits">이후 적립·복원 금액에서 상계</option>
        </NativeSelect>
      </AdminField>
    </AdminFormGrid>
    <p className={NOTE}>{adminGoodsCopy("상품 쿠폰을 순서대로 적용한 뒤 남은 굿즈 금액에 적립금을 사용합니다. 배송비 사용은 제외하고 기존 최소 유상 결제액을 유지합니다. 현금 청구·환불액 차감은 발생하지 않습니다.")}</p>
    <AdminField label="정책 승인 근거" inputId="credit-evidence"><Textarea id="credit-evidence" name="evidence" maxLength={2000} rows={4} value={values.evidence} onChange={event => set('evidence', event.target.value)} /></AdminField>
    <label className={CHECK_LABEL}><input type="checkbox" name="enabled" checked={values.enabled === 'true'} onChange={event => set('enabled', String(event.target.checked))} /> 적립금 지급과 주문 사용 활성화</label>
    <p className={NOTE}>비활성화해도 기존 주문에 약속한 적립과 사용분 복원, 기존 원장은 보존됩니다.</p>
    {state.error ? <AdminNotice role="alert" tone="danger">{state.error}</AdminNotice> : null}{state.message ? <AdminNotice role="status" tone="success">{state.message}</AdminNotice> : null}
    <Button className="w-fit" disabled={pending} type="submit"><Check aria-hidden="true" />{pending ? '저장 중…' : '정책 저장'}</Button>
  </form>;
}

export function StoreCreditAdjustmentForm({ userId, available, enabled, operationId }: { userId: string; available: number; enabled: boolean; operationId: string }) {
  const [direction, setDirection] = useState('credit');
  const [amount, setAmount] = useState(''); const [expiresAt, setExpiresAt] = useState(''); const [reason, setReason] = useState('');
  const [state, action, pending] = useActionState(async (previous: StoreCreditActionState, form: FormData) => {
    const result = await adjustStoreCreditAction(previous, form);
    if (result.message) { setAmount(''); setExpiresAt(''); setReason(''); }
    return result;
  }, {});
  return <form action={action} className="flex min-w-0 flex-col gap-4" onReset={event => event.preventDefault()}>
    <input type="hidden" name="operationId" value={state.operationId ?? operationId} />
    <input type="hidden" name="userId" value={userId} />
    <input type="hidden" name="expectedAvailable" value={state.available ?? available} />
    <fieldset disabled={!enabled || pending} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      <AdminFormGrid>
        <AdminField label="조정 구분" inputId="credit-direction"><NativeSelect className="w-full" id="credit-direction" name="direction" value={direction} onChange={event => setDirection(event.target.value)}><option value="credit">지급</option><option value="debit">차감 정정</option></NativeSelect></AdminField>
        <AdminField label="조정 금액 (원)" inputId="credit-amount"><Input id="credit-amount" name="amount" type="number" min="1" step="1" required value={amount} onChange={event => setAmount(event.target.value)} /></AdminField>
        {direction === 'credit' ? <AdminField label="만료 일시 (KST)" inputId="credit-expiresAt"><Input id="credit-expiresAt" name="expiresAt" type="datetime-local" required value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></AdminField> : null}
      </AdminFormGrid>
      <AdminField label="조정 사유" inputId="credit-reason" hint="고객의 적립금 이력에도 표시됩니다. 고객에게 안내할 수 있는 근거만 적어주세요."><Textarea id="credit-reason" name="reason" required maxLength={1000} rows={3} value={reason} onChange={event => setReason(event.target.value)} /></AdminField>
      <Button className="w-fit" type="submit"><Check aria-hidden="true" />{pending ? '저장 중…' : '적립금 조정 저장'}</Button>
    </fieldset>
    {!enabled ? <AdminNotice tone="warning">적립금 정책이 비활성 상태입니다. 정책을 설정하고 활성화해야 조정할 수 있습니다.</AdminNotice> : null}
    {state.error ? <AdminNotice role="alert" tone="danger">{state.error}</AdminNotice> : null}{state.message ? <AdminNotice role="status" tone="success">{state.message} 현재 사용 가능 적립금: {state.available?.toLocaleString('ko-KR')}원</AdminNotice> : null}
  </form>;
}
