'use client';

import { useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { refreshMemberVerificationLimitsAction, resetMemberVerificationLimitAction, type MemberLimitResult } from '@/app/admin/member-verification-actions';
import { AdminNotice, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { adminPrompt } from '@/lib/admin/confirm';
import { OVERSEAS_PROGRESS, VERIFICATION_LIMIT_LABELS, type MemberVerificationLimit, type MemberVerificationLimits } from '@/lib/admin/member-verification-limits';
import { statusTone } from '@/lib/admin/status-tone';

const dateTime = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function MemberVerificationLimitsPanel({ profileId, nickname, initial }: {
  profileId: string; nickname: string; initial?: MemberVerificationLimits | null;
}) {
  const [result, setResult] = useState<MemberLimitResult | null>(null);
  const [pending, startTransition] = useTransition();
  const newerInitial = initial && result?.snapshot && Date.parse(initial.checkedAt) > Date.parse(result.snapshot.checkedAt);
  const snapshot = !result || newerInitial ? initial : result.snapshot;

  function run(action: () => Promise<MemberLimitResult>) {
    startTransition(async () => {
      try {
        setResult(await action());
      } catch {
        setResult({ ok: false, snapshot: null, message: '처리 결과를 확인하지 못했습니다. 다시 조회해 주세요.' });
      }
    });
  }

  async function reset(limit: MemberVerificationLimit) {
    const revision = limit.revision;
    if (!revision || !snapshot?.canReset) return;
    const label = VERIFICATION_LIMIT_LABELS[limit.kind];
    const reason = await adminPrompt({
      title: `${label} 시도 횟수 초기화`, confirmLabel: '횟수 초기화',
      message: `@${nickname} 회원의 ${label} 횟수를 0회로 되돌립니다. 사유는 감사 기록에 남습니다.`,
      input: { label: '초기화 사유', placeholder: '예: 테스트 계정 재신청', minLength: 2, maxLength: 200 },
    });
    if (reason !== null) run(() => resetMemberVerificationLimitAction(profileId, limit.kind, revision, reason));
  }

  return <AdminSectionCard title="인증 시도 제한">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      {snapshot ? <span>조회 시각 <time dateTime={snapshot.checkedAt}>{dateTime.format(new Date(snapshot.checkedAt))} KST</time></span> : <span>조회 시각 확인 필요</span>}
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => refreshMemberVerificationLimitsAction(profileId))}>
        <RefreshCw aria-hidden="true" /> 다시 조회
      </Button>
    </div>
    {snapshot ? <>
      <ul className="divide-y">{snapshot.limits.map(limit => {
        const label = VERIFICATION_LIMIT_LABELS[limit.kind];
        const countLimited = limit.dayUsed >= limit.dayLimit || (limit.hourLimit !== null && limit.hourUsed >= limit.hourLimit);
        const statusLabel = limit.retryAt ? (countLimited ? '횟수 제한 중' : '재발송 대기') : '횟수 제한 없음';
        return <li key={limit.kind} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-sm font-medium">{label}</strong>
              <AdminStatusBadge tone={statusTone('memberVerificationLimit', limit.retryAt ? 'limited' : 'available')}>{statusLabel}</AdminStatusBadge>
              {limit.kind === 'overseas_adult' && snapshot.overseasState ? <span className="text-xs text-muted-foreground">{OVERSEAS_PROGRESS[snapshot.overseasState]}</span> : null}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {limit.hourLimit !== null ? `최근 1시간 ${limit.hourUsed}/${limit.hourLimit}회 · ` : ''}최근 24시간 {limit.dayUsed}/{limit.dayLimit}회
            </p>
            {limit.retryAt ? <p className="text-xs">자동 해제 <time dateTime={limit.retryAt}>{dateTime.format(new Date(limit.retryAt))} KST</time></p> : null}
          </div>
          {snapshot.canReset && limit.revision ? <Button type="button" size="sm" variant="outline" disabled={pending}
            aria-label={`${label} 횟수 초기화`} onClick={() => reset(limit)}>횟수 초기화</Button> : null}
        </li>;
      })}</ul>
      <p className="text-xs text-muted-foreground">문자·메일 발송에는 같은 연락처와 접속 위치에 대한 공통 제한도 적용됩니다.</p>
    </> : !result ? <AdminNotice tone="warning">인증 시도 횟수를 불러오지 못했습니다. 다시 조회해 주세요.</AdminNotice> : null}
    {result ? <AdminNotice tone={result.ok ? 'success' : 'warning'} role={result.ok ? 'status' : 'alert'}>{result.message}</AdminNotice> : null}
  </AdminSectionCard>;
}
