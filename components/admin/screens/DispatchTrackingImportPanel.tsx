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

const EMPTY_STATE: AdminTrackingImportState = {};

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
    <section className="wc-admin-kit wc-admin-kit__card" aria-label="엑셀 일괄 운송장 등록">
      <h2>엑셀 일괄 운송장 등록</h2>

      <p className="muted">
        컬럼은 <strong>배송건번호 · 택배사코드 · 운송장번호</strong> 순서입니다.
        XLSX 파일을 올리거나 엑셀의 세 칸을 복사해 붙여넣어주세요. 단일 배송 주문은 주문번호도 사용할 수 있습니다.
        한 번에 {TRACKING_IMPORT_ROW_LIMIT.toLocaleString('ko-KR')}건까지 처리합니다.
      </p>
      <p className="muted">
        택배사코드: {activeCodes.length
          ? activeCodes.map((carrier) => `${carrier.code}(${carrier.label})`).join(' · ')
          : '등록된 택배사가 없습니다.'}
      </p>
      <p className="muted">
        김포 WMS의 21열 XLSX 회신도 그대로 올릴 수 있습니다. 목록 위에서 해당 출고지를 선택하고,
        주문번호(쇼핑몰)는 ICONS 출고 파일의 전체 주문번호를 유지해주세요. 기본 택배사는 출고지 설정을 사용합니다.
        같은 주문의 여러 상품 행은 한 배송 건으로 합치며, 서로 다른 운송장이 있으면 해당 주문 전체를 등록하지 않습니다.
        서원 양식에는 회신용 주문번호·운송장 열이 없으므로 위 세 칸 양식으로 등록해주세요.
      </p>
      {/* WMS 이중 입력 주의(#177). 어드민을 운송장 진실원으로 선언하지 않는다. */}
      <p className="muted">
        창고 WMS가 발행한 운송장을 옮겨 적는 운영 기록입니다. 값이 어긋나면 WMS가 기준입니다.
      </p>
      <pre className="admin-console-import-sample">{TRACKING_IMPORT_SAMPLE}</pre>

      <form action={action}>
        <input type="hidden" name="originId" value={originId??''} />
        <label htmlFor="admin-dispatch-import-pasted">붙여넣기</label>
        <textarea
          value={pasted}
          onChange={event => setPasted(event.target.value)}
          disabled={pending}
          id="admin-dispatch-import-pasted"
          name="pasted"
          placeholder={TRACKING_IMPORT_SAMPLE}
          rows={6}
        />
        <label htmlFor="admin-dispatch-import-file">또는 XLSX·CSV 파일</label>
        <input
          accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
          disabled={pending}
          id="admin-dispatch-import-file"
          name="file"
          ref={fileInput}
          type="file"
          onChange={event => setSelectedFile(event.target.files?.[0] ?? null)}
        />
        {selectedFile ? <p>선택 파일: {selectedFile.name} <button type="button" disabled={pending} onClick={() => { setSelectedFile(null); if (fileInput.current) fileInput.current.value = ''; }}>파일 선택 해제</button></p> : null}
        <p className="muted">등록에 성공한 배송 건은 배송 중으로 바뀌고 배송 메일이 대기열에 등록됩니다.</p>
        <button className="wc-admin-kit__button" disabled={pending} type="submit">
          {pending ? '등록 중' : '일괄 등록'}
        </button>
      </form>

      <div aria-live="polite" className="admin-order-action-feedback">
        {state.errors?.form ? <span role="alert">{state.errors.form}</span> : null}
        {state.message ? <span role="status">{state.message}</span> : null}
      </div>

      {state.report && state.report.failed.length > 0 ? (
        <div>
        <a className="wc-admin-kit__button" download="운송장-실패행.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent("\uFEFF"+[["줄","배송건번호","사유"],...state.report.failed.map(row=>[String(row.line),row.reference,row.reason])].map(row=>row.map(cell=>`"${(/^[\s]*[=+\-@]/.test(cell)?"'":"")+cell.replaceAll('"','""')}"`).join(',')).join('\r\n'))}`}>실패 행 내려받기</a>
        <table className="admin-console-import-report">
          <caption>등록하지 못한 줄</caption>
          <thead>
            <tr>
              <th scope="col">줄</th>
              <th scope="col">배송건번호</th>
              <th scope="col">사유</th>
            </tr>
          </thead>
          <tbody>
            {state.report.failed.map((failure) => (
              <tr key={`${failure.line}:${failure.reference}`}>
                <td>{failure.line}</td>
                <td className="mono">{failure.reference || '-'}</td>
                <td>{failure.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : null}

      {state.report && state.report.succeeded.length > 0 ? (
        <>
        <Link className="wc-admin-kit__button" href={shippingHref}>배송현황에서 결과 확인</Link>
        <p className="muted">
          발송처리: <span className="mono">{state.report.succeeded.join(', ')}</span>
        </p>
        </>
      ) : null}
    </section>
  );
}
