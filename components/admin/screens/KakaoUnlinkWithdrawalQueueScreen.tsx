import Link from 'next/link';
import { ConsoleGrid, ConsoleListCard, type ConsoleGridColumn } from '@/components/admin/console';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { kakaoUnlinkReasonLabel, KAKAO_UNLINK_QUEUE_PATH, type KakaoUnlinkQueueEntry } from '@/lib/admin/kakao-unlink-withdrawal';
import { statusTone } from '@/lib/admin/status-tone';
import { formatOrderDateTime } from '@/lib/orders';

/*
 * 카카오 연결 해제 탈퇴 검토 대기(runbook kakao-account-unlink.md §5) — 템플릿 룩(ADR-0028). 카카오로만 가입한 회원이 카카오 쪽에서
 * 연결을 끊은 목록이다. 이 화면은 보기만 하고, 처리는 고객 상세 개요의 탈퇴 요청 처리에서 한다(진행 중 주문·환불 같은 남은 의무를
 * 그 화면에서 함께 본다). 처리 방법은 해제 사유로 나뉜다(2026-11-19 결정) — DB가 정한 accountClosed를 따른다.
 */

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'member', label: '회원', minWidth: '200px', required: true },
  { key: 'reason', label: '해제 사유', width: '240px' },
  { key: 'eventAt', label: '알림 시각', width: '170px' },
  { key: 'method', label: '처리 방법', width: '150px' },
  { key: 'account', label: '계정 상태', width: '110px' },
];

const METHOD_LABELS = { account_closed: '알림으로 처리', member_request: '회원 확인 필요' } as const;

function methodOf(entry: KakaoUnlinkQueueEntry): keyof typeof METHOD_LABELS {
  return entry.accountClosed ? 'account_closed' : 'member_request';
}

/** 회원 관리 화면 위에 두는 진입 안내. 대기 회원이 있을 때만 보인다(건수만, 개인정보 없음). */
export function KakaoUnlinkQueueNotice({ count }: { count: number }) {
  if (count < 1) return null;
  return <AdminNotice title={`카카오 연결 해제 · 탈퇴 검토 대기 ${count.toLocaleString('ko-KR')}명`} tone="warning">
    카카오로만 가입한 회원이 카카오 쪽에서 연결을 끊었습니다. <Link className="font-medium underline underline-offset-4" href={KAKAO_UNLINK_QUEUE_PATH}>대기 목록 보기</Link>
  </AdminNotice>;
}

export function KakaoUnlinkWithdrawalQueueScreen({ entries }: { entries: KakaoUnlinkQueueEntry[] | null }) {
  return <div className="flex min-w-0 flex-col gap-4" data-kakao-unlink-queue="">
    <AdminNotice title="처리 방법은 해제 사유로 나뉩니다." tone="info">
      <ul className="flex list-disc flex-col gap-1 pl-5">
        <li><strong>알림으로 처리</strong> — 카카오계정 탈퇴·강제 탈퇴로 카카오계정이 없어져 회원이 다시 로그인할 수 없습니다. 회원을 눌러 고객 상세 개요의 &apos;카카오 알림으로 탈퇴 처리&apos;로 처리합니다.</li>
        <li><strong>회원 확인 필요</strong> — 연결만 끊어 회원이 카카오로 다시 로그인할 수 있습니다. 회원에게 탈퇴 의사를 확인하고, 회원이 1:1 문의(계정 유형)로 요청하면 고객 상세의 &apos;1:1 문의로 받은 탈퇴 처리&apos;로 처리합니다. 다시 로그인하면 이 목록에서 빠집니다.</li>
        <li>진행 중인 주문·환불·티켓·정기구매가 남아 있으면 처리되지 않으니 그 일을 먼저 끝냅니다. 처리한 회원은 이 목록에서 빠집니다.</li>
      </ul>
    </AdminNotice>
    {entries === null
      ? <AdminNotice role="alert" title="탈퇴 검토 대기 목록을 불러오지 못했습니다." tone="warning">잠시 후 화면을 새로고침해주세요.</AdminNotice>
      : <ConsoleListCard description="알림을 받은 순서입니다. 이메일은 일부만 보이며 전체 이메일과 남은 의무는 고객 상세에서 확인합니다."
        title="탈퇴 검토 대기" total={entries.length} unit="명">
        <ConsoleGrid caption="카카오 연결 해제 탈퇴 검토 대기" columns={COLUMNS} emptyLabel="탈퇴 검토를 기다리는 회원이 없습니다."
          preferencesKey="kakao-unlink-withdrawal-queue"
          rows={entries.map((entry) => ({ id: entry.userId, href: `/admin/customers/${entry.userId}`, cells: [
            <span className="flex min-w-0 flex-col gap-0.5" key="member">
              <span className="font-semibold">@{entry.nickname}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{entry.maskedEmail}</span>
            </span>,
            <span key="reason">{kakaoUnlinkReasonLabel(entry.reason)}</span>,
            <time className="tabular-nums" dateTime={entry.eventAt} key="eventAt">{formatOrderDateTime(entry.eventAt)}</time>,
            <AdminStatusBadge key="method" tone={statusTone('kakaoUnlinkWithdrawal', methodOf(entry))}>{METHOD_LABELS[methodOf(entry)]}</AdminStatusBadge>,
            <AdminStatusBadge key="account" tone={statusTone('member', entry.suspended ? 'suspended' : 'active')}>{entry.suspended ? '정지' : '이용 중'}</AdminStatusBadge>,
          ] }))} />
      </ConsoleListCard>}
  </div>;
}
