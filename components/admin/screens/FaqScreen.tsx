import Link from 'next/link';
import { AdminPageHeader, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { ConsoleFilterPanel } from '@/components/admin/console/ConsoleFilterPanel';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { ADMIN_FAQ_PATH, FAQ_CATEGORIES, FAQ_PAGE_SIZE, faqHref } from '@/lib/faq';
import type { FaqPageData } from '@/lib/faq.server';
import { inquiryCategoryLabel } from '@/lib/inquiries';
import { FaqDeleteForm, FaqEntryForm } from './FaqEntryForm';

export function FaqScreen({ data }: { data: FaqPageData }) {
  const { entries, filters, total } = data;
  return <section className="admin-faq wc-admin-kit">
    <AdminPageHeader title="FAQ 관리" description="고객이 문의하기 전에 찾아볼 질문과 답변을 관리합니다." actions={<Link href="/help" target="_blank" rel="noopener noreferrer">공개 FAQ 보기 (새 창)</Link>} />
    <details className="admin-faq__create"><summary>새 FAQ 등록</summary><FaqEntryForm /></details>
    <ConsoleFilterPanel action={ADMIN_FAQ_PATH}
      search={{ name: 'q', label: '질문 검색', value: filters.query, placeholder: '질문 내용으로 검색' }}
      statusFilter={{ value: filters.status, label: '게시 상태', options: [{ value: 'all', label: '전체' }, { value: 'published', label: '공개' }, { value: 'draft', label: '비공개' }] }}>
      <label>카테고리<select name="category" defaultValue={filters.category}><option value="">전체</option>{FAQ_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
    </ConsoleFilterPanel>
    <p className="admin-faq__hint">질문을 열어 수정할 수 있습니다. 공개 FAQ만 고객에게 표시됩니다.</p>
    {entries.length ? <div className="admin-faq__entries">{entries.map((entry) => <details key={entry.id} className="admin-faq__entry">
      <summary><span>{inquiryCategoryLabel(entry.category)}</span><strong>{entry.question}</strong><AdminStatusBadge tone={entry.published ? 'success' : 'neutral'}>{entry.published ? '공개' : '비공개'}</AdminStatusBadge><span>순서 {entry.sortOrder}</span></summary>
      <FaqEntryForm entry={entry} /><FaqDeleteForm entry={entry} />
    </details>)}</div> : <p className="admin-faq__empty">조건에 맞는 FAQ가 없습니다. 새 FAQ를 등록하거나 검색 조건을 바꿔주세요.</p>}
    <ConsolePagination page={filters.page} pageSize={FAQ_PAGE_SIZE} total={total} hrefForPage={(page) => faqHref(ADMIN_FAQ_PATH, filters, page)} />
  </section>;
}
