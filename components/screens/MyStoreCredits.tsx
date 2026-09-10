import Link from 'next/link';
import { MypageShell } from '@/components/wc/MypageShell';
import { formatOrderDateTime } from '@/lib/orders';
import { storeCreditEntryLabel, type StoreCreditHistory } from '@/lib/store-credits';

export function StoreCreditHistoryList({ history, pagePath }: { history: StoreCreditHistory; pagePath: string }) {
  return <>
    <p>전체 {history.total.toLocaleString('ko-KR')}건 · {history.page}페이지</p>
    {history.items.length ? <ul className="wc-coin-list">{history.items.map(entry => <li key={entry.id} className={`wc-coin-row wc-coin-row--${entry.availableDelta >= 0 ? 'earn' : 'spend'}`}>
      <div className="wc-coin-row__body">
        <p className="wc-coin-row__reason">{storeCreditEntryLabel(entry.kind)}</p>
        <p className="wc-coin-row__meta"><time dateTime={entry.createdAt}>{formatOrderDateTime(entry.createdAt)}</time></p>
        {entry.reason ? <p>{entry.reason}</p> : null}
        {entry.expiresAt ? <p>유효기간 {formatOrderDateTime(entry.expiresAt)}</p> : null}
        {entry.debtDelta ? <p>회수 예정 {entry.debtDelta > 0 ? '+' : ''}{entry.debtDelta.toLocaleString('ko-KR')}원</p> : null}
        {entry.orderId ? <Link href={pagePath.startsWith('/admin/') ? `/admin/sales/orders/${entry.orderId}` : `/orders/${entry.orderId}`}>관련 주문</Link> : null}
      </div>
      <p className="wc-coin-row__amount">{entry.kind === 'consume' ? `${Math.abs(entry.reservedDelta).toLocaleString('ko-KR')}원 사용 확정`
        : <><strong>{entry.availableDelta > 0 ? '+' : ''}{entry.availableDelta.toLocaleString('ko-KR')}</strong>원</>}</p>
    </li>)}</ul> : <p>적립금 이력이 없습니다.</p>}
    <nav aria-label="적립금 이력 페이지" className="wc-admin-kit__actions">
      {history.page > 1 ? <Link href={`${pagePath}?page=${history.page - 1}`}>이전</Link> : null}
      {history.page * history.pageSize < history.total ? <Link href={`${pagePath}?page=${history.page + 1}`}>다음</Link> : null}
    </nav>
  </>;
}
export function StoreCreditBalance({ history }: { history: StoreCreditHistory }) {
  return <section aria-label="적립금 잔액" className="wc-coin-strip">
    <p className="wc-coin-strip__balance">사용 가능 <strong>{history.available.toLocaleString('ko-KR')}</strong>원</p>
    <p>주문 사용 대기 {history.reserved.toLocaleString('ko-KR')}원</p>
    {history.debt > 0 ? <p>회수 예정 {history.debt.toLocaleString('ko-KR')}원</p> : null}
  </section>;
}
export function MyStoreCredits({ history }: { history: StoreCreditHistory | null }) {
  return <MypageShell active="/my/store-credits">
    <h1 className="wc-mypage__heading">적립금</h1>
    {history ? <>
      <StoreCreditBalance history={history} />
      {!history.enabled ? <p role="status">적립금 지급과 주문 사용을 준비 중입니다. 기존 잔액과 이력은 계속 확인할 수 있습니다.</p> : null}
      <StoreCreditHistoryList history={history} pagePath="/my/store-credits" />
      <div className="wc-coin-guide"><p>적립금 안내</p><ul>
        <li>적립금은 굿즈 주문 할인에 사용하며 무료 코인·카드팩과 별도로 관리됩니다.</li>
        <li>쿠폰을 적용한 뒤 남은 굿즈 금액에 사용합니다. 배송비에는 사용할 수 없습니다.</li>
        <li>결제 결과를 확인하는 동안 사용 대기 금액은 다른 주문에 사용할 수 없습니다.</li>
        <li>주문 취소·전액 환불이 완료되면 주문 당시 기준으로 사용분을 복원합니다.</li>
        <li>환불 주문에서 받은 적립금은 회수합니다. 이미 사용한 금액은 이후 적립·복원 금액에서 상계하며 현금으로 청구하지 않습니다.</li>
      </ul></div>
    </> : <p role="alert">적립금 내역을 불러오지 못했습니다. 잠시 후 다시 열어주세요.</p>}
  </MypageShell>;
}
