'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  confirmClaimReturnIntakeAction,
  previewClaimReturnIntakeAction,
  type ClaimReturnIntakePreview,
} from '@/app/admin/claim-return-actions';
import { adminClaimPreviewHref } from '@/lib/admin/claims';
import {
  RETURN_INTAKE_FIELD_LABELS,
  RETURN_INTAKE_FIELDS,
  RETURN_INTAKE_OUTCOME_LABELS,
  RETURN_INTAKE_ROW_LIMIT,
  RETURN_INTAKE_STATUS_LABELS,
  returnIntakeErrorText,
  type ReturnIntakeColumns,
  type ReturnIntakeConfirmResult,
} from '@/lib/admin/claim-return-intake';
import { RETURN_PICKUP_STATE_LABELS, returnPickupErrorLabel, type ClaimReturnOperations } from '@/lib/admin/claim-return-pickup';
import { formatOrderDateTime } from '@/lib/orders';
import { orderClaimReferenceLabel } from '@/lib/orders/claims';
import { AdminCountCard } from '@/components/admin/console/AdminCountCard';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/admin/kit/ui/alert-dialog';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';

const NOTE = 'text-muted-foreground';
const SECTION = 'flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground';

/*
 * 반품·교환 목록 위 운영 칸(QNA-032·QNA-034·ADR-0034). 스위치가 꺼져 있으면 아무것도 그리지 않는다(목록은 지금과 같다).
 * - 자동 수거 실패: 택배사가 회수 접수·취소를 받지 않은 회수 묶음 수와 목록. 요청번호를 누르면 상세에서 다시 접수한다.
 * - 반품입고 회신 업로드: 창고 반품입고 파일을 열 이름 대응표로 읽어 회수 묶음에 맞춘 뒤(등록 전 확인), 확인창을 거쳐 입고완료로 확정한다.
 */
export function ClaimReturnOperationsPanel({ operations }: { operations: ClaimReturnOperations }) {
  if (!operations.pickup.enabled && !operations.intake.enabled) return null;
  return <div className="flex min-w-0 flex-col gap-3 text-sm text-foreground" data-claim-return-operations="">
    {operations.pickup.enabled ? <PickupFailures pickup={operations.pickup} /> : null}
    {operations.intake.enabled ? <ReturnIntakeUpload columns={operations.intake.columns} /> : null}
  </div>;
}

function PickupFailures({ pickup }: { pickup: Extract<ClaimReturnOperations['pickup'], { enabled: true }> }) {
  return <section aria-label="반품 자동 회수 접수" className={SECTION} data-claim-return-pickups="">
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-44"><AdminCountCard count={pickup.failed} label="자동 수거 실패" tone={pickup.failed ? 'danger' : 'default'} /></div>
      <p className={NOTE}>반품·교환을 승인하면 회수 계약 출고지는 몇 분 안에 택배사에 회수를 접수합니다. 접수 대기 {pickup.pending.toLocaleString('ko-KR')}건.</p>
    </div>
    {pickup.items.length ? <div className="w-full rounded-lg border">
      <Table>
        <caption className="caption-top border-b px-2 py-2 text-left text-sm font-medium text-foreground">자동 수거 실패 — 요청번호를 눌러 상세에서 다시 접수하세요</caption>
        <TableHeader><TableRow className="bg-muted/50">
          <TableHead scope="col">요청번호</TableHead><TableHead scope="col">주문번호</TableHead><TableHead scope="col">상태</TableHead>
          <TableHead scope="col">이유</TableHead><TableHead scope="col">시도</TableHead><TableHead scope="col">마지막 시도</TableHead>
        </TableRow></TableHeader>
        <TableBody>{pickup.items.map(item => <TableRow key={item.bundleId}>
          <TableCell><Link className="font-medium text-primary underline-offset-4 hover:underline" href={adminClaimPreviewHref(item.claimType, item.claimId)}>{orderClaimReferenceLabel(item.reference)}</Link></TableCell>
          <TableCell className="tabular-nums">{item.orderNumber ?? '-'}</TableCell>
          <TableCell>{RETURN_PICKUP_STATE_LABELS[item.state]}</TableCell>
          <TableCell className="whitespace-normal">{returnPickupErrorLabel(item.lastErrorCode) ?? '-'}</TableCell>
          <TableCell className="tabular-nums">{item.attempts.toLocaleString('ko-KR')}회</TableCell>
          <TableCell className="tabular-nums">{formatOrderDateTime(item.updatedAt)}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div> : null}
    {pickup.failed > pickup.items.length ? <p className={NOTE}>오래된 {pickup.items.length}건만 보입니다.</p> : null}
  </section>;
}

function ReturnIntakeUpload({ columns }: { columns: ReturnIntakeColumns }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ClaimReturnIntakePreview | null>(null);
  const [operationId, setOperationId] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ReturnIntakeConfirmResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [checking, startCheck] = useTransition();
  const [confirming, startConfirm] = useTransition();
  const busy = checking || confirming;
  const matched = preview?.rows.filter(row => row.status === 'matched' && row.bundleId) ?? [];

  function reset() { setPreview(null); setResult(null); setError(''); }
  function formData() {
    const data = new FormData();
    if (file) data.set('file', file);
    data.set('filePassword', passwordInput.current?.value ?? '');
    return data;
  }
  function check() {
    if (!file || busy) { if (!file) setError('반품입고 회신 파일을 골라주세요.'); return; }
    reset();
    startCheck(async () => {
      try {
        const response = await previewClaimReturnIntakeAction(formData());
        if (response.preview) { setPreview(response.preview); setOperationId(crypto.randomUUID()); }
        else setError(response.error ?? '반품입고 회신을 읽지 못했습니다.');
      } catch {
        setError('반품입고 회신을 확인하지 못했습니다. 잠시 후 다시 확인해주세요.');
      }
    });
  }
  function confirm() {
    if (!preview || !matched.length || busy) return;
    const data = formData();
    data.set('sha256', preview.sha256);
    data.set('operationId', operationId);
    data.set('selection', JSON.stringify(matched.map(row => ({ rowNumber: row.rowNumber, bundleId: row.bundleId }))));
    setConfirmOpen(false);
    startConfirm(async () => {
      try {
        const response = await confirmClaimReturnIntakeAction(data);
        if (response.result) { setResult(response.result); setPreview(null); router.refresh(); }
        else setError(response.error ?? '입고 확정 결과를 확인하지 못했습니다.');
      } catch {
        setError('입고 확정 결과를 확인하지 못했습니다. 같은 파일로 다시 확정하면 이미 기록된 줄은 그대로 둡니다.');
      }
    });
  }

  return <section aria-label="반품입고 회신 업로드" className={SECTION} data-claim-return-intake="">
    <h2 className="text-base font-medium text-foreground">반품입고 회신 업로드</h2>
    <p className={NOTE}>
      창고의 반품입고 회신 파일을 그대로 올리면 회수 송장 또는 주문번호·연락처로 반품·교환 요청을 찾습니다. <strong className="font-medium text-foreground">등록 전 확인</strong>으로
      맞춘 결과를 본 뒤 확정하면 회수 묶음마다 입고완료로 기록되고, 실제 입고일은 파일의 입고일입니다. 한 번에 {RETURN_INTAKE_ROW_LIMIT.toLocaleString('ko-KR')}줄까지 올립니다.
    </p>
    <details className="w-full rounded-lg border px-3 py-2 [&_summary]:cursor-pointer [&_summary]:font-medium [&_summary]:text-foreground" data-return-intake-columns="">
      <summary>읽는 열 이름</summary>
      <ul className={`${NOTE} mt-2 flex list-disc flex-col gap-1 pl-5`}>
        {RETURN_INTAKE_FIELDS.map(field => <li key={field}><strong className="font-medium text-foreground">{RETURN_INTAKE_FIELD_LABELS[field]}</strong>: {columns[field].join(' · ')}</li>)}
      </ul>
      <p className={`${NOTE} mt-2`}>입고일과 회수 송장 또는 주문번호 열이 있어야 합니다. 주문번호로 찾을 때는 연락처도 함께 맞아야 합니다. 다른 열(이름·주소 등)은 읽지 않습니다.</p>
    </details>
    <div className="flex flex-col items-start gap-2">
      <Label htmlFor="claim-return-intake-file">XLSX·CSV 파일</Label>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <input accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain" aria-hidden="true" className="sr-only"
          disabled={busy} id="claim-return-intake-file" ref={fileInput} tabIndex={-1} type="file"
          onChange={event => { setFile(event.target.files?.[0] ?? null); reset(); }} />
        <Button aria-describedby="claim-return-intake-file-name" disabled={busy} onClick={() => fileInput.current?.click()} size="sm" variant="outline">파일 선택</Button>
        <span className={file ? 'min-w-0 break-all text-foreground' : NOTE} id="claim-return-intake-file-name">{file ? file.name : '선택한 파일 없음'}</span>
      </div>
      <Label className="mt-1" htmlFor="claim-return-intake-password">파일 비밀번호</Label>
      <p className={NOTE} id="claim-return-intake-password-hint">비밀번호를 건 XLSX만 입력합니다. 저장하지 않습니다.</p>
      <Input aria-describedby="claim-return-intake-password-hint" autoComplete="new-password" className="max-w-md" disabled={busy} id="claim-return-intake-password"
        maxLength={255} onChange={reset} ref={passwordInput} spellCheck={false} type="password" />
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || !file} onClick={check} variant="outline">{checking ? '확인 중' : '등록 전 확인'}</Button>
        <Button disabled={busy || !matched.length} onClick={() => setConfirmOpen(true)}>{confirming ? '확정 중' : `입고 확정${matched.length ? ` ${matched.length.toLocaleString('ko-KR')}건` : ''}`}</Button>
      </div>
    </div>
    {error ? <AdminNotice role="alert" tone="danger">{error}</AdminNotice> : null}
    {preview ? <IntakePreview preview={preview} /> : null}
    {result ? <IntakeResult result={result} /> : null}
    <AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{matched.length.toLocaleString('ko-KR')}건을 입고완료로 확정할까요?</AlertDialogTitle>
          <AlertDialogDescription>
            회수 묶음마다 회수 확인으로 기록합니다. 실제 입고일은 파일의 입고일이고 환급 기한은 그 날부터 셉니다. 확정한 입고는 되돌릴 수 없고, 근거에 파일과 행 번호가 남습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={confirm}>입고 확정</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}

function IntakePreview({ preview }: { preview: ClaimReturnIntakePreview }) {
  const count = (status: string) => preview.counts[status] ?? 0;
  const others = preview.rows.length - count('matched') - count('not_found');
  return <div className="flex w-full min-w-0 flex-col gap-2 rounded-lg border bg-muted/40 p-3" data-return-intake-preview="" role="status">
    <p className="font-medium text-foreground">{preview.fileName} · 매칭 {count('matched').toLocaleString('ko-KR')} · 못 찾음 {count('not_found').toLocaleString('ko-KR')}
      {others ? ` · 확인 필요 ${others.toLocaleString('ko-KR')}` : ''}{preview.issues.length ? ` · 읽지 못한 줄 ${preview.issues.length.toLocaleString('ko-KR')}` : ''}</p>
    <div className="w-full rounded-lg border bg-card">
      <Table>
        <caption className="sr-only">반품입고 회신을 맞춘 결과</caption>
        <TableHeader><TableRow className="bg-muted/50">
          <TableHead scope="col">줄</TableHead><TableHead scope="col">결과</TableHead><TableHead scope="col">요청번호</TableHead>
          <TableHead scope="col">반품지</TableHead><TableHead scope="col">상품</TableHead><TableHead scope="col">입고일</TableHead><TableHead scope="col">회수 송장</TableHead>
        </TableRow></TableHeader>
        <TableBody>{preview.rows.map(row => <TableRow data-return-intake-status={row.status} key={row.rowNumber}>
          <TableCell className="tabular-nums">{row.rowNumber}</TableCell>
          <TableCell className="whitespace-normal">{RETURN_INTAKE_STATUS_LABELS[row.status] ?? row.status}</TableCell>
          <TableCell className="tabular-nums">{row.claimReference !== undefined && row.claimId && row.claimType
            ? <Link className="text-primary underline-offset-4 hover:underline" href={adminClaimPreviewHref(row.claimType, row.claimId)}>{orderClaimReferenceLabel(row.claimReference)}</Link> : '-'}</TableCell>
          <TableCell className="whitespace-normal">{row.returnLabel ?? '-'}</TableCell>
          <TableCell className="whitespace-normal">{row.items ?? '-'}</TableCell>
          <TableCell className="tabular-nums">{row.receivedOn ?? '-'}</TableCell>
          <TableCell className="tabular-nums">{row.trackingNumber ?? '-'}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div>
    {preview.issues.length ? <ul className="flex list-disc flex-col gap-1 pl-5 text-destructive">
      {preview.issues.slice(0, 20).map(issue => <li key={issue.line}><span className="tabular-nums">{issue.line}줄</span>: {issue.reason}</li>)}
    </ul> : null}
    <p className={NOTE}>읽기만 했고 아직 아무것도 바꾸지 않았습니다. 확정할 때 다시 맞춰 보고, 그 사이 바뀐 줄은 기록하지 않습니다. 여러 반품지·회수 생략 배송 건은 상세의 회수 확인에서 처리합니다.</p>
  </div>;
}

function IntakeResult({ result }: { result: ReturnIntakeConfirmResult }) {
  const notRecorded = result.rows.filter(row => row.outcome === 'changed' || row.outcome === 'failed');
  return <div className="flex w-full min-w-0 flex-col gap-2" data-return-intake-result="">
    <AdminNotice role="status" tone={result.failed || result.changed ? 'warning' : 'success'}>
      {result.recorded.toLocaleString('ko-KR')}건을 입고완료로 기록했습니다.{result.changed ? ` 미리보기 뒤 바뀐 ${result.changed}건은 기록하지 않았습니다.` : ''}
      {result.failed ? ` ${result.failed}건은 기록하지 못했습니다.` : ''}{result.replayed ? ' 이미 처리한 확정의 결과입니다.' : ''}
    </AdminNotice>
    {notRecorded.length ? <ul className="flex list-disc flex-col gap-1 pl-5 text-destructive">
      {notRecorded.map(row => <li key={row.rowNumber}><span className="tabular-nums">{row.rowNumber}줄</span>: {RETURN_INTAKE_OUTCOME_LABELS[row.outcome] ?? row.outcome}
        {row.outcome === 'failed' ? ` — ${returnIntakeErrorText(row.errorCode)}` : row.status && row.status !== 'matched' ? ` — ${RETURN_INTAKE_STATUS_LABELS[row.status] ?? row.status}` : ''}</li>)}
    </ul> : null}
  </div>;
}
