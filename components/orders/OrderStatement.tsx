import Link from 'next/link';
import { krw } from '@/lib/format';
import { STATEMENT_TITLE, type OrderStatementModel, type StatementInfoRow } from '@/lib/orders/statement';
import { StatementPrintButton } from './StatementPrintButton';
import '@/app/styles/wc-order-statement.css';

export const STATEMENT_BACK_LABEL = '주문 상세로 돌아가기';

function InfoList({ rows }: { rows: StatementInfoRow[] }) {
  return (
    <dl className="wc-statement__info">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 거래명세서(MD-0038). 주문 한 건의 공급자·품목·금액(부가세 포함)을 확인·인쇄하는 문서다. 모델이 없으면(결제 전·취소 주문)
 * 발급하지 않는 사유와 주문 상세로 가는 길만 보인다. 금액은 서버 영수증에서 온 모델 값을 그대로 그린다.
 */
export function OrderStatement({ orderId, model, unavailableMessage }: {
  orderId: string;
  model: OrderStatementModel | null;
  unavailableMessage?: string | null;
}) {
  const orderHref = `/orders/${orderId}`;
  if (!model) {
    return (
      <main className="wc-root wc-statement-page">
        <section className="wc-statement-empty" aria-labelledby="statement-title">
          <h1 id="statement-title">{STATEMENT_TITLE}</h1>
          <p role="status">{unavailableMessage ?? '거래명세서를 발급할 수 없는 주문이에요.'}</p>
          <Link className="wc-btn" href={orderHref}>{STATEMENT_BACK_LABEL}</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="wc-root wc-statement-page">
      <div className="wc-statement-toolbar">
        <Link className="wc-btn" href={orderHref}>{STATEMENT_BACK_LABEL}</Link>
        <StatementPrintButton className="wc-btn primary" />
      </div>

      <article className="wc-statement" aria-labelledby="statement-title">
        <h1 id="statement-title" className="wc-statement__title">{STATEMENT_TITLE}</h1>

        <dl className="wc-statement__meta">
          <div><dt>발행일</dt><dd>{model.issuedOn}</dd></div>
          <div><dt>주문번호</dt><dd>{model.orderNumber}</dd></div>
          <div><dt>거래일시</dt><dd>{model.tradedAt}</dd></div>
          <div><dt>결제수단</dt><dd>{model.paymentLabel}</dd></div>
        </dl>

        <div className="wc-statement__parties">
          <section aria-labelledby="statement-supplier">
            <h2 id="statement-supplier">공급자</h2>
            <InfoList rows={model.supplier} />
          </section>
          <section aria-labelledby="statement-buyer">
            <h2 id="statement-buyer">공급받는자</h2>
            <InfoList rows={model.buyer} />
          </section>
        </div>

        <table className="wc-statement__items">
          <caption>주문 품목</caption>
          <thead>
            <tr>
              <th scope="col">품목</th>
              <th scope="col">옵션</th>
              <th scope="col" className="wc-statement__num">수량</th>
              <th scope="col" className="wc-statement__num">단가</th>
              <th scope="col" className="wc-statement__num">금액</th>
            </tr>
          </thead>
          <tbody>
            {model.items.map((item) => (
              <tr key={item.key}>
                <th scope="row" className="wc-statement__item-name">{item.name}</th>
                <td data-label="옵션">{item.option}</td>
                <td className="wc-statement__num" data-label="수량">{item.qty}</td>
                <td className="wc-statement__num" data-label="단가">{krw(item.unitPrice)}</td>
                <td className="wc-statement__num" data-label="금액">{krw(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="wc-statement__totals">
          <caption>금액 합계</caption>
          <tbody>
            {model.totals.map((row) => (
              <tr key={row.key} data-kind={row.kind}>
                <th scope="row">{row.label}</th>
                <td className="wc-statement__num">{row.kind === 'deduction' ? '−' : ''}{krw(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {model.collectNotice ? <p className="wc-statement__collect">{model.collectNotice}</p> : null}

        <ul className="wc-statement__notes">
          {model.notices.map((notice) => <li key={notice}>{notice}</li>)}
        </ul>
      </article>
    </main>
  );
}
