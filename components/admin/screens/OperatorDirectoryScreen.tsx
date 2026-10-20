'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { activateOperatorAccessAction, changeOperatorRoleAction, saveOperatorDutyAction, transferOperatorOwnerAction } from '@/app/admin/operator-directory-actions';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { SalesFilterField, SalesSelect } from '@/components/admin/sales/SalesConsole';
import { ASSIGNABLE_MANAGER_ROLES, OPERATOR_DIRECTORY_PATH, OPERATOR_DUTIES, canChangeOperator, canRevokeOperator, isAssignableManagerRole, isManagerRole, isOperatorDuty, operatorDirectoryHref, validateOperatorSetup, type OperatorRecord, type OperatorDirectoryData, type OperatorDuty, type OperatorMutationResult, type OperatorSetupAssignment } from '@/lib/admin/operator-directory';
import { MANAGER_ROLES, MANAGER_ROLE_LABELS, type ManagerRole } from '@/lib/admin/access';
import type { OperatorInvitationList } from '@/lib/admin/operator-invitations';
import { OperatorInvitationConsole } from './OperatorInvitationConsole';
import '@/app/styles/admin-operator-directory.css';

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
  return <div className="admin-operator-directory__duty">
    <span>{OPERATOR_DUTIES.find(item => item.value === saved.duty)?.label ?? '미지정'}</span>
    <button type="button" onClick={() => dialog.current?.showModal()} aria-label={`${profile.nickname} 담당업무 변경`}>변경</button>
    <dialog ref={dialog} className="admin-grid-settings-dialog admin-operator-duty-dialog" aria-label="담당업무 변경" onCancel={event => { if (pending) event.preventDefault(); }}>
      <header><h2>담당업무 변경</h2><button type="button" className="admin-grid-settings-close" aria-label="담당업무 변경 닫기" disabled={pending} onClick={() => dialog.current?.close()}>×</button></header>
      <form onSubmit={save}><div className="admin-grid-settings-body"><p><strong>{profile.nickname}</strong> · {profile.maskedEmail}</p><p>담당업무는 내부 관리용 표시입니다. 상품·주문·정산 등의 접근 권한은 계정 역할을 따릅니다.</p>
        <label htmlFor={`operator-duty-${profile.id}`}>담당업무</label><select id={`operator-duty-${profile.id}`} value={duty} disabled={pending || uncertain} onChange={event => { if (isOperatorDuty(event.target.value)) setDuty(event.target.value); setRequest(null); setError(''); setMessage(''); }}>{OPERATOR_DUTIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
      </div><footer className="admin-operator-duty-dialog__actions"><button type="button" disabled={pending} onClick={() => dialog.current?.close()}>닫기</button>
        {uncertain ? <button className="admin-operator-primary" type="button" disabled={pending} onClick={() => { void save(); }}>같은 요청으로 결과 확인</button>
          : <button className="admin-operator-primary" type="submit" disabled={pending}>{pending ? '저장 중' : '저장'}</button>}
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
  return <section className="admin-operator-directory__list admin-operator-setup">
    <header><h2>매니저 역할 설정</h2></header>
    <div className="admin-operator-directory__guide"><p>기존 운영자 {data.setupCandidates.length}명의 역할을 모두 선택하면 새 권한을 적용합니다. 통합 매니저는 이용 중인 기존 관리자 중 한 명을 직접 지정해주세요.</p><p>설정하는 본인은 통합 매니저 또는 계정 주매니저로 유지합니다. 권한 회수를 고른 계정은 일반 회원으로 전환됩니다.</p></div>
    <form onSubmit={submit}>
      <div className="admin-operator-directory__table" tabIndex={0} role="region" aria-label="기존 운영자 역할 배정"><table><thead><tr><th>운영자</th><th>이메일</th><th>현재 권한</th><th>새 매니저 역할</th></tr></thead><tbody>
        {data.setupCandidates.map(profile => <tr key={profile.id}><td>{profile.nickname}{profile.id === actorId ? ' (본인)' : ''}{profile.suspendedAt ? ' · 정지' : ''}</td><td>{profile.maskedEmail}</td><td>{profile.role === 'admin' ? '관리자' : '직원'}</td><td><select aria-label={`${profile.nickname} 새 매니저 역할`} value={roles[profile.id] ?? ''} disabled={request.pending || request.uncertain} onChange={event => { const value = event.target.value; if (value === '' || value === 'none' || isManagerRole(value)) { setRoles(current => ({ ...current, [profile.id]: value })); setConfirmed(false); setInputError(''); } }}>
          <option value="">역할 선택</option>
          {!profile.suspendedAt ? MANAGER_ROLES.filter(role => role !== 'owner' || profile.role === 'admin').filter(role => profile.id !== actorId || role === 'owner' || role === 'primary').map(role => <option key={role} value={role}>{MANAGER_ROLE_LABELS[role]}</option>) : null}
          {profile.id !== actorId ? <option value="none">권한 회수 (일반 회원)</option> : null}
        </select></td></tr>)}
      </tbody></table></div>
      <div className="admin-operator-setup__confirm"><p>통합 매니저: <strong>{owner?.nickname ?? '미선택'}</strong> · 권한 회수: {assignments.filter(item => item.managerRole === null).length}명</p>
        <label><input type="checkbox" checked={confirmed} disabled={request.pending || request.uncertain} onChange={event => setConfirmed(event.target.checked)} />역할별 권한과 위 배정을 확인했습니다.</label>
        {inputError || request.error ? <p role="alert">{inputError || request.error}</p> : null}
        <button type="submit" className="admin-operator-primary" disabled={request.pending}>{request.pending ? '적용 중' : request.uncertain ? '같은 요청으로 결과 확인' : '매니저 역할 적용'}</button>
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
  return <div className="admin-operator-directory__controls">
    {changeAllowed && !profile.suspendedAt ? <button type="button" onClick={() => open('change')} aria-label={`${profile.nickname} 권한 변경`}>변경</button> : null}
    {revokeAllowed ? <button type="button" onClick={() => open('revoke')} aria-label={`${profile.nickname} 권한 회수`}>권한 회수</button> : null}
    {transferAllowed ? <button type="button" onClick={() => open('transfer')} aria-label={`${profile.nickname} 통합 매니저 승계`}>통합 매니저 승계</button> : null}
    {!changeAllowed && !revokeAllowed && !transferAllowed ? <span>{profile.id === actorId ? '본인' : profile.managerRole === 'owner' ? '통합 매니저' : '—'}</span> : null}
    <dialog ref={dialog} className="admin-grid-settings-dialog admin-operator-duty-dialog" aria-label={title} onCancel={event => { if (request.pending) event.preventDefault(); }}>
      <header><h2>{title}</h2><button type="button" className="admin-grid-settings-close" aria-label={`${title} 닫기`} disabled={request.pending} onClick={() => dialog.current?.close()}>×</button></header>
      <form onSubmit={submit}><div className="admin-grid-settings-body"><p><strong>{profile.nickname}</strong> · {profile.maskedEmail}</p>
        {intent === 'change' ? <><label htmlFor={`operator-role-${profile.id}`}>매니저 역할</label><select id={`operator-role-${profile.id}`} value={role} disabled={request.pending || request.uncertain} onChange={event => { if (isAssignableManagerRole(event.target.value)) { setRole(event.target.value); setConfirmed(false); } }}>{ASSIGNABLE_MANAGER_ROLES.map(value => <option key={value} value={value}>{MANAGER_ROLE_LABELS[value]}</option>)}</select><p>새 역할의 메뉴·처리 권한이 즉시 적용됩니다. 담당업무는 유지됩니다.</p></>
          : intent === 'revoke' ? <p>매니저 권한을 회수하고 일반 회원으로 전환합니다. 고객의 주문·회원 기록은 유지됩니다.</p>
            : <p>이 계정을 통합 매니저로 지정합니다. 현재 통합 매니저인 본인은 계정 주매니저로 바뀌며, 이후 승계는 새 통합 매니저만 할 수 있습니다.</p>}
        <label className="admin-operator-confirm"><input type="checkbox" checked={confirmed} disabled={request.pending || request.uncertain} onChange={event => setConfirmed(event.target.checked)} />{title} 내용을 확인했습니다.</label>
        {inputError || request.error ? <p role="alert">{inputError || request.error}</p> : null}
      </div><footer className="admin-operator-duty-dialog__actions"><button type="button" disabled={request.pending} onClick={() => dialog.current?.close()}>취소</button><button type="submit" className="admin-operator-primary" disabled={request.pending}>{request.pending ? '처리 중' : request.uncertain ? '같은 요청으로 결과 확인' : '확인'}</button></footer></form>
    </dialog>
  </div>;
}
const dateLabel = (value: string) => new Date(value).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

export function OperatorDirectoryScreen({ data, adminId, invitations }: { data: OperatorDirectoryData; adminId: string; invitations?: OperatorInvitationList }) {
  const { filters } = data;
  return <section className="admin-operator-directory wc-admin-kit">
    {data.mode === 'legacy' ? data.setupCandidates.some(profile => profile.id === adminId && profile.role === 'admin' && !profile.suspendedAt)
      ? <ManagerSetup data={data} actorId={adminId} />
      : <div className="admin-operator-directory__guide">기존 관리자가 전체 운영자의 매니저 역할 설정을 완료해야 합니다. 이미 배정된 역할의 권한은 현재 적용됩니다.</div> : null}
    <form action={OPERATOR_DIRECTORY_PATH} method="get" className="admin-sales-filters" key={operatorDirectoryHref(filters, filters.page)}>
      <div className="admin-sales-filter-rows">
        <SalesFilterField label="검색" htmlFor="operator-query"><input type="search" id="operator-query" name="query" maxLength={100} defaultValue={filters.query} placeholder="닉네임·이메일·회원번호" /></SalesFilterField>
        <SalesFilterField label="권한 / 계정 상태"><SalesSelect label="권한 필터" name="role" value={filters.role} options={[{ value: 'operators', label: '전체 매니저' }, ...MANAGER_ROLES.map(role => ({ value: role, label: MANAGER_ROLE_LABELS[role] })), { value: 'all', label: '전체 회원' }, { value: 'unassigned', label: '매니저 미지정' }, ...(data.mode === 'legacy' ? [{ value: 'staff', label: '기존 직원' }, { value: 'admin', label: '기존 관리자' }] : [])]} /><SalesSelect label="계정 상태" name="status" value={filters.status} options={[{ value: 'all', label: '전체 상태' }, { value: 'active', label: '이용 중' }, { value: 'suspended', label: '정지' }]} /><SalesSelect label="목록 개수" name="pageSize" value={String(filters.pageSize)} options={[20, 50, 100].map(size => ({ value: String(size), label: `${size}개씩` }))} /></SalesFilterField>
      </div><div className="admin-sales-filter-actions"><button type="submit">검색</button><Link href={OPERATOR_DIRECTORY_PATH}>초기화</Link></div>
    </form>
    <section className="admin-operator-directory__list"><header><h2>매니저 목록 <strong>{data.total.toLocaleString('ko-KR')}명</strong></h2></header>
      <div className="admin-operator-directory__guide"><p>통합 매니저와 계정 주매니저가 다른 매니저의 역할을 관리합니다. 계정 주매니저는 다른 주매니저의 권한을 직접 회수할 수 없습니다.</p><p>본인의 역할과 통합 매니저의 역할은 일반 변경할 수 없습니다. 담당업무는 접근 권한을 추가하지 않으며 통합 매니저는 대표로 표시됩니다.</p></div>
      <div className="admin-operator-directory__table" tabIndex={0} role="region" aria-label="매니저 목록 표"><table><thead><tr><th>닉네임 / 회원번호</th><th>이메일</th><th>현재 권한</th><th>담당업무</th><th>계정 상태</th><th>가입일</th><th>권한 변경</th></tr></thead><tbody>
        {data.rows.map(profile => <tr key={profile.id}><td><Link href={`/admin/customers/${profile.id}`}>{profile.nickname}</Link>{profile.id === adminId ? ' (본인)' : null}<small title={profile.id}>{profile.id.slice(0, 8)}</small></td><td>{profile.maskedEmail}</td><td>{profile.managerRole ? MANAGER_ROLE_LABELS[profile.managerRole] : data.mode === 'legacy' && profile.role !== 'user' ? `기존 ${profile.role === 'admin' ? '관리자' : '직원'}` : '일반 회원'}</td><td>{profile.managerRole === 'owner' ? '대표' : profile.managerRole || (data.mode === 'legacy' && profile.role !== 'user') ? <DutyEditor key={`${profile.id}:${profile.dutyRevision}`} profile={profile} /> : '—'}</td><td>{profile.suspendedAt ? '정지' : '이용 중'}</td><td>{dateLabel(profile.createdAt)}</td><td>{data.mode === 'configured' ? <ManagerRoleEditor key={`${profile.id}:${profile.membershipRevision}`} profile={profile} data={data} actorId={adminId} /> : '역할 설정 후 변경 가능'}</td></tr>)}
        {!data.rows.length ? <tr><td colSpan={7}>조회 조건에 맞는 계정이 없습니다.</td></tr> : null}
      </tbody></table></div>
      <ConsolePagination page={filters.page} pageSize={filters.pageSize} total={data.total} hrefForPage={page => operatorDirectoryHref(filters, page)} />
    </section>
    {data.mode === 'configured' && invitations ? <OperatorInvitationConsole data={invitations} accessRevision={data.revision} /> : null}
  </section>;
}
