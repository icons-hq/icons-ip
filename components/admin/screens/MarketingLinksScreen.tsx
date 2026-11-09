import Link from 'next/link';
import { AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '../console/AdminKit';
import { ConsolePagination } from '../console/ConsolePagination';
import { MarketingLinkCopy, MarketingLinkIssuer } from '../marketing/MarketingLinkIssuer';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { MARKETING_LINKS_PATH, MARKETING_LINK_SOURCES, MARKETING_LINK_LABELS, MARKETING_LINK_ORIGINS, marketingLinksHref, type MarketingLinksData } from '@/lib/admin/marketing-links';
/* 마케팅 링크 조회(템플릿 룩, ADR-0028). 링크 종류는 링크 탭, 조회 조건·목록은 kit 부품이다. URL 키는 그대로다. */
const TABS = 'inline-flex max-w-full items-center self-start overflow-x-auto rounded-lg bg-muted p-0.5';
const TAB = 'inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-primary-soft-foreground aria-[current=page]:shadow-sm';

export function MarketingLinksScreen({ data, canIssueHome }: { data: MarketingLinksData; canIssueHome: boolean }) {
  const { filters, rows, total } = data;
  return <section className="flex min-w-0 flex-col gap-5 text-sm">
    <AdminPageHeader title="마케팅 링크" description="스토어 홈·상품·쇼핑스토리·카테고리의 공유 링크를 조회하고 복사합니다." />
    <nav className={TABS} aria-label="링크 종류">{MARKETING_LINK_SOURCES.map(source => <Link className={TAB} key={source} aria-current={source === filters.source ? 'page' : undefined} href={marketingLinksHref({ ...filters, source, query: '', status: 'all' }, 1)}>{MARKETING_LINK_LABELS[source]}</Link>)}</nav>
    <AdminSectionCard title={`${MARKETING_LINK_LABELS[filters.source]} 링크`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4"><p className="text-muted-foreground">{filters.source === 'home' ? '스토어 홈으로 이동하는 링크입니다.' : `${MARKETING_LINK_LABELS[filters.source]} 관리 화면에서 대상을 선택해 링크를 생성합니다.`}</p>
        {filters.source === 'home' ? canIssueHome ? <MarketingLinkIssuer source="home" targetIds={['home']} refreshOnIssue label="새 스토어 홈 링크 만들고 복사" /> : <p className="text-muted-foreground">스토어 관리 권한이 있으면 홈 링크를 생성할 수 있습니다.</p> : <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={MARKETING_LINK_ORIGINS[filters.source]}>{MARKETING_LINK_LABELS[filters.source]} 관리로 이동</Link>}</div>
      <form action={MARKETING_LINKS_PATH} className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4 sm:flex-row sm:items-end"><input name="source" type="hidden" value={filters.source} /><input name="pageSize" type="hidden" value={filters.pageSize} />
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 font-medium">이름·번호·링크 검색<Input name="q" defaultValue={filters.query} maxLength={100} /></label>
        <label className="flex min-w-0 flex-col gap-1.5 font-medium">이동 상태<NativeSelect className="w-full sm:w-36" name="status" defaultValue={filters.status}><option value="all">전체</option><option value="available">이동 가능</option><option value="unavailable">이동 불가</option></NativeSelect></label><Button type="submit" variant="soft">조회</Button></form>
      <p>총 <strong className="font-semibold tabular-nums">{total.toLocaleString('ko-KR')}</strong>개</p>
      {rows.length ? <div className="grid gap-3">{rows.map(row => <article className="rounded-lg border p-3 sm:p-4" key={row.id}><div className="mb-2.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><span className="[overflow-wrap:anywhere]">대상 번호 {row.targetId ?? row.originalTargetId}</span><time className="tabular-nums sm:ml-auto" dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</time><AdminStatusBadge tone={row.available ? 'success' : 'neutral'}>{row.available ? '이동 가능' : '이동 불가'}</AdminStatusBadge></div><MarketingLinkCopy hideAvailability rows={[row]} /></article>)}</div> : <p className="py-10 text-center text-muted-foreground">조건에 맞는 링크가 없습니다.</p>}
      <ConsolePagination page={filters.page} pageSize={filters.pageSize} total={total} hrefForPage={page => marketingLinksHref(filters, page)} />
    </AdminSectionCard>
    <aside className="rounded-xl border bg-card p-4 leading-relaxed text-muted-foreground sm:p-5"><strong className="font-medium text-foreground">링크 사용 안내</strong><ul className="mt-2 list-disc space-y-1 pl-5"><li>링크 주소는 수정하거나 링크만 별도로 삭제할 수 없습니다. 최초 공개 전 상품 주소 ID가 바뀌어도 같은 상품의 링크가 유지됩니다.</li><li>원본과 상위 IP의 공개 여부, 카테고리 활성화, 쇼핑스토리 전시기간을 이동할 때마다 확인합니다. 삭제된 원본은 이동할 수 없습니다.</li><li>UTM 매개변수 5종(source, medium, campaign, term, content)만 전달합니다. 이 화면은 클릭·매출·전환을 집계하지 않습니다.</li></ul></aside>
  </section>;
}
