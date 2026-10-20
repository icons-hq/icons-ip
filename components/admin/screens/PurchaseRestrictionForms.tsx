'use client';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { findPurchaseRestrictionCustomerAction, registerPurchaseRestrictionAction, releasePurchaseRestrictionAction,
  type RestrictionActionState, type RestrictionLookupState } from '@/app/admin/purchase-restriction-actions';
import { PURCHASE_RESTRICTION_REASONS, type PurchaseRestrictionCustomer } from '@/lib/admin/purchase-restrictions';

function Result({ state }: { state: RestrictionActionState }) {
  return <>{state.error ? <p role="alert" className="admin-error">{state.error}</p> : null}{state.message ? <p role="status">{state.message}</p> : null}</>;
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
  return <form method="post" onSubmit={event => submitPreservingFields(event, action)} className="admin-purchase-restriction-form">
    <input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="userId" value={customer.id} />
    <label>등록 사유<select name="reasonCode" required value={reasonCode} onChange={event => setReasonCode(event.target.value)}>{PURCHASE_RESTRICTION_REASONS.map(reason => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select></label>
    <label>상세 사유<textarea name="reasonDetail" aria-label="상세 사유" required maxLength={200} rows={3} value={reasonDetail} onChange={event => setReasonDetail(event.target.value)} placeholder="구매제한이 필요한 구체적인 근거를 입력하세요. (200자 이내)" /></label>
    <label>근거 주문번호 <span>(선택)</span><input name="evidenceOrderId" value={evidenceOrderId} onChange={event => setEvidenceOrderId(event.target.value)} placeholder="이 고객이 주문한 전체 주문번호" /></label>
    <label className="admin-purchase-restriction-confirm"><input type="checkbox" name="confirmed" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{adminGoodsCopy('이 고객의 신규 굿즈 주문을 제한하며 기존 주문은 정상 처리해야 함을 확인했습니다.')}</label>
    <Result state={state} /><button type="submit" className="wc-admin-kit__button" disabled={pending || Boolean(state.message)}>{pending ? '등록 중…' : '구매제한 등록'}</button>
  </form>;
}
export function PurchaseRestrictionRegister() {
  const [state, action, pending] = useActionState<RestrictionLookupState, FormData>(findPurchaseRestrictionCustomerAction, {});
  const [query, setQuery] = useState('');
  return <details className="admin-purchase-restriction-register"><summary>판매방해 고객 등록</summary>
    <form method="post" onSubmit={event => submitPreservingFields(event, action)} className="admin-purchase-restriction-lookup">
      <label htmlFor="restriction-customer-query">고객 ID 또는 이메일</label><input id="restriction-customer-query" name="customerQuery" maxLength={254} required value={query} onChange={event => setQuery(event.target.value)} placeholder="고객 ID 또는 정확한 이메일 주소" />
      <button type="submit" className="wc-admin-kit__button" disabled={pending}>{pending ? '조회 중…' : '고객 조회'}</button>
    </form>
    {state.error ? <p role="alert" className="admin-error">{state.error}</p> : null}
    {state.customer ? <div className="admin-purchase-restriction-customer">
      <p><strong>{state.customer.nickname || '이름 없음'}</strong> · {state.customer.email || '이메일 없음'}</p><p className="mono">{state.customer.id}</p>
      {!state.customer.eligible ? <p>일반 고객 계정만 구매제한을 등록할 수 있습니다.</p> : state.customer.activeRestrictionId ? <p>이미 구매제한 중인 고객입니다. 목록에서 기존 기록을 확인해주세요.</p>
        : state.requestId ? <RegisterForm key={state.requestId} customer={state.customer} requestId={state.requestId} /> : null}
    </div> : null}
  </details>;
}
export function PurchaseRestrictionRelease({ restrictionId, customerName }: { restrictionId: string; customerName: string }) {
  const [state, action, pending] = useActionState(releasePurchaseRestrictionAction, {});
  const [reason, setReason] = useState('');
  return <details className="admin-purchase-restriction-release"><summary>해제</summary>
    <form method="post" onSubmit={event => submitPreservingFields(event, action)}>
      <input type="hidden" name="restrictionId" value={restrictionId} />
      <label>해제 사유<textarea name="reason" required maxLength={200} rows={2} value={reason} onChange={event => setReason(event.target.value)} aria-label={`${customerName} 구매제한 해제 사유`} /></label>
      <Result state={state} /><button type="submit" className="wc-admin-kit__button" disabled={pending || Boolean(state.message)}>{pending ? '해제 중…' : '구매제한 해제'}</button>
    </form>
  </details>;
}
