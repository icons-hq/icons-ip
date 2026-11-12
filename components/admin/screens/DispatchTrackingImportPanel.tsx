'use client';

import { kstFileStamp } from '@/lib/admin/list-export';
import { useActionState, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  bulkRegisterAdminOrderTrackingAction,
  previewAdminOrderTrackingImportAction,
  type AdminTrackingImportPreview,
  type AdminTrackingImportState,
} from '@/app/admin/order-actions';
import {
  TRACKING_IMPORT_ROW_LIMIT,
  TRACKING_IMPORT_SAMPLE,
} from '@/lib/admin/tracking-import';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { Textarea } from '@/components/admin/kit/ui/textarea';

const EMPTY_STATE: AdminTrackingImportState = {};
/* 운송장 일괄 등록(템플릿 룩, ADR-0028). 안내 문단은 보조 글자, 실패 보고는 kit 표다. */
const NOTE = 'text-muted-foreground';
const STRONG = 'font-medium text-foreground';
const DISCLOSURE = 'w-full rounded-lg border px-3 py-2 [&_summary]:cursor-pointer [&_summary]:font-medium [&_summary]:text-foreground';

/**
 * Shipment uploads return an actionable row report and preserve failed input.
 * QA 라운드 1 m2: 입력칸보다 안내가 길어 파일 선택이 첫 화면 밖에 있었고, 잘못 고른 파일도 바로 등록됐다.
 * 짧은 안내 → 파일·비밀번호 → [등록 전 확인] → [일괄 등록] 순서로 두고, 회신 양식 안내와 붙여넣기는 접어 둔다.
 * 파일 이름은 이 화면이 가진 선택을 보인다(제출 뒤 브라우저 파일 칸이 비워져도 실패 줄을 고쳐 다시 올릴 수 있게 선택을 유지한다).
 */
export function DispatchTrackingImportPanel({ carriers, originId, shippingHref = '/admin/sales/shipping?tab=transit&page=1' }: { carriers: ShippingCarrierRegistry; originId?: string|null; shippingHref?: string }) {
  const router = useRouter();
  const [pasted, setPasted] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<AdminTrackingImportPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [checking, startCheck] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(
    async (previous: AdminTrackingImportState, data: FormData) => {
      if (selectedFile) data.set('file', selectedFile);
      const result = await bulkRegisterAdminOrderTrackingAction(previous, data);
      // 운송장 칸을 비워 건너뛴 줄이 있으면 그 사실을 이 자리에서 보이도록 배송현황으로 넘어가지 않는다.
      if (result.report?.succeeded.length && !result.report.failed.length && !result.report.skipped && !result.errors?.form && !result.queueWarning) {
        const [path, query] = shippingHref.split('?');
        const params = new URLSearchParams(query);
        params.set('registered', String(result.report.succeeded.length));
        router.push(`${path}?${params}`);
      }
      return result;
    },
    EMPTY_STATE,
  );
  const activeCodes = carriers.filter((carrier) => carrier.active);
  /* 입력이 바뀌면 확인 결과는 더는 그 입력의 것이 아니다. 다시 확인해야 등록할 수 있다. */
  function invalidate() { setPreview(null); setPreviewError(''); }
  function check() {
    if (!formRef.current || checking || pending) return;
    const data = new FormData(formRef.current);
    if (selectedFile) data.set('file', selectedFile);
    setPreviewError('');
    startCheck(async () => {
      try {
        const result = await previewAdminOrderTrackingImportAction(data);
        if (result.preview) setPreview(result.preview);
        else { setPreview(null); setPreviewError(result.error ?? '회신 내용을 읽지 못했습니다.'); }
      } catch {
        setPreview(null); setPreviewError('회신 내용을 확인하지 못했습니다. 잠시 후 다시 확인해주세요.');
      }
    });
  }
  const canRegister = Boolean(preview && (preview.ready > 0 || preview.issueCount > 0));

  return (
    <section className="flex min-w-0 flex-col gap-3 border-t p-3 text-sm leading-relaxed sm:p-4" aria-label="엑셀 일괄 운송장 등록">
      <h2 className="text-base font-medium text-foreground">엑셀 일괄 운송장 등록</h2>
      <p className={NOTE}>
        내려받은 출고지시 파일(ICONS 표준 양식·김포 WMS 21열·남양주 송장양식)에 운송장을 채워 그대로 올리면 양식을 알아서 찾습니다.
        <strong className={STRONG}> 등록 전 확인</strong>으로 읽은 내용을 본 뒤 등록합니다. 한 번에 {TRACKING_IMPORT_ROW_LIMIT.toLocaleString('ko-KR')}건까지 처리합니다.
      </p>

      <form action={action} className="flex flex-col items-start gap-2" ref={formRef}>
        <input type="hidden" name="originId" value={originId??''} />
        <Label htmlFor="admin-dispatch-import-file">XLSX·CSV 파일</Label>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {/* 브라우저 파일 칸은 제출 뒤 비워져 '선택된 파일 없음'과 이 화면의 선택이 함께 보였다. 칸은 감추고 이 화면의 선택만 보인다. */}
          <input
            accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
            aria-hidden="true"
            className="sr-only"
            disabled={pending}
            id="admin-dispatch-import-file"
            name="file"
            ref={fileInput}
            tabIndex={-1}
            type="file"
            onChange={event => { setSelectedFile(event.target.files?.[0] ?? null); invalidate(); }}
          />
          <Button aria-describedby="admin-dispatch-import-file-name" disabled={pending} onClick={() => fileInput.current?.click()} size="sm" type="button" variant="outline">파일 선택</Button>
          <span className={selectedFile ? 'min-w-0 break-all text-foreground' : NOTE} data-selected-file="" id="admin-dispatch-import-file-name">{selectedFile ? selectedFile.name : '선택한 파일 없음'}</span>
          {selectedFile ? <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => { setSelectedFile(null); invalidate(); if (fileInput.current) fileInput.current.value = ''; }}>파일 선택 해제</Button> : null}
        </div>
        <p className={NOTE}>XLSX와 ICONS 표준 양식 CSV는 1MB, 그 밖의 CSV·TSV·텍스트와 붙여넣기는 256KB까지 등록합니다.</p>
        <Label className="mt-1" htmlFor="admin-dispatch-import-file-password">파일 비밀번호</Label>
        <p className={NOTE} id="admin-dispatch-import-file-password-hint">비밀번호를 건 XLSX만 입력합니다. 파일을 내려받을 때 정한 비밀번호이며 저장하지 않습니다.</p>
        <Input
          aria-describedby="admin-dispatch-import-file-password-hint"
          autoComplete="new-password"
          className="max-w-md"
          disabled={pending}
          id="admin-dispatch-import-file-password"
          maxLength={255}
          name="filePassword"
          onChange={invalidate}
          spellCheck={false}
          type="password"
        />
        <details className={DISCLOSURE} data-tracking-import-paste="">
          <summary>붙여넣기로 등록 (배송건번호 · 택배사코드 · 운송장번호)</summary>
          <div className="mt-2 flex flex-col items-start gap-2">
            <Label htmlFor="admin-dispatch-import-pasted">붙여넣기</Label>
            <Textarea
              value={pasted}
              onChange={event => { setPasted(event.target.value); invalidate(); }}
              disabled={pending}
              id="admin-dispatch-import-pasted"
              name="pasted"
              placeholder={TRACKING_IMPORT_SAMPLE}
              rows={6}
              className="font-mono text-xs"
            />
            <p className={NOTE}>파일을 고르면 붙여넣기보다 파일을 읽습니다.</p>
            <pre className="w-full overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">{TRACKING_IMPORT_SAMPLE}</pre>
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={pending || checking} onClick={check} type="button" variant="outline">{checking ? '확인 중' : '등록 전 확인'}</Button>
          <Button disabled={pending || !canRegister} type="submit">
            {pending ? '등록 중' : '일괄 등록'}
          </Button>
          {!preview && !pending ? <span className={NOTE}>[등록 전 확인]으로 읽은 내용을 본 뒤 등록할 수 있습니다.</span> : null}
        </div>
        <p className={NOTE}>등록에 성공한 배송 건은 배송 중으로 바뀌고 배송 메일이 대기열에 등록됩니다.</p>
      </form>

      {previewError ? <AdminNotice role="alert" tone="danger">{previewError}</AdminNotice> : null}
      {preview ? <TrackingImportPreview preview={preview} /> : null}

      <div aria-live="polite" className="text-sm empty:hidden [&_[role=alert]]:text-destructive [&_[role=status]]:text-success">
        {state.errors?.form ? <span role="alert">{state.errors.form}</span> : null}
        {state.message ? <span role="status">{state.message}</span> : null}
      </div>

      {state.report && state.report.failed.length > 0 ? (
        <div className="flex min-w-0 flex-col items-start gap-2">
        <a className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" download={`icons-운송장실패행-${kstFileStamp(new Date())}.csv`} href={`data:text/csv;charset=utf-8,${encodeURIComponent("﻿"+[["줄","대상","사유"],...state.report.failed.map(row=>[String(row.line),row.reference,row.reason])].map(row=>row.map(cell=>`"${(/^[\s]*[=+\-@]/.test(cell)?"'":"")+cell.replaceAll('"','""')}"`).join(',')).join('\r\n'))}`}>실패 행 내려받기</a>
        <div className="w-full rounded-lg border">
        <Table>
          <caption className="caption-top border-b px-2 py-2 text-left text-sm font-medium text-foreground">등록하지 못한 줄</caption>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead scope="col">줄</TableHead>
              <TableHead scope="col">대상(상품주문·배송건·주문·받는 분)</TableHead>
              <TableHead scope="col">사유</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.report.failed.map((failure) => (
              <TableRow key={`${failure.line}:${failure.reference}`}>
                <TableCell className="tabular-nums">{failure.line}</TableCell>
                <TableCell className="tabular-nums">{failure.reference || '-'}</TableCell>
                <TableCell className="whitespace-normal">{failure.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
        </div>
      ) : null}

      {state.report && state.report.succeeded.length > 0 ? (
        <>
        <Link className={`${buttonVariants({ variant: 'outline', size: 'sm' })} self-start`} data-slot="button" href={shippingHref}>배송현황에서 결과 확인</Link>
        <p className={NOTE}>
          발송처리: <span className="tabular-nums">{state.report.succeeded.join(', ')}</span>
        </p>
        </>
      ) : null}

      <details className={DISCLOSURE} data-tracking-import-guide="">
        <summary>회신 양식 안내 (ICONS 표준 · 김포 WMS 21열 · 남양주 송장양식 · 기존 세 칸)</summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className={NOTE}>
            ICONS 표준 양식은 <strong className={STRONG}>상품주문번호 · 택배사 · 운송장번호</strong> 세 열을 읽습니다. 내려받은 파일에 택배사와 운송장번호를 채우고, XLSX 또는 내려받은 CSV로 올려주세요. 비밀번호를 건 XLSX는 해제하지 않고 그대로 올리고 위 <strong className={STRONG}>파일 비밀번호</strong>를 입력합니다.
            시트 이름과 열 순서는 바꿔도 되고, 나머지 열은 그대로 두거나 지워도 됩니다. 이전에 내려받은 파일도 그대로 올릴 수 있습니다.
          </p>
          <p className={NOTE}>상품주문번호는 ICONS 파일의 전체 번호를 유지해주세요. 택배 건만 등록할 수 있으며 퀵·방문수령·직접전달은 행의 인계·수령 확인에서 처리합니다. CSV를 Excel에서 열어 저장하면 긴 번호가 바뀌어 등록되지 않으니, Excel로 작업할 때는 XLSX를 받아 주세요.</p>
          <p className={NOTE}>기존 <strong className={STRONG}>배송건번호 · 택배사코드 · 운송장번호</strong> 세 칸 XLSX·CSV·붙여넣기도 지원합니다. 단일 배송 주문은 주문번호도 사용할 수 있습니다.</p>
          <p className={NOTE}>
            택배사코드: {activeCodes.length
              ? activeCodes.map((carrier) => `${carrier.code}(${carrier.label})`).join(' · ')
              : '등록된 택배사가 없습니다.'}
          </p>
          <p className={NOTE}>
            창고 회신 XLSX는 내려받은 양식 그대로 올립니다. 출고지는 파일 양식으로 찾고, 택배사는 그 출고지의 기본 택배사를 씁니다.
            같은 양식을 쓰는 출고지가 여러 곳일 때만 목록 위에서 출고지를 골라주세요.
          </p>
          <ul className={`${NOTE} flex list-disc flex-col gap-1 pl-5`}>
            <li>
              <strong className={STRONG}>김포 WMS 21열</strong> — 운송장번호 열을 채운 회신입니다. 주문번호(쇼핑몰)는 ICONS 출고 파일의 전체 주문번호를 유지해주세요.
              같은 주문의 여러 상품 행은 한 배송 건으로 합치며, 서로 다른 운송장이 있으면 해당 주문 전체를 등록하지 않습니다.
              운송장 칸을 비운 주문은 아직 출고하지 않은 것으로 보고 건너뜁니다(한 주문의 일부 행만 비우면 그 주문은 등록하지 않습니다).
            </li>
            <li>
              <strong className={STRONG}>남양주(서원) 송장양식</strong> — 내려받은 송장양식 오른쪽에 &lsquo;송장번호&rsquo; 열을 두고 번호를 채운 파일입니다.
              서원은 주문번호를 돌려주지 않아 받는분전화번호·주소·품목명·수량으로 배송 건을 찾으므로 이 칸들은 바꾸지 마세요.
              한 배송 건의 줄은 빠짐없이 같은 송장번호로 채워주세요.
            </li>
          </ul>
          <p className={NOTE}>
            이미 발송된 배송 건의 운송장은 덮어쓰지 않습니다. 같은 회신을 다시 올리면 그대로 두고, 번호가 다르면 실패로 알려드립니다.
            정정은 주문 통합검색의 운송장 수정에서 합니다.
          </p>
          <p className={NOTE}>합포장은 한 배송 건의 송장을 등록해도 묶음 전체에 적용됩니다. 같은 합포장에 서로 다른 송장이나 오류 행이 있으면 먼저 파일을 수정해주세요. 남양주 원형 회신은 합포장에 포함된 모든 배송 건의 품목 줄을 빠짐없이 올려야 합니다.</p>
          {/* WMS 이중 입력 주의(#177). 어드민을 운송장 진실원으로 선언하지 않는다. */}
          <p className={NOTE}>
            창고 WMS가 발행한 운송장을 옮겨 적는 운영 기록입니다. 값이 어긋나면 WMS가 기준입니다.
          </p>
        </div>
      </details>
    </section>
  );
}

/** 등록 전 확인 결과. 아무것도 바꾸지 않은 읽기 결과이고, 등록할 때 배송 건 상태를 다시 확인한다. */
function TrackingImportPreview({ preview }: { preview: AdminTrackingImportPreview }) {
  const count = (value: number) => value.toLocaleString('ko-KR');
  return <div className="flex w-full min-w-0 flex-col gap-2 rounded-lg border bg-muted/40 p-3" data-tracking-import-preview="" role="status">
    <p className={STRONG}>{preview.format} · 등록할 줄 {count(preview.ready)} · 건너뛸 줄 {count(preview.skipped)} · 등록할 수 없는 줄 {count(preview.issueCount)}</p>
    {preview.sample.length ? <div className="w-full rounded-lg border bg-card">
      <Table>
        <caption className="sr-only">등록할 줄 앞부분</caption>
        <TableHeader><TableRow className="bg-muted/50">
          <TableHead scope="col">줄</TableHead><TableHead scope="col">대상</TableHead><TableHead scope="col">운송장번호</TableHead>
        </TableRow></TableHeader>
        <TableBody>{preview.sample.map((row) => <TableRow key={`${row.line}:${row.reference}`}>
          <TableCell className="tabular-nums">{row.line}</TableCell>
          <TableCell className="whitespace-normal tabular-nums">{row.reference}</TableCell>
          <TableCell className="tabular-nums">{row.trackingNumber}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div> : null}
    {preview.ready > preview.sample.length ? <p className={NOTE}>앞의 {count(preview.sample.length)}줄만 보입니다.</p> : null}
    {preview.issues.length ? <ul className="flex list-disc flex-col gap-1 pl-5 text-destructive">
      {preview.issues.map((issue) => <li key={`${issue.line}:${issue.reference}`}><span className="tabular-nums">{issue.line}줄</span>: {issue.reason}</li>)}
      {preview.issueCount > preview.issues.length ? <li className="list-none text-muted-foreground">외 {count(preview.issueCount - preview.issues.length)}줄</li> : null}
    </ul> : null}
    {preview.skipped ? <p className={NOTE}>운송장 칸을 비운 줄은 아직 출고하지 않은 것으로 보고 등록하지 않습니다.</p> : null}
    <p className={NOTE}>읽기만 했고 아직 아무것도 바꾸지 않았습니다. 등록할 때 배송 건 상태를 다시 확인하며, 이미 발송된 운송장은 덮어쓰지 않습니다.</p>
  </div>;
}
