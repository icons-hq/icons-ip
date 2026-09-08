'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { upsertAdminCouponAction, type AdminCouponActionState } from '@/app/admin/coupon-actions';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { CouponSection } from '@/components/admin/sections/CouponSection';
import {
  COUPON_SEARCH_PAGE_SIZE,
  COUPON_STATUS_FILTERS,
  adminCouponHref,
  hasCouponSearchFilter,
  type AdminCouponSearchForm,
} from '@/lib/admin/coupon-search';
import { COUPON_TARGET_KINDS, type AdminCouponRecord } from '@/lib/admin/coupons';
import type { AdminCurationTargetRecord } from '@/lib/admin/curation-targets';
import { useSelectedRecord } from './record-selection';

const emptyState: AdminCouponActionState = {};

/*
 * 쿠폰 조회 필터 (현업 슬라이스 4 · 「조건으로 쿠폰을 찾을 수 없다」).
 *
 * 일반 GET 폼이다 — 조건이 주소에 남아야 새로고침·뒤로가기·링크 공유가 같은 화면을 연다.
 * 저장 뒤 화면이 다시 그려져도 보던 조건이 그대로인 것도 같은 이유다.
 */
function CouponFilters({ search }: { search: AdminCouponSearchForm }) {
  return (
    <form action="/admin/sales/coupons" className="admin-order-filters card" method="get">
      <label>
        <span>쿠폰 검색</span>
        <input
          aria-label="쿠폰 코드 또는 이름 검색"
          defaultValue={search.query}
          maxLength={80}
          name="query"
          placeholder="코드 · 쿠폰 이름"
          type="search"
        />
      </label>
      <label>
        <span>상태</span>
        <select aria-label="쿠폰 상태" defaultValue={search.status} name="status">
          {COUPON_STATUS_FILTERS.map((option) => (
            <option key={option.value || 'all'} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label>
        <span>받을 수 있는 사람</span>
        <select aria-label="쿠폰 대상" defaultValue={search.targetKind} name="targetKind">
          <option value="">전체 대상</option>
          {COUPON_TARGET_KINDS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label>
        {/* 기간은 **겹치는** 쿠폰을 찾는다 — 이미 돌고 있던 쿠폰이 빠지면 중복 발행을 못 본다. */}
        <span>기간 시작</span>
        <input aria-label="사용 기간 시작일" defaultValue={search.from} name="from" type="date" />
      </label>
      <label>
        <span>기간 종료</span>
        <input aria-label="사용 기간 종료일" defaultValue={search.to} name="to" type="date" />
      </label>
      <div className="admin-order-filter-actions">
        <button className="btn btn-sm" type="submit">조회</button>
        <Link className="btn btn-sm btn-ghost" href="/admin/sales/coupons">초기화</Link>
      </div>
    </form>
  );
}

export function CouponScreen({
  goodOptions,
  records,
  search,
  total,
}: {
  goodOptions: readonly AdminCurationTargetRecord[];
  records: AdminCouponRecord[];
  search: AdminCouponSearchForm;
  total: number;
}) {
  const [state, action, pending] = useActionState(upsertAdminCouponAction, emptyState);
  const { selected, select } = useSelectedRecord(records);

  return (
    <div className="col" style={{ gap: 14 }}>
      <CouponFilters search={search} />
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        {hasCouponSearchFilter(search)
          ? `조건에 맞는 쿠폰 ${total.toLocaleString('ko-KR')}장`
          : `등록된 쿠폰 ${total.toLocaleString('ko-KR')}장`}
      </p>
      <CouponSection
        action={action}
        goodOptions={goodOptions}
        onSelect={select}
        pending={pending}
        records={records}
        selected={selected}
        state={state}
      />
      <ConsolePagination
        hrefForPage={(page) => adminCouponHref(search, { page })}
        label="쿠폰 목록 페이지"
        page={search.page}
        pageSize={COUPON_SEARCH_PAGE_SIZE}
        total={total}
      />
    </div>
  );
}
