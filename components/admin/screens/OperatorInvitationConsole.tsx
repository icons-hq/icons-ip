'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { cancelOperatorInvitationAction, createOperatorInvitationsAction, reissueOperatorInvitationAction, retryOperatorInvitationEmailAction } from '@/app/admin/operator-invitation-actions';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { MANAGER_ROLE_LABELS } from '@/lib/admin/access';
import { ASSIGNABLE_MANAGER_ROLES, OPERATOR_DIRECTORY_PATH, OPERATOR_DUTIES, isAssignableManagerRole, isOperatorDuty } from '@/lib/admin/operator-directory';
import { OPERATOR_INVITATION_STATUSES, OPERATOR_INVITATION_STATUS_LABELS, invitationEmailLabel, normalizeOperatorInvitationInput, type OperatorInvitationInput, type OperatorInvitationList, type OperatorInvitationRecord, type OperatorInvitationWriteResult } from '@/lib/admin/operator-invitations';

type Draft = Omit<OperatorInvitationInput, 'id'>;
const emptyDraft = (): Draft => ({ name: '', email: '', managerRole: 'deputy', duty: 'other' });
function InvitationFields({ draft, index, disabled, onChange }: { draft: Draft; index: number; disabled: boolean; onChange: (value: Draft) => void }) {
  return <div className="admin-operator-invite-fields">
    <label>이름<input aria-label={`초대 ${index} 이름`} required maxLength={100} value={draft.name} disabled={disabled} autoComplete="off" onChange={event => onChange({ ...draft, name: event.target.value })} /></label>
    <label>이메일<input aria-label={`초대 ${index} 이메일`} type="email" required maxLength={320} value={draft.email} disabled={disabled} autoComplete="off" onChange={event => onChange({ ...draft, email: event.target.value })} /></label>
    <label>매니저 권한<select aria-label={`초대 ${index} 매니저 권한`} value={draft.managerRole} disabled={disabled} onChange={event => { if (isAssignableManagerRole(event.target.value)) onChange({ ...draft, managerRole: event.target.value }); }}>{ASSIGNABLE_MANAGER_ROLES.map(role => <option value={role} key={role}>{MANAGER_ROLE_LABELS[role]}</option>)}</select></label>
    <label>담당업무<select aria-label={`초대 ${index} 담당업무`} value={draft.duty} disabled={disabled} onChange={event => { if (isOperatorDuty(event.target.value)) onChange({ ...draft, duty: event.target.value }); }}>{OPERATOR_DUTIES.map(duty => <option value={duty.value} key={duty.value}>{duty.label}</option>)}</select></label>
  </div>;
}

type WriteReceipt = OperatorInvitationWriteResult | { revision: number; accessRevision: number };
function useInvitationRequest(onSuccess: (result: Exclude<WriteReceipt, { error: string }>) => void) {
  const [request, setRequest] = useState<{ id: string; run: (id: string) => Promise<WriteReceipt> } | null>(null);
  const [pending, setPending] = useState(false); const [uncertain, setUncertain] = useState(false); const [error, setError] = useState('');
  async function run(task: (id: string) => Promise<WriteReceipt>) {
    if (pending) return;
    const active = request ?? { id: crypto.randomUUID(), run: task };
    setRequest(active); setPending(true); setError('');
    try {
      const result = await active.run(active.id);
      if ('error' in result) { setError(result.error); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) setRequest(null); return; }
      setRequest(null); setUncertain(false); onSuccess(result);
    } catch { setError('처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.'); setUncertain(true); }
    finally { setPending(false); }
  }
  return { pending, uncertain, error, run };
}

function CreateInvitations({ accessRevision }: { accessRevision: number }) {
  const router = useRouter(); const dialog = useRef<HTMLDialogElement>(null);
  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft()]); const [confirmed, setConfirmed] = useState(false); const [inputError, setInputError] = useState(''); const [message, setMessage] = useState('');
  const request = useInvitationRequest(result => { setMessage('count' in result ? `${result.count}명의 초대를 등록했습니다. ${result.delivery}` : '저장했습니다.'); setDrafts([emptyDraft()]); setConfirmed(false); dialog.current?.close(); router.refresh(); });
  async function submit(event: FormEvent) {
    event.preventDefault();
    const rows = drafts.map(row => normalizeOperatorInvitationInput({ ...row, id: crypto.randomUUID() }));
    if (!request.uncertain && (!confirmed || rows.some(row => !row) || new Set(rows.map(row => row?.email)).size !== rows.length)) { setInputError('중복되지 않는 이름·이메일과 부여할 권한을 확인해주세요.'); return; }
    setInputError('');
    await request.run(operationId => createOperatorInvitationsAction(rows as OperatorInvitationInput[], accessRevision, operationId));
  }
  return <><div className="admin-operator-invite-start"><button type="button" className="admin-operator-primary" onClick={() => dialog.current?.showModal()}>매니저 초대</button><span>한 번에 최대 10명 · 초대 유효기간 7일</span></div>{message ? <p role="status" className="admin-operator-invite-message">{message}</p> : null}
    <dialog ref={dialog} className="admin-grid-settings-dialog admin-operator-invite-dialog" aria-label="매니저 초대" onCancel={event => { if (request.pending) event.preventDefault(); }}>
      <header><h2>매니저 초대</h2><button type="button" className="admin-grid-settings-close" aria-label="매니저 초대 닫기" disabled={request.pending} onClick={() => dialog.current?.close()}>×</button></header>
      <form onSubmit={submit}><div className="admin-grid-settings-body"><p>초대받은 이메일을 인증한 계정이 수락하면 선택한 권한이 적용됩니다. 통합 매니저는 초대할 수 없으며, 기존 계정 주매니저에게 승계합니다.</p>
        {drafts.map((draft, index) => <div className="admin-operator-invite-row" key={index}><strong>초대 {index + 1}</strong><InvitationFields draft={draft} index={index + 1} disabled={request.pending || request.uncertain} onChange={value => { setDrafts(current => current.map((row, rowIndex) => rowIndex === index ? value : row)); setConfirmed(false); }} />{drafts.length > 1 ? <button type="button" disabled={request.pending || request.uncertain} onClick={() => { setDrafts(current => current.filter((_, rowIndex) => rowIndex !== index)); setConfirmed(false); }} aria-label={`초대 ${index + 1} 삭제`}>삭제</button> : null}</div>)}
        <button type="button" disabled={drafts.length >= 10 || request.pending || request.uncertain} onClick={() => { setDrafts(current => [...current, emptyDraft()]); setConfirmed(false); }}>초대할 매니저 추가 ({drafts.length}/10)</button>
        <label className="admin-operator-confirm"><input type="checkbox" checked={confirmed} disabled={request.pending || request.uncertain} onChange={event => setConfirmed(event.target.checked)} />입력한 이메일과 부여할 매니저 권한을 확인했습니다.</label>
        {inputError || request.error ? <p role="alert">{inputError || request.error}</p> : null}
      </div><footer className="admin-operator-duty-dialog__actions"><button type="button" disabled={request.pending} onClick={() => dialog.current?.close()}>닫기</button><button type="submit" className="admin-operator-primary" disabled={request.pending}>{request.pending ? '처리 중' : request.uncertain ? '같은 요청으로 결과 확인' : '이메일 초대 보내기'}</button></footer></form>
    </dialog></>;
}

function InvitationControls({ row, accessRevision }: { row: OperatorInvitationRecord; accessRevision: number }) {
  const router = useRouter(); const dialog = useRef<HTMLDialogElement>(null);
  const [intent, setIntent] = useState<'reissue' | 'cancel'>('reissue'); const [draft, setDraft] = useState<Draft>({ name: row.name, email: '', managerRole: row.managerRole, duty: row.duty });
  const [confirmed, setConfirmed] = useState(false); const [inputError, setInputError] = useState(''); const [message, setMessage] = useState(''); const [retrying, setRetrying] = useState(false);
  const request = useInvitationRequest(result => { setMessage('count' in result ? result.delivery : '초대를 취소했습니다.'); dialog.current?.close(); router.refresh(); });
  const canReissue = ['pending', 'expired', 'cancelled'].includes(row.status); const canCancel = row.status === 'pending' || row.status === 'expired';
  function open(next: typeof intent) { if (!request.uncertain) { setIntent(next); setConfirmed(false); setInputError(''); } dialog.current?.showModal(); }
  async function submit(event: FormEvent) {
    event.preventDefault(); const input = normalizeOperatorInvitationInput({ ...draft, id: crypto.randomUUID() });
    if (!request.uncertain && (!confirmed || (intent === 'reissue' && !input))) { setInputError('이메일과 변경 내용을 확인해주세요.'); return; }
    setInputError('');
    await request.run(operationId => intent === 'cancel' ? cancelOperatorInvitationAction(row.id, row.revision, accessRevision, operationId)
      : reissueOperatorInvitationAction(row.id, input!, row.revision, accessRevision, operationId));
  }
  async function retry() {
    if (retrying) return; setRetrying(true); setMessage('');
    try { const result = await retryOperatorInvitationEmailAction(row.id); setMessage('error' in result ? result.error : result.message); router.refresh(); }
    catch { setMessage('발송 결과를 확인하지 못했습니다. 초대 내역을 새로고침해주세요.'); }
    finally { setRetrying(false); }
  }
  return <><div className="admin-operator-directory__controls">{row.status === 'pending' ? <button type="button" disabled={retrying || request.pending} onClick={() => { void retry(); }} aria-label={`${row.name} 이메일 발송 재시도`}>{retrying ? '확인 중' : '발송 재시도'}</button> : null}{canReissue ? <button type="button" disabled={request.pending} onClick={() => open('reissue')} aria-label={`${row.name} 재초대`}>재초대</button> : null}{canCancel ? <button type="button" disabled={request.pending} onClick={() => open('cancel')} aria-label={`${row.name} 초대 취소`}>초대 취소</button> : null}</div>{message ? <small role="status">{message}</small> : null}
    <dialog ref={dialog} className="admin-grid-settings-dialog admin-operator-invite-dialog" aria-label={intent === 'cancel' ? '매니저 초대 취소' : '매니저 재초대'} onCancel={event => { if (request.pending) event.preventDefault(); }}>
      <header><h2>{intent === 'cancel' ? '매니저 초대 취소' : '매니저 재초대'}</h2><button type="button" className="admin-grid-settings-close" aria-label="초대 변경 닫기" disabled={request.pending} onClick={() => dialog.current?.close()}>×</button></header>
      <form onSubmit={submit}><div className="admin-grid-settings-body"><p><strong>{row.name}</strong> · {row.maskedEmail}</p>{intent === 'reissue' ? <><p>기존 초대와 같은 이메일을 다시 입력해주세요. 새 초대가 등록되면 이전 링크는 사용할 수 없습니다.</p><InvitationFields draft={draft} index={1} disabled={request.pending || request.uncertain} onChange={value => { setDraft(value); setConfirmed(false); }} /></> : <p>초대를 취소하면 발송된 링크를 수락할 수 없습니다. 이미 발송한 이메일은 회수되지 않습니다.</p>}
        <label className="admin-operator-confirm"><input type="checkbox" checked={confirmed} disabled={request.pending || request.uncertain} onChange={event => setConfirmed(event.target.checked)} />위 내용을 확인했습니다.</label>{inputError || request.error ? <p role="alert">{inputError || request.error}</p> : null}
      </div><footer className="admin-operator-duty-dialog__actions"><button type="button" disabled={request.pending} onClick={() => dialog.current?.close()}>닫기</button><button type="submit" className="admin-operator-primary" disabled={request.pending}>{request.pending ? '처리 중' : request.uncertain ? '같은 요청으로 결과 확인' : intent === 'cancel' ? '초대 취소' : '재초대 보내기'}</button></footer></form>
    </dialog></>;
}

function invitationHref(data: OperatorInvitationList, page: number) { const params = new URLSearchParams({ inviteQuery: data.query, inviteStatus: data.status, invitePage: String(page), invitePageSize: String(data.pageSize) }); return `${OPERATOR_DIRECTORY_PATH}?${params}#manager-invitations`; }
const dateLabel = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
export function OperatorInvitationConsole({ data, accessRevision }: { data: OperatorInvitationList; accessRevision: number }) {
  return <section id="manager-invitations" className="admin-operator-directory__list admin-operator-invitations"><header><h2>매니저 초대 내역 <strong>{data.total.toLocaleString('ko-KR')}건</strong></h2></header>
    <div className="admin-operator-directory__guide"><p>초대 등록·이메일 발송·매니저 수락은 각각 확인합니다. 수락 대기 중에는 어드민 권한이 생기지 않습니다. 매니저와 유효한 수락 대기 초대를 합해 최대 1,000명입니다.</p><p>초대한 관리자의 매니저 관리 권한이 회수되면 그 관리자가 만든 수락 대기 초대도 취소됩니다.</p></div><CreateInvitations accessRevision={accessRevision} />
    <form action={`${OPERATOR_DIRECTORY_PATH}#manager-invitations`} className="admin-operator-invite-filter"><label>초대 검색<input type="search" name="inviteQuery" defaultValue={data.query} maxLength={100} placeholder="이름·이메일" /></label><label>초대 상태<select name="inviteStatus" defaultValue={data.status}><option value="all">전체 상태</option>{OPERATOR_INVITATION_STATUSES.map(status => <option key={status} value={status}>{OPERATOR_INVITATION_STATUS_LABELS[status]}</option>)}</select></label><label>목록 개수<select name="invitePageSize" defaultValue={data.pageSize}>{[20, 50, 100].map(size => <option key={size} value={size}>{size}개씩</option>)}</select></label><button type="submit">검색</button><Link href={`${OPERATOR_DIRECTORY_PATH}#manager-invitations`}>초기화</Link></form>
    <div className="admin-operator-directory__table" tabIndex={0} role="region" aria-label="매니저 초대 내역 표"><table><thead><tr><th>이름 / 이메일</th><th>매니저 권한 / 담당업무</th><th>초대 상태</th><th>이메일 발송</th><th>초대일 / 만료일</th><th>관리</th></tr></thead><tbody>{data.rows.map(row => <tr key={row.id}><td>{row.name}<small>{row.maskedEmail}</small></td><td>{MANAGER_ROLE_LABELS[row.managerRole]}<small>{OPERATOR_DUTIES.find(duty => duty.value === row.duty)?.label}</small></td><td>{OPERATOR_INVITATION_STATUS_LABELS[row.status]}</td><td>{invitationEmailLabel(row)}</td><td>{dateLabel(row.createdAt)}<small>만료 {dateLabel(row.expiresAt)}</small></td><td><InvitationControls key={`${row.id}:${row.revision}`} row={row} accessRevision={accessRevision} /></td></tr>)}{!data.rows.length ? <tr><td colSpan={6}>조회 조건에 맞는 초대가 없습니다.</td></tr> : null}</tbody></table></div>
    <ConsolePagination page={data.page} pageSize={data.pageSize} total={data.total} hrefForPage={page => invitationHref(data, page)} />
  </section>;
}
