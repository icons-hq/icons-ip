'use client';

import { useActionState } from 'react';
import {
  cancelCashReceiptAction,
  decideTaxInvoiceAction,
  recordTaxInvoiceIssuedAction,
  requestCashReceiptAction,
  type AdminReceiptActionState,
} from '@/app/admin/receipt-actions';
import { krw } from '@/lib/format';
import {
  CASH_RECEIPT_KINDS,
  CASH_RECEIPT_KIND_LABELS,
  CASH_RECEIPT_STATUS_LABELS,
  daysUntil,
  formatBusinessNumber,
  TAX_INVOICE_STATUS_LABELS,
  type AdminReceiptsConsoleData,
} from '@/lib/admin/receipts';
import { formatOrderDateTime } from '@/lib/orders';

/*
 * 증빙 콘솔 (D-3).
 *
 * 미발급 목록이 맨 위에 온다. 발급된 것만 보여주는 화면은 빠뜨린 건을 절대 못 보여주고,
 * 현금영수증에서 빠뜨린 건은 가산세가 된다.
 */

const EMPTY: AdminReceiptActionState = {};

function Message({ state }: { state: AdminReceiptActionState }) {
  if (state.error) return <span className="admin-form-error">{state.error}</span>;
  if (state.message) return <span className="muted" style={{ fontSize: 12 }}>{state.message}</span>;
  return null;
}

function IssueForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(requestCashReceiptAction, EMPTY);
  return (
    <form action={action} className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
      <input name="orderId" type="hidden" value={orderId} />
      <select aria-label="발급 유형" name="kind">
        {CASH_RECEIPT_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
      </select>
      <input aria-label="식별번호" name="identityNumber" placeholder="휴대폰·사업자번호" style={{ width: 150 }} />
      <button className="btn btn-xs btn-holo" disabled={pending} type="submit">발급</button>
      <Message state={state} />
    </form>
  );
}

function CancelForm({ receiptId }: { receiptId: string }) {
  const [state, action, pending] = useActionState(cancelCashReceiptAction, EMPTY);
  return (
    <form action={action} className="row" style={{ alignItems: 'center', gap: 6 }}>
      <input name="receiptId" type="hidden" value={receiptId} />
      <input aria-label="취소 사유" name="reason" placeholder="사유" style={{ width: 120 }} />
      <button className="btn btn-xs btn-ghost" disabled={pending} type="submit" title={state.error}>취소</button>
    </form>
  );
}

function InvoiceDecision({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(decideTaxInvoiceAction, EMPTY);
  return (
    <form action={action} className="row" style={{ alignItems: 'center', gap: 6 }}>
      <input name="requestId" type="hidden" value={requestId} />
      <button className="btn btn-xs btn-holo" disabled={pending} name="decision" type="submit" value="approve">승인</button>
      <button className="btn btn-xs btn-ghost" disabled={pending} name="decision" type="submit" value="reject">거절</button>
      <Message state={state} />
    </form>
  );
}

function InvoiceIssued({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(recordTaxInvoiceIssuedAction, EMPTY);
  return (
    <form action={action} className="row" style={{ alignItems: 'center', gap: 6 }}>
      <input name="requestId" type="hidden" value={requestId} />
      <input aria-label="승인번호" name="approvalNumber" placeholder="스마트빌 승인번호" style={{ width: 160 }} />
      <button className="btn btn-xs btn-holo" disabled={pending} type="submit">발행 기록</button>
      <Message state={state} />
    </form>
  );
}

export function ReceiptsConsole({ data }: { data: AdminReceiptsConsoleData }) {
  return (
    <section className="col" style={{ gap: 16, minWidth: 0 }}>
      <div>
        <span className="eyebrow">RECEIPTS</span>
        <h1 style={{ fontSize: 22, margin: '6px 0 0' }}>현금영수증 · 세금계산서</h1>
      </div>

      <section className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
        <div>
          <h2 style={{ fontSize: 16, margin: 0 }}>발급하지 않은 현금 거래 {data.pending.length}건</h2>
          <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '6px 0 0' }}>
            10만 원 이상 현금성 거래는 입금 확인 뒤 5일 안에 발급해야 합니다. 상대의 번호를 모르면
            「자진발급」으로 국세청 지정번호를 써서 발급합니다.
          </p>
        </div>
        {data.pending.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>발급하지 않은 현금 거래가 없습니다.</p>
        ) : (
          <ul className="admin-order-refs">
            {data.pending.map((row) => {
              const left = daysUntil(row.dueAt, data.now);
              return (
                <li className="col" key={row.orderId} style={{ gap: 6 }}>
                  <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <strong className="mono">{row.orderNo}</strong>
                    <span>{krw(row.total)}</span>
                    {row.mandatory ? <span className="chip chip-warning">의무발행</span> : null}
                    <span className={left < 0 ? 'admin-form-error' : 'faint'}>
                      {left < 0 ? `기한 ${-left}일 지남` : `기한 ${left}일 남음`}
                    </span>
                  </div>
                  <IssueForm orderId={row.orderId} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>현금영수증 발급 내역</h2>
        {data.receipts.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>발급 내역이 없습니다.</p>
        ) : (
          <ul className="admin-order-refs">
            {data.receipts.map((receipt) => (
              <li className="row" key={receipt.id} style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                <span>
                  <strong className="mono">{receipt.orderNo ?? receipt.orderId}</strong>{' '}
                  {CASH_RECEIPT_KIND_LABELS[receipt.kind] ?? receipt.kind} · {krw(receipt.amount)}
                  {' · '}{CASH_RECEIPT_STATUS_LABELS[receipt.status] ?? receipt.status}
                  {receipt.identityMasked ? <span className="faint"> · {receipt.identityMasked}</span> : null}
                  {receipt.receiptNumber ? <span className="faint"> · 승인 {receipt.receiptNumber}</span> : null}
                  {receipt.errorMessage ? <span className="admin-form-error"> · {receipt.errorMessage}</span> : null}
                  <span className="faint"> · {formatOrderDateTime(receipt.requestedAt)}</span>
                </span>
                {receipt.status === 'issued' || receipt.status === 'queued' || receipt.status === 'requested'
                  ? <CancelForm receiptId={receipt.id} />
                  : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
        <div>
          <h2 style={{ fontSize: 16, margin: 0 }}>세금계산서 신청</h2>
          <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '6px 0 0' }}>
            발행은 스마트빌에서 사람이 합니다. 여기서는 신청을 받고, 승인하고, 발행된 승인번호를 적습니다.
          </p>
        </div>
        {data.invoices.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>접수된 신청이 없습니다.</p>
        ) : (
          <ul className="admin-order-refs">
            {data.invoices.map((invoice) => (
              <li className="col" key={invoice.id} style={{ gap: 6 }}>
                <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <strong className="mono">{invoice.orderNo ?? invoice.orderId}</strong>
                  <span>{invoice.businessName} · {formatBusinessNumber(invoice.businessNumber)}</span>
                  <span className="faint">{TAX_INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status}</span>
                  {invoice.approvalNumber ? <span className="faint">승인 {invoice.approvalNumber}</span> : null}
                </div>
                {invoice.status === 'requested' ? <InvoiceDecision requestId={invoice.id} /> : null}
                {invoice.status === 'approved' ? <InvoiceIssued requestId={invoice.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
