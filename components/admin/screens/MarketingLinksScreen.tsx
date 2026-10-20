import Link from 'next/link';
import { AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '../console/AdminKit';
import { ConsolePagination } from '../console/ConsolePagination';
import { MarketingLinkCopy, MarketingLinkIssuer } from '../marketing/MarketingLinkIssuer';
import { MARKETING_LINKS_PATH, MARKETING_LINK_SOURCES, MARKETING_LINK_LABELS, MARKETING_LINK_ORIGINS, marketingLinksHref, type MarketingLinksData } from '@/lib/admin/marketing-links';
export function MarketingLinksScreen({ data, canIssueHome }: { data: MarketingLinksData; canIssueHome: boolean }) {
  const { filters, rows, total } = data;
  return <section className="wc-admin-kit wc-admin-kit__screen admin-marketing-links">
    <AdminPageHeader title="마케팅 링크" description="스토어 홈·상품·쇼핑스토리·카테고리의 공유 링크를 조회하고 복사합니다." />
    <nav className="admin-marketing-links__tabs" aria-label="링크 종류">{MARKETING_LINK_SOURCES.map(source => <Link key={source} aria-current={source === filters.source ? 'page' : undefined} href={marketingLinksHref({ ...filters, source, query: '', status: 'all' }, 1)}>{MARKETING_LINK_LABELS[source]}</Link>)}</nav>
    <AdminSectionCard title={`${MARKETING_LINK_LABELS[filters.source]} 링크`}>
      <div className="admin-marketing-links__intro"><p>{filters.source === 'home' ? '스토어 홈으로 이동하는 링크입니다.' : `${MARKETING_LINK_LABELS[filters.source]} 관리 화면에서 대상을 선택해 링크를 생성합니다.`}</p>
        {filters.source === 'home' ? canIssueHome ? <MarketingLinkIssuer source="home" targetIds={['home']} refreshOnIssue label="스토어 홈 링크 생성/복사" /> : <p>스토어 관리 권한이 있으면 홈 링크를 생성할 수 있습니다.</p> : <Link className="wc-admin-kit__button" href={MARKETING_LINK_ORIGINS[filters.source]}>{MARKETING_LINK_LABELS[filters.source]} 관리로 이동</Link>}</div>
      <form action={MARKETING_LINKS_PATH} className="admin-marketing-links__filters"><input name="source" type="hidden" value={filters.source} /><input name="pageSize" type="hidden" value={filters.pageSize} />
        <label>이름·번호·링크 검색<input name="q" defaultValue={filters.query} maxLength={100} /></label>
        <label>이동 상태<select name="status" defaultValue={filters.status}><option value="all">전체</option><option value="available">이동 가능</option><option value="unavailable">이동 불가</option></select></label><button className="wc-admin-kit__button" type="submit">조회</button></form>
      <p>총 <strong>{total.toLocaleString('ko-KR')}</strong>개</p>
      {rows.length ? <div className="admin-marketing-links__ledger">{rows.map(row => <article key={row.id}><div className="admin-marketing-links__metadata"><span>대상 번호 {row.targetId ?? row.originalTargetId}</span><time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</time><AdminStatusBadge tone={row.available ? 'success' : 'neutral'}>{row.available ? '이동 가능' : '이동 불가'}</AdminStatusBadge></div><MarketingLinkCopy rows={[row]} /></article>)}</div> : <p className="admin-marketing-links__empty">조건에 맞는 링크가 없습니다.</p>}
      <ConsolePagination page={filters.page} pageSize={filters.pageSize} total={total} hrefForPage={page => marketingLinksHref(filters, page)} />
    </AdminSectionCard>
    <aside className="admin-marketing-links__help"><strong>링크 사용 안내</strong><ul><li>링크 주소는 수정하거나 링크만 별도로 삭제할 수 없습니다. 최초 공개 전 상품 주소 ID가 바뀌어도 같은 상품의 링크가 유지됩니다.</li><li>원본과 상위 IP의 공개 여부, 카테고리 활성화, 쇼핑스토리 전시기간을 이동할 때마다 확인합니다. 삭제된 원본은 이동할 수 없습니다.</li><li>UTM 매개변수 5종(source, medium, campaign, term, content)만 전달합니다. 이 화면은 클릭·매출·전환을 집계하지 않습니다.</li></ul></aside>
  </section>;
}
