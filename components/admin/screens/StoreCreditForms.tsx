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
import { rewardPercentBps } from '@/lib/admin/customer-rewards';
import { NOTE } from '@/components/admin/settings-kit';
import { SettingsFormGroup, SettingsSaveBar } from './StoreSettingsFormGroup';
import { WonInput } from './StoreSettingsWonInput';

/* 지급·사용·만료 기준을 구역별로 나눈다. name·검증은 칸마다 그대로다. */
const EARN_FIELDS = [['earnMaxPerOrder', '주문당 적립 상한 (원)'], ['maxBalance', '보유 적립금 상한 (원)']] as const;
const USE_FIELDS = [['minUse', '1회 사용 하한 (원)'], ['maxUse', '1회 사용 상한 (원)']] as const;
const EXPIRY_FIELDS = [['validityDays', '적립금 유효기간 (일)'], ['restoreGraceDays', '만료 후 복원 유효기간 (일)']] as const;
const WON_FIELDS = new Set<string>(['earnMaxPerOrder', 'maxBalance', 'minUse', 'maxUse']);

/** 저장값(0.01% 단위 정수)을 입력칸에 보일 % 글자로. 100 → '1'. */
function percentText(bps: string | undefined) {
  if (!bps?.trim()) return '';
  const value = Number(bps);
  return Number.isFinite(value) && value >= 0 ? String(value / 100) : '';
}

export function StoreCreditPolicyForm({ policy, operationId }: { policy: StoreCreditPolicyRecord; operationId: string }) {
  const [state, action, pending] = useActionState(saveStoreCreditPolicyAction, {});
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(policy).map(([key, value]) => [key, value === null ? '' : String(value)])));
  function set(key: string, value: string) { setValues(previous => ({ ...previous, [key]: value })); }
  /* 적립률은 사람이 쓰는 %로 받고, 제출할 때만 저장 단위(0.01%)로 바꾼다 — 1%에 1을 넣어 0.01%가 되는 돈 실수를 막는다. */
  const [rateText, setRateText] = useState(() => percentText(policy.earnValue === null ? '' : String(policy.earnValue)));
  const rateEarn = values.earnKind === 'rate_bps';
  const rateInvalid = rateEarn && rateText.trim() !== '' && rewardPercentBps(rateText.trim()) === null;
  function changeRate(text: string) {
    setRateText(text);
    const bps = text.trim() === '' ? null : rewardPercentBps(text.trim());
    set('earnValue', bps === null ? '' : String(bps));
  }
  function changeEarnKind(kind: string) {
    set('earnKind', kind);
    if (kind === 'rate_bps') setRateText(percentText(values.earnValue));
  }
  const rateSample = rateEarn && !rateInvalid && values.earnValue ? Math.floor(50000 * Number(values.earnValue) / 10000).toLocaleString('ko-KR') : null;
  function policyField(key: string, label: string, hint?: string) {
    return <AdminField key={key} label={label} inputId={`credit-${key}`} hint={hint}>
      {WON_FIELDS.has(key)
        ? <WonInput id={`credit-${key}`} name={key} onValueChange={value => set(key, value)} value={values[key]} />
        : <Input id={`credit-${key}`} name={key} type="number" min={key === 'validityDays' ? '1' : '0'} step="1" value={values[key]} onChange={event => set(key, event.target.value)} />}
    </AdminField>;
  }
  return <form action={action} className="flex min-w-0 flex-col gap-4" onReset={event => event.preventDefault()}>
    <input type="hidden" name="operationId" value={state.operationId ?? operationId} />
    <input type="hidden" name="version" value={state.policy?.version ?? policy.version} />
    {/* 돈이 걸린 화면이다 — 저장하면 무엇이 언제 바뀌는지를 입력칸보다 먼저 말한다. */}
    <AdminNotice title="저장하면 새 주문부터 바로 적용됩니다" tone="warning">기존 주문에 약속한 적립과 사용분 복원, 기존 원장은 바뀌지 않습니다.</AdminNotice>
    {/* 지금 켜져 있는지가 이 화면에서 제일 중요하다 — 맨 위 상자에 둔다(제출 값은 그대로다). */}
    <label className="flex items-start gap-2.5 rounded-lg border bg-muted/40 p-3 text-sm">
      <input className="mt-0.5" type="checkbox" name="enabled" checked={values.enabled === 'true'} onChange={event => set('enabled', String(event.target.checked))} />
      <span className="flex min-w-0 flex-col gap-1"><span className="font-semibold">적립금 지급과 주문 사용 활성화</span>
        <span className={NOTE}>활성화하려면 모든 수치와 정책 근거를 입력해주세요. 비활성 초안은 빈 값으로 저장할 수 있습니다.</span></span>
    </label>
    <SettingsFormGroup title="지급 기준">
      <AdminFormGrid>
        <AdminField label="거래확정 시 적립 방식" inputId="credit-earnKind"><NativeSelect className="w-full" id="credit-earnKind" name="earnKind" value={values.earnKind} onChange={event => changeEarnKind(event.target.value)}>
          <option value="">미설정</option><option value="rate_bps">{adminGoodsCopy("할인 후 굿즈 금액의 정률")}</option><option value="fixed">거래확정 주문당 정액</option>
        </NativeSelect></AdminField>
        <AdminField label={rateEarn ? '적립률 (%)' : '적립 금액 (원)'} inputId="credit-earnValue"
          error={rateInvalid ? '적립률은 0~100 사이, 소수 둘째 자리까지 입력해주세요.' : undefined}
          hint={`${rateEarn ? `1%를 적립하려면 1을 입력합니다.${rateSample !== null ? ` 상품 금액 50,000원이면 약 ${rateSample}원이 적립됩니다.` : ''} ` : ''}배송비와 사용 적립금은 적립 기준에서 제외합니다.`}>
          {rateEarn ? <div className="relative min-w-0">
            <input name="earnValue" type="hidden" value={values.earnValue} />
            <Input aria-invalid={rateInvalid} autoComplete="off" className="pr-8 tabular-nums" id="credit-earnValue" inputMode="decimal" maxLength={6} onChange={event => changeRate(event.target.value)} value={rateText} />
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-medium text-muted-foreground">%</span>
          </div> : <WonInput id="credit-earnValue" name="earnValue" onValueChange={value => set('earnValue', value)} value={values.earnValue} />}
        </AdminField>
        {EARN_FIELDS.map(([key, label]) => policyField(key, label))}
      </AdminFormGrid>
    </SettingsFormGroup>
    <SettingsFormGroup title="사용 기준" description={adminGoodsCopy("상품 쿠폰을 순서대로 적용한 뒤 남은 굿즈 금액에 적립금을 사용합니다. 배송비 사용은 제외하고 기존 최소 유상 결제액을 유지합니다. 현금 청구·환불액 차감은 발생하지 않습니다.")}>
      <AdminFormGrid>{USE_FIELDS.map(([key, label]) => policyField(key, label))}</AdminFormGrid>
    </SettingsFormGroup>
    <SettingsFormGroup title="만료 기준">
      <AdminFormGrid>{EXPIRY_FIELDS.map(([key, label]) => policyField(key, label, key === 'restoreGraceDays' ? '명시적으로 0일을 설정하면 이미 만료된 사용분은 복원 시에도 사용할 수 없습니다.' : undefined))}</AdminFormGrid>
    </SettingsFormGroup>
    <SettingsFormGroup title="환불 기준">
      <AdminFormGrid>
        <AdminField label="환불 주문에서 이미 사용한 원적립금" inputId="credit-refundEarnedCreditMode">
          <NativeSelect className="w-full" id="credit-refundEarnedCreditMode" name="refundEarnedCreditMode" value={values.refundEarnedCreditMode} onChange={event => set('refundEarnedCreditMode', event.target.value)}>
            <option value="">미설정</option><option value="offset_future_credits">이후 적립·복원 금액에서 상계</option>
          </NativeSelect>
        </AdminField>
      </AdminFormGrid>
    </SettingsFormGroup>
    <SettingsFormGroup title="승인 근거">
      <AdminField label="정책 승인 근거" inputId="credit-evidence"><Textarea id="credit-evidence" name="evidence" maxLength={2000} rows={4} value={values.evidence} onChange={event => set('evidence', event.target.value)} /></AdminField>
    </SettingsFormGroup>
    <SettingsSaveBar>
      {state.error ? <AdminNotice className="flex-1" role="alert" tone="danger">{state.error}</AdminNotice> : null}{state.message ? <AdminNotice className="flex-1" role="status" tone="success">{state.message}</AdminNotice> : null}
      <Button disabled={pending} type="submit"><Check aria-hidden="true" />{pending ? '저장 중…' : '정책 저장'}</Button>
    </SettingsSaveBar>
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
