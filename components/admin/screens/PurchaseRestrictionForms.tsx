'use client';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { findPurchaseRestrictionCustomerAction, registerPurchaseRestrictionAction, releasePurchaseRestrictionAction,
  type RestrictionActionState, type RestrictionLookupState } from '@/app/admin/purchase-restriction-actions';
import { PURCHASE_RESTRICTION_REASONS, type PurchaseRestrictionCustomer } from '@/lib/admin/purchase-restrictions';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';

/* 구매제한 등록·해제 양식(템플릿 룩, ADR-0028). 입력 이름·확인 체크·결과 문구는 그대로다. */
const FIELD = 'flex w-full min-w-0 flex-col gap-1.5 [&>span]:font-medium';

function Result({ state }: { state: RestrictionActionState }) {
  return <>{state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}{state.message ? <p className="text-sm text-[var(--wc-success)]" role="status">{state.message}</p> : null}</>;
}
function submitPreservingFields(event: FormEvent<HTMLFormElement>, action: (form: FormData) => void) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  // A resolved action may contain a validation error. Explicit dispatch avoids
  // React's successful-form reset so entered evidence and confirmation survive.
  startTransition(() => action(form));
}
function RegisterForm({ customer, requestId }: { customer: PurchaseRestrictionCustomer; requestId: string }) {
  const [state, action, pending] = useActionState(registerPurchaseRestrictionAction, {});
  const [reasonCode, setReasonCode] = useState('repeated_purchase');
  const [reasonDetail, setReasonDetail] = useState('');
  const [evidenceOrderId, setEvidenceOrderId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  return <form method="post" onSubmit={event => submitPreservingFields(event, action)} className="flex max-w-2xl flex-col items-start gap-3.5">
    <input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="userId" value={customer.id} />
    <div className={FIELD}><Label htmlFor={`restriction-register-reason-${requestId}`}>등록 사유</Label><NativeSelect className="w-full" id={`restriction-register-reason-${requestId}`} name="reasonCode" required value={reasonCode} onChange={event => setReasonCode(event.target.value)}>{PURCHASE_RESTRICTION_REASONS.map(reason => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</NativeSelect></div>
    <label className={FIELD}><span>상세 사유</span><Textarea name="reasonDetail" aria-label="상세 사유" required maxLength={200} rows={3} value={reasonDetail} onChange={event => setReasonDetail(event.target.value)} placeholder="구매제한이 필요한 구체적인 근거를 입력하세요. (200자 이내)" /></label>
    <label className={FIELD}><span>근거 주문번호 <small className="text-xs font-normal text-muted-foreground">(선택)</small></span><Input name="evidenceOrderId" value={evidenceOrderId} onChange={event => setEvidenceOrderId(event.target.value)} placeholder="이 고객이 주문한 전체 주문번호" /></label>
    <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" name="confirmed" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>{adminGoodsCopy('이 고객의 신규 굿즈 주문을 제한하며 기존 주문은 정상 처리해야 함을 확인했습니다.')}</span></label>
    <Result state={state} /><Button type="submit" disabled={pending || Boolean(state.message)}>{pending ? '등록 중…' : '구매제한 등록'}</Button>
  </form>;
}
export function PurchaseRestrictionRegister() {
  const [state, action, pending] = useActionState<RestrictionLookupState, FormData>(findPurchaseRestrictionCustomerAction, {});
  const [query, setQuery] = useState('');
  return <details className="group rounded-xl border bg-card px-4 py-3 text-card-foreground"><summary className="cursor-pointer font-medium">판매방해 고객 등록</summary>
    <form method="post" onSubmit={event => submitPreservingFields(event, action)} className="mt-4 flex flex-wrap items-center gap-2.5">
      <Label htmlFor="restriction-customer-query">고객 ID 또는 이메일</Label><Input className="w-72 max-w-full" id="restriction-customer-query" name="customerQuery" maxLength={254} required value={query} onChange={event => setQuery(event.target.value)} placeholder="고객 ID 또는 정확한 이메일 주소" />
      <Button type="submit" variant="outline" disabled={pending}>{pending ? '조회 중…' : '고객 조회'}</Button>
    </form>
    {state.error ? <p role="alert" className="mt-2 text-sm text-destructive">{state.error}</p> : null}
    {state.customer ? <div className="mt-3.5 flex flex-col gap-2 border-t pt-3.5">
      <p><strong className="font-medium">{state.customer.nickname || '이름 없음'}</strong> · {state.customer.email || '이메일 없음'}</p><p className="text-xs text-muted-foreground tabular-nums">{state.customer.id}</p>
      {!state.customer.eligible ? <p className="rounded-lg border bg-muted/40 px-3 py-2.5">일반 고객 계정만 구매제한을 등록할 수 있습니다.</p> : state.customer.activeRestrictionId ? <p className="rounded-lg border bg-muted/40 px-3 py-2.5">이미 구매제한 중인 고객입니다. 목록에서 기존 기록을 확인해주세요.</p>
        : state.requestId ? <RegisterForm key={state.requestId} customer={state.customer} requestId={state.requestId} /> : null}
    </div> : null}
  </details>;
}
export function PurchaseRestrictionRelease({ restrictionId, customerName }: { restrictionId: string; customerName: string }) {
  const [state, action, pending] = useActionState(releasePurchaseRestrictionAction, {});
  const [reason, setReason] = useState('');
  return <details className="text-sm"><summary className="cursor-pointer font-medium underline underline-offset-4">해제</summary>
    <form method="post" onSubmit={event => submitPreservingFields(event, action)} className="mt-2 flex min-w-40 flex-col items-start gap-2">
      <input type="hidden" name="restrictionId" value={restrictionId} />
      <label className={FIELD}><span>해제 사유</span><Textarea name="reason" required maxLength={200} rows={2} value={reason} onChange={event => setReason(event.target.value)} aria-label={`${customerName} 구매제한 해제 사유`} /></label>
      <Result state={state} /><Button type="submit" size="sm" disabled={pending || Boolean(state.message)}>{pending ? '해제 중…' : '구매제한 해제'}</Button>
    </form>
  </details>;
}
