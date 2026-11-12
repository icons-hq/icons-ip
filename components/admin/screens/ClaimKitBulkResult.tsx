import { ADMIN_CLAIM_BULK_OUTCOME_LABELS, type AdminClaimBulkState } from '@/lib/admin/claim-bulk';
import { adminClaimCopy } from '@/lib/admin/vocabulary';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { ClaimPreviewLink } from './ClaimPreviewDialog';

/**
 * 일괄 처리의 건별 결과표(승인·거부·검토중·전환과 회수 확인·환불 완료 확정·재출고 공통). 목록에서 빠진 요청도 남고,
 * 요청번호는 같은 목록 위 팝업을 연다. 재출고처럼 한 요청을 출고지마다 처리하면 번호 옆에 출고지를 적는다.
 */
export function ClaimKitBulkResult({ previewHrefBase, state }: { previewHrefBase: string; state: AdminClaimBulkState }) {
  if (!state.results?.length) return null;
  return <section aria-label="일괄 처리 결과" className="flex flex-col gap-2">
    <p className="text-sm" role="status">{state.summary}</p>
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableCaption>일괄 처리 결과</TableCaption>
        <TableHeader><TableRow><TableHead scope="col">번호</TableHead><TableHead scope="col">결과</TableHead><TableHead scope="col">사유</TableHead></TableRow></TableHeader>
        <TableBody>
          {state.results.map((result) => <TableRow data-outcome={result.outcome} key={`${result.claimId}:${result.scope ?? ''}`}>
            <TableCell>{result.reference
              ? <ClaimPreviewLink href={`${previewHrefBase}&claimId=${result.claimId}`} label={`요청 ${result.reference} 상세 열기`}>{result.reference}</ClaimPreviewLink>
              : <span className="text-muted-foreground">확인 불가</span>}
            {result.scope ? <span className="ml-1.5 text-muted-foreground">{result.scope}</span> : null}</TableCell>
            <TableCell>{ADMIN_CLAIM_BULK_OUTCOME_LABELS[result.outcome]}</TableCell>
            <TableCell className="whitespace-normal">{adminClaimCopy(result.message)}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </div>
  </section>;
}
