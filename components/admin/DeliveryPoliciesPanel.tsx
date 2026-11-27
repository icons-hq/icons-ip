'use client';

import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import { readDeliveryPoliciesAction, saveDeliveryPolicyAction } from '@/app/admin/shipment-delivery-actions';
import { readGoodsTransactionRuntimeAction } from '@/app/admin/goods-transaction-runtime-actions';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { adminConfirm, type AdminConfirmRequest } from '@/lib/admin/confirm';
import { statusTone } from '@/lib/admin/status-tone';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import { formatOrderDateTime } from '@/lib/orders';
import { DELIVERY_METHOD_LABELS, DELIVERY_POLICY_TEXT_FIELDS, type AdminDeliveryPolicy } from '@/lib/shipment-delivery';
import { GoodReadback } from './GoodEditorParts';
import { useAdminLeaveGuard } from './useAdminLeaveGuard';

type PolicyMethod = AdminDeliveryPolicy['method'];
type PolicyState = AdminDeliveryPolicy['state'];
/** true 켜짐 · false 꺼짐 · null 아직 모름. 쇼핑몰 주문 설정이 꺼져 있으면 고객은 주문서에서 택배 외 방식을 고를 수 없다. */
type Runtime = boolean | null;

/**
 * 고객에게 보이는 일곱 칸(주문서 요약·주문 상세에 그대로 나오고 주문 기록에 남는다).
 * '운영 승인 근거'(approvalReference)는 고객 화면·주문 기록에 쓰이지 않아 걷어 냈다(2026-11-26) — 보내지 않으면 저장돼 있던 값은 DB가 그대로 둔다.
 */
const POLICY_FIELDS = DELIVERY_POLICY_TEXT_FIELDS.filter((key): key is Exclude<typeof DELIVERY_POLICY_TEXT_FIELDS[number], 'approvalReference'> => key !== 'approvalReference');
type PolicyField = typeof POLICY_FIELDS[number];
const LABELS: Record<PolicyField, string> = {
  contactName: '담당자 이름', contactPhone: '담당자 연락처', handoffLocation: '인계 장소',
  handoffInstructions: '인계 방법 안내', appointmentInstructions: '예약·방문 시간 안내', completionInstructions: '받았는지 확인하는 방법',
  cancellationInstructions: '취소 안내',
};
const EXAMPLES: Record<PolicyField, string> = {
  contactName: '예: 물류팀 김담당', contactPhone: '예: 02-0000-0000', handoffLocation: '예: 김포 물류센터 1층 안내 데스크',
  handoffInstructions: '예: 주문번호를 말하고 신분증을 보여 주세요.', appointmentInstructions: '예: 평일 10~17시, 하루 전까지 전화로 예약해 주세요.',
  completionInstructions: '예: 상품을 받을 때 주문 상세의 수령 확인값을 담당자에게 보여 주세요.', cancellationInstructions: '예: 상품을 받기 전까지 주문 상세에서 취소를 요청할 수 있습니다.',
};
const DELEGATE_LABEL = '대리수령';
const STATE_LABELS: Record<PolicyState, string> = { draft: '준비 중', active: '사용', stopped: '사용 안 함' };
const NEW_METHODS: PolicyMethod[] = ['quick', 'pickup', 'direct', 'freight', 'none'];
const SAVE_DRAFT_LABEL = '준비 중으로 저장';
const SAVE_ACTIVE_LABEL = '저장하고 사용';
const STOP_LABEL = '사용 안 함으로 바꾸기';
const RELOAD_LABEL = '다시 불러오기';
const FIELD_LABEL = 'flex min-w-0 flex-col gap-1.5 text-sm font-medium';
const ALERT = 'rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive';
const DETAILS = 'rounded-lg border bg-background';
const DETAILS_SUMMARY = 'cursor-pointer px-3 py-2.5 text-sm font-medium';
const HINT = 'text-sm text-muted-foreground';
/* 저장 요청은 같은 번호로 다시 보낼 수 없다. 결과를 모르면 목록을 다시 불러와 확인한다. */
const SAVE_UNKNOWN = `저장됐는지 확인하지 못했습니다. [${RELOAD_LABEL}]를 눌러 목록에서 상태를 확인해 주세요.`;
const ORIGIN_OFF = "사용 안 함인 출고지에서는 수령 방식을 켤 수 없습니다. 위에서 출고지의 '사용 여부'를 사용으로 바꿔 저장해 주세요.";
/**
 * 쇼핑몰 주문 설정이 꺼져 있으면 고객은 주문서에서 택배 외 방식을 고를 수 없다. 퀵·방문수령·직접배송·화물배송은 발송관리에서 주문의
 * 배송 방식을 바꿀 때 쓰이므로 막지 않고, 주문서로만 생기는 배송없음 · 직접전달은 쓸 곳이 없어 켜기 전에 막는다(화면 규칙 5).
 * 그 설정을 켜는 어드민 화면은 없고 개발 담당자가 켠다.
 */
const RUNTIME_OFF_NONE = `지금 쇼핑몰 설정에서는 ${DELIVERY_METHOD_LABELS.none}을 쓸 수 없습니다. 써야 하면 개발 담당자에게 요청해 주세요.`;
const methodName = (method: PolicyMethod) => `‘${DELIVERY_METHOD_LABELS[method]}’ 방식`;

/** 켜는 순간 고객 주문에 쓰이고, 켠 뒤에는 고칠 수 없다. 누르기 전에 한 번 말한다. */
function activateConfirm(method: PolicyMethod, runtime: Runtime): AdminConfirmRequest {
  const effect = runtime === false ? `저장하면 ${ADMIN_VOCABULARY.dispatch}에서 주문의 배송 방식을 이 방식으로 바꿀 수 있습니다.`
    : '저장하면 바로 이 출고지 상품을 이 방식으로 주문받고, 적은 내용이 고객의 주문서와 주문 상세에 보입니다.';
  return { title: `${methodName(method)}을 사용으로 켤까요?`, message: `${effect} 켠 뒤에는 내용을 고칠 수 없습니다. 바꾸려면 운영 조건을 새로 추가한 뒤 이 조건을 사용 안 함으로 바꿔야 합니다.`,
    confirmLabel: SAVE_ACTIVE_LABEL, cancelLabel: '돌아가기' };
}
/** 끄면 그 방식의 새 주문이 막히고 다시 켤 수 없다. 이미 정해진 주문은 저장된 조건으로 계속 인계한다. */
function stopConfirm(method: PolicyMethod, runtime: Runtime): AdminConfirmRequest {
  const lines = [
    runtime === false ? '' : '바꾸면 고객이 주문서에서 이 방식을 골랐을 때 새 주문이 막힙니다. 상품에서 이 방식을 빼기 전까지는 주문서에 계속 보입니다.',
    method === 'none' ? '' : `${ADMIN_VOCABULARY.dispatch}에서도 주문의 배송 방식을 이 방식으로 바꿀 수 없습니다.`,
    '이미 이 방식으로 정해진 주문은 저장된 조건대로 인계합니다.',
    '한 번 끈 운영 조건은 다시 켤 수 없습니다. 다시 쓰려면 새로 추가해 주세요.',
  ];
  return { title: `${methodName(method)}을 사용 안 함으로 바꿀까요?`, message: lines.filter(Boolean).join(' '), confirmLabel: STOP_LABEL, cancelLabel: '돌아가기', destructive: true };
}

/** 준비 중인 운영 조건을 고치거나 새로 추가하는 폼. 시험에서 따로 그릴 수 있게 내보낸다. */
export function DeliveryPolicyForm({ originId, policy, activeMethods, originActive, runtime, onSaved }: {
  originId: string; policy?: AdminDeliveryPolicy; activeMethods: readonly PolicyMethod[]; originActive?: boolean; runtime: Runtime; onSaved: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition(); const [error, setError] = useState<string | null>(null); const busy = useRef(false);
  const [method, setMethod] = useState<PolicyMethod | ''>(policy?.method ?? '');
  /* 저장에 성공하면 목록을 다시 읽어 이 폼이 새로 만들어진다 — 저장 결과를 따로 알릴 필요가 없다. */
  const { formRef } = useAdminLeaveGuard();
  /*
   * 켤 수 없는 까닭을 누르기 전에 말한다: 출고지가 사용 안 함이거나, 같은 방식에 사용 중인 조건이 이미 있거나(방식마다 하나만 켤 수 있다),
   * 쇼핑몰 주문 설정이 꺼져 있어 쓸 곳이 없는 방식이다.
   */
  const blockedFor = (target: PolicyMethod | '') => originActive === false ? ORIGIN_OFF : !target ? null
    : activeMethods.includes(target) ? `${methodName(target)}은 이미 사용 중인 운영 조건이 있습니다. 내용을 바꾸려면 [${SAVE_DRAFT_LABEL}]을 누른 뒤, 사용 중인 조건을 [${STOP_LABEL}] 하고 이 조건을 켜 주세요.`
      : runtime === false && target === 'none' ? RUNTIME_OFF_NONE : null;
  const blocked = blockedFor(method);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current) return;
    const form = new FormData(event.currentTarget);
    const state = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
    const chosen = form.get('method');
    if (state !== 'draft' && state !== 'active') return;
    if (typeof chosen !== 'string' || !NEW_METHODS.includes(chosen as PolicyMethod)) { setError('수령 방식을 골라 주세요.'); return; }
    form.set('state', state);
    if (state === 'active') {
      const reason = blockedFor(chosen as PolicyMethod);
      if (reason) { setError(reason); return; }
      const missing = [...POLICY_FIELDS.filter((key) => !String(form.get(key) ?? '').trim()).map((key) => LABELS[key]), ...(form.get('allowDelegate') ? [] : [DELEGATE_LABEL])];
      if (missing.length) { setError(`[${SAVE_ACTIVE_LABEL}]은 ${missing.join(' · ')} 칸을 채워야 합니다. 모두 고객에게 보이는 내용입니다.`); return; }
    }
    busy.current = true; setError(null);
    if (state === 'active' && !await adminConfirm(activateConfirm(chosen as PolicyMethod, runtime))) { busy.current = false; return; }
    startTransition(async () => {
      try {
        const result = await saveDeliveryPolicyAction(form);
        if (!result.ok) setError(result.error);
        else onSaved(state === 'active' ? `${methodName(chosen as PolicyMethod)}을 사용으로 켰습니다.` : `${methodName(chosen as PolicyMethod)}을 준비 중으로 저장했습니다. 고객 주문에는 아직 쓰이지 않습니다.`);
      } catch { setError(SAVE_UNKNOWN); }
      finally { busy.current = false; }
    });
  }
  return <form className="flex min-w-0 flex-col gap-3 border-t p-3" onSubmit={(event) => { void save(event); }} ref={formRef}>
    <input type="hidden" name="originId" value={originId} /><input type="hidden" name="policyId" value={policy?.id ?? ''} />
    <input type="hidden" name="revision" value={policy?.revision ?? ''} />
    {policy ? <input type="hidden" name="method" value={policy.method} /> : <label className={FIELD_LABEL}>수령 방식 (필수)
      <NativeSelect className="w-full font-normal" name="method" value={method} disabled={pending} onChange={(event) => setMethod(event.target.value as PolicyMethod | '')}><option value="" disabled>고르지 않음</option>
        {NEW_METHODS.map((value) => <option key={value} value={value}>{DELIVERY_METHOD_LABELS[value]}</option>)}</NativeSelect>
    </label>}
    <p className={HINT}>아래 내용은 이 방식을 고른 고객의 주문서와 주문 상세에 그대로 보입니다.</p>
    <fieldset disabled={pending} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="sr-only">고객에게 보이는 안내</legend>
      {POLICY_FIELDS.map((key) => <label className={FIELD_LABEL} key={key}>{LABELS[key]}
        {key === 'contactName' || key === 'contactPhone' ? <Input className="font-normal" name={key} type={key === 'contactPhone' ? 'tel' : 'text'} defaultValue={policy?.[key] ?? ''}
          maxLength={key === 'contactPhone' ? 40 : 100} placeholder={EXAMPLES[key]} /> : <Textarea className="font-normal" name={key} rows={2} maxLength={2000} defaultValue={policy?.[key] ?? ''} placeholder={EXAMPLES[key]} />}
      </label>)}
      <label className={FIELD_LABEL}>{DELEGATE_LABEL}<NativeSelect className="w-full font-normal" name="allowDelegate" defaultValue={policy?.allowDelegate == null ? '' : String(policy.allowDelegate)}>
        <option value="">아직 정하지 않음</option><option value="true">안내 조건에 따라 허용</option><option value="false">허용하지 않음</option>
      </NativeSelect></label>
    </fieldset>
    {blocked && <p className={HINT} data-delivery-policy-blocked="">{blocked}</p>}
    {error && <p className={ALERT} role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={pending} name="state" type="submit" value="draft" variant="outline">{SAVE_DRAFT_LABEL}</Button>
      <Button disabled={pending || Boolean(blocked)} name="state" type="submit" value="active">{pending ? '저장 중…' : SAVE_ACTIVE_LABEL}</Button>
    </div>
  </form>;
}

/** 켰거나 끈 운영 조건(고칠 수 없다)과, 편집 권한이 없는 사람에게 보이는 준비 중 조건. */
export function SavedDeliveryPolicy({ policy, canEdit, runtime, onSaved }: { policy: AdminDeliveryPolicy; canEdit: boolean; runtime: Runtime; onSaved: (message: string) => void }) {
  const [error, setError] = useState<string | null>(null); const [pending, startTransition] = useTransition(); const busy = useRef(false);
  async function stop() {
    if (busy.current) return; busy.current = true;
    if (!await adminConfirm(stopConfirm(policy.method, runtime))) { busy.current = false; return; }
    const form = new FormData(); for (const [key, value] of Object.entries({ originId: policy.originId, policyId: policy.id,
      revision: String(policy.revision), method: policy.method, state: 'stopped' })) form.set(key, value);
    setError(null); startTransition(async () => {
      try {
        const result = await saveDeliveryPolicyAction(form);
        if (result.ok) onSaved(`${methodName(policy.method)}을 사용 안 함으로 바꿨습니다. 이미 이 방식으로 정해진 주문은 저장된 조건대로 인계합니다.`); else setError(result.error);
      } catch { setError(SAVE_UNKNOWN); }
      finally { busy.current = false; }
    });
  }
  return <div className="flex min-w-0 flex-col gap-2 border-t p-3">
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {POLICY_FIELDS.map((key) => <div className="flex min-w-0 flex-col gap-0.5" key={key}><dt className="text-xs text-muted-foreground">{LABELS[key]}</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{policy[key] ?? '없음'}</dd></div>)}
      <div className="flex min-w-0 flex-col gap-0.5"><dt className="text-xs text-muted-foreground">{DELEGATE_LABEL}</dt><dd>{policy.allowDelegate === null ? '아직 정하지 않음' : policy.allowDelegate ? '안내 조건에 따라 허용' : '허용하지 않음'}</dd></div>
    </dl>
    {canEdit && policy.state === 'active' ? <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button className="w-fit" disabled={pending} onClick={() => { void stop(); }} type="button" variant="outline">{STOP_LABEL}</Button>
      <span className={HINT}>켠 운영 조건은 고칠 수 없습니다. 내용을 바꾸려면 새로 추가해 주세요.</span>
    </div> : null}
    {error && <p className={ALERT} role="alert">{error}</p>}
  </div>;
}

/** 목록 줄에서 조건을 가르는 날짜. 내부 버전 번호 대신 언제 켜고 껐는지를 보인다. */
function policyWhen(policy: AdminDeliveryPolicy): string {
  if (policy.state === 'stopped' && policy.stoppedAt) return `${formatOrderDateTime(policy.stoppedAt)}에 끔`;
  if (policy.state === 'active' && policy.activatedAt) return `${formatOrderDateTime(policy.activatedAt)}부터`;
  return '';
}

/**
 * 출고지의 택배 외 수령 방식(퀵·방문수령·직접배송·화물배송·배송없음). 방식마다 운영 조건(고객에게 보이는 담당자·인계 장소·안내)을 적고 사용으로 켜야 그 방식의 주문을 받는다.
 * 발송·주문 화면은 이 조건을 '운영 조건'이라고 부른다(예: "운영 조건이 켜진 방법") — 여기서도 같은 말을 쓴다.
 * 출고지 폼 밖에 둔다. 새 방식이 저절로 켜지지 않는다.
 * `originActive`: 출고지의 사용 여부. 사용 안 함인 출고지에서는 켤 수 없어 미리 막는다(넘기지 않으면 막지 않는다).
 */
export function DeliveryPoliciesPanel({ originId, canEdit = false, originActive }: { originId: string; canEdit?: boolean; originActive?: boolean }) {
  const [refresh, setRefresh] = useState(0); const key = `${originId}:${refresh}`;
  const [notice, setNotice] = useState<{ originId: string; text: string } | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; policies?: AdminDeliveryPolicy[]; error?: string } | null>(null);
  const [runtime, setRuntime] = useState<Runtime>(null);
  useEffect(() => {
    let canceled = false;
    const failed = `운영 조건을 불러오지 못했습니다. [${RELOAD_LABEL}]를 눌러 주세요.`;
    void readDeliveryPoliciesAction(originId).then((result) => { if (!canceled) setLoaded(result.ok ? { key, policies: result.policies } : { key, error: failed }); })
      .catch(() => { if (!canceled) setLoaded({ key, error: failed }); });
    return () => { canceled = true; };
  }, [key, originId]);
  useEffect(() => {
    let canceled = false;
    void readGoodsTransactionRuntimeAction().then((value) => { if (!canceled) setRuntime(value); }, () => { if (!canceled) setRuntime(null); });
    return () => { canceled = true; };
  }, []);
  const visible = loaded?.key === key ? loaded : null;
  const reload = () => setRefresh((value) => value + 1);
  const saved = (text: string) => { setNotice({ originId, text }); reload(); };
  const activeMethods = (visible?.policies ?? []).filter((policy) => policy.state === 'active').map((policy) => policy.method);
  return <section aria-labelledby={`delivery-policies-${originId}`} className="flex min-w-0 flex-col gap-3 border-t pt-4" data-delivery-policies="">
    <h3 className="text-sm font-medium" id={`delivery-policies-${originId}`}>택배 외 수령 방식</h3>
    {runtime === false ? <AdminNotice tone="warning">지금 쇼핑몰 설정에서는 고객이 주문서에서 택배 외 방식을 고를 수 없습니다. 퀵·방문수령·직접배송·화물배송은 켜 두면 {ADMIN_VOCABULARY.dispatch}에서 주문의 배송 방식을 바꿀 때 쓰이고, {DELIVERY_METHOD_LABELS.none}은 쓸 수 없습니다. 주문서에서도 받으려면 개발 담당자에게 요청해 주세요.</AdminNotice> : null}
    {notice?.originId === originId && <AdminNotice role="status" tone="success">{notice.text}</AdminNotice>}
    {!visible ? <p className={HINT} role="status">불러오는 중입니다.</p> : visible.error ? <p className={ALERT} role="alert">{visible.error}</p> : <>
      {runtime === true ? <GoodReadback>지금 이 출고지에서 주문받는 방식: {['택배', ...activeMethods.map((method) => DELIVERY_METHOD_LABELS[method])].join(' · ')}. 상품에서 허용한 방식이라도 여기서 운영 조건을 사용으로 켜지 않았으면, 고객이 주문서에서 그 방식을 골랐을 때 주문이 막힙니다.</GoodReadback> : null}
      {visible.policies?.length ? visible.policies.map((policy) => <details className={DETAILS} key={`${policy.id}:${policy.revision}`}>
        <summary className={DETAILS_SUMMARY}>{DELIVERY_METHOD_LABELS[policy.method]} <AdminStatusBadge className="mx-1 align-middle" tone={statusTone('setting', policy.state === 'active' ? 'active' : 'inactive')}>{STATE_LABELS[policy.state]}</AdminStatusBadge> <span className="text-xs font-normal text-muted-foreground tabular-nums">{policyWhen(policy)}</span></summary>
        {policy.state === 'draft' && canEdit ? <DeliveryPolicyForm originId={originId} policy={policy} activeMethods={activeMethods} originActive={originActive} runtime={runtime} onSaved={saved} /> : <SavedDeliveryPolicy policy={policy} canEdit={canEdit} runtime={runtime} onSaved={saved} />}
      </details>) : <p className={HINT}>추가한 운영 조건이 없습니다.</p>}
      {canEdit ? <details className={DETAILS} key={`new-${key}`}><summary className={DETAILS_SUMMARY}>운영 조건 추가</summary><DeliveryPolicyForm originId={originId} activeMethods={activeMethods} originActive={originActive} runtime={runtime} onSaved={saved} /></details>
        : <small className="text-xs text-muted-foreground">운영 조건은 최고 관리자만 추가하고 켜고 끌 수 있습니다.</small>}
    </>}
    <Button className="w-fit" onClick={reload} type="button" variant="outline"><RefreshCw aria-hidden="true" />{RELOAD_LABEL}</Button>
  </section>;
}
