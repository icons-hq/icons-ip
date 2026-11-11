'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { saveStockSafetyDigestAction, type StockDigestSettingsResult } from '@/app/admin/stock-safety-digest-actions';
import { AdminField, AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { fulfillmentOriginTabHref } from '@/lib/admin/fulfillment-origin-tabs';
import { statusTone } from '@/lib/admin/status-tone';
import {
  STOCK_DIGEST_ERROR_LABELS,
  STOCK_DIGEST_OPERATOR_RECIPIENT_LIMIT,
  STOCK_DIGEST_STATUS_LABELS,
  isDigestSendTime,
  parseRecipientList,
  type StockSafetyDigestSettings,
} from '@/lib/admin/stock-safety-digest';
import { formatOrderDateTime } from '@/lib/orders';

const HINT = 'text-sm text-muted-foreground';
const UNKNOWN = '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.';
const count = (value: number) => value.toLocaleString('ko-KR');

/**
 * 안전재고 하루 1회 요약 메일(QNA-014) 설정과 최근 발송 기록.
 * 저장은 화면이 한 번 만든 요청 ID를 결과가 확실해질 때까지 재사용한다(응답 유실 재시도가 같은 저장이 된다).
 * 출고지 담당자 주소는 배송정보 관리의 출고지 탭에서 넣는다 — 여기서는 현황만 보인다.
 */
export function StockSafetyDigestPanel({ initial }: { initial: StockSafetyDigestSettings }) {
  const [state, setState] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [sendTime, setSendTime] = useState(initial.sendTime);
  const [recipients, setRecipients] = useState(initial.operatorRecipients.join('\n'));
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState(false);
  const request = useRef<{ enabled: boolean; sendTime: string; recipients: string; expectedRevision: number; operationId: string } | null>(null);
  const parsedRecipients = parseRecipientList(recipients, STOCK_DIGEST_OPERATOR_RECIPIENT_LIMIT);
  const changed = enabled !== state.enabled || sendTime !== state.sendTime
    || !parsedRecipients.ok || parsedRecipients.recipients.join('\n') !== state.operatorRecipients.join('\n');
  const originRecipients = state.origins.reduce((sum, origin) => sum + origin.recipients.length, 0);

  async function save() {
    if (pending) return;
    if (!isDigestSendTime(sendTime)) { setMessage('발송 시각을 00:00~23:59 사이로 입력해주세요.'); setError(true); return; }
    if (!parsedRecipients.ok) { setMessage(parsedRecipients.error); setError(true); return; }
    request.current ??= { enabled, sendTime, recipients: parsedRecipients.recipients.join('\n'), expectedRevision: state.revision, operationId: crypto.randomUUID() };
    setPending(true); setMessage('');
    let result: StockDigestSettingsResult;
    try { result = await saveStockSafetyDigestAction(request.current); }
    catch { result = { ok: false, error: UNKNOWN }; }
    setPending(false);
    if (!result.ok) {
      const unknownOutcome = result.error === UNKNOWN;
      setMessage(result.error); setError(true); setUncertain(unknownOutcome);
      if (!unknownOutcome) request.current = null;
      return;
    }
    const saved = result.settings;
    setState(saved); setEnabled(saved.enabled); setSendTime(saved.sendTime); setRecipients(saved.operatorRecipients.join('\n'));
    setUncertain(false); setError(false); request.current = null;
    setMessage(saved.enabled ? `저장했습니다. 매일 ${saved.sendTime}(한국 시간)이 지나면 그날 한 번 보냅니다.` : '저장했습니다. 요약 메일을 껐습니다.');
  }

  return <div className="flex min-w-0 flex-col gap-4" data-stock-digest="panel">
    <p className="flex flex-wrap items-center gap-2">
      <AdminStatusBadge tone={state.enabled ? 'success' : 'warning'}>{state.enabled ? '켜짐' : '꺼짐'}</AdminStatusBadge>
      <span className={HINT}>
        지금 안전재고 기준 이하 옵션 {count(state.lowStockCount)}개
        {state.nextSendAt ? ` · 다음 발송 ${formatOrderDateTime(state.nextSendAt)}` : ''}
        {` · 운영자 ${count(state.operatorRecipients.length)}명 · 출고지 담당자 ${count(originRecipients)}명`}
      </span>
    </p>
    <p className={HINT}>매일 정한 시각(한국 시간)이 지나면 그날 한 번, 사용 중인 옵션 중 재고수량이 안전재고 기준 이하인 옵션을 모아 보냅니다.
      운영자 주소에는 전체 목록을, 출고지 담당자 주소에는 그 출고지 상품만 보냅니다. 같은 주소는 하루 한 통이고, 대상 옵션이 없거나 받는 주소가 없으면 보내지 않습니다.
      안전재고 기준은 상품 수정의 옵션 상세에서 옵션마다 넣습니다(비워 두면 대상이 아닙니다).</p>
    {state.enabled && !state.operatorRecipients.length && !originRecipients ? <AdminNotice tone="warning">켜져 있지만 받는 주소가 없어 보내지 않습니다. 운영자 주소나 출고지 담당자 주소를 넣어주세요.</AdminNotice> : null}
    <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={pending || uncertain}>
        <legend className="sr-only">안전재고 요약 메일 설정</legend>
        <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> 하루 1회 요약 메일 보내기</label>
        <AdminField label="매일 보내는 시각 (한국 시간)" inputId="stock-digest-time" hint="기본 09:00 — 담당자가 업무 시작에 받아 그날 출고 마감(16:30) 전에 보충·품절 처리를 할 수 있습니다. 오늘 시각이 이미 지났고 오늘 보낸 적이 없으면 켠 직후 보냅니다.">
          <Input className="w-36" id="stock-digest-time" type="time" step={60} required value={sendTime} aria-describedby="stock-digest-time-hint"
            onChange={(event) => setSendTime(event.target.value.slice(0, 5))} />
        </AdminField>
        <AdminField label={`운영자 받는 주소 (최대 ${STOCK_DIGEST_OPERATOR_RECIPIENT_LIMIT}개)`} inputId="stock-digest-recipients" hint="한 줄에 하나 또는 쉼표로 나눠 넣습니다. 전체 목록(모든 출고지)을 받습니다."
          error={parsedRecipients.ok ? undefined : parsedRecipients.error}>
          <Textarea className="min-h-24 max-w-[35rem] font-mono text-[13px]" id="stock-digest-recipients" rows={3} value={recipients}
            aria-describedby="stock-digest-recipients-hint" aria-invalid={!parsedRecipients.ok || undefined} placeholder={'md@example.com\nops@example.com'}
            onChange={(event) => setRecipients(event.target.value)} />
        </AdminField>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || (!changed && !uncertain)}>{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : '설정 저장'}</Button>
        {message ? <p className={`text-sm ${error ? 'text-destructive' : 'text-success'}`} role={error ? 'alert' : 'status'}>{message}</p> : null}
      </div>
    </form>
    <div className="flex flex-col gap-2 border-t pt-4">
      <p className="font-medium">출고지 담당자 주소</p>
      <ul className="flex flex-col gap-1">{state.origins.map((origin) => <li className="flex flex-wrap items-center gap-2" key={origin.originId}>
        <Link className="underline underline-offset-4" href={fulfillmentOriginTabHref(origin.originCode)}>{origin.originName}{origin.active ? '' : ' (비활성)'}</Link>
        <span className={HINT}>{origin.recipients.length ? origin.recipients.join(', ') : '받는 주소 없음'}</span>
      </li>)}</ul>
      <p className={HINT}>배송정보 관리의 출고지 탭에서 넣습니다. 서원처럼 창고가 다른 곳은 그 창고 담당자 주소를 넣으면 그 출고지 상품만 받습니다.</p>
    </div>
    {state.runs.length ? <div className="flex flex-col gap-2 border-t pt-4">
      <p className="font-medium">최근 발송 기록</p>
      <div className="min-w-0 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm" data-slot="table">
          <caption className="sr-only">최근 7일 안전재고 요약 메일</caption>
          <TableHeader><TableRow><TableHead scope="col">날짜</TableHead><TableHead scope="col" className="text-right">대상 옵션</TableHead><TableHead scope="col">받는 사람 · 결과</TableHead></TableRow></TableHeader>
          <TableBody>{state.runs.map((run) => <TableRow key={run.digestDate}>
            <TableCell className="align-top whitespace-nowrap tabular-nums">{run.digestDate}</TableCell>
            <TableCell className="text-right align-top tabular-nums">{count(run.itemCount)}</TableCell>
            <TableCell className="whitespace-normal">{run.deliveries.length ? <ul className="flex flex-col gap-1">{run.deliveries.map((delivery) => <li className="flex flex-wrap items-center gap-2" key={delivery.recipient}>
              <span className="wrap-anywhere">{delivery.recipient}</span>
              <span className={HINT}>{delivery.audience === 'origin' ? `${delivery.originName ?? '출고지'} 담당 · ${count(delivery.itemCount)}개` : `운영자 · ${count(delivery.itemCount)}개`}</span>
              <AdminStatusBadge tone={statusTone('stockDigest', delivery.status)}>{STOCK_DIGEST_STATUS_LABELS[delivery.status]}</AdminStatusBadge>
              {delivery.errorCode && delivery.status !== 'sent' ? <span className={HINT}>{STOCK_DIGEST_ERROR_LABELS[delivery.errorCode] ?? delivery.errorCode}</span> : null}
            </li>)}</ul> : <span className={HINT}>{run.itemCount ? '받는 주소가 없어 보내지 않음' : '대상 옵션이 없어 보내지 않음'}</span>}</TableCell>
          </TableRow>)}</TableBody>
        </table>
      </div>
    </div> : null}
  </div>;
}
