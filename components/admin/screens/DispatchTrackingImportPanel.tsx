'use client';

import { useActionState } from 'react';
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

const IMPORT_CONFIRMATION = '붙여넣은 운송장으로 일괄 발송처리할까요? 성공한 주문은 곧바로 배송중으로 바뀌고 배송 시작 메일이 나갑니다.';

/**
 * 엑셀 일괄 운송장 등록 (#251).
 *
 * ## 왜 붙여넣기인가
 *
 * `package.json`에 엑셀 파서가 없고 의존성 추가는 이 이슈 범위 밖이다. 스프레드시트
 * 선택 영역을 그대로 붙여넣으면 탭 구분 텍스트가 되고, CSV로 저장해 올려도 같은
 * 파서를 지난다 — 운영자 입장에서 잃는 단계가 없다.
 *
 * ## 실패는 주문번호와 사유를 그대로 보여준다
 *
 * 건수만 알려주면 100건 목록에서 어느 주문이 남았는지 찾지 못한다. 줄 번호까지
 * 함께 실어 운영자가 원본 파일에서 곧바로 고칠 수 있게 한다.
 *
 * ## 포맷은 잠정이다
 *
 * 실제 WMS 내보내기 포맷은 #177 확인 뒤 맞춘다. 지금은 우리가 정한 세 칸이고,
 * 이 화면 문구가 그 접점을 설명한다.
 */
export function DispatchTrackingImportPanel({ carriers }: { carriers: ShippingCarrierRegistry }) {
  const [state, action, pending] = useActionState(
    bulkRegisterAdminOrderTrackingAction,
    EMPTY_STATE,
  );
  const activeCodes = carriers.filter((carrier) => carrier.active);

  return (
    <details className="admin-console-import card">
      <summary>엑셀 일괄 운송장 등록</summary>

      <p className="muted">
        컬럼은 <strong>주문번호 · 택배사코드 · 운송장번호</strong> 순서입니다.
        엑셀에서 세 칸을 복사해 붙여넣거나 CSV 파일을 올려주세요.
        한 번에 {TRACKING_IMPORT_ROW_LIMIT}건까지 처리합니다.
      </p>
      <p className="muted">
        택배사코드: {activeCodes.length
          ? activeCodes.map((carrier) => `${carrier.code}(${carrier.label})`).join(' · ')
          : '등록된 택배사가 없습니다.'}
      </p>
      {/* WMS 이중 입력 주의(#177). 어드민을 운송장 진실원으로 선언하지 않는다. */}
      <p className="muted">
        창고 WMS가 발행한 운송장을 옮겨 적는 운영 기록입니다. 값이 어긋나면 WMS가 기준입니다.
      </p>
      <pre className="admin-console-import-sample">{TRACKING_IMPORT_SAMPLE}</pre>

      <form
        action={action}
        onSubmit={(event) => {
          if (!window.confirm(IMPORT_CONFIRMATION)) event.preventDefault();
        }}
      >
        <label htmlFor="admin-dispatch-import-pasted">붙여넣기</label>
        <textarea
          defaultValue=""
          disabled={pending}
          id="admin-dispatch-import-pasted"
          name="pasted"
          placeholder={TRACKING_IMPORT_SAMPLE}
          rows={6}
        />
        <label htmlFor="admin-dispatch-import-file">또는 CSV 파일</label>
        <input
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          disabled={pending}
          id="admin-dispatch-import-file"
          name="file"
          type="file"
        />
        <button className="btn btn-sm" disabled={pending} type="submit">
          {pending ? '등록 중' : '일괄 등록'}
        </button>
      </form>

      <div aria-live="polite" className="admin-order-action-feedback">
        {state.errors?.form ? <span role="alert">{state.errors.form}</span> : null}
        {state.message ? <span role="status">{state.message}</span> : null}
      </div>

      {state.report && state.report.failed.length > 0 ? (
        <table className="admin-console-import-report">
          <caption>등록하지 못한 줄</caption>
          <thead>
            <tr>
              <th scope="col">줄</th>
              <th scope="col">주문번호</th>
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
      ) : null}

      {state.report && state.report.succeeded.length > 0 ? (
        <p className="muted">
          발송처리: <span className="mono">{state.report.succeeded.join(', ')}</span>
        </p>
      ) : null}
    </details>
  );
}
