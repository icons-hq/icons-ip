'use client';
import { useActionState } from 'react';
import { createSettledExportAction } from '@/app/admin/settled-export-actions';
import { ADMIN_LIST_EXPORT_BUTTON_LABEL } from '@/lib/admin/list-export';
import type { SettledExportFilters } from '@/lib/admin/settled-export';
import { Download } from 'lucide-react';
import { Button } from '@/components/admin/kit/ui/button';
import { EncryptedWorkbookDownloadButton } from '../EncryptedWorkbookDownloadButton';

/* 버튼 이름·위치만 다른 목록과 맞춘다. 보존 기록을 만든 뒤 링크로 받는 기존 동선은 그대로다. 모양은 목록 엑셀 다운로드(kit)와 같다. */
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
      <Button size="sm" type="submit" variant="outline" disabled={pending}><Download aria-hidden="true" />{pending ? '엑셀 기록 생성 중…' : ADMIN_LIST_EXPORT_BUTTON_LABEL}</Button>
      <span className="max-w-md text-right text-xs leading-snug text-muted-foreground">현재 조회 조건의 전체 페이지를 담습니다. 주문 1,000건·품목 10,000행까지 생성할 수 있으며, 생성한 기록은 이후 변경과 무관하게 유지됩니다.</span>
    </div>
    {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
  </form>
    {receiptId ? <div className="flex flex-wrap items-center justify-end gap-2">
      {state.receipt ? <span className="text-sm text-[var(--wc-success)]" role="status">주문 {state.receipt.orderCount.toLocaleString('ko-KR')}건을 보존했습니다.</span> : null}
      <EncryptedWorkbookDownloadButton key={receiptId} href={`/api/admin/settled-workbook?id=${receiptId}`} label="거래확정 엑셀 다운로드" snapshot />
      <a className="text-sm underline underline-offset-4" href={`/admin/sales/settled?exportReceipt=${receiptId}`}>보존 기록 다시 받기</a>
      <span className="basis-full text-right text-xs text-muted-foreground">보존된 같은 내용을 매번 새 비밀번호로 받을 수 있습니다.</span>
    </div> : null}
  </div>;
}
