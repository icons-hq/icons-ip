'use client';

import { useRef } from 'react';
import type { AdminDispatchOrderRow } from '@/lib/admin/dispatch';
import { adminDispatchItemLabel } from '@/lib/admin/dispatch';
import { formatOrderDateTime } from '@/lib/orders';
import { krw } from '@/lib/format';

/*
 * 주문 요약 팝업 (현업 슬라이스 3 · 3-2 #4).
 *
 * 지금까지 주문번호를 누르면 통합검색으로 **떠났다** — 돌아오면 보던 탭·페이지·필터가
 * 처음으로 돌아가 있어서, 스무 건을 처리하는 동안 스무 번 자리를 잃었다.
 *
 * 그래서 목록 위에서 연다. 여기 있는 값은 **행이 이미 들고 있는 것**이라 새 조회가 없다 —
 * 팝업을 열자고 주문마다 서버를 한 번씩 더 부르면 목록이 무거워진다. 더 깊이 봐야 하면
 * 새 탭으로 보낸다: 그때는 이 목록이 그대로 남는다.
 */
export function DispatchOrderPeek({
  reference,
  row,
}: {
  reference: string;
  row: AdminDispatchOrderRow;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        className="admin-order-peek-trigger mono"
        onClick={() => dialogRef.current?.showModal()}
        title={`주문 ${reference} 요약 보기`}
        type="button"
      >
        {reference}
      </button>
      <dialog className="admin-order-peek" ref={dialogRef}>
        <form method="dialog" className="admin-order-peek-head">
          <h2 className="mono" style={{ fontSize: 14, margin: 0 }}>{reference}</h2>
          <button className="btn btn-sm btn-ghost" type="submit">닫기</button>
        </form>
        <dl className="admin-order-peek-body">
          <div><dt>주문자</dt><dd>@{row.buyerName}</dd></div>
          <div><dt>주문 시각</dt><dd>{formatOrderDateTime(row.createdAt)}</dd></div>
          <div>
            <dt>발주확인</dt>
            <dd>{row.confirmedAt ? formatOrderDateTime(row.confirmedAt) : '아직'}</dd>
          </div>
          <div><dt>결제사</dt><dd>{row.paymentProvider ?? '—'}</dd></div>
          <div><dt>금액</dt><dd>{krw(row.total)}</dd></div>
          <div><dt>품목</dt><dd>{adminDispatchItemLabel(row.items)}</dd></div>
          {row.delayNote ? (
            <div>
              <dt>지연 사유</dt>
              <dd>
                {row.delayNote.reason}
                {row.delayNote.expectedShipDate ? ` · 발송 예정 ${row.delayNote.expectedShipDate}` : ''}
              </dd>
            </div>
          ) : null}
        </dl>
        <p className="admin-order-peek-foot">
          {/* 새 탭으로 연다 — 이 목록의 탭·페이지·필터가 그대로 남아야 한다. */}
          <a href={`/admin/sales/orders?selected=${row.id}`} rel="noreferrer" target="_blank">
            주문 상세 새 탭에서 열기
          </a>
        </p>
      </dialog>
    </>
  );
}
