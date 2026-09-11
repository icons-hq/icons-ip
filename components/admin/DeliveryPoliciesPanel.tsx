'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { readDeliveryPoliciesAction, saveDeliveryPolicyAction } from '@/app/admin/shipment-delivery-actions';
import { DELIVERY_METHOD_LABELS, DELIVERY_POLICY_TEXT_FIELDS, type AdminDeliveryPolicy } from '@/lib/shipment-delivery';

const LABELS: Record<typeof DELIVERY_POLICY_TEXT_FIELDS[number], string> = {
  contactName: '실제 담당자 이름', contactPhone: '실제 담당 연락처', handoffLocation: '인계 장소',
  handoffInstructions: '인계 방법 안내', appointmentInstructions: '예약·방문 시간 안내', completionInstructions: '수령 확인 근거와 절차',
  cancellationInstructions: '취소 가능 시점·고객 응대 안내', approvalReference: '운영 승인 근거',
};

function PolicyForm({ originId, policy, onSaved }: { originId: string; policy?: AdminDeliveryPolicy; onSaved: (message: string) => void }) {
  const [pending, startTransition] = useTransition(); const [error, setError] = useState<string | null>(null); const busy = useRef(false);
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
  return <form className="col wc-admin-kit" style={{ gap: 10 }} onSubmit={save}>
    <input type="hidden" name="originId" value={originId} /><input type="hidden" name="policyId" value={policy?.id ?? ''} />
    <input type="hidden" name="revision" value={policy?.revision ?? ''} />
    {policy ? <input type="hidden" name="method" value={policy.method} /> : <label>제공할 배송 방식
      <select name="method" defaultValue="" disabled={pending} required><option value="" disabled>방식을 선택해주세요</option>
        <option value="quick">퀵</option><option value="pickup">방문수령</option></select>
    </label>}
    <fieldset disabled={pending} className="col" style={{ border: 0, padding: 0, margin: 0, gap: 10 }}>
      <legend className="sr-only">실제 운영 조건</legend>
      {DELIVERY_POLICY_TEXT_FIELDS.map((key) => <label key={key}>{LABELS[key]}
        {['contactName', 'contactPhone'].includes(key) ? <input name={key} type={key === 'contactPhone' ? 'tel' : 'text'} defaultValue={policy?.[key] ?? ''}
          maxLength={key === 'contactPhone' ? 40 : 100} /> : <textarea name={key} rows={2} maxLength={2000} defaultValue={policy?.[key] ?? ''} />}
      </label>)}
      <label>대리수령 허용 여부<select name="allowDelegate" defaultValue={policy?.allowDelegate == null ? '' : String(policy.allowDelegate)}>
        <option value="">미설정</option><option value="true">안내 조건에 따라 허용</option><option value="false">허용하지 않음</option>
      </select></label>
    </fieldset>
    <p className="muted" style={{ margin: 0 }}>활성화하려면 모든 실제 운영 조건과 근거가 필요합니다. 수령은 주문자의 일회 확인값과 운영자의 인계 기록을 함께 확인합니다.
      발주확인 이후의 취소·반품은 기존 CS/클레임 검토를 따릅니다.</p>
    {error && <p role="alert">{error}</p>}
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <button className="btn btn-ghost" name="state" value="draft" type="submit" disabled={pending}>초안 저장</button>
      <button className="btn" name="state" value="active" type="submit" disabled={pending}>{pending ? '저장 중…' : '근거 확인 후 활성화'}</button>
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
  return <div className="col" style={{ gap: 8 }}>
    <dl className="admin-order-detail__facts">
      {DELIVERY_POLICY_TEXT_FIELDS.map((key) => <div key={key}><dt>{LABELS[key]}</dt><dd style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{policy[key] ?? '미설정'}</dd></div>)}
      <div><dt>대리수령</dt><dd>{policy.allowDelegate === null ? '미설정' : policy.allowDelegate ? '안내 조건에 따라 허용' : '허용하지 않음'}</dd></div>
    </dl>
    {canEdit && policy.state === 'active' ? <button className="btn btn-ghost" type="button" disabled={pending} onClick={stop}>새 선택 중지</button> : null}
    {error && <p role="alert">{error}</p>}
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
  return <section className="col wc-admin-kit" style={{ gap: 12 }} aria-labelledby={`delivery-policies-${originId}`}>
    <h4 id={`delivery-policies-${originId}`} style={{ margin: 0 }}>퀵·방문수령 운영 조건</h4>
    <p style={{ margin: 0 }}>고객 요청과 기존 배송비 유지 동의가 기록된 주문에 적용합니다. 활성 정책의 조건은 보존되며, 변경은 새 버전으로 등록합니다.</p>
    {notice?.originId === originId && <p role="status">{notice.text}</p>}
    {!visible ? <p role="status">운영 조건을 불러오는 중입니다…</p> : visible.error ? <p role="alert">{visible.error}</p> : <>
      {visible.policies?.length ? visible.policies.map((policy) => <details key={`${policy.id}:${policy.revision}`}>
        <summary>{DELIVERY_METHOD_LABELS[policy.method]} · {policy.state === 'draft' ? '초안' : policy.state === 'active' ? '활성' : '새 선택 중지'} · 버전 {policy.revision}</summary>
        {policy.state === 'draft' && canEdit ? <PolicyForm originId={originId} policy={policy} onSaved={saved} /> : <SavedPolicy policy={policy} canEdit={canEdit} onSaved={saved} />}
      </details>) : <p className="muted">등록된 운영 조건이 없습니다. 퀵·방문수령 선택은 열리지 않습니다.</p>}
      {canEdit ? <details key={`new-${key}`}><summary>새 운영 조건 등록</summary><PolicyForm originId={originId} onSaved={saved} /></details> : <small className="muted">운영 조건 등록과 활성화는 관리자가 처리합니다.</small>}
    </>}
    <button className="btn btn-ghost" type="button" onClick={reload}>운영 조건 새로고침</button>
  </section>;
}
