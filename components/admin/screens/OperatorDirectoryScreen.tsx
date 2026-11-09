'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { activateOperatorAccessAction, changeOperatorRoleAction, saveOperatorDutyAction, transferOperatorOwnerAction } from '@/app/admin/operator-directory-actions';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { Search, X } from 'lucide-react';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/admin/kit/ui/table';
import { ConsoleTableHeader } from '@/components/admin/console/ConsoleListCard';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { CHECK_LABEL_TOP, DIALOG_BODY, DIALOG_FOOTER, DIALOG_FORM, DIALOG_HEADER, DIALOG_TITLE, FIELD_HINT, NATIVE_DIALOG, NOTE, OPERATOR_CARD, OPERATOR_GUIDE, OPERATOR_TABLE, RESULT_HEADING } from '@/components/admin/settings-kit';
import { ASSIGNABLE_MANAGER_ROLES, OPERATOR_DIRECTORY_PATH, OPERATOR_DUTIES, canChangeOperator, canRevokeOperator, isAssignableManagerRole, isManagerRole, isOperatorDuty, operatorDirectoryHref, validateOperatorSetup, type OperatorRecord, type OperatorDirectoryData, type OperatorDuty, type OperatorMutationResult, type OperatorSetupAssignment } from '@/lib/admin/operator-directory';
import { MANAGER_ROLES, MANAGER_ROLE_LABELS, type ManagerRole } from '@/lib/admin/access';
import type { OperatorInvitationList } from '@/lib/admin/operator-invitations';
import { OperatorInvitationConsole } from './OperatorInvitationConsole';


function DutyEditor({ profile }: { profile: OperatorRecord }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [duty, setDuty] = useState<OperatorDuty>(isOperatorDuty(profile.duty) ? profile.duty : 'other');
  const [saved, setSaved] = useState({ duty: profile.duty, revision: profile.dutyRevision });
  const [request, setRequest] = useState<{ id: string; duty: OperatorDuty; revision: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  async function save(event?: FormEvent) {
    event?.preventDefault(); if (pending) return;
    const active = request ?? { id: crypto.randomUUID(), duty, revision: saved.revision };
    setRequest(active); setPending(true); setError(''); setMessage('');
    try {
      const result = await saveOperatorDutyAction(profile.id, active.duty, active.revision, active.id);
      if ('error' in result) { setError(result.error); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) setRequest(null); return; }
      setSaved({ duty: active.duty, revision: result.revision }); setRequest(null); setUncertain(false); setMessage('담당업무를 저장했습니다. 접근 권한은 바뀌지 않습니다.');
    } catch { setError('저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.'); setUncertain(true); }
    finally { setPending(false); }
  }
  return <div className="flex flex-wrap items-center gap-1.5">
    <span>{OPERATOR_DUTIES.find(item => item.value === saved.duty)?.label ?? '미지정'}</span>
    <Button aria-label={`${profile.nickname} 담당업무 변경`} onClick={() => dialog.current?.showModal()} size="xs" type="button" variant="outline">변경</Button>
    <dialog ref={dialog} className={NATIVE_DIALOG} aria-label="담당업무 변경" onCancel={event => { if (pending) event.preventDefault(); }}>
      <header className={DIALOG_HEADER}><h2 className={DIALOG_TITLE}>담당업무 변경</h2><Button aria-label="담당업무 변경 닫기" disabled={pending} onClick={() => dialog.current?.close()} size="icon-sm" type="button" variant="ghost"><X /></Button></header>
      <form className={DIALOG_FORM} onSubmit={save}><div className={DIALOG_BODY}><p><strong className="font-medium">{profile.nickname}</strong> · <span className="text-muted-foreground">{profile.maskedEmail}</span></p><p className={NOTE}>담당업무는 내부 관리용 표시입니다. 상품·주문·정산 등의 접근 권한은 계정 역할을 따릅니다.</p>
        <label className="text-sm font-medium" htmlFor={`operator-duty-${profile.id}`}>담당업무</label><NativeSelect className="w-full" id={`operator-duty-${profile.id}`} value={duty} disabled={pending || uncertain} onChange={event => { if (isOperatorDuty(event.target.value)) setDuty(event.target.value); setRequest(null); setError(''); setMessage(''); }}>{OPERATOR_DUTIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</NativeSelect>
        {error ? <AdminNotice role="alert" tone="danger">{error}</AdminNotice> : null}{message ? <AdminNotice role="status" tone="success">{message}</AdminNotice> : null}
      </div><footer className={DIALOG_FOOTER}><Button disabled={pending} onClick={() => dialog.current?.close()} type="button" variant="outline">닫기</Button>
        {uncertain ? <Button disabled={pending} onClick={() => { void save(); }} type="button">같은 요청으로 결과 확인</Button>
          : <Button disabled={pending} type="submit">{pending ? '저장 중' : '저장'}</Button>}
      </footer></form>
    </dialog>
  </div>;
}

function useOperatorRequest(onSuccess: () => void) {
  const [request, setRequest] = useState<{ operationId: string; task: (operationId: string) => Promise<OperatorMutationResult> } | null>(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  async function run(task: (operationId: string) => Promise<OperatorMutationResult>) {
    if (pending) return;
    const active = request ?? { operationId: crypto.randomUUID(), task };
    setRequest(active); setPending(true); setError('');
    try {
      const result = await active.task(active.operationId);
      if ('error' in result) { setError(result.error); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) setRequest(null); return; }
      setRequest(null); setUncertain(false); onSuccess();
    } catch { setError('처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.'); setUncertain(true); }
    finally { setPending(false); }
  }
  return { run, pending, uncertain, error };
}

function ManagerSetup({ data, actorId }: { data: OperatorDirectoryData; actorId: string }) {
  const router = useRouter();
  const [roles, setRoles] = useState<Record<string, ManagerRole | 'none' | ''>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [inputError, setInputError] = useState('');
  const request = useOperatorRequest(() => router.refresh());
  const assignments = data.setupCandidates.map(profile => ({ profileId: profile.id, managerRole: roles[profile.id] === 'none' ? null : roles[profile.id] })) as OperatorSetupAssignment[];
  const owner = data.setupCandidates.find(profile => roles[profile.id] === 'owner');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!request.uncertain && (!confirmed || !validateOperatorSetup(assignments, data.setupCandidates, actorId))) {
      setInputError('모든 운영자의 역할을 선택해주세요. 통합 매니저는 이용 중인 기존 관리자 한 명, 본인은 통합 또는 주매니저로 지정해야 합니다. 정지 계정은 권한 회수를 선택해주세요.'); return;
    }
    setInputError('');
    await request.run(operationId => activateOperatorAccessAction(assignments, data.revision, operationId));
  }
  return <section className={OPERATOR_CARD} data-operator-setup="">
    <header className={RESULT_HEADING}><h2 className="text-base font-semibold">매니저 역할 설정</h2></header>
    <div className={OPERATOR_GUIDE}><p>기존 운영자 {data.setupCandidates.length}명의 역할을 모두 선택하면 새 권한을 적용합니다. 통합 매니저는 이용 중인 기존 관리자 중 한 명을 직접 지정해주세요.</p><p>설정하는 본인은 통합 매니저 또는 계정 주매니저로 유지합니다. 권한 회수를 고른 계정은 일반 회원으로 전환됩니다.</p></div>
    <form className="flex min-w-0 flex-col gap-3" onSubmit={submit}>
      <div className={OPERATOR_TABLE} tabIndex={0} role="region" aria-label="기존 운영자 역할 배정"><Table className="min-w-[48.75rem]"><ConsoleTableHeader><TableRow className="hover:bg-transparent"><TableHead>운영자</TableHead><TableHead>이메일</TableHead><TableHead>현재 권한</TableHead><TableHead>새 매니저 역할</TableHead></TableRow></ConsoleTableHeader><TableBody>
        {data.setupCandidates.map(profile => <TableRow key={profile.id}><TableCell className="font-medium">{profile.nickname}{profile.id === actorId ? ' (본인)' : ''}{profile.suspendedAt ? ' · 정지' : ''}</TableCell><TableCell className="text-muted-foreground">{profile.maskedEmail}</TableCell><TableCell>{profile.role === 'admin' ? '관리자' : '직원'}</TableCell><TableCell><NativeSelect aria-label={`${profile.nickname} 새 매니저 역할`} className="w-full min-w-48" value={roles[profile.id] ?? ''} disabled={request.pending || request.uncertain} onChange={event => { const value = event.target.value; if (value === '' || value === 'none' || isManagerRole(value)) { setRoles(current => ({ ...current, [profile.id]: value })); setConfirmed(false); setInputError(''); } }}>
          <option value="">역할 선택</option>
          {!profile.suspendedAt ? MANAGER_ROLES.filter(role => role !== 'owner' || profile.role === 'admin').filter(role => profile.id !== actorId || role === 'owner' || role === 'primary').map(role => <option key={role} value={role}>{MANAGER_ROLE_LABELS[role]}</option>) : null}
          {profile.id !== actorId ? <option value="none">권한 회수 (일반 회원)</option> : null}
        </NativeSelect></TableCell></TableRow>)}
      </TableBody></Table></div>
      <div className="flex flex-col gap-3 px-4"><p>통합 매니저: <strong className="font-semibold">{owner?.nickname ?? '미선택'}</strong> · 권한 회수: {assignments.filter(item => item.managerRole === null).length}명</p>
        <label className={CHECK_LABEL_TOP}><input className="mt-0.5" type="checkbox" checked={confirmed} disabled={request.pending || request.uncertain} onChange={event => setConfirmed(event.target.checked)} />역할별 권한과 위 배정을 확인했습니다.</label>
        {inputError || request.error ? <AdminNotice role="alert" tone="danger">{inputError || request.error}</AdminNotice> : null}
        <Button className="w-fit" disabled={request.pending} type="submit">{request.pending ? '적용 중' : request.uncertain ? '같은 요청으로 결과 확인' : '매니저 역할 적용'}</Button>
      </div>
    </form>
  </section>;
}

function ManagerRoleEditor({ profile, data, actorId }: { profile: OperatorRecord; data: OperatorDirectoryData; actorId: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [intent, setIntent] = useState<'change' | 'revoke' | 'transfer'>('change');
  const [role, setRole] = useState(isAssignableManagerRole(profile.managerRole) ? profile.managerRole : 'deputy');
  const [confirmed, setConfirmed] = useState(false);
  const [inputError, setInputError] = useState('');
  const request = useOperatorRequest(() => { dialog.current?.close(); router.refresh(); });
  const changeAllowed = canChangeOperator(actorId, data.actorManagerRole, profile);
  const revokeAllowed = canRevokeOperator(actorId, data.actorManagerRole, profile);
  const transferAllowed = data.actorManagerRole === 'owner' && profile.managerRole === 'primary' && !profile.suspendedAt && profile.id !== actorId;
  const title = intent === 'transfer' ? '통합 매니저 승계' : intent === 'revoke' ? '매니저 권한 회수' : '매니저 권한 변경';
  function open(next: typeof intent) { if (!request.uncertain) { setIntent(next); setConfirmed(false); setInputError(''); } dialog.current?.showModal(); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!request.uncertain && !confirmed) { setInputError('변경할 내용을 확인해주세요.'); return; }
    setInputError('');
    await request.run(operationId => intent === 'transfer'
      ? transferOperatorOwnerAction(profile.id, data.actorMembershipRevision, profile.membershipRevision, data.revision, operationId)
      : changeOperatorRoleAction(profile.id, intent === 'revoke' ? null : role, profile.membershipRevision, data.revision, operationId));
  }
  return <div className="flex flex-wrap gap-1.5">
    {changeAllowed && !profile.suspendedAt ? <Button aria-label={`${profile.nickname} 권한 변경`} onClick={() => open('change')} size="xs" type="button" variant="outline">변경</Button> : null}
    {revokeAllowed ? <Button aria-label={`${profile.nickname} 권한 회수`} onClick={() => open('revoke')} size="xs" type="button" variant="destructive">권한 회수</Button> : null}
    {transferAllowed ? <Button aria-label={`${profile.nickname} 통합 매니저 승계`} onClick={() => open('transfer')} size="xs" type="button" variant="outline">통합 매니저 승계</Button> : null}
    {!changeAllowed && !revokeAllowed && !transferAllowed ? <span className="text-muted-foreground">{profile.id === actorId ? '본인' : profile.managerRole === 'owner' ? '통합 매니저' : '—'}</span> : null}
    <dialog ref={dialog} className={NATIVE_DIALOG} aria-label={title} onCancel={event => { if (request.pending) event.preventDefault(); }}>
      <header className={DIALOG_HEADER}><h2 className={DIALOG_TITLE}>{title}</h2><Button aria-label={`${title} 닫기`} disabled={request.pending} onClick={() => dialog.current?.close()} size="icon-sm" type="button" variant="ghost"><X /></Button></header>
      <form className={DIALOG_FORM} onSubmit={submit}><div className={DIALOG_BODY}><p><strong className="font-medium">{profile.nickname}</strong> · <span className="text-muted-foreground">{profile.maskedEmail}</span></p>
        {intent === 'change' ? <><label className="text-sm font-medium" htmlFor={`operator-role-${profile.id}`}>매니저 역할</label><NativeSelect className="w-full" id={`operator-role-${profile.id}`} value={role} disabled={request.pending || request.uncertain} onChange={event => { if (isAssignableManagerRole(event.target.value)) { setRole(event.target.value); setConfirmed(false); } }}>{ASSIGNABLE_MANAGER_ROLES.map(value => <option key={value} value={value}>{MANAGER_ROLE_LABELS[value]}</option>)}</NativeSelect><p className={NOTE}>새 역할의 메뉴·처리 권한이 즉시 적용됩니다. 담당업무는 유지됩니다.</p></>
          : intent === 'revoke' ? <p className={NOTE}>매니저 권한을 회수하고 일반 회원으로 전환합니다. 고객의 주문·회원 기록은 유지됩니다.</p>
            : <p className={NOTE}>이 계정을 통합 매니저로 지정합니다. 현재 통합 매니저인 본인은 계정 주매니저로 바뀌며, 이후 승계는 새 통합 매니저만 할 수 있습니다.</p>}
        <label className={CHECK_LABEL_TOP}><input className="mt-0.5" type="checkbox" checked={confirmed} disabled={request.pending || request.uncertain} onChange={event => setConfirmed(event.target.checked)} />{title} 내용을 확인했습니다.</label>
        {inputError || request.error ? <AdminNotice role="alert" tone="danger">{inputError || request.error}</AdminNotice> : null}
      </div><footer className={DIALOG_FOOTER}><Button disabled={request.pending} onClick={() => dialog.current?.close()} type="button" variant="outline">취소</Button><Button disabled={request.pending} type="submit" variant={intent === 'revoke' ? 'destructive' : 'default'}>{request.pending ? '처리 중' : request.uncertain ? '같은 요청으로 결과 확인' : '확인'}</Button></footer></form>
    </dialog>
  </div>;
}
const dateLabel = (value: string) => new Date(value).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

export function OperatorDirectoryScreen({ data, adminId, invitations }: { data: OperatorDirectoryData; adminId: string; invitations?: OperatorInvitationList }) {
  const { filters } = data;
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="operators">
    {data.mode === 'legacy' ? data.setupCandidates.some(profile => profile.id === adminId && profile.role === 'admin' && !profile.suspendedAt)
      ? <ManagerSetup data={data} actorId={adminId} />
      : <AdminNotice tone="info">기존 관리자가 전체 운영자의 매니저 역할 설정을 완료해야 합니다. 이미 배정된 역할의 권한은 현재 적용됩니다.</AdminNotice> : null}
    <form action={OPERATOR_DIRECTORY_PATH} method="get" className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" key={operatorDirectoryHref(filters, filters.page)}>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex min-w-[min(100%,16rem)] flex-1 flex-col gap-1.5"><label className="text-sm leading-none font-medium" htmlFor="operator-query">검색</label><Input type="search" id="operator-query" name="query" maxLength={100} defaultValue={filters.query} placeholder="닉네임·이메일·회원번호" /></div>
        <div className="flex min-w-0 flex-col gap-1.5"><span className="text-sm leading-none font-medium">권한 / 계정 상태</span><div className="flex flex-wrap gap-2"><NativeSelect aria-label="권한 필터" name="role" defaultValue={filters.role}>{[{ value: 'operators', label: '전체 매니저' }, ...MANAGER_ROLES.map(role => ({ value: role, label: MANAGER_ROLE_LABELS[role] })), { value: 'all', label: '전체 회원' }, { value: 'unassigned', label: '매니저 미지정' }, ...(data.mode === 'legacy' ? [{ value: 'staff', label: '기존 직원' }, { value: 'admin', label: '기존 관리자' }] : [])].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeSelect><NativeSelect aria-label="계정 상태" name="status" defaultValue={filters.status}>{[{ value: 'all', label: '전체 상태' }, { value: 'active', label: '이용 중' }, { value: 'suspended', label: '정지' }].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeSelect><NativeSelect aria-label="목록 개수" name="pageSize" defaultValue={String(filters.pageSize)}>{[20, 50, 100].map(size => <option key={size} value={String(size)}>{`${size}개씩`}</option>)}</NativeSelect></div></div>
      </div><div className="flex flex-wrap justify-end gap-2 border-t pt-3"><Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={OPERATOR_DIRECTORY_PATH}>초기화</Link><button className={buttonVariants({ variant: 'soft' })} data-slot="button" type="submit"><Search aria-hidden="true" />검색</button></div>
    </form>
    <section className={OPERATOR_CARD} data-operator-list=""><header className={RESULT_HEADING}><h2 className="flex flex-wrap items-baseline gap-2 text-base font-semibold">매니저 목록 <strong className="font-semibold tabular-nums">{data.total.toLocaleString('ko-KR')}명</strong></h2></header>
      <div className={OPERATOR_GUIDE}><p>통합 매니저와 계정 주매니저가 다른 매니저의 역할을 관리합니다. 계정 주매니저는 다른 주매니저의 권한을 직접 회수할 수 없습니다.</p><p>본인의 역할과 통합 매니저의 역할은 일반 변경할 수 없습니다. 담당업무는 접근 권한을 추가하지 않으며 통합 매니저는 대표로 표시됩니다.</p></div>
      <div className={OPERATOR_TABLE} tabIndex={0} role="region" aria-label="매니저 목록 표"><Table className="min-w-[67.5rem]"><ConsoleTableHeader><TableRow className="hover:bg-transparent"><TableHead>닉네임 / 회원번호</TableHead><TableHead>이메일</TableHead><TableHead>현재 권한</TableHead><TableHead>담당업무</TableHead><TableHead>계정 상태</TableHead><TableHead>가입일</TableHead><TableHead>권한 변경</TableHead></TableRow></ConsoleTableHeader><TableBody>
        {data.rows.map(profile => <TableRow key={profile.id}><TableCell className="align-top"><Link className="font-medium underline-offset-4 hover:underline" href={`/admin/customers/${profile.id}`}>{profile.nickname}</Link>{profile.id === adminId ? ' (본인)' : null}<small className={`mt-1 block ${FIELD_HINT}`} title={profile.id}>{profile.id.slice(0, 8)}</small></TableCell><TableCell className="align-top text-muted-foreground">{profile.maskedEmail}</TableCell><TableCell className="align-top">{profile.managerRole ? MANAGER_ROLE_LABELS[profile.managerRole] : data.mode === 'legacy' && profile.role !== 'user' ? `기존 ${profile.role === 'admin' ? '관리자' : '직원'}` : '일반 회원'}</TableCell><TableCell className="align-top">{profile.managerRole === 'owner' ? '대표' : profile.managerRole || (data.mode === 'legacy' && profile.role !== 'user') ? <DutyEditor key={`${profile.id}:${profile.dutyRevision}`} profile={profile} /> : '—'}</TableCell><TableCell className="align-top"><AdminStatusBadge tone={statusTone('member', profile.suspendedAt ? 'suspended' : 'active')}>{profile.suspendedAt ? '정지' : '이용 중'}</AdminStatusBadge></TableCell><TableCell className="align-top tabular-nums">{dateLabel(profile.createdAt)}</TableCell><TableCell className="min-w-64 align-top">{data.mode === 'configured' ? <ManagerRoleEditor key={`${profile.id}:${profile.membershipRevision}`} profile={profile} data={data} actorId={adminId} /> : <span className="text-muted-foreground">역할 설정 후 변경 가능</span>}</TableCell></TableRow>)}
        {!data.rows.length ? <TableRow className="hover:bg-transparent"><TableCell className="h-24 text-center text-muted-foreground" colSpan={7}>조회 조건에 맞는 계정이 없습니다.</TableCell></TableRow> : null}
      </TableBody></Table></div>
      <ConsolePagination className="px-4" page={filters.page} pageSize={filters.pageSize} total={data.total} hrefForPage={page => operatorDirectoryHref(filters, page)} />
    </section>
    {data.mode === 'configured' && invitations ? <OperatorInvitationConsole data={invitations} accessRevision={data.revision} /> : null}
  </div>;
}
