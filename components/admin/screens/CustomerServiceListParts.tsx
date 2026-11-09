import Link from 'next/link';
import type { ReactNode } from 'react';
import { CustomerServiceListSelect } from './CustomerServiceListControls';
import { KIT_SEGMENT_CLASS, KIT_SEGMENT_ITEM_CLASS } from './cs-kit-classes';

/* 문의·리뷰 관리 목록(상품 문의·고객문의·리뷰)의 공용 부품 — 템플릿 룩(ADR-0028). */

export function CustomerServiceTabs({ active }: { active: 'qna' | 'inquiries' | 'reviews' }) {
  return <nav className={KIT_SEGMENT_CLASS} aria-label="문의·리뷰 관리">
    {([
      ['qna', '상품 문의'], ['inquiries', '고객문의'], ['reviews', '리뷰 관리'],
    ] as const).map(([key, label]) => <Link aria-current={key === active ? 'page' : undefined} className={KIT_SEGMENT_ITEM_CLASS} href={`/admin/cs/${key}`} key={key}>{label}</Link>)}
  </nav>;
}

/** 결과 카드(목록 제목·전체 건수·목록 수)의 머리. */
export function CustomerServiceResultsHeader({ title, total, pageSize, pageSizeOptions, children }: {
  title: string;
  total: number;
  pageSize: number;
  pageSizeOptions: { value: string; label: string; href: string }[];
  children?: ReactNode;
}) {
  return <div className="flex flex-wrap items-center justify-between gap-3" data-cs-results-header="">
    <h3 className="text-base leading-snug font-semibold text-foreground">{title} <span className="text-sm font-normal text-muted-foreground">(총 <strong className="font-semibold text-foreground tabular-nums">{total.toLocaleString('ko-KR')}</strong>개)</span></h3>
    <div className="flex flex-wrap items-center gap-2">
      {children}
      <CustomerServiceListSelect label={`${title} 수`} value={String(pageSize)} options={pageSizeOptions} />
    </div>
  </div>;
}
