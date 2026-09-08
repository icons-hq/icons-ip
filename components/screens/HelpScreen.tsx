import Link from 'next/link';
import { FAQ_CATEGORIES, FAQ_PAGE_SIZE, faqHref } from '@/lib/faq';
import type { FaqPageData } from '@/lib/faq.server';
import { inquiryCategoryLabel } from '@/lib/inquiries';

export function HelpScreen({ data, failed = false }: { data: FaqPageData; failed?: boolean }) {
  const { entries, total, filters } = data;
  const pages = Math.max(1, Math.ceil(total / FAQ_PAGE_SIZE));
  return (
    <main className="wc-root wc-help">
      <header className="wc-help__heading">
        <h1>자주 묻는 질문</h1>
        <p>궁금한 내용을 검색하거나 유형별로 찾아보세요.</p>
      </header>
      <form action="/help" className="wc-help__search">
        <label htmlFor="faq-query">질문 검색</label>
        <div><input id="faq-query" name="q" type="search" defaultValue={filters.query} maxLength={200} placeholder="배송, 취소, 반품 등" /><button type="submit">검색</button></div>
        {filters.category ? <input type="hidden" name="category" value={filters.category} /> : null}
      </form>
      <nav aria-label="FAQ 카테고리" className="wc-help__categories">
        {[{ id: '', label: '전체' }, ...FAQ_CATEGORIES].map((category) => (
          <Link key={category.id} href={faqHref('/help', { ...filters, category: category.id as typeof filters.category }, 1)} aria-current={filters.category === category.id ? 'page' : undefined}>{category.label}</Link>
        ))}
      </nav>
      {failed ? <div className="wc-help__empty" role="alert"><p>FAQ를 불러오지 못했습니다.</p><Link href={faqHref('/help', filters)}>다시 시도</Link></div> : (
        <>
          <p className="wc-help__count">총 {total.toLocaleString('ko-KR')}개</p>
          {entries.length ? <div className="wc-help__entries">
            {entries.map((entry) => <details key={entry.id} id={`faq-${entry.id}`} className="wc-help__entry">
              <summary><span className="wc-help__category">{inquiryCategoryLabel(entry.category)}</span><span>{entry.question}</span></summary>
              <p>{entry.answer}</p>
            </details>)}
          </div> : <p className="wc-help__empty">{filters.query || filters.category ? '조건에 맞는 질문이 없습니다. 다른 검색어로 찾아보세요.' : '아직 등록된 FAQ가 없습니다.'}</p>}
          {pages > 1 ? <nav className="wc-help__pagination" aria-label="FAQ 페이지">
            {filters.page > 1 ? <Link href={faqHref('/help', filters, filters.page - 1)}>이전 페이지</Link> : <span />}
            <span>{filters.page} / {pages}</span>
            {filters.page < pages ? <Link href={faqHref('/help', filters, filters.page + 1)}>다음 페이지</Link> : <span />}
          </nav> : null}
        </>
      )}
      <section className="wc-help__contact"><h2>답을 찾지 못하셨나요?</h2><p>상황을 알려주시면 운영자가 도와드릴게요.</p><Link href="/my/inquiries/new">1:1 문의하기</Link></section>
    </main>
  );
}
