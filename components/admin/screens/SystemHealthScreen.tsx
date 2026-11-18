import Link from 'next/link';
import { AdminNotice, AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { ADMIN_COUNT_CARD_GRID_CLASS, AdminCountCard } from '@/components/admin/console/AdminCountCard';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { PaymentAttemptReconcileButton } from '@/components/admin/PaymentAttemptReconcileButton';
import { statusTone } from '@/lib/admin/status-tone';
import {
  PAYMENT_PROVIDER_LABELS,
  PAYMENT_PURPOSE_LABELS,
  SYSTEM_JOB_SOURCE_LABELS,
  SYSTEM_JOB_STATE_LABELS,
  UNRESOLVED_PAYMENT_REASON_HINTS,
  UNRESOLVED_PAYMENT_REASON_LABELS,
  formatElapsed,
  formatJobInterval,
  systemErrorCodeLabel,
  systemJobState,
  type SystemHealthReport,
  type UnresolvedPaymentAttempt,
  type UnresolvedPaymentAttemptList,
} from '@/lib/admin/system-health';
import { formatOrderDateTime } from '@/lib/orders';

const NUM = 'text-right tabular-nums';
const time = (value: string | null) => value ? <time className="tabular-nums" dateTime={value}>{formatOrderDateTime(value)}</time> : <span className="text-muted-foreground">—</span>;

/**
 * 시스템 상태(원장 OPS-039·OPS-040·PAY-067·PAY-063·CUS-066). 자동 작업의 실패·멈춤, 미종결 결제 시도, 메일 발송 실패를 한 화면에서 본다.
 * 판정은 DB(admin_system_health)가 하고 화면은 고르지 않는다. 미종결 결제 목록·재확인은 주문 관리 권한(sales.manage)이 있을 때만 보인다.
 */
export function SystemHealthScreen({ health, payments, canReconcile }: {
  health: SystemHealthReport | null;
  /** sales.manage가 없으면 undefined(목록을 읽지 않는다), 읽지 못하면 null. */
  payments: UnresolvedPaymentAttemptList | null | undefined;
  canReconcile: boolean;
}) {
  return <div className="flex min-w-0 flex-col gap-4" data-system-health="">
    <AdminPageHeader title="시스템 상태"
      description="메일·정기결제·선물 만료·리워드·배송 추적 같은 자동 작업의 실패·멈춤, 결제사 결과를 받지 못한 결제, 메일 발송 실패를 한곳에서 봅니다. 문제가 생기면 운영 알림 '시스템'과 할 일 '시스템 점검'에도 건수가 올라옵니다." />
    {health ? <HealthBody canReconcile={canReconcile} health={health} payments={payments} />
      : <AdminNotice role="alert" title="시스템 상태를 불러오지 못했습니다" tone="danger">
        새로고침 후 다시 확인해주세요. 계속 열리지 않으면 DB 연결 자체가 문제일 수 있으니 개발팀에 알려주세요.
      </AdminNotice>}
  </div>;
}

function HealthBody({ health, payments, canReconcile }: { health: SystemHealthReport; payments: UnresolvedPaymentAttemptList | null | undefined; canReconcile: boolean }) {
  const { counts } = health;
  return <>
    <p className="text-xs text-muted-foreground">기준 시각 {time(health.asOf)}</p>
    <div className={ADMIN_COUNT_CARD_GRID_CLASS}>
      <AdminCountCard count={counts.problemJobs} href="#system-jobs" label="문제 있는 자동 작업" tone="danger" unit="개" />
      <AdminCountCard count={counts.unresolvedPayments} href="#unresolved-payments" label="미종결 결제" tone="warning" />
      <AdminCountCard count={counts.emailFailures} href="#system-emails" label="메일 발송 실패(24시간)" tone="danger" />
      <AdminCountCard count={counts.emailBounces} href="#system-emails" label="메일 반송(24시간)" tone="warning" />
    </div>
    {counts.issues === 0 ? <AdminNotice role="status" title="지금 확인할 문제가 없습니다" tone="success">
      자동 작업이 모두 제때 돌고 있고, 미종결 결제와 메일 발송 실패가 없습니다.
    </AdminNotice> : null}
    <JobsSection health={health} />
    <FailuresSection health={health} />
    <PaymentsSection canReconcile={canReconcile} health={health} payments={payments} />
    <AdminSectionCard id="system-emails" title="메일 발송"
      summary="최근 24시간. 실패는 우리·발송사 쪽 문제(설정·연결·결과 불명)이고, 반송은 받는 주소 문제(없는 주소·수신 거부)입니다.">
      <p className="text-sm">발송 실패 <strong className="tabular-nums">{health.emails.failed24h.toLocaleString('ko-KR')}건</strong> · 반송 <strong className="tabular-nums">{health.emails.bounced24h.toLocaleString('ko-KR')}건</strong></p>
      <p className="text-sm text-muted-foreground">주문 확인·배송 안내 메일의 건별 결과는 <Link className="underline underline-offset-4" href="/admin/messaging/emails">메일 발송 이력</Link>에서 봅니다. 실패가 이어지면 발송 설정(Resend 키·발신 도메인)을 개발팀에 확인해주세요.</p>
    </AdminSectionCard>
  </>;
}

function JobsSection({ health }: { health: SystemHealthReport }) {
  return <AdminSectionCard id="system-jobs" title="자동 작업"
    summary="'멈춤'은 주기의 두 배 + 10분 동안 성공 기록이 없다는 뜻입니다. '기록 없음'은 이 배포에서 아직 한 번도 돌지 않은 작업입니다(로컬·미리보기에서는 앱 자동 작업이 돌지 않습니다).">
    <Table aria-label="자동 작업 상태">
      <TableHeader><TableRow>
        <TableHead scope="col">상태</TableHead><TableHead scope="col">작업</TableHead><TableHead scope="col">종류</TableHead>
        <TableHead scope="col">주기</TableHead><TableHead scope="col">마지막 실행</TableHead><TableHead scope="col">마지막 성공</TableHead>
        <TableHead className="text-right" scope="col">24시간 실패</TableHead><TableHead scope="col">마지막 오류</TableHead>
      </TableRow></TableHeader>
      <TableBody>{health.jobs.map(job => {
        const state = systemJobState(job);
        return <TableRow data-system-job={job.jobKey} data-system-job-state={state} key={`${job.source}:${job.jobKey}`}>
          <TableCell><AdminStatusBadge tone={statusTone('systemJob', state)}>{SYSTEM_JOB_STATE_LABELS[state]}</AdminStatusBadge></TableCell>
          <TableCell className="whitespace-normal"><span className="font-medium">{job.label}</span>{job.label !== job.jobKey ? <span className="block font-mono text-xs text-muted-foreground">{job.jobKey}</span> : null}</TableCell>
          <TableCell className="text-muted-foreground">{SYSTEM_JOB_SOURCE_LABELS[job.source]}</TableCell>
          <TableCell>{formatJobInterval(job.expectedIntervalMinutes)}</TableCell>
          <TableCell>{time(job.lastRunAt)}</TableCell>
          <TableCell>{time(job.lastSuccessAt)}</TableCell>
          <TableCell className={NUM}>{job.failures24h.toLocaleString('ko-KR')}</TableCell>
          <TableCell className="whitespace-normal">{job.failing || job.lastErrorCode ? systemErrorCodeLabel(job.lastErrorCode) ?? '—' : <span className="text-muted-foreground">—</span>}</TableCell>
        </TableRow>;
      })}</TableBody>
    </Table>
  </AdminSectionCard>;
}

function FailuresSection({ health }: { health: SystemHealthReport }) {
  if (!health.recentFailures.length) return null;
  return <AdminSectionCard title="최근 24시간 실패" summary="최신 50건. 오류 원문·개인정보는 남기지 않고 오류 코드만 남깁니다 — 코드를 개발팀에 그대로 전달해주세요.">
    <Table aria-label="최근 24시간 실패">
      <TableHeader><TableRow>
        <TableHead scope="col">시각</TableHead><TableHead scope="col">작업</TableHead><TableHead scope="col">오류</TableHead>
        <TableHead scope="col">오류 코드</TableHead><TableHead className="text-right" scope="col">응답 코드</TableHead>
      </TableRow></TableHeader>
      <TableBody>{health.recentFailures.map((failure, index) => <TableRow key={`${failure.source}:${failure.jobKey}:${failure.occurredAt}:${index}`}>
        <TableCell>{time(failure.occurredAt)}</TableCell>
        <TableCell className="whitespace-normal">{failure.label}</TableCell>
        <TableCell className="whitespace-normal">{systemErrorCodeLabel(failure.errorCode)}</TableCell>
        <TableCell className="font-mono text-xs">{failure.errorCode}</TableCell>
        <TableCell className={NUM}>{failure.statusCode ?? '—'}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
  </AdminSectionCard>;
}

function PaymentsSection({ health, payments, canReconcile }: { health: SystemHealthReport; payments: UnresolvedPaymentAttemptList | null | undefined; canReconcile: boolean }) {
  const summary = `결제사 결과를 받지 못했거나(결과 불명) 확인 처리가 멈춘 결제는 그동안 재고·쿠폰을 잡고 있습니다. 결과 불명·멈춘 확인은 10분마다 자동으로 다시 확인합니다(같은 결제는 30분에 한 번, 7일 안). 굿즈 ${health.payments.goods.toLocaleString('ko-KR')}건 · 티켓 ${health.payments.tickets.toLocaleString('ko-KR')}건${health.payments.other ? ` · 그 밖 ${health.payments.other.toLocaleString('ko-KR')}건` : ''}.`;
  return <AdminSectionCard id="unresolved-payments" summary={summary} title="미종결 결제">
    {!canReconcile ? <AdminNotice tone="neutral">{"목록과 '결제 상태 다시 확인'은 주문 관리 권한이 있는 매니저에게 보입니다."}</AdminNotice>
      : payments === null || payments === undefined ? <AdminNotice role="alert" tone="danger">미종결 결제 목록을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</AdminNotice>
        : payments.total === 0 ? <p className="text-sm text-muted-foreground">미종결 결제가 없습니다.</p>
          : <>
            <Table aria-label="미종결 결제 시도">
              <TableHeader><TableRow>
                <TableHead scope="col">주문</TableHead><TableHead scope="col">결제사</TableHead><TableHead className="text-right" scope="col">금액</TableHead>
                <TableHead scope="col">상태</TableHead><TableHead scope="col">경과</TableHead><TableHead scope="col">마지막 확인</TableHead><TableHead scope="col">처리</TableHead>
              </TableRow></TableHeader>
              <TableBody>{payments.items.map(item => <PaymentRow asOf={payments.asOf} item={item} key={item.attemptId} />)}</TableBody>
            </Table>
            {payments.total > payments.items.length ? <p className="text-xs text-muted-foreground">오래된 {payments.items.length.toLocaleString('ko-KR')}건만 보입니다(전체 {payments.total.toLocaleString('ko-KR')}건). 처리하면 다음 건이 올라옵니다.</p> : null}
          </>}
  </AdminSectionCard>;
}

function PaymentRow({ item, asOf }: { item: UnresolvedPaymentAttempt; asOf: string }) {
  const target = item.orderNumber ?? `${PAYMENT_PURPOSE_LABELS[item.purpose] ?? item.purpose} ${item.attemptId.slice(0, 8)}`;
  return <TableRow data-unresolved-payment={item.attemptId} data-unresolved-reason={item.reason}>
    <TableCell className="whitespace-normal">
      {item.purpose === 'order' && item.refId
        ? <Link className="font-medium tabular-nums underline-offset-4 hover:underline" href={`/admin/sales/orders/${item.refId}`}>{target}</Link>
        : <span className="font-medium tabular-nums">{target}</span>}
      <span className="block text-xs text-muted-foreground">{PAYMENT_PURPOSE_LABELS[item.purpose] ?? item.purpose}</span>
    </TableCell>
    <TableCell>{PAYMENT_PROVIDER_LABELS[item.provider] ?? item.provider}</TableCell>
    <TableCell className={NUM}>{item.amount.toLocaleString('ko-KR')}원</TableCell>
    <TableCell className="max-w-80 whitespace-normal">
      <AdminStatusBadge title={UNRESOLVED_PAYMENT_REASON_HINTS[item.reason]} tone={statusTone('unresolvedPayment', item.reason)}>{UNRESOLVED_PAYMENT_REASON_LABELS[item.reason]}</AdminStatusBadge>
      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{UNRESOLVED_PAYMENT_REASON_HINTS[item.reason]}</span>
    </TableCell>
    <TableCell className="tabular-nums">{formatElapsed(item.createdAt, asOf)}</TableCell>
    <TableCell>{time(item.lastCheckedAt)}</TableCell>
    <TableCell className="whitespace-normal">
      {item.reconcilable ? <PaymentAttemptReconcileButton attemptId={item.attemptId} targetLabel={target} />
        : <span className="text-xs text-muted-foreground">{item.provider === 'bank_transfer' ? '미결제 확인에서 처리' : '결제사 조회 불가 · 수동 처리'}</span>}
    </TableCell>
  </TableRow>;
}
