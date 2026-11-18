import Link from 'next/link';
import { ConsoleCountChips, ConsoleFilterField, ConsoleFilterPanel, ConsoleGrid, ConsoleListCard, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { AdminSelect } from '@/components/admin/console/AdminSelect';
import { EncryptedWorkbookDownloadButton } from '@/components/admin/EncryptedWorkbookDownloadButton';
import { Input } from '@/components/admin/kit/ui/input';
import { kstDateTimeText } from '@/lib/admin/list-export';
import {
  PII_ACCESS_ACTION_LABELS,
  PII_ACCESS_FLAG_LABELS,
  PII_ACCESS_FLAG_RULES,
  PII_ACCESS_LOG_PATH,
  PII_ACCESS_LOG_RETENTION_YEARS,
  PII_ACCESS_SURFACE_LABELS,
  piiAccessActorAccessLabel,
  piiAccessDetailText,
  piiAccessLogExportHref,
  piiAccessLogHref,
  piiAccessSubjectSummary,
  piiAccessSurfaceLabel,
  type PiiAccessFlag,
  type PiiAccessLogData,
  type PiiAccessLogEntry,
  type PiiAccessLogFilters,
} from '@/lib/admin/pii-access-log';
import { statusTone } from '@/lib/admin/status-tone';

/*
 * 개인정보 접속기록 점검(CUS-084·OPS-014·OPS-015) — 템플릿 룩(ADR-0028). 개인정보의 안전성 확보조치 기준 제8조의 접속기록을
 * 기간·운영자·업무·화면·대상으로 거르고, 단순 규칙의 이상 징후(근무시간 외·대량·몰아보기)를 표시한다. 기록은 지난 일이라 업무에는
 * 색을 쓰지 않고 이상 징후만 상태 표의 색을 따른다. 대상 ID는 개인정보 화면이 아니라 같은 점검 화면의 대상 필터로 잇는다.
 */

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'at', label: '접속일시', width: '160px', required: true },
  { key: 'actor', label: '운영자', width: '170px' },
  { key: 'ip', label: '접속지(IP)', width: '140px' },
  { key: 'action', label: '수행 업무', width: '100px' },
  { key: 'surface', label: '화면', width: '220px' },
  { key: 'subject', label: '대상', width: '240px' },
  { key: 'detail', label: '조건·참고', minWidth: '180px' },
  { key: 'flags', label: '이상 징후', width: '150px' },
];
const EXPORT_LIMIT = 10_000;

function SubjectCell({ entry, filters }: { entry: PiiAccessLogEntry; filters: PiiAccessLogFilters }) {
  const more = entry.subjectCount - entry.subjectIds.length;
  return <div className="flex min-w-0 flex-col gap-0.5">
    <span>{piiAccessSubjectSummary(entry)}{entry.memberCount && entry.subjectKind !== 'member' ? ` · 회원 ${entry.memberCount.toLocaleString('ko-KR')}명` : ''}</span>
    {entry.subjectIds.length ? <span className="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
      {entry.subjectIds.map(id => <Link aria-label={`대상 ${id}의 접속기록만 보기`} className="font-mono underline underline-offset-2 hover:text-foreground" href={piiAccessLogHref(filters, { subject: id, page: 1 })} key={id}>{id.slice(0, 8)}</Link>)}
      {more > 0 ? <span>외 {more.toLocaleString('ko-KR')}건</span> : null}
    </span> : null}
  </div>;
}

export function PiiAccessLogScreen({ data, filters }: { data: PiiAccessLogData; filters: PiiAccessLogFilters }) {
  const exportBlocked = data.total === 0 || data.total > EXPORT_LIMIT;
  const flagChip = (flag: PiiAccessFlag, count: number) => {
    const tone = statusTone('piiAccessFlag', flag);
    return { label: PII_ACCESS_FLAG_LABELS[flag], count, tone: tone === 'neutral' ? 'default' as const : tone,
      href: piiAccessLogHref(filters, { flag, page: 1 }), active: filters.flag === flag };
  };
  return <section aria-label="개인정보 접속기록" className="flex min-w-0 flex-col gap-4 text-sm text-foreground" data-admin-kit="pii-access-log">
    <AdminNotice title="운영자가 고객 개인정보를 열람·검색·내려받은 기록입니다.">
      <p>고객 상세·주문 상세(목록 위 팝업 포함)·클레임 상세 열람, 이름·연락처·이메일로 한 주문 검색, 회수지·재배송지·환불계좌 원문 확인, 개인정보가 담긴 엑셀·출고지시 파일 내려받기를 누가·언제·어디서(IP)·누구의 정보를 처리했는지 남깁니다. 개인정보 원문(이름·연락처·주소·검색어)은 남기지 않습니다.</p>
      <p>기록은 {PII_ACCESS_LOG_RETENTION_YEARS}년 보관한 뒤 자동으로 지워지며 누구도 고치거나 지울 수 없습니다. 이 화면을 열거나 목록을 내려받은 기록도 남습니다. 한 달에 한 번 이상 이상 징후를 점검하고 경위를 확인해주세요.</p>
    </AdminNotice>
    <ConsoleFilterPanel action={PII_ACCESS_LOG_PATH} className="[&_[data-console-filter=period]>div>div:last-child]:flex-wrap" idPrefix="pii-access-log"
      resetHref={PII_ACCESS_LOG_PATH} dateRange={{ from: filters.from, to: filters.to, label: '접속 기간' }}>
      <ConsoleFilterField htmlFor="pii-access-log-actor" label="운영자">
        <AdminSelect defaultValue={filters.actor ?? ''} id="pii-access-log-actor" name="actor" wrapperClassName="w-48">
          <option value="">전체</option>
          {filters.actor && !data.actors.some(actor => actor.id === filters.actor) ? <option value={filters.actor}>선택한 운영자</option> : null}
          {data.actors.map(actor => <option key={actor.id} value={actor.id}>{actor.name} ({actor.count.toLocaleString('ko-KR')}건)</option>)}
        </AdminSelect>
      </ConsoleFilterField>
      <ConsoleFilterField htmlFor="pii-access-log-action" label="수행 업무">
        <AdminSelect defaultValue={filters.action ?? ''} id="pii-access-log-action" name="action" wrapperClassName="w-32">
          <option value="">전체</option>
          {Object.entries(PII_ACCESS_ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </AdminSelect>
      </ConsoleFilterField>
      <ConsoleFilterField htmlFor="pii-access-log-surface" label="화면">
        <AdminSelect defaultValue={filters.surface ?? ''} id="pii-access-log-surface" name="surface" wrapperClassName="w-48">
          <option value="">전체</option>
          {Object.entries(PII_ACCESS_SURFACE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </AdminSelect>
      </ConsoleFilterField>
      <ConsoleFilterField htmlFor="pii-access-log-flag" label="이상 징후">
        <AdminSelect defaultValue={filters.flag ?? ''} id="pii-access-log-flag" name="flag" wrapperClassName="w-36">
          <option value="">전체</option>
          <option value="any">이상 징후 전체</option>
          {Object.entries(PII_ACCESS_FLAG_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </AdminSelect>
      </ConsoleFilterField>
      <ConsoleFilterField className="min-w-[min(100%,20rem)] flex-1" htmlFor="pii-access-log-subject" label="대상 ID">
        <Input autoComplete="off" defaultValue={filters.subject ?? ''} id="pii-access-log-subject" name="subject" placeholder="회원·주문·클레임·배송 건 ID" spellCheck={false} />
        <span className="text-xs text-muted-foreground">회원 ID를 넣으면 그 회원의 주문·클레임을 본 기록도 함께 찾습니다.</span>
      </ConsoleFilterField>
    </ConsoleFilterPanel>
    {filters.adjusted ? <AdminNotice role="status" title="조회 조건 일부를 기본값으로 바꿔 조회했습니다." tone="warning">
      접속 기간은 시작일이 종료일보다 늦지 않은 날짜로 최대 1년(366일)까지, 운영자·대상은 ID 형식으로만 거를 수 있습니다.
    </AdminNotice> : null}
    <ConsoleCountChips label="이상 징후별 건수" chips={[
      { label: '전체 기록', count: data.summary.total, href: piiAccessLogHref(filters, { flag: null, page: 1 }), active: !filters.flag },
      { label: '이상 징후', count: data.summary.flagged, tone: 'warning', href: piiAccessLogHref(filters, { flag: 'any', page: 1 }), active: filters.flag === 'any' },
      flagChip('off_hours', data.summary.offHours), flagChip('bulk', data.summary.bulk), flagChip('burst', data.summary.burst),
    ]} />
    <p className="text-xs text-muted-foreground" data-pii-access-rules="">
      이상 징후 기준 — {(Object.keys(PII_ACCESS_FLAG_RULES) as PiiAccessFlag[]).map(flag => `${PII_ACCESS_FLAG_LABELS[flag]}: ${PII_ACCESS_FLAG_RULES[flag]}`).join(' · ')}. 표시는 점검의 시작점이며 그 자체로 위반을 뜻하지 않습니다.
    </p>
    <ConsoleListCard title="접속기록" total={data.total}
      description={`${data.from} ~ ${data.to}(KST) · 최신순 · 한 쪽 ${data.pageSize}건`}
      actions={<div className="flex flex-col items-start gap-1 sm:items-end" data-export-href={piiAccessLogExportHref(filters)} data-pii-access-export="">
        <EncryptedWorkbookDownloadButton describedBy="pii-access-log-export-hint" disabled={exportBlocked} href={piiAccessLogExportHref(filters)} label="엑셀 다운로드" />
        <span className="max-w-md text-left text-xs leading-snug text-muted-foreground sm:text-right" id="pii-access-log-export-hint">
          {data.total > EXPORT_LIMIT ? `한 번에 ${EXPORT_LIMIT.toLocaleString('ko-KR')}건까지 받습니다. 기간이나 조건을 좁혀주세요.` : `현재 조건 전체 ${data.total.toLocaleString('ko-KR')}건 · 운영자 IP가 담긴 파일이라 비밀번호를 걸고, 내려받은 기록도 남습니다.`}
        </span>
      </div>}>
      <ConsoleGrid caption="개인정보 접속기록" columns={COLUMNS} emptyLabel="이 조건의 접속기록이 없습니다." preferencesKey="pii-access-log"
        rows={data.items.map(entry => ({ id: entry.id, cells: [
          <time className="tabular-nums" dateTime={entry.at} key="at">{kstDateTimeText(entry.at)}</time>,
          <div className="flex min-w-0 flex-col gap-0.5" key="actor">
            <Link className="font-medium underline-offset-4 hover:underline" href={piiAccessLogHref(filters, { actor: entry.actorId, page: 1 })}>{entry.actorName}</Link>
            <span className="text-xs text-muted-foreground">{piiAccessActorAccessLabel(entry.actorAccess)}</span>
          </div>,
          entry.ip ? <span className="font-mono text-xs" key="ip">{entry.ip}</span> : <span className="text-muted-foreground" key="ip">확인 불가</span>,
          PII_ACCESS_ACTION_LABELS[entry.action],
          <div className="flex min-w-0 flex-col gap-0.5" key="surface">
            <span>{piiAccessSurfaceLabel(entry.surface)}</span>
            <span className="font-mono text-xs break-all text-muted-foreground">{entry.path}</span>
          </div>,
          <SubjectCell entry={entry} filters={filters} key="subject" />,
          <span className="wrap-anywhere text-muted-foreground" key="detail">{piiAccessDetailText(entry.detail) || '—'}</span>,
          entry.flags.length ? <span className="flex flex-wrap gap-1" key="flags">
            {entry.flags.map(flag => <AdminStatusBadge key={flag} tone={statusTone('piiAccessFlag', flag)}>{PII_ACCESS_FLAG_LABELS[flag]}</AdminStatusBadge>)}
          </span> : <span className="text-muted-foreground" key="flags">—</span>,
        ] }))} />
      <ConsolePagination hrefForPage={page => piiAccessLogHref(filters, { page })} label="접속기록 페이지" page={data.page} pageSize={data.pageSize} total={data.total} />
    </ConsoleListCard>
  </section>;
}
