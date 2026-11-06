'use client';

import { useActionState, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  bulkRegisterAdminOrderTrackingAction,
  type AdminTrackingImportState,
} from '@/app/admin/order-actions';
import {
  TRACKING_IMPORT_ROW_LIMIT,
  TRACKING_IMPORT_SAMPLE,
} from '@/lib/admin/tracking-import';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { Textarea } from '@/components/admin/kit/ui/textarea';

const EMPTY_STATE: AdminTrackingImportState = {};
/* 운송장 일괄 등록(템플릿 룩, ADR-0028). 안내 문단은 보조 글자, 실패 보고는 kit 표다. */
const NOTE = 'text-muted-foreground';
const STRONG = 'font-medium text-foreground';

/** Shipment uploads return an actionable row report and preserve failed input. */
export function DispatchTrackingImportPanel({ carriers, originId, shippingHref = '/admin/sales/shipping?tab=transit&page=1' }: { carriers: ShippingCarrierRegistry; originId?: string|null; shippingHref?: string }) {
  const router = useRouter();
  const [pasted, setPasted] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [state, action, pending] = useActionState(
    async (previous: AdminTrackingImportState, data: FormData) => {
      if (selectedFile) data.set('file', selectedFile);
      const result = await bulkRegisterAdminOrderTrackingAction(previous, data);
      if (result.report?.succeeded.length && !result.report.failed.length && !result.errors?.form && !result.queueWarning) {
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

  return (
    <section className="flex min-w-0 flex-col gap-3 border-t p-3 text-sm leading-relaxed sm:p-4" aria-label="엑셀 일괄 운송장 등록">
      <h2 className="text-base font-medium text-foreground">엑셀 일괄 운송장 등록</h2>

      <p className={NOTE}>
        스마트스토어 양식은 <strong className={STRONG}>상품주문번호 · 배송방법 · 택배사 · 송장번호</strong> 네 열을 사용합니다.
        내려받은 파일의 암호를 해제하고, 상단 안내 행이 있는 파일만 안내 행을 삭제해주세요. 상품주문번호가 있는 머리글 행은 유지하고 시트명을 <strong className={STRONG}>발송처리</strong>로 저장해 올려주세요. 열의 순서는 바꿔도 됩니다.
        한 번에 {TRACKING_IMPORT_ROW_LIMIT.toLocaleString('ko-KR')}건까지 처리합니다.
      </p>
      <p className={NOTE}>상품주문번호는 ICONS 파일의 전체 번호를 유지해주세요. 배송방법은 택배,등기,소포이며 퀵·방문수령·직접전달은 주문 상세에서 처리합니다.</p>
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
      <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">{TRACKING_IMPORT_SAMPLE}</pre>

      <form action={action} className="flex flex-col items-start gap-2">
        <input type="hidden" name="originId" value={originId??''} />
        <Label htmlFor="admin-dispatch-import-pasted">붙여넣기</Label>
        <Textarea
          value={pasted}
          onChange={event => setPasted(event.target.value)}
          disabled={pending}
          id="admin-dispatch-import-pasted"
          name="pasted"
          placeholder={TRACKING_IMPORT_SAMPLE}
          rows={6}
          className="font-mono text-xs"
        />
        <Label className="mt-1" htmlFor="admin-dispatch-import-file">또는 XLSX·CSV 파일</Label>
        <p className={NOTE}>XLSX는 1MB, CSV·TSV·텍스트와 붙여넣기는 256KB까지 등록합니다.</p>
        <Input
          accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
          className="max-w-md"
          disabled={pending}
          id="admin-dispatch-import-file"
          name="file"
          ref={fileInput}
          type="file"
          onChange={event => setSelectedFile(event.target.files?.[0] ?? null)}
        />
        {selectedFile ? <p className="flex flex-wrap items-center gap-2">선택 파일: {selectedFile.name} <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => { setSelectedFile(null); if (fileInput.current) fileInput.current.value = ''; }}>파일 선택 해제</Button></p> : null}
        <p className={NOTE}>등록에 성공한 배송 건은 배송 중으로 바뀌고 배송 메일이 대기열에 등록됩니다.</p>
        <Button disabled={pending} type="submit">
          {pending ? '등록 중' : '일괄 등록'}
        </Button>
      </form>

      <div aria-live="polite" className="text-sm empty:hidden [&_[role=alert]]:text-destructive [&_[role=status]]:text-[var(--wc-success)]">
        {state.errors?.form ? <span role="alert">{state.errors.form}</span> : null}
        {state.message ? <span role="status">{state.message}</span> : null}
      </div>

      {state.report && state.report.failed.length > 0 ? (
        <div className="flex min-w-0 flex-col items-start gap-2">
        <a className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" download="운송장-실패행.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent("﻿"+[["줄","대상","사유"],...state.report.failed.map(row=>[String(row.line),row.reference,row.reason])].map(row=>row.map(cell=>`"${(/^[\s]*[=+\-@]/.test(cell)?"'":"")+cell.replaceAll('"','""')}"`).join(',')).join('\r\n'))}`}>실패 행 내려받기</a>
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
    </section>
  );
}
