'use client';

/** 거래명세서 인쇄(브라우저 인쇄 창). 인쇄 모양은 `wc-order-statement.css`의 @media print가 정한다. */
export function StatementPrintButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      인쇄하기
    </button>
  );
}
