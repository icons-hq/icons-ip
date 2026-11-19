'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  saveOrderDelayNoticeSwitchAction, savePartialCancelSwitchAction, saveReturnFeeDeductionSwitchAction, type OperationsSwitchResult,
} from '@/app/admin/operations-switches-actions';
import { AdminNotice, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { useAdminLeaveGuard } from '@/components/admin/useAdminLeaveGuard';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import {
  DELAY_NOTICE_EVIDENCE_MAX, OPERATIONS_SWITCH_CHECKLISTS, RETURN_FEE_AMOUNT_MAX, SWITCH_EVIDENCE_MAX, operationsSwitchEvidenceProblem,
  type OperationsSwitchKind, type OperationsSwitchesState,
} from '@/lib/admin/operations-switches';
import { adminConfirm } from '@/lib/admin/confirm';
import { statusTone } from '@/lib/admin/status-tone';
import { formatOrderDateTime } from '@/lib/orders';

const UNKNOWN = '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.';

export interface SaveInput { enabled: boolean; amount: number | null; evidence: string | null; revision: number; id: string }

export interface SectionProps {
  kind: OperationsSwitchKind;
  title: string;
  description: ReactNode;
  enabled: boolean;
  revision: number;
  evidence: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  evidenceMax: number;
  amountInitial?: number | null;
  /** 켜기를 막는 이유(운영 환경 준비 미완). 이미 켜진 스위치를 끄는 것은 막지 않는다. */
  blocked?: string;
  extra?: ReactNode;
  confirmOn: string;
  confirmOff: string;
  save: (input: SaveInput) => Promise<OperationsSwitchResult>;
  onSaved: (state: OperationsSwitchesState) => void;
}

/**
 * 스위치 한 칸. 꺼져 있으면 확인 항목을 모두 체크하고 근거(와 금액)를 적어야 켤 수 있고, 켜져 있으면 끄거나 근거·금액을 바꿔 저장한다.
 * 켜기·끄기·변경은 모두 확인창을 거친다. 결과가 불확실하면 입력과 요청 ID를 고정해 같은 요청으로만 다시 확인한다.
 */
export function SwitchSection(props: SectionProps) {
  const { kind, enabled, revision, evidenceMax, blocked } = props;
  const checklist = OPERATIONS_SWITCH_CHECKLISTS[kind];
  const id = useId();
  const [checks, setChecks] = useState<boolean[]>(() => checklist.map(() => false));
  const [evidence, setEvidence] = useState(props.evidence ?? '');
  const [amount, setAmount] = useState(props.amountInitial == null ? '' : String(props.amountInitial));
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState(false);
  const request = useRef<SaveInput | null>(null);
  const resultRef = useRef<HTMLParagraphElement>(null), focusResult = useRef(false);
  useEffect(() => {
    if (!focusResult.current) return;
    focusResult.current = false;
    resultRef.current?.focus();
  });
  const hasAmount = props.amountInitial !== undefined;
  /* 고치던 근거·금액·체크는 저장하지 않고 떠나면 사라지고(비밀이 아닌 값이라 보관은 하지 않는다), 저장 중에는 떠나지 못하며,
     결과가 불확실한 동안은 이동하면 같은 요청 ID를 잃어 결과를 다시 확인할 수 없으므로 묻는다. */
  const savedAmount = props.amountInitial == null ? '' : String(props.amountInitial);
  const dirty = evidence !== (props.evidence ?? '') || (hasAmount && amount !== savedAmount) || checks.some(Boolean) || uncertain;
  useAdminLeaveGuard({ dirty, blocked: pending, message: uncertain
    ? `${props.title} 저장 결과를 아직 확인하지 못했습니다. 나가면 같은 요청으로 다시 확인할 수 없습니다. 화면을 나가시겠습니까?`
    : `저장하지 않은 ${props.title} 입력이 있습니다. 화면을 나가시겠습니까?`, recover: false });
  const allChecked = checks.every(Boolean);
  /* 입력은 결과가 불확실한 동안에도 잠그지만 [같은 요청 결과 확인] 버튼은 눌러야 하므로 버튼은 저장 중에만 막는다. */
  const locked = pending || uncertain;

  function fail(text: string) { setMessage(text); setError(true); focusResult.current = true; }

  async function submit(enable: boolean) {
    if (pending) return;
    if (!request.current) {
      const trimmed = evidence.trim();
      if (enable) {
        if (!enabled && blocked) return fail(blocked);
        if (!enabled && !allChecked) return fail('켜기 전에 확인 항목을 모두 확인했는지 체크해주세요.');
        const problem = operationsSwitchEvidenceProblem(trimmed, evidenceMax);
        if (problem) return fail(problem);
        if (hasAmount && !/^[1-9][0-9]*$/.test(amount.trim())) return fail('반품배송비 편도 금액은 1원 이상의 정수로 입력해주세요.');
        if (hasAmount && Number(amount) > RETURN_FEE_AMOUNT_MAX) return fail(`반품배송비 편도 금액은 ${RETURN_FEE_AMOUNT_MAX.toLocaleString('ko-KR')}원 이하로 입력해주세요.`);
      }
      const ok = await adminConfirm({
        title: enable ? (enabled ? `${props.title} 변경 저장` : `${props.title} 켜기`) : `${props.title} 끄기`,
        message: enable ? props.confirmOn : props.confirmOff,
        confirmLabel: enable ? (enabled ? '저장' : '켜기') : '끄기',
        destructive: !enable,
      });
      if (!ok) return;
      request.current = {
        enabled: enable, amount: enable && hasAmount ? Number(amount) : null, evidence: enable ? trimmed : null, revision, id: crypto.randomUUID(),
      };
    }
    setPending(true); setMessage('');
    let result: OperationsSwitchResult;
    try { result = await props.save(request.current); } catch { result = { error: UNKNOWN, uncertain: true }; }
    setPending(false); focusResult.current = true;
    if ('error' in result) {
      setMessage(result.error); setError(true); setUncertain(Boolean(result.uncertain));
      if (!result.uncertain) request.current = null;
      return;
    }
    const sent = request.current;
    request.current = null;
    setUncertain(false); setError(false); setChecks(checklist.map(() => false));
    setMessage(sent.enabled ? (enabled ? '변경 내용을 저장했습니다.' : '켰습니다. 변경자와 근거가 감사 기록에 남았습니다.') : '껐습니다. 변경자가 감사 기록에 남았습니다.');
    props.onSaved(result.state);
  }

  const evidenceId = `${id}-evidence`, amountId = `${id}-amount`;
  return <AdminSectionCard title={props.title} summary={props.description}>
    <div className="flex flex-wrap items-center gap-2">
      <AdminStatusBadge tone={statusTone('setting', enabled ? 'active' : 'inactive')}>{enabled ? '켜짐' : '꺼짐'}</AdminStatusBadge>
      {props.updatedBy && props.updatedAt ? <span className="text-xs text-muted-foreground">마지막 변경 {formatOrderDateTime(props.updatedAt)} · {props.updatedBy}</span>
        : <span className="text-xs text-muted-foreground">아직 어드민에서 바꾼 적이 없습니다.</span>}
    </div>
    {props.extra}
    {blocked && !enabled ? <AdminNotice role="status" tone="warning">{blocked}</AdminNotice> : null}
    <form className="flex min-w-0 flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void submit(true); }}>
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={locked}>
        <legend className="sr-only">{props.title} 설정</legend>
        {!enabled ? <div className="flex flex-col gap-2 rounded-lg border p-3">
          <p className="font-medium">켜기 전에 확인할 것</p>
          <ul className="flex flex-col gap-2">{checklist.map((item, index) => <li key={item}>
            <label className="flex items-start gap-2 leading-relaxed">
              <input className="mt-1" type="checkbox" checked={checks[index]} onChange={(event) => setChecks((current) => current.map((value, at) => at === index ? event.target.checked : value))} />
              <span>{item}</span>
            </label>
          </li>)}</ul>
        </div> : null}
        {hasAmount ? <div className="flex max-w-xs min-w-0 flex-col gap-1.5">
          <Label htmlFor={amountId}>반품배송비 편도 금액 (원)</Label>
          <Input className="tabular-nums" id={amountId} inputMode="numeric" max={RETURN_FEE_AMOUNT_MAX} min={1} step={1} type="number" value={amount}
            onChange={(event) => setAmount(event.target.value)} />
          <p className="text-xs text-muted-foreground">무료배송으로 받은 주문은 왕복(편도의 2배)을 차감합니다. 결제액 이상이면 차감하지 않고 전액 환불합니다.</p>
        </div> : null}
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={evidenceId}>켠 근거 (2~{evidenceMax.toLocaleString('ko-KR')}자)</Label>
          <Textarea id={evidenceId} maxLength={evidenceMax + 50} rows={3} value={evidence} onChange={(event) => setEvidence(event.target.value)}
            placeholder="확인한 계약·공지·승인 내용을 적습니다. 감사 기록에 남습니다." />
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending} type="submit">{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : enabled ? '근거·금액 변경 저장' : '켜기'}</Button>
        {enabled ? <Button disabled={locked} type="button" variant="outline" onClick={() => { void submit(false); }}>끄기</Button> : null}
        {message ? <p className={`text-sm outline-none ${error ? 'text-destructive' : 'text-success'}`} ref={resultRef} role={error ? 'alert' : 'status'} tabIndex={-1}>{message}</p> : null}
      </div>
    </form>
  </AdminSectionCard>;
}

/** 어드민에서 켜고 끄는 운영 스위치 세 개. 저장 결과 문서는 세 칸이 함께 받는다(반품배송비와 부분 취소는 한 행의 같은 리비전을 쓴다). */
export function OperationsSwitchesForm({ initial, emailConfigured }: { initial: OperationsSwitchesState; emailConfigured: boolean }) {
  const [state, setState] = useState(initial);
  const { delayNotice, returnFee, partialCancel } = state;
  return <div className="flex min-w-0 flex-col gap-4">
    <SwitchSection kind="delayNotice" title="주문 지연 안내 이메일" enabled={delayNotice.enabled} revision={delayNotice.revision}
      description="꺼져 있으면 배송 지연 안내 요청과 예약 주문 발송일 일괄 변경이 진행되지 않습니다. 켜면 앱 알림과 함께 이메일을 보냅니다."
      evidence={delayNotice.evidence} updatedBy={delayNotice.updatedBy} updatedAt={delayNotice.updatedBy ? delayNotice.changedAt : null}
      evidenceMax={DELAY_NOTICE_EVIDENCE_MAX}
      blocked={emailConfigured ? undefined : '이메일 공급자 또는 발송 서명 설정이 운영 환경에 준비되지 않아 지금은 켤 수 없습니다. 설정을 마치면 켤 수 있습니다.'}
      extra={<ul className="flex flex-col gap-1 text-xs text-muted-foreground">
        <li>이메일 설정: {emailConfigured ? '운영 환경에 준비됨' : '준비되지 않음'}</li>
        <li>예약 일정 변경 SMS: {delayNotice.smsEnabled ? '켜짐' : '꺼짐'} (이 화면에서 바꾸지 않습니다. 앱의 SMS 알림 스위치도 함께 켜져야 문자가 나갑니다.)</li>
      </ul>}
      confirmOn="켜면 지연 안내와 예약 일정 변경 안내가 고객에게 이메일로 나갈 수 있습니다. 켤까요?"
      confirmOff="끄면 지연 안내 요청과 예약 주문 발송일 일괄 변경이 다시 막힙니다. 대기 중인 이메일도 보내지 않고 실패(재시도 가능)로 남습니다. 다시 켠 뒤 재시도해야 합니다. 끌까요?"
      save={(input) => saveOrderDelayNoticeSwitchAction(input.enabled, input.evidence, input.revision, input.id)}
      onSaved={setState} />
    <SwitchSection kind="returnFee" title="반품배송비 차감" enabled={returnFee.enabled} revision={returnFee.revision}
      description="단순 변심 반품의 환불금에서 반품배송비를 차감하고 결제사 부분 취소로 나머지를 돌려줍니다. 정책(금액·약관 개정)은 사람이 정한 뒤에 켭니다."
      evidence={returnFee.evidence} updatedBy={returnFee.updatedBy} updatedAt={returnFee.updatedBy ? returnFee.updatedAt : null}
      evidenceMax={SWITCH_EVIDENCE_MAX} amountInitial={returnFee.oneWayAmount}
      confirmOn="켠 시각 이후 접수된 단순 변심 반품부터 환불금에서 반품배송비가 차감됩니다. 켜기 전에 접수된 반품은 환불 접수가 켠 뒤여도 전액 환불입니다. 켤까요?"
      confirmOff="끄면 새 반품 접수에서 차감하지 않습니다. 이미 차감을 결정한 요청은 그대로 진행됩니다. 끌까요?"
      save={(input) => saveReturnFeeDeductionSwitchAction(input.enabled, input.amount, input.evidence, input.revision, input.id)}
      onSaved={setState}
      extra={<><p className="text-sm" data-return-fee-inflight="">지금 진행 중인 단순 변심 반품 <strong className="tabular-nums">{returnFee.inflightCount.toLocaleString('ko-KR')}건</strong> — {returnFee.enabled ? '켠 시각 전에 접수된 건은 차감하지 않습니다.' : '켜도 이 건들은 차감하지 않고 전액 환불합니다(켠 시각 이후 접수된 반품부터 차감).'}</p><p className="text-xs text-muted-foreground">반품배송비 정책 배경은 <Link className="underline underline-offset-4" href="/admin/guide/claims">클레임 가이드</Link>를 참고하세요.</p></>} />
    <SwitchSection kind="partialCancel" title="재고 부족 부분 취소" enabled={partialCancel.enabled} revision={partialCancel.revision}
      description="재고 부족으로 주문 일부 품목·수량만 취소할 때 결제사 부분 취소를 사용합니다. 반품배송비 차감과 따로 켜고 끕니다."
      evidence={partialCancel.evidence} updatedBy={partialCancel.updatedBy} updatedAt={partialCancel.updatedBy ? partialCancel.updatedAt : null}
      evidenceMax={SWITCH_EVIDENCE_MAX}
      confirmOn="켜면 주문 상세에서 재고 부족 품목·수량을 골라 부분 취소할 수 있고, 결제사 부분 취소가 나갑니다. 켤까요?"
      confirmOff="끄면 새 부분 취소를 시작할 수 없습니다. 이미 진행 중인 부분 취소는 그대로 처리됩니다. 끌까요?"
      save={(input) => savePartialCancelSwitchAction(input.enabled, input.evidence, input.revision, input.id)}
      onSaved={setState} />
  </div>;
}
