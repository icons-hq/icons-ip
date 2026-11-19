'use client';

import { useRef, useState } from 'react';
import { saveOpsAlertDigestAction, type OpsAlertDigestResult } from '@/app/admin/ops-alert-digest-actions';
import { AdminField, AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { useAdminLeaveGuard } from '@/components/admin/useAdminLeaveGuard';
import { statusTone } from '@/lib/admin/status-tone';
import {
  OPS_ALERT_DIGEST_CATEGORIES,
  OPS_ALERT_DIGEST_CATEGORY_HINTS,
  OPS_ALERT_DIGEST_CATEGORY_LABELS,
  OPS_ALERT_DIGEST_ERROR_LABELS,
  OPS_ALERT_DIGEST_MAX_DELAY_HOURS,
  OPS_ALERT_DIGEST_MIN_DELAY_HOURS,
  OPS_ALERT_DIGEST_RECIPIENT_LIMIT,
  OPS_ALERT_DIGEST_STATUS_LABELS,
  isOpsAlertDigestDelayHours,
  opsAlertDigestLeaveGuard,
  parseRecipientList,
  type OpsAlertDigestCategory,
  type OpsAlertDigestSettings,
} from '@/lib/admin/ops-alert-digest';
import { formatOrderDateTime } from '@/lib/orders';

const HINT = 'text-sm text-muted-foreground';
const UNKNOWN = '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.';
const count = (value: number) => value.toLocaleString('ko-KR');

/**
 * 운영 알림 요약 메일(OPS-095) 설정과 최근 발송 기록. 어드민 탭을 닫은 동안의 새 문의·답변 지연·시스템 장애를 한 통으로 받는다.
 * 저장은 화면이 한 번 만든 요청 ID를 결과가 확실해질 때까지 재사용한다(응답 유실 재시도가 같은 저장이 된다).
 */
export function OpsAlertDigestPanel({ initial }: { initial: OpsAlertDigestSettings }) {
  const [state, setState] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [recipients, setRecipients] = useState(initial.recipients.join('\n'));
  const [categories, setCategories] = useState<OpsAlertDigestCategory[]>(initial.categories);
  const [delayHours, setDelayHours] = useState(String(initial.delayHours));
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState(false);
  const request = useRef<{ enabled: boolean; recipients: string; categories: string[]; delayHours: number; expectedRevision: number; operationId: string } | null>(null);
  const parsed = parseRecipientList(recipients, OPS_ALERT_DIGEST_RECIPIENT_LIMIT);
  const hours = Number(delayHours);
  const changed = enabled !== state.enabled || !parsed.ok || parsed.recipients.join('\n') !== state.recipients.join('\n')
    || categories.join() !== state.categories.join() || hours !== state.delayHours;
  useAdminLeaveGuard({ ...opsAlertDigestLeaveGuard({ changed, uncertain, pending }), message: '저장하지 않은 운영 알림 메일 설정을 두고 이동할까요?' });
  const toggle = (category: OpsAlertDigestCategory, on: boolean) => setCategories(OPS_ALERT_DIGEST_CATEGORIES.filter((entry) => entry === category ? on : categories.includes(entry)));

  async function save() {
    if (pending) return;
    if (!parsed.ok) { setMessage(parsed.error); setError(true); return; }
    if (!categories.length) { setMessage('알릴 범주를 하나 이상 골라주세요.'); setError(true); return; }
    if (!isOpsAlertDigestDelayHours(hours)) {
      setMessage(`답변 지연 기준 시간은 ${OPS_ALERT_DIGEST_MIN_DELAY_HOURS}~${OPS_ALERT_DIGEST_MAX_DELAY_HOURS}시간 사이 정수로 넣어주세요.`); setError(true); return;
    }
    request.current ??= { enabled, recipients: parsed.recipients.join('\n'), categories, delayHours: hours, expectedRevision: state.revision, operationId: crypto.randomUUID() };
    setPending(true); setMessage('');
    let result: OpsAlertDigestResult;
    try { result = await saveOpsAlertDigestAction(request.current); }
    catch { result = { ok: false, error: UNKNOWN }; }
    setPending(false);
    if (!result.ok) {
      const unknownOutcome = result.error === UNKNOWN;
      setMessage(result.error); setError(true); setUncertain(unknownOutcome);
      if (!unknownOutcome) request.current = null;
      return;
    }
    const saved = result.settings;
    setState(saved); setEnabled(saved.enabled); setRecipients(saved.recipients.join('\n')); setCategories(saved.categories); setDelayHours(String(saved.delayHours));
    setUncertain(false); setError(false); request.current = null;
    setMessage(saved.enabled ? '저장했습니다. 이 시각 이후에 생긴 알림부터 5분마다 확인해 한 통으로 보냅니다.' : '저장했습니다. 운영 알림 메일을 껐습니다.');
  }

  return <div className="flex min-w-0 flex-col gap-4" data-ops-alert-digest="panel">
    <p className="flex flex-wrap items-center gap-2">
      <AdminStatusBadge tone={state.enabled ? 'success' : 'warning'}>{state.enabled ? '켜짐' : '꺼짐'}</AdminStatusBadge>
      <span className={HINT}>받는 주소 {count(state.recipients.length)}개 · 알림 범주 {state.categories.map((category) => OPS_ALERT_DIGEST_CATEGORY_LABELS[category]).join(', ')}</span>
    </p>
    <p className={HINT}>어드민 탭을 닫아 둔 업무 외 시간에도 새 문의·답변 지연·자동 작업 멈춤을 놓치지 않도록, 5분마다 새 알림을 확인해 있으면 한 통으로 보냅니다.
      같은 알림은 한 번만 세고, 요약은 10분에 한 통까지입니다. 메일에는 건수와 어드민 링크만 싣고 고객 이름·문의 내용은 싣지 않습니다.
      켠 뒤에 생긴 알림부터 보내며, 켜기 전에 쌓인 알림은 보내지 않습니다.</p>
    {state.enabled && !state.recipients.length ? <AdminNotice tone="warning">켜져 있지만 받는 주소가 없어 보내지 않습니다. 받는 주소를 넣어주세요.</AdminNotice> : null}
    <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={pending || uncertain}>
        <legend className="sr-only">운영 알림 메일 설정</legend>
        <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> 운영 알림 메일 보내기</label>
        <AdminField label={`받는 주소 (최대 ${OPS_ALERT_DIGEST_RECIPIENT_LIMIT}개)`} inputId="ops-alert-digest-recipients"
          hint="한 줄에 하나 또는 쉼표로 나눠 넣습니다. 처음에는 주소 하나로 켜서 메일이 오는지 확인한 뒤 늘리세요."
          error={parsed.ok ? undefined : parsed.error}>
          <Textarea className="min-h-24 max-w-[35rem] font-mono text-[13px]" id="ops-alert-digest-recipients" rows={3} value={recipients}
            aria-describedby="ops-alert-digest-recipients-hint" aria-invalid={!parsed.ok || undefined} placeholder={'cs@example.com\nops@example.com'}
            onChange={(event) => setRecipients(event.target.value)} />
        </AdminField>
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="font-medium">알릴 범주</legend>
          {OPS_ALERT_DIGEST_CATEGORIES.map((category) => <label className="flex flex-col gap-0.5" key={category}>
            <span className="flex items-center gap-2"><input type="checkbox" checked={categories.includes(category)} onChange={(event) => toggle(category, event.target.checked)} />{OPS_ALERT_DIGEST_CATEGORY_LABELS[category]}</span>
            <span className={`${HINT} pl-6`}>{OPS_ALERT_DIGEST_CATEGORY_HINTS[category]}</span>
          </label>)}
        </fieldset>
        <AdminField label="답변 지연 기준 (시간)" inputId="ops-alert-digest-delay"
          hint={`답변을 기다린 지 이 시간을 넘긴 1:1 문의·상품 문의를 알립니다(${OPS_ALERT_DIGEST_MIN_DELAY_HOURS}~${OPS_ALERT_DIGEST_MAX_DELAY_HOURS}시간, 기본 4시간). 문의당 한 번만 알리고, 7일 넘게 묵은 문의는 세지 않습니다.`}>
          <Input className="w-28" id="ops-alert-digest-delay" type="number" inputMode="numeric" min={OPS_ALERT_DIGEST_MIN_DELAY_HOURS} max={OPS_ALERT_DIGEST_MAX_DELAY_HOURS} step={1}
            required value={delayHours} aria-describedby="ops-alert-digest-delay-hint" onChange={(event) => setDelayHours(event.target.value)} />
        </AdminField>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || (!changed && !uncertain)}>{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : '설정 저장'}</Button>
        {message ? <p className={`text-sm ${error ? 'text-destructive' : 'text-success'}`} role={error ? 'alert' : 'status'}>{message}</p> : null}
      </div>
    </form>
    {state.runs.length ? <div className="flex flex-col gap-2 border-t pt-4">
      <p className="font-medium">최근 발송 기록</p>
      <ul className="flex flex-col gap-2">{state.runs.map((run) => <li className="flex flex-col gap-1" key={run.runId}>
        <span className="tabular-nums">{formatOrderDateTime(run.createdAt)}
          <span className={`${HINT} ml-2`}>새 문의 {count(run.counts.inquiries)} · 새 상품 문의 {count(run.counts.questions)} · 답변 지연 {count(run.counts.delayedInquiries + run.counts.delayedQuestions)} · 시스템 {count(run.counts.system)}</span></span>
        {run.deliveries.length ? <ul className="flex flex-col gap-1 pl-3">{run.deliveries.map((delivery) => <li className="flex flex-wrap items-center gap-2" key={delivery.recipient}>
          <span className="wrap-anywhere">{delivery.recipient}</span>
          <AdminStatusBadge tone={statusTone('stockDigest', delivery.status)}>{OPS_ALERT_DIGEST_STATUS_LABELS[delivery.status]}</AdminStatusBadge>
          {delivery.errorCode && delivery.status !== 'sent' ? <span className={HINT}>{OPS_ALERT_DIGEST_ERROR_LABELS[delivery.errorCode] ?? delivery.errorCode}</span> : null}
        </li>)}</ul> : <span className={`${HINT} pl-3`}>받는 주소가 없어 보내지 않음</span>}
      </li>)}</ul>
    </div> : null}
  </div>;
}
