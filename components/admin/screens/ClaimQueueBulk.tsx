'use client';

import { startTransition, useActionState, useId, useState, type FormEvent } from 'react';
import { ConsoleGrid, type ConsoleGridColumn, type ConsoleGridRow } from '@/components/admin/console';
import { bulkDecideOrderClaimsAction } from '@/app/admin/claim-actions';
import {
  ADMIN_CLAIM_BULK_ACTION_LABELS,
  ADMIN_CLAIM_BULK_DECISIONS,
  ADMIN_CLAIM_BULK_LIMIT,
  ADMIN_CLAIM_BULK_OUTCOME_LABELS,
  planAdminClaimBulkSubmit,
  type AdminClaimBulkState,
} from '@/lib/admin/claim-bulk';
import { adminClaimCopy } from '@/lib/admin/vocabulary';
import type { OrderClaimType } from '@/lib/orders/claims';
import { ClaimPreviewLink } from './ClaimPreviewDialog';
import { ClaimRejectionReasonField } from './ClaimRejectionReasonField';

/*
 * 취소·반품·교환 목록의 선택 → 건별 순차 처리 → 결과표(R8 · D8).
 *
 * 선택은 지금 페이지에서 처리할 수 있는 행으로만 좁힌다. 다른 페이지·다른 조건에서 고른 요청을
 * 보이지 않는 채로 함께 보내지 않기 위해서다. 처리는 서버 액션이 한 건씩 기존 단건 경로로 하고,
 * 끝나면 목록은 revalidatePath로 다시 그려진다. 결과표는 목록에서 빠진 요청도 그대로 남긴다.
 *
 * 한 양식에 버튼이 셋이라 사유 칸의 Enter가 첫 버튼(승인)을 누르지 않게 막는다.
 */

const EMPTY_STATE: AdminClaimBulkState = {};

/* 확인 창을 거치지 않은 제출(하이드레이션 전 재생)은 버린다. 보내는 쪽은 onSubmit이다. */
function ignoreUnconfirmedBulkSubmit() {}

export function ClaimBulkResultTable({ previewHrefBase, state }: { previewHrefBase: string; state: AdminClaimBulkState }) {
  if (!state.results?.length) return null;
  return <section aria-label="일괄 처리 결과" className="admin-claim-bulk-result">
    <p role="status">{state.summary}</p>
    <table>
      <caption>일괄 처리 결과</caption>
      <thead><tr><th scope="col">번호</th><th scope="col">결과</th><th scope="col">사유</th></tr></thead>
      <tbody>
        {state.results.map((result) => <tr data-outcome={result.outcome} key={result.claimId}>
          <td>{result.reference
            ? <ClaimPreviewLink href={`${previewHrefBase}&claimId=${result.claimId}`} label={`요청 ${result.reference} 상세 열기`}>{result.reference}</ClaimPreviewLink>
            : <span className="muted">확인 불가</span>}</td>
          <td>{ADMIN_CLAIM_BULK_OUTCOME_LABELS[result.outcome]}</td>
          <td>{adminClaimCopy(result.message)}</td>
        </tr>)}
      </tbody>
    </table>
  </section>;
}

export function ClaimQueueBulkGrid({
  caption,
  claimType,
  columns,
  emptyLabel,
  preferencesKey,
  previewHrefBase,
  rows,
}: {
  caption: string;
  claimType: OrderClaimType;
  columns: ConsoleGridColumn[];
  emptyLabel: string;
  preferencesKey: string;
  /** 지금 목록 조건의 href. 결과표의 요청번호가 같은 목록 위 팝업을 연다. */
  previewHrefBase: string;
  rows: ConsoleGridRow[];
}) {
  const reasonId = useId();
  const [selection, setSelection] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [clientError, setClientError] = useState('');
  const [state, run, pending] = useActionState(async (previous: AdminClaimBulkState, formData: FormData) => {
    const next = await bulkDecideOrderClaimsAction(previous, formData);
    /* 시간 예산으로 남은 건만 선택에 남겨 그대로 다시 실행할 수 있게 한다. */
    if (next.results) setSelection(next.results.filter((result) => result.outcome === 'skipped').map((result) => result.claimId));
    return next;
  }, EMPTY_STATE);

  const eligible = new Set(rows.filter((row) => row.selectable !== false).map((row) => row.id));
  const selectedIds = selection.filter((id) => eligible.has(id));
  const overLimit = selectedIds.length > ADMIN_CLAIM_BULK_LIMIT;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter ?? null;
    const decision = submitter?.getAttribute('name') === 'decision' ? submitter.getAttribute('value') : null;
    const plan = planAdminClaimBulkSubmit(
      { claimType, count: selectedIds.length, decision, note },
      (message) => window.confirm(message),
    );
    if (plan.kind === 'invalid') {
      setClientError(plan.error);
      return;
    }
    setClientError('');
    if (plan.kind === 'dismissed') return;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => run(formData));
  }

  const error = clientError || state.error;
  return <form action={ignoreUnconfirmedBulkSubmit} className="admin-claim-bulk" onSubmit={submit}>
    <input name="claimType" type="hidden" value={claimType} />
    {selectedIds.map((id) => <input key={id} name="claimIds" type="hidden" value={id} />)}
    <ConsoleGrid
      caption={caption}
      columns={columns}
      emptyLabel={emptyLabel}
      onSelectionChange={setSelection}
      preferencesKey={preferencesKey}
      rows={rows}
      selectable={eligible.size > 0}
      selectedIds={selectedIds}
    >
      <div aria-label="선택 건 일괄 처리" className="admin-sales-workbar admin-claim-bulk-bar" role="group">
        <span className="admin-sales-selection">{selectedIds.length}건 선택 · 한 번에 최대 {ADMIN_CLAIM_BULK_LIMIT}건</span>
        {ADMIN_CLAIM_BULK_DECISIONS.map((decision) => <button
          disabled={pending || selectedIds.length === 0 || overLimit}
          key={decision}
          name="decision"
          type="submit"
          value={decision}
        >{ADMIN_CLAIM_BULK_ACTION_LABELS[decision]}</button>)}
        {pending ? <span className="admin-claim-bulk-progress" role="status">처리 중… 한 건씩 순서대로 처리합니다.</span> : null}
      </div>
      <div className="admin-claim-bulk-reason">
        <ClaimRejectionReasonField
          claimType={claimType}
          id={reasonId}
          label="거부 사유 (선택 건 거부에 함께 씁니다 · 10~200자, 구매자에게 전달됩니다)"
          onChange={setNote}
          suppressEnter
          value={note}
        />
      </div>
      {overLimit ? <p className="admin-claim-bulk-limit" role="alert">한 번에 {ADMIN_CLAIM_BULK_LIMIT}건까지 처리할 수 있습니다. 선택을 줄여주세요.</p> : null}
    </ConsoleGrid>
    {error ? <p className="admin-claim-bulk-error" role="alert">{adminClaimCopy(error)}</p> : null}
    <ClaimBulkResultTable previewHrefBase={previewHrefBase} state={state} />
  </form>;
}
