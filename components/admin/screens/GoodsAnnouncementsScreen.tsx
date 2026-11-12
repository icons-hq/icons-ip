import Link from 'next/link';
import { Plus } from 'lucide-react';
import { formatOrderDateTime } from '@/lib/orders';
import { kstDay } from '@/lib/admin/kst';
import { goodsAnnouncementHref, GOODS_ANNOUNCEMENTS_PATH, GOODS_ANNOUNCEMENT_CATEGORIES, GOODS_ANNOUNCEMENT_DEVICES, GOODS_ANNOUNCEMENT_PLACEMENTS, GOODS_ANNOUNCEMENT_STATES, type GoodsAnnouncementListData } from '@/lib/admin/goods-announcements';
import { AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminSelect } from '../console/AdminSelect';
import { ConsoleFilterField, ConsoleFilterPanel, ConsoleGrid, ConsolePagination } from '../console';
import { buttonVariants } from '../kit/ui/button';
import { CustomerServiceListSelect } from './CustomerServiceListControls';

const KST_PERIOD_FORMAT = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function kstPeriodParts(value: string) {
  const parts = Object.fromEntries(KST_PERIOD_FORMAT.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return { year: parts.year, date: `${parts.month}.${parts.day} ${parts.hour}:${parts.minute}` };
}
/** 목록의 전시·노출 기간을 한 줄로 줄인다(같은 해면 끝 날짜의 연도를 생략한다). 한국 시각이고, 전체 일시는 칸의 말풍선에 둔다. */
export function compactKstPeriod(startsAt: string | null, endsAt: string | null) {
  if (!startsAt && !endsAt) return '제한 없음';
  const start = startsAt ? kstPeriodParts(startsAt) : null, end = endsAt ? kstPeriodParts(endsAt) : null;
  const startText = start ? `${start.year}.${start.date}` : '제한 없음';
  const endText = end ? `${end.year === start?.year ? '' : `${end.year}.`}${end.date}` : '제한 없음';
  return `${startText} ~ ${endText}`;
}

export function GoodsAnnouncementsScreen({ data }: { data: GoodsAnnouncementListData }) {
  const { rows, total, filters } = data; const href = goodsAnnouncementHref(filters);
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-announcements">
    <AdminPageHeader title="상품공지사항 관리" description="공지 저장은 고객 알림을 발송하지 않습니다. 전시중인 공지도 상품과 IP가 공개되어 있고 노출 화면·적용 상품 조건이 맞을 때 표시됩니다." actions={<Link className={buttonVariants()} data-slot="button" href={`${href}&create=1`}><Plus aria-hidden="true" />상품공지사항 등록</Link>} />
    <ConsoleFilterPanel action={GOODS_ANNOUNCEMENTS_PATH} hiddenFields={{ pageSize: String(filters.pageSize) }} dateRange={{ label: '공지등록일', from: filters.from, to: filters.to, presetHref: range => goodsAnnouncementHref({ ...filters, ...range }, 1) }}
      statusFilter={{ label: '전시상태', name: 'state', value: filters.state, options: [{ value: 'all', label: '전체' }, ...GOODS_ANNOUNCEMENT_STATES] }}
      search={{ label: '검색어', name: 'q', value: filters.query, fieldName: 'field', fieldValue: filters.field, fields: [{ value: 'title', label: '공지 제목' }, { value: 'reference', label: '공지번호' }] }} resetHref={GOODS_ANNOUNCEMENTS_PATH}>
      <ConsoleFilterField htmlFor="announcement-filter-category" label="공지 분류"><AdminSelect id="announcement-filter-category" name="category" defaultValue={filters.category} wrapperClassName="w-40"><option value="all">전체</option>{GOODS_ANNOUNCEMENT_CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</AdminSelect></ConsoleFilterField>
    </ConsoleFilterPanel>
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" aria-label="상품공지사항 목록"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-base leading-snug font-medium">상품공지사항 목록 <span className="text-sm font-normal text-muted-foreground">(총 <strong className="font-semibold text-foreground tabular-nums">{total.toLocaleString('ko-KR')}</strong>개)</span></h3><CustomerServiceListSelect label="상품공지사항 목록 수" value={String(filters.pageSize)} options={([20, 50, 100] as const).map(size => ({ value: String(size), label: `${size}개씩`, href: goodsAnnouncementHref({ ...filters, pageSize: size }, 1) }))} /></div>
      {/* 1440 화면에서 수정일까지 들어오도록 열을 나눴다. 공지 제목은 한 줄로 줄여 중요 표시가 있어도 줄 높이가 같다. 안내는 조회항목 설정과 한 줄에 둔다. */}
      <ConsoleGrid caption="상품공지사항 목록" className="[&_table]:min-w-[1168px]" preferencesKey="goods-announcements" columns={[
        { key: 'title', label: '공지 제목', width: '228px' }, { key: 'reference', label: '공지번호', width: '72px' }, { key: 'category', label: '분류', width: '76px' }, { key: 'state', label: '전시상태', width: '96px' },
        { key: 'device', label: '노출 화면', width: '84px' }, { key: 'placement', label: '노출 위치', width: '84px' }, { key: 'goods', label: '적용 상품', width: '76px' }, { key: 'period', label: '전시 기간', width: '244px' }, { key: 'created', label: '등록일', width: '104px' }, { key: 'updated', label: '수정일', width: '104px' },
      ]} rows={rows.map(row => ({ id: row.id, href: `${href}&edit=${row.id}`, cells: [
        <span className="inline-flex max-w-[12.75rem] items-center gap-1.5 align-middle" key="title" title={row.title}>{row.important ? <AdminStatusBadge className="shrink-0" tone="danger">중요</AdminStatusBadge> : null}<span className="min-w-0 truncate">{row.title}</span></span>, row.reference,
        <span className="whitespace-nowrap" key="category">{GOODS_ANNOUNCEMENT_CATEGORIES.find(item => item.value === row.category)?.label}</span>,
        <AdminStatusBadge key="state" tone={statusTone('goodsAnnouncement', row.state)}>{GOODS_ANNOUNCEMENT_STATES.find(item => item.value === row.state)?.label}</AdminStatusBadge>,
        <span className="whitespace-nowrap" key="device">{GOODS_ANNOUNCEMENT_DEVICES.find(item => item.value === row.device)?.label}</span>,
        <span className="whitespace-nowrap" key="placement">{GOODS_ANNOUNCEMENT_PLACEMENTS.find(item => item.value === row.placement)?.label}</span>, <span className="whitespace-nowrap" key="goods">{row.allGoods ? '전체 상품' : `${row.goodCount}개 상품`}</span>,
        <span className="whitespace-nowrap tabular-nums" key="period" title={`${row.startsAt ? formatOrderDateTime(row.startsAt) : '제한 없음'} ~ ${row.endsAt ? formatOrderDateTime(row.endsAt) : '제한 없음'}`}>{compactKstPeriod(row.startsAt, row.endsAt)}</span>,
        ...[row.createdAt, row.updatedAt].map((value, index) => <span className="whitespace-nowrap tabular-nums" key={index ? 'updated' : 'created'} title={value ? formatOrderDateTime(value) : undefined}>{value ? kstDay(new Date(value)).replaceAll('-', '.') : '—'}</span>),
      ] }))}><p className="text-sm text-muted-foreground">공지 제목을 누르면 내용과 적용 상품을 수정합니다. 기간은 한국 시각 기준입니다. 노출 위치는 상품 상세의 탭 위(상세 상단) 또는 상세설명 바로 아래(상세 하단)입니다.</p></ConsoleGrid>
      <ConsolePagination page={filters.page} total={total} pageSize={filters.pageSize} hrefForPage={page => goodsAnnouncementHref(filters, page)} />
    </section>
  </section>;
}
