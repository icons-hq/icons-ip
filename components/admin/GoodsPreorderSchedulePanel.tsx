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
  PREORDER_SCHEDULE_BODY_MAX, PREORDER_SCHEDULE_EXCLUSION_LABELS, PREORDER_SCHEDULE_EXCLUSION_REASONS, PREORDER_SCHEDULE_POLICY_BLOCK_LABELS,
  PREORDER_SCHEDULE_REASON_MAX, PREORDER_SCHEDULE_SMS_LABELS, PREORDER_SCHEDULE_SMS_REASON_LABELS, PREORDER_SCHEDULE_TITLE_MAX,
  defaultPreorderScheduleCopy, defaultPreorderScheduleExclusions, preorderScheduleDateDiffers, preorderScheduleDateLine, preorderScheduleSelection,
  type PreorderScheduleChange, type PreorderScheduleChangeSummary, type PreorderSchedulePolicyMode, type PreorderSchedulePreview,
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
/** 접수 중 조건을 바꿀 수 있는 계정 주매니저·통합 매니저 본인에게는 '주매니저가 바꿔야'가 아니라 막힌 이유를 말한다. */
export const PREORDER_SCHEDULE_POLICY_ACK_OWN = '이 날짜로는 접수 중 예약 조건을 바꿀 수 없어(위 안내) 지금은 그대로 두고, 새 주문에는 옛 날짜가 안내됩니다.';
export const PREORDER_SCHEDULE_POLICY_ACK_KEEP = '접수 중 예약 조건을 바꾸지 않으면 새 주문에는 옛 날짜가 안내됩니다.';
export const PREORDER_SCHEDULE_POLICY_ACK = '접수 중 조건은 계정 주매니저·통합 매니저가 새 날짜로 바꿔야 새 주문에도 같은 날짜가 안내됩니다.';
/** 접수 중 조건을 바꾸지 않을 때의 안내. 보는 사람이 바꿀 수 있는지(주매니저 본인)·이 날짜로 막혔는지에 따라 문구가 갈린다. */
export function preorderSchedulePolicyAckText(canReplacePolicies: boolean, policyBlocked: boolean): string {
  return !canReplacePolicies ? PREORDER_SCHEDULE_POLICY_ACK : policyBlocked ? PREORDER_SCHEDULE_POLICY_ACK_OWN : PREORDER_SCHEDULE_POLICY_ACK_KEEP;
}
/** 접수 중인 예약 조건을 날짜별로 묶는다. 랜덤 판매처럼 옵션이 많아도 한 줄로 읽히게 날짜마다 옵션 이름은 셋까지 보인다. */
export function openPolicySummary(policies: readonly { variantName: string; expectedShipDate: string }[]): string {
  const byDate = new Map<string, string[]>();
  for (const policy of policies) byDate.set(policy.expectedShipDate, [...(byDate.get(policy.expectedShipDate) ?? []), policy.variantName]);
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, names]) =>
    `${names.slice(0, 3).join('·')}${names.length > 3 ? ` 외 ${names.length - 3}개` : ''} ${dateLabel(date)}`).join(' · ');
}

/** 미리보기에서 확정해 온 결과 화면만 아는 값. 발송관리 이력에서 연 결과에는 없어 기본 문구를 쓴다. */
export interface PreorderScheduleResultContext {
  /** 미리보기 '바꾸지 않는 배송 건'(조건상 제외)의 건수. */
  excludedTotal: number;
  /** 보는 사람이 접수 중 예약 조건을 바꿀 수 있는지, 이 날짜로는 막혔는지. */
  canReplacePolicies: boolean; policyBlocked: boolean;
}

type Step =
  | { kind: 'form' }
  | { kind: 'preview'; preview: PreorderSchedulePreview; emailConfigured: boolean; smsAvailable: boolean }
  | { kind: 'result'; change: PreorderScheduleChange; context?: PreorderScheduleResultContext };

/** 미리보기: 대상·제외 사유·접수 중 조건·고객 문구를 확인하고 확정한다. */
export function PreorderSchedulePreviewStep({ preview, emailConfigured, smsAvailable, initialReason = '', onReasonChange, onBack, onApplied, onStale }: {
  preview: PreorderSchedulePreview; emailConfigured: boolean; smsAvailable: boolean; initialReason?: string;
  /** 조건으로 돌아갔다 다시 미리봐도 입력한 사유를 잃지 않게 바깥에 맡긴다. */
  onReasonChange?: (reason: string) => void;
  onBack: () => void; onApplied: (change: PreorderScheduleChange) => void; onStale: () => void;
}) {
  const copy = defaultPreorderScheduleCopy(preview.goodName);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => defaultPreorderScheduleExclusions(preview));
  const [reason, setReason] = useState(initialReason);
  const [title, setTitle] = useState(copy.title);
  const [body, setBody] = useState(copy.body);
  const policyReplaceable = preview.openPolicies.length > 0 && preview.canReplacePolicies && !preview.policyBlockReason;
  const [replacePolicies, setReplacePolicies] = useState(policyReplaceable);
  const [acknowledged, setAcknowledged] = useState(false);
  const [targetPage, setTargetPage] = useState(1);
  const [excludedPage, setExcludedPage] = useState(1);
  const [error, setError] = useState<{ message: string; uncertain?: boolean; stale?: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  /* 같은 미리보기의 확정은 같은 요청 UUID다. 연결이 끊겨도 같은 요청으로만 다시 보내고 결과를 먼저 읽는다. */
  const [request, setRequest] = useState<PreorderScheduleApplyInput | null>(null);
  const selection = preorderScheduleSelection(preview, excluded);
  const emailReady = preview.emailEnabled && emailConfigured;
  const overLimit = preview.targets.length > preview.limit;
  const tooMany = selection.shipments > preview.limit;
  const individual = preview.targets.filter((target) => target.individuallyChanged).length;
  const noticeOnly = preview.targets.filter((target) => target.noticeOnly).length;
  const mixed = preview.targets.some((target) => target.otherPreorder);
  const differing = preview.targets.filter((target) => preorderScheduleDateDiffers(preview, target)).length;
  const sample = preview.targets.find((target) => !target.noticeOnly) ?? preview.targets[0];
  const policyMode: PreorderSchedulePolicyMode | null = !preview.openPolicies.length ? null : policyReplaceable && replacePolicies ? 'replace' : acknowledged ? 'acknowledge' : null;
  const policyDecided = !preview.openPolicies.length || policyMode !== null;
  const frozen = Boolean(request) && Boolean(error?.uncertain);
  const allChecked = excluded.size === 0;
  /* 확정 버튼이 눌리지 않는 이유를 버튼 곁에 한 줄로 밝힌다(처리 중·결과 모름 단계는 제외). */
  const confirmBlockedReason = pending || frozen ? null
    : !emailReady ? '이메일 발송 설정이 준비되지 않아 확정할 수 없습니다.'
    : tooMany ? `선택이 한 번에 바꿀 수 있는 ${preview.limit.toLocaleString('ko-KR')}건을 넘었습니다.`
    : !selection.shipments ? '바꿀 배송 건을 하나 이상 선택해주세요.'
    : !policyDecided ? (preview.policyBlockReason ? '접수 중 예약 조건은 이 날짜로 바꿀 수 없습니다. 위의 ‘확인했습니다’를 체크해야 확정할 수 있습니다.' : '접수 중 예약 조건을 새 날짜로 교체하거나 위의 ‘확인했습니다’를 체크해야 확정할 수 있습니다.')
    : !reason.trim() ? '변경 사유를 입력해주세요.'
    : !title.trim() || !body.trim() ? '고객 안내 제목과 내용을 입력해주세요.' : null;
  function edit() { setRequest(null); setError(null); }
  function toggle(shipmentId: string, checked: boolean) {
    edit();
    setExcluded((current) => { const next = new Set(current); if (checked) next.delete(shipmentId); else next.add(shipmentId); return next; });
  }
  function apply(retrySame = false) {
    if (pending) return;
    const payload: PreorderScheduleApplyInput = retrySame && request ? request : {
      requestId: crypto.randomUUID(), goodId: preview.goodId, variantId: preview.variantId, expectedShipDate: preview.expectedShipDate,
      reason, title, body, fingerprint: preview.fingerprint, excludedShipmentIds: selection.excludedShipmentIds, policyMode,
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
      <p className="text-base font-medium text-foreground">{selection.shipments ? `예약 주문 ${selection.orders.toLocaleString('ko-KR')}건 일정도 바꾸고 안내할까요?` : preview.targets.length ? '지금 선택한 배송 건이 없어 바꿀 일정이 없습니다.' : '바꿀 예약 배송 건이 없습니다.'}</p>
      {selection.shipments ? <p className="text-muted-foreground">
        {preview.variantName ? `옵션 '${preview.variantName}'의 ` : ''}미출고 예약 배송 건 {(selection.shipments - selection.noticeOnly).toLocaleString('ko-KR')}건의 발송 예정일을 {dateLabel(preview.expectedShipDate)}로 바꾸고
        {selection.noticeOnly ? `(따로 바꿔 둔 ${selection.noticeOnly.toLocaleString('ko-KR')}건은 일정 그대로 안내만)` : ''},
        주문 {selection.orders.toLocaleString('ko-KR')}건의 구매자(선물 주문은 받는 분 포함)에게 앱 알림·이메일을 보냅니다. 주문 당시 예정일은 보존하고 배송 건마다 변경 이력이 남습니다.
      </p> : preview.targets.length ? <p className="text-muted-foreground">아래 표에서 바꿀 배송 건을 하나 이상 선택해주세요.</p> : null}
    </div>
    {!emailReady ? <AdminNotice role="status" tone="danger">{!preview.emailEnabled ? '지연 안내 이메일 발송 설정이 꺼져 있습니다.' : '이메일 공급자 또는 발송 서명 설정이 준비되지 않았습니다.'} 두 채널이 준비되어야 일정 변경과 안내를 진행할 수 있습니다.</AdminNotice> : null}

    {preview.openPolicies.length ? <div className="flex min-w-0 flex-col gap-2 rounded-lg border p-3" data-preorder-schedule-policies="">
      <p className="font-medium">접수 중인 예약 조건 · {openPolicySummary(preview.openPolicies)}</p>
      <p className="text-muted-foreground">이 조건 그대로면 이후 새 주문은 옛 날짜로 약속됩니다.</p>
      {policyReplaceable ? <label className="flex items-start gap-2">
        <input form={form} type="checkbox" checked={replacePolicies} disabled={pending || frozen} onChange={(event) => { edit(); setReplacePolicies(event.target.checked); }} />
        <span>접수 중 예약 조건도 {dateLabel(preview.expectedShipDate)}로 교체 — 남은 물량·접수 기간을 이어받은 새 버전으로 활성화합니다{preview.randomSale ? '(랜덤 판매는 모든 옵션)' : ''}.</span>
      </label> : null}
      {preview.policyBlockReason ? <p className="text-warning">{PREORDER_SCHEDULE_POLICY_BLOCK_LABELS[preview.policyBlockReason]}</p> : null}
      {!policyReplaceable || !replacePolicies ? <label className="flex items-start gap-2" data-preorder-schedule-policy-ack="">
        <input form={form} type="checkbox" checked={acknowledged} disabled={pending || frozen} onChange={(event) => { edit(); setAcknowledged(event.target.checked); }} />
        <span>{preorderSchedulePolicyAckText(preview.canReplacePolicies, Boolean(preview.policyBlockReason))} 확인했습니다(기록에 남습니다).</span>
      </label> : null}
    </div> : null}

    {individual ? <AdminNotice tone="info">운영자가 주문 상세에서 따로 바꾼 배송 건 {individual.toLocaleString('ko-KR')}건이 포함되어 있습니다(표의 &lsquo;개별 변경&rsquo;).
      {noticeOnly ? ` 그중 ${noticeOnly.toLocaleString('ko-KR')}건은 이미 새 날짜라 일정은 그대로 두고 고객에게 안내만 합니다(고객은 아직 모릅니다).` : ''} 빼려면 선택을 해제하세요.</AdminNotice> : null}
    {mixed ? <AdminNotice tone="info">다른 예약 상품과 함께 보내는 배송 건은 앞당기는 변경이면 바꾸지 않고, 늦출 때는 그 상품의 주문 당시 예정일 이상으로 바꿉니다.
      {differing ? ` 그래서 새 예정일이 입력한 날짜와 다른 ${differing.toLocaleString('ko-KR')}건은 표에 '새 예정일 다름'으로 표시하고 기본으로 빼 두었습니다.` : ''}</AdminNotice> : null}
    {overLimit ? <AdminNotice tone="warning" title={`바꿀 배송 건이 ${preview.targets.length.toLocaleString('ko-KR')}건이라 한 번에 바꿀 수 있는 ${preview.limit.toLocaleString('ko-KR')}건을 넘습니다`}>
      주문번호 순으로 앞의 {preview.limit.toLocaleString('ko-KR')}건을 먼저 골라 두었습니다. 확정한 뒤 다시 미리 보면 바뀐 건은 빠지고 남은 건만 이어서 바꿀 수 있습니다
      {!preview.randomSale && !preview.variantName && preview.variantCount > 1 ? '(옵션별로 나누어 바꿀 수도 있습니다)' : ''}.
    </AdminNotice> : null}
    {tooMany ? <AdminNotice role="alert" tone="danger">한 번에 바꿀 수 있는 배송 건은 {preview.limit.toLocaleString('ko-KR')}건까지입니다. 선택을 줄이거나 [앞의 {preview.limit.toLocaleString('ko-KR')}건만 고르기]를 눌러주세요.</AdminNotice> : null}
    {smsAvailable && preview.smsEnabled ? <p className="text-sm text-muted-foreground" data-preorder-schedule-sms="">SMS: 휴대폰 번호를 인증하고 SMS 수신에 동의한 고객에게는 같은 안내를 문자로도 한 번 보냅니다.</p> : null}

    {preview.targets.length ? <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm"><input form={form} type="checkbox" checked={allChecked} disabled={pending || frozen}
          onChange={(event) => { edit(); setExcluded(event.target.checked ? new Set() : new Set(preview.targets.map((target) => target.shipmentId))); }} /> 전체 선택</label>
        {overLimit || differing ? <Button form={form} type="button" size="sm" variant="outline" disabled={pending || frozen} onClick={() => { edit(); setExcluded(defaultPreorderScheduleExclusions(preview)); }}>
          {overLimit ? `앞의 ${preview.limit.toLocaleString('ko-KR')}건만 고르기` : '처음 선택으로 되돌리기'}</Button> : null}
      </div>
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
            <TableCell className="align-top whitespace-normal tabular-nums">{target.noticeOnly
              ? <>{target.currentDate} <small className="text-xs text-muted-foreground">(고객 안내: {target.knownDate} → {target.newDate})</small></>
              : <>{target.currentDate} → <strong className="font-medium">{target.newDate}</strong></>}</TableCell>
            <TableCell className="align-top whitespace-normal"><div className="flex flex-wrap gap-1">
              {target.noticeOnly ? <AdminStatusBadge tone="info">안내만(일정 그대로)</AdminStatusBadge> : null}
              {target.individuallyChanged ? <AdminStatusBadge tone="warning">개별 변경</AdminStatusBadge> : null}
              {preorderScheduleDateDiffers(preview, target) ? <AdminStatusBadge tone="warning">새 예정일 다름</AdminStatusBadge> : null}
              {target.otherPreorder ? <AdminStatusBadge tone="info">다른 예약 상품 포함</AdminStatusBadge> : null}
              {paymentLabel(target.orderStatus, target.paymentMethod) ? <AdminStatusBadge tone="neutral">{paymentLabel(target.orderStatus, target.paymentMethod)}</AdminStatusBadge> : null}
            </div></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </div>
      {preview.targets.length > PAGE_SIZE ? <ConsolePagination label="바꿀 배송 건 페이지" page={targetPage} pageSize={PAGE_SIZE} total={preview.targets.length} unit="건" onPageChange={setTargetPage} /> : null}
    </div> : preview.excludedTotal ? <AdminNotice tone="neutral">바꾸지 않는 배송 건의 사유는 아래에서 확인할 수 있습니다.</AdminNotice> : null}

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
      <legend className="mb-1 font-medium">변경 사유와 고객 안내</legend>
      <label className={FIELD}><span>변경 사유(내부 기록)</span>
        <Textarea form={form} rows={2} maxLength={PREORDER_SCHEDULE_REASON_MAX} value={reason} required placeholder="예: 공급처 입고 일정 변경(협조전 번호)"
          onChange={(event) => { edit(); setReason(event.target.value); onReasonChange?.(event.target.value); }} />
        <small className="text-xs font-normal text-muted-foreground">배송 건마다 일정 변경 이력에 남고 고객에게는 보내지 않습니다.</small>
      </label>
      <label className={FIELD}><span>고객 안내 제목</span>
        <Input form={form} value={title} maxLength={PREORDER_SCHEDULE_TITLE_MAX} required onChange={(event) => { edit(); setTitle(event.target.value); }} />
      </label>
      <label className={FIELD}><span>고객 안내 내용</span>
        <Textarea form={form} value={body} maxLength={PREORDER_SCHEDULE_BODY_MAX} rows={4} required onChange={(event) => { edit(); setBody(event.target.value); }} />
        <small className="text-xs font-normal text-muted-foreground">{body.length}/{PREORDER_SCHEDULE_BODY_MAX}자 · 앱 알림과 이메일에 같은 문구를 쓰고, 아래에 주문마다 날짜(고객이 마지막으로 안내받은 날짜 → 새 날짜)와 배송 건 번호가 붙습니다.
          {sample ? ` 예: "${preorderScheduleDateLine([sample.knownDate], [sample.newDate])}"` : ''}</small>
      </label>
    </fieldset>

    <div aria-live="polite">{pending ? <p className="text-muted-foreground" role="status">처리하고 있습니다…</p> : null}{error ? <p className="text-destructive" role="alert">{error.message}</p> : null}</div>
    <div className="flex flex-wrap items-center gap-2">
      {frozen ? <>
        <Button form={form} type="button" disabled={pending} onClick={check}>같은 요청 결과 확인</Button>
        <Button form={form} type="button" variant="outline" disabled={pending} onClick={() => apply(true)}>같은 내용으로 다시 확정</Button>
      </> : <Button className="h-auto min-h-8 whitespace-normal text-left" form={form} type="button"
        disabled={pending || !emailReady || tooMany || !selection.shipments || !reason.trim() || !title.trim() || !body.trim() || !policyDecided} onClick={() => apply()}>
        일정 변경하고 주문 {selection.orders.toLocaleString('ko-KR')}건 안내
      </Button>}
      {confirmBlockedReason ? <p className="text-sm text-muted-foreground" role="status" data-preorder-schedule-blocked="">{confirmBlockedReason}</p> : null}
      {error?.stale ? <Button form={form} type="button" variant="outline" disabled={pending} onClick={onStale}>대상 다시 미리보기</Button> : null}
      <Button form={form} type="button" variant="outline" disabled={pending || frozen} onClick={onBack}>조건 다시 입력</Button>
    </div>
  </div>;
}

/** 확정 결과: 주문마다 앱 알림·이메일(·SMS) 결과. 이메일 주소·연락처는 보이지 않는다. 발송관리 지연 탭 이력에서도 같은 화면으로 연다. */
export function PreorderScheduleResultView({ change: initial, context }: { change: PreorderScheduleChange; context?: PreorderScheduleResultContext }) {
  const [change, setChange] = useState(initial);
  const [targetPage, setTargetPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const emailReady = change.emailEnabled;
  const sms = change.targets.some((target) => target.smsStatus);
  const retryable = change.targets.some((target) => target.retryable);
  /* 미리보기의 '바꾸지 않는 배송 건'(조건상 제외)과 확정 때 선택을 해제한 건을 합쳐 같은 기준으로 센다. 이력에서 연 결과는 선택을 해제한 건만 안다. */
  const notChanged = context
    ? (context.excludedTotal + change.excludedCount ? { total: context.excludedTotal + change.excludedCount, detail: ` (조건상 제외 ${context.excludedTotal.toLocaleString('ko-KR')}건 · 선택 해제 ${change.excludedCount.toLocaleString('ko-KR')}건)` } : null)
    : change.excludedCount ? { total: change.excludedCount, detail: ' (확정 때 선택을 해제한 배송 건)' } : null;
  const noEmail = change.targets.filter((target) => !target.hasEmail).length;
  function run(action: () => ReturnType<typeof readPreorderScheduleChangeAction>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) setChange(result.change); else setError(result.error);
    });
  }
  return <div className="flex min-w-0 flex-col gap-3" data-preorder-schedule-result="">
    <AdminNotice tone="success" title={`배송 건 ${change.shipmentCount.toLocaleString('ko-KR')}건을 ${dateLabel(change.expectedShipDate)} 일정으로 안내했습니다`}>
      주문 {change.orderCount.toLocaleString('ko-KR')}건에 앱 알림을 보내고 이메일을 발송 대기열에 넣었습니다{change.smsQueued ? '(SMS는 수신 동의한 고객에게만)' : ''}{notChanged ? `. 바꾸지 않은 배송 건은 ${notChanged.total.toLocaleString('ko-KR')}건입니다${notChanged.detail}.` : '.'}
    </AdminNotice>
    {change.policyAction === 'replaced' ? <AdminNotice tone="info">접수 중이던 예약 조건({openPolicySummary(change.policies)})을 {dateLabel(change.expectedShipDate)} 새 버전으로 바꿨습니다. 이후 새 주문도 같은 날짜로 안내됩니다.</AdminNotice>
      : change.policyAction === 'acknowledged' ? <AdminNotice tone="warning">접수 중인 예약 조건({openPolicySummary(change.policies)})은 바꾸지 않았습니다. {context ? preorderSchedulePolicyAckText(context.canReplacePolicies, context.policyBlocked) : PREORDER_SCHEDULE_POLICY_ACK}</AdminNotice> : null}
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
          <TableCell className="align-top whitespace-normal"><ul className="flex flex-col gap-0.5">{target.shipments.map((shipment) => <li key={shipment.shipmentId} className="tabular-nums">
            {shipment.label} · {shipment.noticeOnly ? `${shipment.toDate} (일정 그대로, 안내만)` : `${shipment.fromDate} → ${shipment.toDate}`}</li>)}</ul></TableCell>
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

/** 조건 입력: 새 발송 예정일·(옵션 선택 판매면) 대상 옵션. 변경 사유·고객 문구는 미리보기에서 대상과 함께 확인한다. */
function PreorderScheduleConditions({ variants, randomSale, variantId, date, pending, error, onChange, onPreview }: {
  variants: AdminGoodsVariant[]; randomSale: boolean; variantId: string; date: string; pending: boolean; error: string | null;
  onChange: (changes: { variantId?: string; date?: string }) => void; onPreview: () => void;
}) {
  const id = useId();
  const today = kstDay(new Date());
  const ready = Boolean(date) && date >= today;
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
    <div aria-live="polite">{pending ? <p className="text-muted-foreground" role="status">대상을 계산하고 있습니다…</p> : null}{error ? <p className="text-destructive" role="alert">{error}</p> : null}</div>
    <Button className="self-start" form={form} type="button" disabled={pending || !ready} onClick={onPreview}>대상 미리보기</Button>
  </div>;
}

/** 예약 조건을 새 날짜로 저장·활성화한 직후 '기존 예약 주문도 이 날짜로' 미리보기를 바로 여는 제안(F2 원래 요청의 입구). */
export interface PreorderScheduleSuggestion { expectedShipDate: string; variantId: string | null; key: number }

/**
 * 예약판매 영역의 '예약 주문 발송 일정 변경·고객 안내'. 주문 관리 권한(sales.manage)이 있을 때만 그린다 — 서버 액션·RPC가 다시 확인한다.
 */
export function GoodsPreorderSchedulePanel({ goodId, variants, randomSale = false, suggestion = null }: {
  goodId: string; variants: AdminGoodsVariant[]; randomSale?: boolean; suggestion?: PreorderScheduleSuggestion | null;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [conditions, setConditions] = useState({ variantId: '', date: '' });
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ changes?: PreorderScheduleChangeSummary[]; error?: string } | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const scopeVariants = useMemo(() => variants.filter((variant) => variant.goodId === goodId), [goodId, variants]);
  const activeSuggestion = suggestion && suggestion.key !== dismissed ? suggestion : null;
  function runPreview(next: { variantId: string; date: string }) {
    setError(null);
    startTransition(async () => {
      const result = await previewPreorderScheduleChangeAction({ goodId, variantId: randomSale ? null : next.variantId || null, expectedShipDate: next.date });
      if (result.ok) setStep({ kind: 'preview', preview: result.preview, emailConfigured: result.emailConfigured, smsAvailable: result.smsAvailable });
      else setError(result.error);
    });
  }
  function openSuggestion(value: PreorderScheduleSuggestion) {
    const next = { variantId: value.variantId ?? '', date: value.expectedShipDate };
    setConditions(next); setReason(`예약 조건 발송 예정일 변경(${value.expectedShipDate})`); setDismissed(value.key); setOpen(true);
    runPreview(next);
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
    if (step.kind === 'result') { setStep({ kind: 'form' }); setConditions({ variantId: '', date: '' }); setReason(''); loadHistory(); }
    else if (step.kind === 'preview') setStep({ kind: 'form' });
  }
  return <div className="flex min-w-0 flex-col gap-3 border-t pt-4" data-preorder-schedule="">
    <h3 className="text-sm font-medium">예약 주문 발송 일정 변경·고객 안내</h3>
    <p className="text-sm text-muted-foreground">발송 예정일이 바뀌면 이 상품의 미출고 예약 주문 일정을 한 번에 바꾸고, 대상과 제외 사유를 미리 본 뒤 고객에게 앱 알림·이메일로 안내합니다.
      출고지시·발송된 배송 건은 바꾸지 않습니다. 배송 건 하나만 바꿀 때는 주문 상세의 예약 발송 일정을 씁니다.</p>
    {activeSuggestion ? <AdminNotice tone="info" title={`예약 조건을 ${dateLabel(activeSuggestion.expectedShipDate)} 발송으로 활성화했습니다`}>
      <span>이미 받은 예약 주문의 일정도 이 날짜로 바꾸고 안내할까요? </span>
      <span className="mt-2 flex flex-wrap gap-2">
        <Button form={form} type="button" size="sm" disabled={pending} onClick={() => openSuggestion(activeSuggestion)}>예약 주문도 이 날짜로 미리보기</Button>
        <Button form={form} type="button" size="sm" variant="outline" disabled={pending} onClick={() => setDismissed(activeSuggestion.key)}>나중에</Button>
      </span>
    </AdminNotice> : null}
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
          <DialogDescription>{step.kind === 'form' ? '새 발송 예정일을 입력하고 대상을 미리 봅니다.' : step.kind === 'preview' ? '대상과 제외 사유, 접수 중인 예약 조건, 고객에게 보낼 문구를 확인한 뒤 확정합니다.' : '안내 결과를 확인합니다.'}</DialogDescription>
        </DialogHeader>
        {step.kind === 'form' ? <PreorderScheduleConditions variants={scopeVariants} randomSale={randomSale} variantId={conditions.variantId} date={conditions.date}
          pending={pending} error={error} onChange={(changes) => { setError(null); setConditions((current) => ({ ...current, ...changes })); }} onPreview={() => runPreview(conditions)} />
          : step.kind === 'preview' ? <PreorderSchedulePreviewStep key={step.preview.fingerprint} preview={step.preview} emailConfigured={step.emailConfigured} smsAvailable={step.smsAvailable}
            initialReason={reason} onReasonChange={setReason} onBack={() => setStep({ kind: 'form' })} onStale={() => runPreview(conditions)} onApplied={(change) => setStep({ kind: 'result', change, context: { excludedTotal: step.preview.excludedTotal, canReplacePolicies: step.preview.canReplacePolicies, policyBlocked: Boolean(step.preview.policyBlockReason) } })} />
            : <PreorderScheduleResultView key={step.change.id} change={step.change} context={step.context} />}
      </DialogContent>
    </Dialog>
  </div>;
}
