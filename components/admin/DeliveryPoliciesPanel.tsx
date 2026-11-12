'use client';

import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import { readDeliveryPoliciesAction, saveDeliveryPolicyAction } from '@/app/admin/shipment-delivery-actions';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { DELIVERY_METHOD_LABELS, DELIVERY_POLICY_TEXT_FIELDS, type AdminDeliveryPolicy } from '@/lib/shipment-delivery';
import { useAdminLeaveGuard } from './useAdminLeaveGuard';

const LABELS: Record<typeof DELIVERY_POLICY_TEXT_FIELDS[number], string> = {
  contactName: '실제 담당자 이름', contactPhone: '실제 담당 연락처', handoffLocation: '인계 장소',
  handoffInstructions: '인계 방법 안내', appointmentInstructions: '예약·방문 시간 안내', completionInstructions: '수령 확인 근거와 절차',
  cancellationInstructions: '취소 가능 시점·고객 응대 안내', approvalReference: '운영 승인 근거',
};
const FIELD_LABEL = 'flex min-w-0 flex-col gap-1.5 text-sm font-medium';
const ALERT = 'rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive';
const DETAILS = 'rounded-lg border bg-background';
const DETAILS_SUMMARY = 'cursor-pointer px-3 py-2.5 text-sm font-medium';

function PolicyForm({ originId, policy, onSaved }: { originId: string; policy?: AdminDeliveryPolicy; onSaved: (message: string) => void }) {
  const [pending, startTransition] = useTransition(); const [error, setError] = useState<string | null>(null); const busy = useRef(false);
  /* 저장에 성공하면 목록을 다시 읽어 이 폼이 새로 만들어진다 — 저장 결과를 따로 알릴 필요가 없다. */
  const { formRef } = useAdminLeaveGuard();
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current) return;
    const form = new FormData(event.currentTarget);
    const state = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
    if (!state) return; form.set('state', state); busy.current = true; setError(null);
    startTransition(async () => {
      try { const result = await saveDeliveryPolicyAction(form); if (result.ok) onSaved(result.message); else setError(result.error); }
      catch { setError('운영 정책 저장 결과를 확인하지 못했습니다. 새로고침해 기록을 확인해주세요.'); }
      finally { busy.current = false; }
    });
  }
  return <form className="flex min-w-0 flex-col gap-3 border-t p-3" onSubmit={save} ref={formRef}>
    <input type="hidden" name="originId" value={originId} /><input type="hidden" name="policyId" value={policy?.id ?? ''} />
    <input type="hidden" name="revision" value={policy?.revision ?? ''} />
    {policy ? <input type="hidden" name="method" value={policy.method} /> : <label className={FIELD_LABEL}>제공할 배송 방식
      <NativeSelect className="w-full font-normal" name="method" defaultValue="" disabled={pending} required><option value="" disabled>방식을 선택해주세요</option>
        <option value="quick">퀵</option><option value="pickup">방문수령</option><option value="direct">직접배송</option><option value="freight">화물배송</option><option value="none">배송없음 · 직접전달</option></NativeSelect>
    </label>}
    <fieldset disabled={pending} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="sr-only">실제 운영 조건</legend>
      {DELIVERY_POLICY_TEXT_FIELDS.map((key) => <label className={FIELD_LABEL} key={key}>{LABELS[key]}
        {['contactName', 'contactPhone'].includes(key) ? <Input className="font-normal" name={key} type={key === 'contactPhone' ? 'tel' : 'text'} defaultValue={policy?.[key] ?? ''}
          maxLength={key === 'contactPhone' ? 40 : 100} /> : <Textarea className="font-normal" name={key} rows={2} maxLength={2000} defaultValue={policy?.[key] ?? ''} />}
      </label>)}
      <label className={FIELD_LABEL}>대리수령 허용 여부<NativeSelect className="w-full font-normal" name="allowDelegate" defaultValue={policy?.allowDelegate == null ? '' : String(policy.allowDelegate)}>
        <option value="">미설정</option><option value="true">안내 조건에 따라 허용</option><option value="false">허용하지 않음</option>
      </NativeSelect></label>
    </fieldset>
    <p className="text-sm text-muted-foreground">활성화하려면 모든 실제 운영 조건과 근거가 필요합니다. 수령은 주문자의 일회 확인값과 운영자의 인계 기록을 함께 확인합니다.
      발주확인 이후의 취소·반품은 기존 CS/클레임 검토를 따릅니다.</p>
    {error && <p className={ALERT} role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={pending} name="state" type="submit" value="draft" variant="outline">초안 저장</Button>
      <Button disabled={pending} name="state" type="submit" value="active">{pending ? '저장 중…' : '근거 확인 후 활성화'}</Button>
    </div>
  </form>;
}

function SavedPolicy({ policy, canEdit, onSaved }: { policy: AdminDeliveryPolicy; canEdit: boolean; onSaved: (message: string) => void }) {
  const [error, setError] = useState<string | null>(null); const [pending, startTransition] = useTransition();
  function stop() {
    const form = new FormData(); for (const [key, value] of Object.entries({ originId: policy.originId, policyId: policy.id,
      revision: String(policy.revision), method: policy.method, state: 'stopped' })) form.set(key, value);
    setError(null); startTransition(async () => {
      try { const result = await saveDeliveryPolicyAction(form); if (result.ok) onSaved(result.message); else setError(result.error); }
      catch { setError('정책 중지 결과를 확인하지 못했습니다. 다시 조회해주세요.'); }
    });
  }
  return <div className="flex min-w-0 flex-col gap-2 border-t p-3">
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {DELIVERY_POLICY_TEXT_FIELDS.map((key) => <div className="flex min-w-0 flex-col gap-0.5" key={key}><dt className="text-xs text-muted-foreground">{LABELS[key]}</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{policy[key] ?? '미설정'}</dd></div>)}
      <div className="flex min-w-0 flex-col gap-0.5"><dt className="text-xs text-muted-foreground">대리수령</dt><dd>{policy.allowDelegate === null ? '미설정' : policy.allowDelegate ? '안내 조건에 따라 허용' : '허용하지 않음'}</dd></div>
    </dl>
    {canEdit && policy.state === 'active' ? <Button className="w-fit" disabled={pending} onClick={stop} type="button" variant="outline">새 선택 중지</Button> : null}
    {error && <p className={ALERT} role="alert">{error}</p>}
  </div>;
}

/** Mount outside the origin's existing form. No new delivery method is implicitly enabled. */
export function DeliveryPoliciesPanel({ originId, canEdit = false }: { originId: string; canEdit?: boolean }) {
  const [refresh, setRefresh] = useState(0); const key = `${originId}:${refresh}`;
  const [notice, setNotice] = useState<{ originId: string; text: string } | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; policies?: AdminDeliveryPolicy[]; error?: string } | null>(null);
  useEffect(() => {
    let canceled = false;
    void readDeliveryPoliciesAction(originId).then((result) => { if (!canceled) setLoaded(result.ok ? { key, policies: result.policies } : { key, error: result.error }); })
      .catch(() => { if (!canceled) setLoaded({ key, error: '배송 방식 정책을 불러오지 못했습니다.' }); });
    return () => { canceled = true; };
  }, [key, originId]);
  const visible = loaded?.key === key ? loaded : null;
  const reload = () => setRefresh((value) => value + 1);
  const saved = (text: string) => { setNotice({ originId, text }); reload(); };
  return <section aria-labelledby={`delivery-policies-${originId}`} className="flex min-w-0 flex-col gap-3 border-t pt-4" data-delivery-policies="">
    <h3 className="text-sm font-medium" id={`delivery-policies-${originId}`}>배송·직접전달 운영 조건</h3>
    <p className="text-sm text-muted-foreground">상품에서 허용한 방식은 주문서에서 선택할 수 있습니다. 결제 이후에는 고객 요청과 기존 비용 유지 동의를 기록해 변경합니다. 활성 정책의 조건은 보존되며, 변경은 새 버전으로 등록합니다.</p>
    {notice?.originId === originId && <AdminNotice role="status" tone="success">{notice.text}</AdminNotice>}
    {!visible ? <p className="text-sm text-muted-foreground" role="status">운영 조건을 불러오는 중입니다…</p> : visible.error ? <p className={ALERT} role="alert">{visible.error}</p> : <>
      {visible.policies?.length ? visible.policies.map((policy) => <details className={DETAILS} key={`${policy.id}:${policy.revision}`}>
        <summary className={DETAILS_SUMMARY}>{DELIVERY_METHOD_LABELS[policy.method]} <AdminStatusBadge className="mx-1 align-middle" tone={policy.state === 'active' ? 'success' : policy.state === 'draft' ? 'neutral' : 'warning'}>{policy.state === 'draft' ? '초안' : policy.state === 'active' ? '활성' : '새 선택 중지'}</AdminStatusBadge> 버전 {policy.revision}</summary>
        {policy.state === 'draft' && canEdit ? <PolicyForm originId={originId} policy={policy} onSaved={saved} /> : <SavedPolicy policy={policy} canEdit={canEdit} onSaved={saved} />}
      </details>) : <p className="text-sm text-muted-foreground">등록된 운영 조건이 없습니다. 택배 외 배송 방식은 선택할 수 없습니다.</p>}
      {canEdit ? <details className={DETAILS} key={`new-${key}`}><summary className={DETAILS_SUMMARY}>새 운영 조건 등록</summary><PolicyForm originId={originId} onSaved={saved} /></details> : <small className="text-xs text-muted-foreground">운영 조건 등록과 활성화는 관리자가 처리합니다.</small>}
    </>}
    <Button className="w-fit" onClick={reload} type="button" variant="outline"><RefreshCw aria-hidden="true" />운영 조건 새로고침</Button>
  </section>;
}
