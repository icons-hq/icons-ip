import Link from 'next/link';
import type { ReactNode } from 'react';
import { CustomerServiceListSelect } from './CustomerServiceListControls';

export function CustomerServiceTabs({ active }: { active: 'qna' | 'inquiries' | 'reviews' }) {
  return <nav className="admin-cs-tabs" aria-label="문의·리뷰 관리">
    {([
      ['qna', '상품 문의'], ['inquiries', '고객문의'], ['reviews', '리뷰 관리'],
    ] as const).map(([key, label]) => <Link aria-current={key === active ? 'page' : undefined} href={`/admin/cs/${key}`} key={key}>{label}</Link>)}
  </nav>;
}

export function CustomerServiceResultsHeader({ title, total, pageSize, pageSizeOptions, children }: {
  title: string;
  total: number;
  pageSize: number;
  pageSizeOptions: { value: string; label: string; href: string }[];
  children?: ReactNode;
}) {
  return <div className="admin-cs-results__header">
    <h3>{title} <span>(총 <strong>{total.toLocaleString('ko-KR')}</strong>개)</span></h3>
    <div className="admin-cs-results__controls">
      {children}
      <CustomerServiceListSelect label={`${title} 수`} value={String(pageSize)} options={pageSizeOptions} />
    </div>
  </div>;
}
