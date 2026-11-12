'use client';

import { useId, useMemo, useState, useTransition } from 'react';
import {
  applyPreorderScheduleChangeAction, listPreorderScheduleChangesAction, previewPreorderScheduleChangeAction, readPreorderScheduleChangeAction,
  retryPreorderScheduleEmailsAction, type PreorderScheduleApplyInput,
} from '@/app/admin/preorder-schedule-actions';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { Button } from '@/components/admin/kit/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/admin/kit/ui/dialog';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import { kstDay } from '@/lib/admin/kst';
import { ORDER_DELAY_ERROR_LABELS, ORDER_DELAY_STATUS_LABELS } from '@/lib/admin/order-delay-notices';
import {
  PREORDER_SCHEDULE_BODY_MAX, PREORDER_SCHEDULE_EXCLUSION_LABELS, PREORDER_SCHEDULE_EXCLUSION_REASONS, PREORDER_SCHEDULE_REASON_MAX,
  PREORDER_SCHEDULE_SMS_LABELS, PREORDER_SCHEDULE_SMS_REASON_LABELS, PREORDER_SCHEDULE_TITLE_MAX, defaultPreorderScheduleCopy,
  preorderScheduleDateLine, preorderScheduleSelection, type PreorderScheduleChange, type PreorderScheduleChangeSummary, type PreorderSchedulePreview,
} from '@/lib/admin/preorder-schedule-change';
import { statusTone } from '@/lib/admin/status-tone';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import { GOOD_DETACHED_FORM_ID } from './GoodWorkspace';

/*
 * QNA-040: 예약 상품의 발송 예정일이 바뀌면 그 상품의 미출고 예약 배송 건 일정을 한 번에 바꾸고 고객에게 안내한다.
 * 상품 편집의 예약판매 영역(기본 폼 안)에 놓이지만 대화상자는 포털로 열려 상품 저장 폼과 섞이지 않는다. 그래도 화면의 다른
 * 버튼처럼 소속 폼을 떼어 둔다(GOOD_DETACHED_FORM_ID). 대상·제외·지문·멱등은 DB가 정하고, 화면은 미리보기에서 본 대상 중
 * 운영자가 뺀 배송 건만 보낸다. 고객 이메일·이름·연락처는 받지도 보이지도 않는다.
 */
const form = GOOD_DETACHED_FORM_ID;
const PAGE_SIZE = 20;
const FIELD = 'flex w-full min-w-0 flex-col gap-1.5 text-sm [&>span]:font-medium';
const dateLabel = (date: string) => `${date.slice(0, 4)}년 ${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
const page = <T,>(rows: readonly T[], number: number) => rows.slice((number - 1) * PAGE_SIZE, number * PAGE_SIZE);
const paymentLabel = (status: string, method: string) => status === 'pending' ? method === 'bank_transfer' ? '입금 대기' : '결제 대기' : null;
/** 접수 중인 예약 조건을 날짜별로 묶는다. 랜덤 판매처럼 옵션이 많아도 한 줄로 읽히게 날짜마다 옵션 이름은 셋까지 보인다. */
export function openPolicySummary(policies: readonly { variantName: string; expectedShipDate: string }[]): string {
  const byDate = new Map<string, string[]>();
  for (const policy of policies) byDate.set(policy.expectedShipDate, [...(byDate.get(policy.expectedShipDate) ?? []), policy.variantName]);
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, names]) =>
    `${names.slice(0, 3).join('·')}${names.length > 3 ? ` 외 ${names.length - 3}개` : ''} ${dateLabel(date)}`).join(' · ');
}

type Step =
  | { kind: 'form' }
  | { kind: 'preview'; preview: PreorderSchedulePreview; emailConfigured: boolean; smsAvailable: boolean }
  | { kind: 'result'; change: PreorderScheduleChange };

/** 미리보기: 대상·제외 사유·고객 문구를 확인하고 확정한다. */
export function PreorderSchedulePreviewStep({ preview, emailConfigured, smsAvailable, reason, onBack, onApplied, onStale }: {
  preview: PreorderSchedulePreview; emailConfigured: boolean; smsAvailable: boolean; reason: string;
  onBack: () => void; onApplied: (change: PreorderScheduleChange) => void; onStale: () => void;
}) {
  const copy = defaultPreorderScheduleCopy(preview.goodName);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [title, setTitle] = useState(copy.title);
  const [body, setBody] = useState(copy.body);
  const [targetPage, setTargetPage] = useState(1);
  const [excludedPage, setExcludedPage] = useState(1);
  const [error, setError] = useState<{ message: string; uncertain?: boolean; stale?: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  /* 같은 미리보기의 확정은 같은 요청 UUID다. 연결이 끊겨도 같은 요청으로만 다시 보내고 결과를 먼저 읽는다. */
  const [request, setRequest] = useState<PreorderScheduleApplyInput | null>(null);
  const selection = preorderScheduleSelection(preview, excluded);
  const emailReady = preview.emailEnabled && emailConfigured;
  const tooMany = selection.shipments > preview.limit;
  const individual = preview.targets.filter((target) => target.individuallyChanged).length;
  const mixed = preview.targets.some((target) => target.otherPreorder);
  const sample = preview.targets[0];
  const frozen = Boolean(request) && Boolean(error?.uncertain);
  function toggle(shipmentId: string, checked: boolean) {
    setRequest(null); setError(null);
    setExcluded((current) => { const next = new Set(current); if (checked) next.delete(shipmentId); else next.add(shipmentId); return next; });
  }
  function apply(retrySame = false) {
    if (pending) return;
    const payload: PreorderScheduleApplyInput = retrySame && request ? request : {
      requestId: crypto.randomUUID(), goodId: preview.goodId, variantId: preview.variantId, expectedShipDate: preview.expectedShipDate,
      reason, title, body, fingerprint: preview.fingerprint, excludedShipmentIds: selection.excludedShipmentIds,
    };
    setRequest(payload);
    setError(null);
    startTransition(async () => {
      const result = await applyPreorderScheduleChangeAction(payload);
      if (result.ok) { onApplied(result.change); return; }
      setError({ message: result.error, uncertain: result.uncertain, stale: result.stale });
    });
  }
  function check() {
    const payload = request;
    if (!payload || pending) return;
    startTransition(async () => {
      const result = await readPreorderScheduleChangeAction(payload.requestId);
      if (result.ok) onApplied(result.change);
      else setError({ message: result.uncertain ? result.error : '아직 반영되지 않았습니다. 같은 요청으로 다시 확정할 수 있습니다.', uncertain: true });
    });
  }
  return <div className="flex min-w-0 flex-col gap-4" data-preorder-schedule-preview="">
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-base font-medium text-foreground">예약 주문 {selection.orders.toLocaleString('ko-KR')}건 일정도 바꾸고 안내할까요?</p>
      <p className="text-muted-foreground">
        {preview.variantName ? `옵션 '${preview.variantName}'의 ` : ''}미출고 예약 배송 건 {selection.shipments.toLocaleString('ko-KR')}건의 발송 예정일을 {dateLabel(preview.expectedShipDate)}로 바꾸고,
        주문 {selection.orders.toLocaleString('ko-KR')}건의 구매자(선물 주문은 받는 분 포함)에게 앱 알림·이메일을 보냅니다. 주문 당시 예정일은 보존하고 배송 건마다 변경 이력이 남습니다.
      </p>
      <p className="text-xs text-muted-foreground">변경 사유(내부 기록): {reason}</p>
    </div>
    {!emailReady ? <AdminNotice role="status" tone="danger">{!preview.emailEnabled ? '지연 안내 이메일 발송 설정이 꺼져 있습니다.' : '이메일 공급자 또는 발송 서명 설정이 준비되지 않았습니다.'} 두 채널이 준비되어야 일정 변경과 안내를 진행할 수 있습니다.</AdminNotice> : null}
    {preview.acceptingPolicies.length ? <AdminNotice tone="warning" title="접수 중인 예약 조건은 바뀌지 않습니다">
      {openPolicySummary(preview.acceptingPolicies)} — 이후 새 주문은 이 날짜로 안내됩니다. 새 주문도 바꾸려면 새 예약 접수를 중지하고 새 발송 예정일로 예약 조건을 등록해주세요.
    </AdminNotice> : null}
    {individual ? <AdminNotice tone="info">운영자가 주문 상세에서 따로 바꾼 배송 건 {individual.toLocaleString('ko-KR')}건이 포함되어 있습니다(표의 &lsquo;개별 변경&rsquo;). 그 날짜를 지키려면 선택을 해제하세요.</AdminNotice> : null}
    {mixed ? <AdminNotice tone="info">다른 예약 상품과 함께 보내는 배송 건은 그 상품의 주문 당시 예정일보다 앞당기지 않습니다. 새 예정일이 더 늦으면 그 날짜로 바꿉니다.</AdminNotice> : null}
    {tooMany ? <AdminNotice role="alert" tone="danger">한 번에 바꿀 수 있는 배송 건은 {preview.limit.toLocaleString('ko-KR')}건까지입니다. 옵션별로 나누어 바꿔주세요.</AdminNotice> : null}
    {smsAvailable && preview.smsEnabled ? <p className="text-sm text-muted-foreground" data-preorder-schedule-sms="">SMS: 휴대폰 번호를 인증하고 SMS 수신에 동의한 고객에게는 같은 안내를 문자로도 한 번 보냅니다.</p> : null}

    {preview.targets.length ? <div className="flex min-w-0 flex-col gap-2">
      <div className="w-full rounded-lg border">
        <Table className="min-w-[40rem]">
          <caption className="caption-top border-b px-2 py-2 text-left text-sm font-medium text-foreground">바꿀 배송 건 {preview.targets.length.toLocaleString('ko-KR')}건 · 선택 {selection.shipments.toLocaleString('ko-KR')}건</caption>
          <TableHeader><TableRow className="bg-muted/50">
            <TableHead scope="col" className="w-10"><span className="sr-only">포함</span></TableHead>
            <TableHead scope="col">주문</TableHead><TableHead scope="col">배송 건</TableHead><TableHead scope="col">발송 예정일</TableHead><TableHead scope="col">확인할 점</TableHead>
          </TableRow></TableHeader>
          <TableBody>{page(preview.targets, targetPage).map((target) => <TableRow key={target.shipmentId} data-shipment-id={target.shipmentId}>
            <TableCell className="align-top"><input form={form} type="checkbox" checked={!excluded.has(target.shipmentId)} disabled={pending || frozen}
              aria-label={`${orderReferenceLabel(target.orderId, target.orderNumber)} 배송 건 ${target.shipmentLabel} 포함`} onChange={(event) => toggle(target.shipmentId, event.target.checked)} /></TableCell>
            <TableCell className="align-top whitespace-normal"><a className="underline underline-offset-4" href={`/admin/sales/orders/${target.orderId}`} target="_blank" rel="noreferrer">{orderReferenceLabel(target.orderId, target.orderNumber)}</a></TableCell>
            <TableCell className="align-top whitespace-normal">{target.shipmentLabel}<br /><small className="text-xs text-muted-foreground">{target.originName}</small></TableCell>
            <TableCell className="align-top whitespace-normal tabular-nums">{target.currentDate} → <strong className="font-medium">{target.newDate}</strong></TableCell>
            <TableCell className="align-top whitespace-normal"><div className="flex flex-wrap gap-1">
              {target.individuallyChanged ? <AdminStatusBadge tone="warning">개별 변경</AdminStatusBadge> : null}
              {target.otherPreorder ? <AdminStatusBadge tone="info">다른 예약 상품 포함</AdminStatusBadge> : null}
              {paymentLabel(target.orderStatus, target.paymentMethod) ? <AdminStatusBadge tone="neutral">{paymentLabel(target.orderStatus, target.paymentMethod)}</AdminStatusBadge> : null}
            </div></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </div>
      {preview.targets.length > PAGE_SIZE ? <ConsolePagination label="바꿀 배송 건 페이지" page={targetPage} pageSize={PAGE_SIZE} total={preview.targets.length} unit="건" onPageChange={setTargetPage} /> : null}
    </div> : <AdminNotice tone="neutral">바꿀 예약 배송 건이 없습니다. 아래 제외 사유를 확인해주세요.</AdminNotice>}

    {preview.excludedTotal ? <details className="min-w-0 rounded-lg border" data-preorder-schedule-excluded="">
      <summary className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50">
        바꾸지 않는 배송 건 {preview.excludedTotal.toLocaleString('ko-KR')}건 · {PREORDER_SCHEDULE_EXCLUSION_REASONS.filter((key) => preview.excludedCounts[key])
          .map((key) => `${PREORDER_SCHEDULE_EXCLUSION_LABELS[key]} ${preview.excludedCounts[key]!.toLocaleString('ko-KR')}건`).join(' · ')}
      </summary>
      <div className="flex min-w-0 flex-col gap-2 border-t p-3">
        <Table className="min-w-[36rem]">
          <TableHeader><TableRow className="bg-muted/50"><TableHead scope="col">주문</TableHead><TableHead scope="col">배송 건</TableHead><TableHead scope="col">현재 예정일</TableHead><TableHead scope="col">제외 사유</TableHead></TableRow></TableHeader>
          <TableBody>{page(preview.excluded, excludedPage).map((row) => <TableRow key={row.shipmentId}>
            <TableCell className="align-top whitespace-normal">{orderReferenceLabel(row.orderId, row.orderNumber)}</TableCell>
            <TableCell className="align-top whitespace-normal">{row.shipmentLabel}</TableCell>
            <TableCell className="align-top tabular-nums">{row.currentDate ?? '—'}</TableCell>
            <TableCell className="align-top whitespace-normal">{PREORDER_SCHEDULE_EXCLUSION_LABELS[row.reason]}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
        {preview.excluded.length > PAGE_SIZE ? <ConsolePagination label="바꾸지 않는 배송 건 페이지" page={excludedPage} pageSize={PAGE_SIZE} total={preview.excluded.length} unit="건" onPageChange={setExcludedPage} /> : null}
        {preview.excludedTotal > preview.excluded.length ? <small className="text-xs text-muted-foreground">앞의 {preview.excluded.length.toLocaleString('ko-KR')}건만 보입니다. 건수는 사유별 합계를 확인해주세요.</small> : null}
      </div>
    </details> : null}

    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={pending || frozen}>
      <legend className="mb-1 font-medium">고객 안내</legend>
      <label className={FIELD}><span>고객 안내 제목</span>
        <Input form={form} value={title} maxLength={PREORDER_SCHEDULE_TITLE_MAX} required onChange={(event) => { setRequest(null); setTitle(event.target.value); }} />
      </label>
      <label className={FIELD}><span>고객 안내 내용</span>
        <Textarea form={form} value={body} maxLength={PREORDER_SCHEDULE_BODY_MAX} rows={4} required onChange={(event) => { setRequest(null); setBody(event.target.value); }} />
        <small className="text-xs font-normal text-muted-foreground">{body.length}/{PREORDER_SCHEDULE_BODY_MAX}자 · 앱 알림과 이메일에 같은 문구를 쓰고, 아래에 주문마다 날짜와 배송 건 번호가 붙습니다.
          {sample ? ` 예: "${preorderScheduleDateLine([sample.currentDate], [sample.newDate])}"` : ''}</small>
      </label>
    </fieldset>

    <div aria-live="polite">{pending ? <p className="text-muted-foreground" role="status">처리하고 있습니다…</p> : null}{error ? <p className="text-destructive" role="alert">{error.message}</p> : null}</div>
    <div className="flex flex-wrap items-center gap-2">
      {frozen ? <>
        <Button form={form} type="button" disabled={pending} onClick={check}>같은 요청 결과 확인</Button>
        <Button form={form} type="button" variant="outline" disabled={pending} onClick={() => apply(true)}>같은 내용으로 다시 확정</Button>
      </> : <Button className="h-auto min-h-8 whitespace-normal text-left" form={form} type="button"
        disabled={pending || !emailReady || tooMany || !selection.shipments || !title.trim() || !body.trim()} onClick={() => apply()}>
        일정 변경하고 주문 {selection.orders.toLocaleString('ko-KR')}건 안내
      </Button>}
      {error?.stale ? <Button form={form} type="button" variant="outline" disabled={pending} onClick={onStale}>대상 다시 미리보기</Button> : null}
      <Button form={form} type="button" variant="outline" disabled={pending || frozen} onClick={onBack}>조건 다시 입력</Button>
    </div>
  </div>;
}

/** 확정 결과: 주문마다 앱 알림·이메일(·SMS) 결과. 이메일 주소·연락처는 보이지 않는다. */
export function PreorderScheduleResultView({ change: initial }: { change: PreorderScheduleChange }) {
  const [change, setChange] = useState(initial);
  const [targetPage, setTargetPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const emailReady = change.emailEnabled;
  const sms = change.targets.some((target) => target.smsStatus);
  const retryable = change.targets.some((target) => target.retryable);
  const noEmail = change.targets.filter((target) => !target.hasEmail).length;
  function run(action: () => ReturnType<typeof readPreorderScheduleChangeAction>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) setChange(result.change); else setError(result.error);
    });
  }
  return <div className="flex min-w-0 flex-col gap-3" data-preorder-schedule-result="">
    <AdminNotice tone="success" title={`배송 건 ${change.shipmentCount.toLocaleString('ko-KR')}건의 발송 예정일을 ${dateLabel(change.expectedShipDate)}로 바꿨습니다`}>
      주문 {change.orderCount.toLocaleString('ko-KR')}건에 앱 알림을 보내고 이메일을 발송 대기열에 넣었습니다{change.smsQueued ? '(SMS는 수신 동의한 고객에게만)' : ''}. 제외한 배송 건 {change.excludedCount.toLocaleString('ko-KR')}건은 바꾸지 않았습니다.
    </AdminNotice>
    <p className="text-xs text-muted-foreground tabular-nums">{formatOrderDateTime(change.createdAt)} · {change.actorName ?? '운영자'} · 사유: {change.reason}</p>
    {noEmail ? <AdminNotice tone="warning">이메일이 없는 수신자 {noEmail.toLocaleString('ko-KR')}명은 앱 알림만 받았습니다.</AdminNotice> : null}
    <div className="w-full rounded-lg border">
      <Table className="min-w-[44rem]">
        <caption className="caption-top border-b px-2 py-2 text-left text-sm font-medium text-foreground">주문별 안내 결과 · {change.title}</caption>
        <TableHeader><TableRow className="bg-muted/50">
          <TableHead scope="col">주문</TableHead><TableHead scope="col">배송 건 · 일정</TableHead><TableHead scope="col">앱 알림</TableHead><TableHead scope="col">이메일</TableHead>
          {sms ? <TableHead scope="col">SMS</TableHead> : null}
        </TableRow></TableHeader>
        <TableBody>{page(change.targets, targetPage).map((target) => <TableRow key={target.id}>
          <TableCell className="align-top whitespace-normal"><a className="underline underline-offset-4" href={`/admin/sales/orders/${target.orderId}`} target="_blank" rel="noreferrer">{orderReferenceLabel(target.orderId, target.orderNumber)}</a><br />
            <small className="text-xs text-muted-foreground">{target.audience === 'recipient' ? '선물 받는 분' : '구매자'}{target.hasEmail ? '' : ' · 이메일 없음'}</small></TableCell>
          <TableCell className="align-top whitespace-normal"><ul className="flex flex-col gap-0.5">{target.shipments.map((shipment) => <li key={shipment.shipmentId} className="tabular-nums">{shipment.label} · {shipment.fromDate} → {shipment.toDate}</li>)}</ul></TableCell>
          <TableCell className="align-top"><AdminStatusBadge tone={statusTone('delayNoticeChannel', target.inAppStatus)}>{ORDER_DELAY_STATUS_LABELS[target.inAppStatus]}</AdminStatusBadge></TableCell>
          <TableCell className="align-top whitespace-normal"><AdminStatusBadge tone={statusTone('delayNoticeChannel', target.emailStatus)}>{target.emailStatus === 'sent' && target.emailProviderState === 'accepted' ? '공급자 접수' : ORDER_DELAY_STATUS_LABELS[target.emailStatus]}</AdminStatusBadge>
            {target.errorCode ? <p className="mt-1 text-xs text-destructive">{ORDER_DELAY_ERROR_LABELS[target.errorCode] ?? '발송 상태를 확인해주세요.'}</p> : null}</TableCell>
          {sms ? <TableCell className="align-top whitespace-normal">{target.smsStatus ? <>
            <AdminStatusBadge tone={statusTone('delayNoticeSms', target.smsStatus)}>{PREORDER_SCHEDULE_SMS_LABELS[target.smsStatus]}</AdminStatusBadge>
            {target.smsReason ? <p className="mt-1 text-xs text-muted-foreground">{PREORDER_SCHEDULE_SMS_REASON_LABELS[target.smsReason] ?? '발송 상태를 확인해주세요.'}</p> : null}
          </> : '—'}</TableCell> : null}
        </TableRow>)}</TableBody>
      </Table>
    </div>
    {change.targets.length > PAGE_SIZE ? <ConsolePagination label="안내 결과 페이지" page={targetPage} pageSize={PAGE_SIZE} total={change.targets.length} unit="명" onPageChange={setTargetPage} /> : null}
    <p className="text-xs text-muted-foreground">이메일의 &lsquo;공급자 접수&rsquo;는 수신함 도착 확인과 다릅니다. 이미 보낸 앱 알림·이메일은 다시 보내지 않으며, 같은 안내는 발송관리의 고객 지연 안내 이력에도 남습니다.</p>
    <div aria-live="polite">{pending ? <p className="text-muted-foreground" role="status">결과를 확인하고 있습니다…</p> : null}{error ? <p className="text-destructive" role="alert">{error}</p> : null}</div>
    <div className="flex flex-wrap gap-2">
      <Button form={form} type="button" variant="outline" disabled={pending} onClick={() => run(() => readPreorderScheduleChangeAction(change.id))}>안내 결과 새로고침</Button>
      {retryable ? <Button form={form} type="button" variant="outline" disabled={pending || !emailReady} onClick={() => run(() => retryPreorderScheduleEmailsAction(change.id))}>실패한 이메일만 재시도</Button> : null}
    </div>
  </div>;
}

/** 조건 입력: 새 발송 예정일·(옵션 선택 판매면) 대상 옵션·내부 변경 사유. */
function PreorderScheduleConditions({ variants, randomSale, variantId, date, reason, pending, error, onChange, onPreview }: {
  variants: AdminGoodsVariant[]; randomSale: boolean; variantId: string; date: string; reason: string; pending: boolean; error: string | null;
  onChange: (changes: { variantId?: string; date?: string; reason?: string }) => void; onPreview: () => void;
}) {
  const id = useId();
  const today = kstDay(new Date());
  const ready = Boolean(date) && date >= today && Boolean(reason.trim()) && reason.trim().length <= PREORDER_SCHEDULE_REASON_MAX;
  return <div className="flex min-w-0 flex-col gap-4" data-preorder-schedule-conditions="">
    {!randomSale && variants.length > 1 ? <div className={FIELD}>
      <label className="font-medium" htmlFor={`${id}-variant`}>대상 옵션</label>
      <NativeSelect className="w-full sm:w-fit" form={form} id={`${id}-variant`} value={variantId} disabled={pending} onChange={(event) => onChange({ variantId: event.target.value })}>
        <option value="">상품 전체(모든 옵션)</option>
        {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name} · {variant.code}{variant.archivedAt ? ' (사용 중지)' : ''}</option>)}
      </NativeSelect>
      <small className="text-xs text-muted-foreground">옵션마다 발송 일정이 다를 때만 옵션 하나로 좁힙니다.</small>
    </div> : randomSale ? <p className="text-sm text-muted-foreground">랜덤 판매 상품은 옵션마다 일정이 다르면 배정 옵션이 드러나므로 상품 전체의 예약 주문을 같은 날짜로 바꿉니다.</p> : null}
    <label className={FIELD}><span>새 발송 예정일</span>
      <Input className="w-44" form={form} type="date" min={today} value={date} required disabled={pending} onChange={(event) => onChange({ date: event.target.value })} />
    </label>
    <label className={FIELD}><span>변경 사유(내부 기록)</span>
      <Textarea form={form} rows={2} maxLength={PREORDER_SCHEDULE_REASON_MAX} value={reason} required disabled={pending} placeholder="예: 공급처 입고 일정 변경(협조전 번호)"
        onChange={(event) => onChange({ reason: event.target.value })} />
      <small className="text-xs font-normal text-muted-foreground">배송 건마다 일정 변경 이력에 남고 고객에게는 보내지 않습니다.</small>
    </label>
    <div aria-live="polite">{pending ? <p className="text-muted-foreground" role="status">대상을 계산하고 있습니다…</p> : null}{error ? <p className="text-destructive" role="alert">{error}</p> : null}</div>
    <Button className="self-start" form={form} type="button" disabled={pending || !ready} onClick={onPreview}>대상 미리보기</Button>
  </div>;
}

/**
 * 예약판매 영역의 '예약 주문 발송 일정 변경·고객 안내'. 주문 관리 권한(sales.manage)이 있을 때만 그린다 — 서버 액션·RPC가 다시 확인한다.
 */
export function GoodsPreorderSchedulePanel({ goodId, variants, randomSale = false }: { goodId: string; variants: AdminGoodsVariant[]; randomSale?: boolean }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [conditions, setConditions] = useState({ variantId: '', date: '', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ changes?: PreorderScheduleChangeSummary[]; error?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const scopeVariants = useMemo(() => variants.filter((variant) => variant.goodId === goodId), [goodId, variants]);
  function preview() {
    setError(null);
    startTransition(async () => {
      const result = await previewPreorderScheduleChangeAction({ goodId, variantId: randomSale ? null : conditions.variantId || null, expectedShipDate: conditions.date });
      if (result.ok) setStep({ kind: 'preview', preview: result.preview, emailConfigured: result.emailConfigured, smsAvailable: result.smsAvailable });
      else setError(result.error);
    });
  }
  function loadHistory() {
    startTransition(async () => {
      const result = await listPreorderScheduleChangesAction(goodId);
      setHistory(result.ok ? { changes: result.changes } : { error: result.error });
    });
  }
  function openChange(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await readPreorderScheduleChangeAction(id);
      if (result.ok) { setStep({ kind: 'result', change: result.change }); setOpen(true); } else setHistory((current) => ({ ...current, error: result.error }));
    });
  }
  function close(next: boolean) {
    if (next || pending) return;
    setOpen(false);
    /* 닫았다 다시 열면 지난 미리보기를 쓰지 않는다(그 사이 주문이 바뀔 수 있다). 확정했으면 입력을 비우고 이력을 다시 읽는다. */
    if (step.kind === 'result') { setStep({ kind: 'form' }); setConditions({ variantId: '', date: '', reason: '' }); loadHistory(); }
    else if (step.kind === 'preview') setStep({ kind: 'form' });
  }
  return <div className="flex min-w-0 flex-col gap-3 border-t pt-4" data-preorder-schedule="">
    <h3 className="text-sm font-medium">예약 주문 발송 일정 변경·고객 안내</h3>
    <p className="text-sm text-muted-foreground">발송 예정일이 바뀌면 이 상품의 미출고 예약 주문 일정을 한 번에 바꾸고, 대상과 제외 사유를 미리 본 뒤 고객에게 앱 알림·이메일로 안내합니다.
      출고지시·발송된 배송 건은 바꾸지 않습니다. 배송 건 하나만 바꿀 때는 주문 상세의 예약 발송 일정을 씁니다.</p>
    <div className="flex flex-wrap gap-2">
      <Button form={form} type="button" onClick={() => { setError(null); setOpen(true); }}>발송 예정일 변경·안내</Button>
      <Button form={form} type="button" variant="outline" disabled={pending} onClick={loadHistory}>최근 일정 변경·안내 이력</Button>
    </div>
    {history?.error ? <p className="text-sm text-destructive" role="alert">{history.error}</p> : null}
    {history?.changes ? history.changes.length ? <ul className="m-0 flex list-none flex-col gap-1 p-0">{history.changes.map((change) => <li key={change.id}>
      <Button className="h-auto min-h-7 whitespace-normal text-left" form={form} type="button" size="sm" variant="ghost" disabled={pending} onClick={() => openChange(change.id)}>
        {formatOrderDateTime(change.createdAt)} · {dateLabel(change.expectedShipDate)}{change.variantName ? ` · ${change.variantName}` : ''} · 배송 건 {change.shipmentCount.toLocaleString('ko-KR')}건 · 주문 {change.orderCount.toLocaleString('ko-KR')}건 · {change.actorName ?? '운영자'}
      </Button>
    </li>)}</ul> : <p className="text-sm text-muted-foreground">이 상품의 일정 변경·안내 기록이 없습니다.</p> : null}
    <Dialog open={open} disablePointerDismissal={pending} onOpenChange={close}>
      <DialogContent className="max-h-[calc(100dvh-4rem)] overflow-y-auto sm:max-w-4xl" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>예약 주문 발송 일정 변경·고객 안내</DialogTitle>
          <DialogDescription>{step.kind === 'form' ? '새 발송 예정일과 변경 사유를 입력하고 대상을 미리 봅니다.' : step.kind === 'preview' ? '대상과 제외 사유, 고객에게 보낼 문구를 확인한 뒤 확정합니다.' : '안내 결과를 확인합니다.'}</DialogDescription>
        </DialogHeader>
        {step.kind === 'form' ? <PreorderScheduleConditions variants={scopeVariants} randomSale={randomSale} variantId={conditions.variantId} date={conditions.date}
          reason={conditions.reason} pending={pending} error={error} onChange={(changes) => { setError(null); setConditions((current) => ({ ...current, ...changes })); }} onPreview={preview} />
          : step.kind === 'preview' ? <PreorderSchedulePreviewStep key={step.preview.fingerprint} preview={step.preview} emailConfigured={step.emailConfigured} smsAvailable={step.smsAvailable}
            reason={conditions.reason.trim()} onBack={() => setStep({ kind: 'form' })} onStale={preview} onApplied={(change) => setStep({ kind: 'result', change })} />
            : <PreorderScheduleResultView key={step.change.id} change={step.change} />}
      </DialogContent>
    </Dialog>
  </div>;
}
