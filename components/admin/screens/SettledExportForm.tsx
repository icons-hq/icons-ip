'use client';
import { useActionState } from 'react';
import { createSettledExportAction } from '@/app/admin/settled-export-actions';
import type { SettledExportFilters } from '@/lib/admin/settled-export';
import { Download } from 'lucide-react';
import { Button } from '@/components/admin/kit/ui/button';
import { EncryptedWorkbookDownloadButton } from '../EncryptedWorkbookDownloadButton';

/*
 * 거래확정 엑셀은 두 단계다: [엑셀 만들기]가 지금 조회 조건의 내용을 그때 모습 그대로 담아 두고, [엑셀 내려받기]가 비밀번호를 정해 파일로 받는다.
 * 첫 버튼은 파일을 받지 않으므로 다른 목록의 '목록 엑셀 다운로드'와 이름을 달리한다. 위치와 모양은 그 버튼(kit)과 같다.
 */
export function SettledExportForm({ filters, requestId, initialReceiptId }: { filters: SettledExportFilters; requestId: string; initialReceiptId?: string }) {
  const [state, action, pending] = useActionState(createSettledExportAction, {});
  const receiptId = state.receipt?.id ?? initialReceiptId;
  return <div className="flex flex-col items-end gap-2" data-settled-export=""><form action={action} className="flex flex-col items-end gap-1">
    <input type="hidden" name="requestId" value={state.requestId ?? requestId} />
    <input type="hidden" name="from" value={filters.from ?? ''} />
    <input type="hidden" name="to" value={filters.to ?? ''} />
    <input type="hidden" name="query" value={filters.query} />
    {filters.dateField ? <input type="hidden" name="dateField" value={filters.dateField} /> : null}
    {filters.field ? <input type="hidden" name="field" value={filters.field} /> : null}
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" type="submit" variant="outline" disabled={pending}><Download aria-hidden="true" />{pending ? '엑셀 만드는 중…' : '엑셀 만들기'}</Button>
      <span className="max-w-md text-right text-xs leading-snug text-muted-foreground" title="지금 조회 조건의 모든 페이지를 담습니다. 만든 때의 내용 그대로라, 나중에 주문이 바뀌어도 파일은 달라지지 않습니다.">주문 1,000건·품목 10,000줄까지 담습니다.</span>
    </div>
    {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
  </form>
    {receiptId ? <div className="flex flex-wrap items-center justify-end gap-2">
      {state.receipt ? <span className="text-sm text-success" role="status">주문 {state.receipt.orderCount.toLocaleString('ko-KR')}건을 담았습니다.</span> : null}
      <EncryptedWorkbookDownloadButton key={receiptId} href={`/api/admin/settled-workbook?id=${receiptId}`} label="엑셀 내려받기" snapshot />
      <a className="text-sm underline underline-offset-4" href={`/admin/sales/settled?exportReceipt=${receiptId}`}>이 엑셀을 다시 받는 주소</a>
      <span className="basis-full text-right text-xs text-muted-foreground">이 주소를 저장해 두면 만든 사람이 같은 내용을 새 비밀번호로 다시 받을 수 있습니다.</span>
    </div> : null}
  </div>;
}
