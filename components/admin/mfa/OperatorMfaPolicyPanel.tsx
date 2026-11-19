'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { resetOperatorMfaAction, saveOperatorMfaPolicyAction, type OperatorMfaPolicyResult, type OperatorMfaResetResult } from '@/app/admin/operator-mfa-actions';
import { AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { MANAGER_ROLE_LABELS } from '@/lib/admin/access';
import { adminConfirm } from '@/lib/admin/confirm';
import type { OperatorMfaPolicy, OperatorMfaRow } from '@/lib/admin/mfa';
import { statusTone } from '@/lib/admin/status-tone';
import { formatOrderDateTime } from '@/lib/orders';

const UNKNOWN = '처리 결과를 확인하지 못했습니다. 이미 처리됐을 수 있으니 결과 확인 버튼을 눌러 주세요. 여러 번 눌러도 한 번만 처리됩니다.';

/**
 * 운영자 2단계 인증 요구 스위치와 운영자별 등록 현황·초기화(OPS-006).
 * 켜기는 DB가 "켜는 사람의 세션이 인증 앱으로 확인됐고 운영자 전원이 등록했는가"를 판정한다. 결과가 불확실하면
 * 요청 ID를 고정해 같은 요청으로만 다시 확인한다(기능 공개 관리와 같은 규칙).
 */
export function OperatorMfaPolicyPanel({ initial, canReset, selfId }: { initial: OperatorMfaPolicy; canReset: boolean; selfId: string }) {
  const router = useRouter();
  const [policy, setPolicy] = useState(initial);
  /* 저장·초기화 뒤 router.refresh()는 다시 마운트하지 않고 같은 자리에 새 initial(다른 객체)을 내려보낸다 — 렌더 중에 맞춘다.
     늦게 도착한 이전 렌더(revision이 더 낮음)는 무시한다. 초기화는 revision을 바꾸지 않으므로 같은 revision도 받는다. */
  const [synced, setSynced] = useState(initial);
  if (initial !== synced) {
    setSynced(initial);
    if (initial.revision >= policy.revision) setPolicy(initial);
  }
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState(false);
  const request = useRef<{ required: boolean; revision: number; id: string } | null>(null);
  /* 결과가 불확실한 초기화는 대상별 요청 ID를 고정해 같은 요청으로만 다시 확인한다. */
  const [resetRequests, setResetRequests] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState<string | null>(null);

  async function toggle() {
    if (pending) return;
    const target = request.current?.required ?? !policy.required;
    if (!request.current) {
      const ok = await adminConfirm(target ? {
        title: '2단계 인증 요구 켜기',
        message: `켜면 모든 운영자가 로그인할 때마다 인증 앱 코드를 입력해야 어드민이 열립니다. 인증 앱이 없는 운영자는 다음 화면 이동부터 등록 화면으로 갑니다.${policy.unenrolledCount ? ` 지금 미등록 운영자 ${policy.unenrolledCount}명이 있어 켜지지 않습니다.` : ''} 켤까요?`,
        confirmLabel: '켜기',
      } : {
        title: '2단계 인증 요구 끄기',
        message: '끄면 비밀번호만으로 어드민이 다시 열립니다. 등록한 인증 앱은 지워지지 않습니다. 끌까요?',
        confirmLabel: '끄기',
        destructive: true,
      });
      if (!ok) return;
    }
    request.current ??= { required: target, revision: policy.revision, id: crypto.randomUUID() };
    setPending(true); setMessage('');
    let result: OperatorMfaPolicyResult;
    try {
      const sent = request.current;
      result = await saveOperatorMfaPolicyAction(sent.required, sent.revision, sent.id);
    } catch { result = { error: UNKNOWN, uncertain: true }; }
    setPending(false);
    if ('error' in result) { setMessage(result.error); setError(true); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) request.current = null; return; }
    request.current = null; setUncertain(false); setError(false);
    setPolicy((current) => ({ ...current, required: result.receipt.required, revision: result.receipt.revision, updatedAt: result.receipt.updatedAt }));
    setMessage(result.receipt.required ? '2단계 인증 요구를 켰습니다. 운영자 전원이 다음 화면 이동부터 인증 앱 코드를 입력합니다.' : '2단계 인증 요구를 껐습니다.');
    router.refresh();
  }

  async function reset(row: OperatorMfaRow) {
    if (resetting) return;
    const known = resetRequests[row.id];
    if (!known) {
      const ok = await adminConfirm({
        title: '2단계 인증 초기화',
        message: `${row.nickname}(${row.maskedEmail})의 인증 앱 등록을 모두 지우고 그 계정을 모든 기기에서 로그아웃시킵니다. 휴대폰을 잃었다는 요청을 본인에게서 직접 확인한 뒤에만 진행하세요. 초기화한 운영자는 다시 로그인해 새 휴대폰으로 등록합니다.`,
        confirmLabel: '초기화',
        destructive: true,
      });
      if (!ok) return;
    }
    const id = known ?? crypto.randomUUID();
    const forget = () => setResetRequests((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== row.id)));
    setResetRequests((current) => ({ ...current, [row.id]: id }));
    setResetting(row.id); setMessage('');
    let result: OperatorMfaResetResult;
    try { result = await resetOperatorMfaAction(row.id, id); } catch { result = { error: UNKNOWN, uncertain: true }; }
    setResetting(null);
    if ('error' in result) { setMessage(result.error); setError(true); if (!result.uncertain) forget(); return; }
    forget(); setError(false);
    setMessage(`${row.nickname}의 2단계 인증을 초기화했습니다(인증 앱 ${result.receipt.factorsDeleted}개 삭제, 로그인 ${result.receipt.sessionsRevoked}곳 로그아웃).`);
    router.refresh();
  }

  return <div className="flex flex-col gap-4">
    <AdminSectionCard title="2단계 인증 요구" summary={`마지막 변경 ${formatOrderDateTime(policy.updatedAt)}${policy.updatedBy ? ` · ${policy.updatedBy}` : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <AdminStatusBadge tone={statusTone('setting', policy.required ? 'active' : 'inactive')}>{policy.required ? '켜짐' : '꺼짐'}</AdminStatusBadge>
        <span className="text-sm text-muted-foreground">{policy.required ? '모든 운영자가 인증 앱 코드를 입력해야 어드민이 열립니다.' : '비밀번호만으로 어드민이 열립니다.'}</span>
      </div>
      <p className="text-sm text-muted-foreground">켜려면 본인이 먼저 내 보안 설정에서 인증 앱을 등록하고 지금 로그인을 인증 앱 코드로 확인해야 하며, 운영자 전원이 등록을 마쳐야 합니다(미등록 {policy.unenrolledCount}명).</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending} onClick={() => void toggle()} variant={policy.required && !uncertain ? 'outline' : 'default'}>
          {pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : policy.required ? '2단계 인증 요구 끄기' : '2단계 인증 요구 켜기'}
        </Button>
      </div>
    </AdminSectionCard>
    <AdminSectionCard title="운영자별 등록 현황" summary={`운영자 ${policy.operators.length}명 · 미등록 ${policy.unenrolledCount}명`}>
      <Table>
        <TableHeader><TableRow>
          <TableHead>운영자</TableHead><TableHead>권한</TableHead><TableHead>인증 앱</TableHead><TableHead>최근 등록</TableHead>{canReset ? <TableHead><span className="sr-only">처리</span></TableHead> : null}
        </TableRow></TableHeader>
        <TableBody>
          {policy.operators.map((row) => <TableRow key={row.id}>
            <TableCell><span className="flex flex-col"><span className="font-medium">{row.nickname}</span><span className="text-xs text-muted-foreground">{row.maskedEmail}</span></span></TableCell>
            <TableCell>{row.managerRole ? MANAGER_ROLE_LABELS[row.managerRole] : '전환 전 운영자'}</TableCell>
            <TableCell><AdminStatusBadge tone={statusTone('setting', row.verifiedFactors ? 'active' : 'inactive')}>{row.verifiedFactors ? `등록 ${row.verifiedFactors}개` : '미등록'}</AdminStatusBadge></TableCell>
            <TableCell>{row.verifiedAt ? formatOrderDateTime(row.verifiedAt) : '—'}</TableCell>
            {canReset ? <TableCell className="text-right">
              {row.id !== selfId && row.verifiedFactors + row.unverifiedFactors > 0
                ? <Button disabled={resetting !== null} onClick={() => void reset(row)} size="sm" variant="outline">{resetting === row.id ? '초기화 중…' : resetRequests[row.id] ? '같은 요청 결과 확인' : '초기화'}</Button>
                : null}
            </TableCell> : null}
          </TableRow>)}
        </TableBody>
      </Table>
    </AdminSectionCard>
    {message ? <p className={`text-sm ${error ? 'text-destructive' : 'text-success'}`} role={error ? 'alert' : 'status'}>{message}</p> : null}
  </div>;
}
