'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { cancelOperatorInvitationAction, createOperatorInvitationsAction, reissueOperatorInvitationAction, retryOperatorInvitationEmailAction } from '@/app/admin/operator-invitation-actions';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { Plus, Search, UserPlus, X } from 'lucide-react';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { ALERT_BOX, CHECK_LABEL_TOP, DIALOG_BODY, DIALOG_FOOTER, DIALOG_FORM, DIALOG_HEADER, DIALOG_TITLE, FIELD_HINT, FIELD_LABEL, NATIVE_DIALOG_WIDE, NOTE, OPERATOR_CARD, OPERATOR_GUIDE, OPERATOR_TABLE, RESULT_HEADING, STATUS_BOX } from '@/components/admin/settings-kit';
import { MANAGER_ROLE_LABELS } from '@/lib/admin/access';
import { ASSIGNABLE_MANAGER_ROLES, OPERATOR_DIRECTORY_PATH, OPERATOR_DUTIES, isAssignableManagerRole, isOperatorDuty } from '@/lib/admin/operator-directory';
import { OPERATOR_INVITATION_STATUSES, OPERATOR_INVITATION_STATUS_LABELS, invitationEmailLabel, normalizeOperatorInvitationInput, type OperatorInvitationInput, type OperatorInvitationList, type OperatorInvitationRecord, type OperatorInvitationWriteResult } from '@/lib/admin/operator-invitations';

type Draft = Omit<OperatorInvitationInput, 'id'>;
const emptyDraft = (): Draft => ({ name: '', email: '', managerRole: 'deputy', duty: 'other' });
function InvitationFields({ draft, index, disabled, onChange }: { draft: Draft; index: number; disabled: boolean; onChange: (value: Draft) => void }) {
  return <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-[1fr_1.7fr_1.5fr_1fr]">
    <label className={FIELD_LABEL}>이름<Input aria-label={`초대 ${index} 이름`} required maxLength={100} value={draft.name} disabled={disabled} autoComplete="off" onChange={event => onChange({ ...draft, name: event.target.value })} /></label>
    <label className={FIELD_LABEL}>이메일<Input aria-label={`초대 ${index} 이메일`} type="email" required maxLength={320} value={draft.email} disabled={disabled} autoComplete="off" onChange={event => onChange({ ...draft, email: event.target.value })} /></label>
    <label className={FIELD_LABEL}>매니저 권한<NativeSelect className="w-full" aria-label={`초대 ${index} 매니저 권한`} value={draft.managerRole} disabled={disabled} onChange={event => { if (isAssignableManagerRole(event.target.value)) onChange({ ...draft, managerRole: event.target.value }); }}>{ASSIGNABLE_MANAGER_ROLES.map(role => <option value={role} key={role}>{MANAGER_ROLE_LABELS[role]}</option>)}</NativeSelect></label>
    <label className={FIELD_LABEL}>담당업무<NativeSelect className="w-full" aria-label={`초대 ${index} 담당업무`} value={draft.duty} disabled={disabled} onChange={event => { if (isOperatorDuty(event.target.value)) onChange({ ...draft, duty: event.target.value }); }}>{OPERATOR_DUTIES.map(duty => <option value={duty.value} key={duty.value}>{duty.label}</option>)}</NativeSelect></label>
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
  return <><div className="flex flex-wrap items-center gap-3 px-4"><Button onClick={() => dialog.current?.showModal()} type="button"><UserPlus aria-hidden="true" />매니저 초대</Button><span className="text-sm text-muted-foreground">한 번에 최대 10명 · 초대 유효기간 7일</span></div>{message ? <p className={`mx-4 ${STATUS_BOX}`} role="status">{message}</p> : null}
    <dialog ref={dialog} className={NATIVE_DIALOG_WIDE} aria-label="매니저 초대" onCancel={event => { if (request.pending) event.preventDefault(); }}>
      <header className={DIALOG_HEADER}><h2 className={DIALOG_TITLE}>매니저 초대</h2><Button aria-label="매니저 초대 닫기" disabled={request.pending} onClick={() => dialog.current?.close()} size="icon-sm" type="button" variant="ghost"><X /></Button></header>
      <form className={DIALOG_FORM} onSubmit={submit}><div className={DIALOG_BODY}><p className={NOTE}>초대받은 이메일을 인증한 계정이 수락하면 선택한 권한이 적용됩니다. 통합 매니저는 초대할 수 없으며, 기존 계정 주매니저에게 승계합니다.</p>
        {drafts.map((draft, index) => <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" key={index}><strong className="text-sm font-medium">초대 {index + 1}</strong><InvitationFields draft={draft} index={index + 1} disabled={request.pending || request.uncertain} onChange={value => { setDrafts(current => current.map((row, rowIndex) => rowIndex === index ? value : row)); setConfirmed(false); }} />{drafts.length > 1 ? <Button aria-label={`초대 ${index + 1} 삭제`} className="self-end" disabled={request.pending || request.uncertain} onClick={() => { setDrafts(current => current.filter((_, rowIndex) => rowIndex !== index)); setConfirmed(false); }} size="sm" type="button" variant="ghost">삭제</Button> : null}</div>)}
        <Button className="w-fit" disabled={drafts.length >= 10 || request.pending || request.uncertain} onClick={() => { setDrafts(current => [...current, emptyDraft()]); setConfirmed(false); }} type="button" variant="outline"><Plus aria-hidden="true" />초대할 매니저 추가 ({drafts.length}/10)</Button>
        <label className={CHECK_LABEL_TOP}><input className="mt-0.5" type="checkbox" checked={confirmed} disabled={request.pending || request.uncertain} onChange={event => setConfirmed(event.target.checked)} />입력한 이메일과 부여할 매니저 권한을 확인했습니다.</label>
        {inputError || request.error ? <p className={ALERT_BOX} role="alert">{inputError || request.error}</p> : null}
      </div><footer className={DIALOG_FOOTER}><Button disabled={request.pending} onClick={() => dialog.current?.close()} type="button" variant="outline">닫기</Button><Button disabled={request.pending} type="submit">{request.pending ? '처리 중' : request.uncertain ? '같은 요청으로 결과 확인' : '이메일 초대 보내기'}</Button></footer></form>
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
  return <><div className="flex flex-wrap gap-1.5">{row.status === 'pending' ? <Button aria-label={`${row.name} 이메일 발송 재시도`} disabled={retrying || request.pending} onClick={() => { void retry(); }} size="xs" type="button" variant="outline">{retrying ? '확인 중' : '발송 재시도'}</Button> : null}{canReissue ? <Button aria-label={`${row.name} 재초대`} disabled={request.pending} onClick={() => open('reissue')} size="xs" type="button" variant="outline">재초대</Button> : null}{canCancel ? <Button aria-label={`${row.name} 초대 취소`} disabled={request.pending} onClick={() => open('cancel')} size="xs" type="button" variant="destructive">초대 취소</Button> : null}</div>{message ? <small className={`mt-1 block ${FIELD_HINT}`} role="status">{message}</small> : null}
    <dialog ref={dialog} className={NATIVE_DIALOG_WIDE} aria-label={intent === 'cancel' ? '매니저 초대 취소' : '매니저 재초대'} onCancel={event => { if (request.pending) event.preventDefault(); }}>
      <header className={DIALOG_HEADER}><h2 className={DIALOG_TITLE}>{intent === 'cancel' ? '매니저 초대 취소' : '매니저 재초대'}</h2><Button aria-label="초대 변경 닫기" disabled={request.pending} onClick={() => dialog.current?.close()} size="icon-sm" type="button" variant="ghost"><X /></Button></header>
      <form className={DIALOG_FORM} onSubmit={submit}><div className={DIALOG_BODY}><p><strong className="font-medium">{row.name}</strong> · <span className="text-muted-foreground">{row.maskedEmail}</span></p>{intent === 'reissue' ? <><p className={NOTE}>기존 초대와 같은 이메일을 다시 입력해주세요. 새 초대가 등록되면 이전 링크는 사용할 수 없습니다.</p><InvitationFields draft={draft} index={1} disabled={request.pending || request.uncertain} onChange={value => { setDraft(value); setConfirmed(false); }} /></> : <p className={NOTE}>초대를 취소하면 발송된 링크를 수락할 수 없습니다. 이미 발송한 이메일은 회수되지 않습니다.</p>}
        <label className={CHECK_LABEL_TOP}><input className="mt-0.5" type="checkbox" checked={confirmed} disabled={request.pending || request.uncertain} onChange={event => setConfirmed(event.target.checked)} />위 내용을 확인했습니다.</label>{inputError || request.error ? <p className={ALERT_BOX} role="alert">{inputError || request.error}</p> : null}
      </div><footer className={DIALOG_FOOTER}><Button disabled={request.pending} onClick={() => dialog.current?.close()} type="button" variant="outline">닫기</Button><Button disabled={request.pending} type="submit" variant={intent === 'cancel' ? 'destructive' : 'default'}>{request.pending ? '처리 중' : request.uncertain ? '같은 요청으로 결과 확인' : intent === 'cancel' ? '초대 취소' : '재초대 보내기'}</Button></footer></form>
    </dialog></>;
}

function invitationHref(data: OperatorInvitationList, page: number) { const params = new URLSearchParams({ inviteQuery: data.query, inviteStatus: data.status, invitePage: String(page), invitePageSize: String(data.pageSize) }); return `${OPERATOR_DIRECTORY_PATH}?${params}#manager-invitations`; }
const dateLabel = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
export function OperatorInvitationConsole({ data, accessRevision }: { data: OperatorInvitationList; accessRevision: number }) {
  return <section id="manager-invitations" className={`${OPERATOR_CARD} scroll-mt-16`}><header className={RESULT_HEADING}><h2 className="flex flex-wrap items-baseline gap-2 text-base font-medium">매니저 초대 내역 <strong className="font-semibold tabular-nums">{data.total.toLocaleString('ko-KR')}건</strong></h2></header>
    <div className={OPERATOR_GUIDE}><p>초대 등록·이메일 발송·매니저 수락은 각각 확인합니다. 수락 대기 중에는 어드민 권한이 생기지 않습니다. 매니저와 유효한 수락 대기 초대를 합해 최대 1,000명입니다.</p><p>초대한 관리자의 매니저 관리 권한이 회수되면 그 관리자가 만든 수락 대기 초대도 취소됩니다.</p></div><CreateInvitations accessRevision={accessRevision} />
    <form action={`${OPERATOR_DIRECTORY_PATH}#manager-invitations`} className="flex flex-wrap items-end gap-3 px-4"><label className="flex min-w-[min(100%,14rem)] flex-1 flex-col gap-1.5 text-sm font-medium [&_input]:font-normal">초대 검색<Input type="search" name="inviteQuery" defaultValue={data.query} maxLength={100} placeholder="이름·이메일" /></label><label className={FIELD_LABEL}>초대 상태<NativeSelect name="inviteStatus" defaultValue={data.status}><option value="all">전체 상태</option>{OPERATOR_INVITATION_STATUSES.map(status => <option key={status} value={status}>{OPERATOR_INVITATION_STATUS_LABELS[status]}</option>)}</NativeSelect></label><label className={FIELD_LABEL}>목록 개수<NativeSelect name="invitePageSize" defaultValue={data.pageSize}>{[20, 50, 100].map(size => <option key={size} value={size}>{size}개씩</option>)}</NativeSelect></label><div className="flex gap-2"><button className={buttonVariants()} data-slot="button" type="submit"><Search aria-hidden="true" />검색</button><Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={`${OPERATOR_DIRECTORY_PATH}#manager-invitations`}>초기화</Link></div></form>
    <div className={OPERATOR_TABLE} tabIndex={0} role="region" aria-label="매니저 초대 내역 표"><Table className="min-w-[60rem]"><TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent"><TableHead>이름 / 이메일</TableHead><TableHead>매니저 권한 / 담당업무</TableHead><TableHead>초대 상태</TableHead><TableHead>이메일 발송</TableHead><TableHead>초대일 / 만료일</TableHead><TableHead>관리</TableHead></TableRow></TableHeader><TableBody>{data.rows.map(row => <TableRow key={row.id}><TableCell className="align-top">{row.name}<small className={`mt-1 block ${FIELD_HINT}`}>{row.maskedEmail}</small></TableCell><TableCell className="align-top">{MANAGER_ROLE_LABELS[row.managerRole]}<small className={`mt-1 block ${FIELD_HINT}`}>{OPERATOR_DUTIES.find(duty => duty.value === row.duty)?.label}</small></TableCell><TableCell className="align-top">{OPERATOR_INVITATION_STATUS_LABELS[row.status]}</TableCell><TableCell className="align-top whitespace-normal">{invitationEmailLabel(row)}</TableCell><TableCell className="align-top tabular-nums">{dateLabel(row.createdAt)}<small className={`mt-1 block ${FIELD_HINT}`}>만료 {dateLabel(row.expiresAt)}</small></TableCell><TableCell className="min-w-56 align-top whitespace-normal"><InvitationControls key={`${row.id}:${row.revision}`} row={row} accessRevision={accessRevision} /></TableCell></TableRow>)}{!data.rows.length ? <TableRow className="hover:bg-transparent"><TableCell className="h-24 text-center text-muted-foreground" colSpan={6}>조회 조건에 맞는 초대가 없습니다.</TableCell></TableRow> : null}</TableBody></Table></div>
    <ConsolePagination className="px-4" page={data.page} pageSize={data.pageSize} total={data.total} hrefForPage={page => invitationHref(data, page)} />
  </section>;
}
