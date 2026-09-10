'use client';

import { AdminFormGrid } from '@/components/admin/console/AdminKit';
import { CouponTargetingFields } from '@/components/admin/CouponTargetingFields';
import { adminFormRemountKey } from '@/lib/admin/form-state';
import { ConsoleFilterPanel } from '@/components/admin/console/ConsoleFilterPanel';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import type { AdminCouponActionState } from '@/app/admin/coupon-actions';
import {
  ADMIN_COUPON_LIST_PATH,
  ADMIN_COUPON_STATUS_OPTIONS,
  adminCouponResetHref,
  adminCouponListHref,
  type AdminCouponFilters,
  type AdminCouponRecord,
} from '@/lib/admin/coupons';
import { LOYALTY_GRADES, loyaltyBasisSummary, loyaltyGradeLabel } from '@/lib/loyalty';
import { Field, FormShell, RecordList, SelectField } from '../fields';

/*
 * 쿠폰 콘솔 (S7 #329).
 *
 * 코드가 곧 운영 식별자다 — 수정 모드에서는 읽기 전용으로 잠그고 previousCode 로
 * 카탈로그 계약(catalog_id_immutable)을 지킨다. 발급·사용 수는 원장 파생
 * 읽기 전용이고, 여기서 고칠 수 있는 것은 정의뿐이다.
 */

function dateTimeInput(value: string | null | undefined) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function couponListLabel(coupon: AdminCouponRecord) {
  const benefit = coupon.discountType === 'fixed'
    ? `${coupon.discountValue.toLocaleString('ko-KR')}원`
    : `${coupon.discountValue}%`;
  const state = coupon.status === 'archived' ? ' · 보관' : '';
  return `${coupon.code} · ${coupon.name} · ${benefit}${state}`;
}

function CouponEditor({
  action,
  pending,
  selected,
  state,
  draft,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  selected: AdminCouponRecord | null;
  state: AdminCouponActionState;
  draft: Record<string, string> | null;
}) {
  const value = (
    key: string,
    fallback: string | number | null | undefined,
  ) => draft?.[key] ?? fallback ?? '';

  return (
    <form
      action={action}
      className="card col wc-admin-kit wc-admin-kit__card"
      key={adminFormRemountKey(state, selected)}
      style={{ gap: 14 }}
    >
      <input name="previousCode" type="hidden" value={selected?.code ?? ''} />
      <input name="expectedRevision" type="hidden" value={value('expectedRevision', selected?.termsRevision)} />
      <fieldset disabled={pending} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <legend className="sr-only">쿠폰 정보</legend>
      <AdminFormGrid>
        <Field
          defaultValue={value('code', selected?.code)}
          error={state.errors?.code}
          label="코드 (대문자·숫자·하이픈)"
          name="code"
          placeholder="WELCOME-3000"
          readOnly={Boolean(selected)}
          required
        />
        <Field
          defaultValue={value('name', selected?.name)}
          error={state.errors?.name}
          label="쿠폰 이름"
          name="name"
          placeholder="가을 프로모션 3천원"
          required
        />
        <SelectField
          defaultValue={value('discountType', selected?.discountType ?? 'fixed') as string}
          error={state.errors?.discountType}
          label="할인 방식"
          name="discountType"
        >
          <option value="fixed">정액 (원)</option>
          <option value="percent">정률 (%)</option>
        </SelectField>
        <Field
          defaultValue={value('discountValue', selected?.discountValue)}
          error={state.errors?.discountValue}
          label="할인 값"
          min={1}
          name="discountValue"
          required
          type="number"
        />
        <Field
          defaultValue={value('maxDiscountAmount', selected?.maxDiscountAmount)}
          error={state.errors?.maxDiscountAmount}
          label="최대 할인액 (정률 전용, 비우면 없음)"
          min={1}
          name="maxDiscountAmount"
          type="number"
        />
        <Field
          defaultValue={value('minSubtotal', selected?.minSubtotal ?? 0)}
          error={state.errors?.minSubtotal}
          label="최소 주문 금액 (할인 대상 상품 소계 기준)"
          min={0}
          name="minSubtotal"
          type="number"
        />
        <Field
          defaultValue={value('startsAt', dateTimeInput(selected?.startsAt) || dateTimeInput(new Date().toISOString()))}
          error={state.errors?.startsAt}
          label="사용 시작"
          name="startsAt"
          required
          type="datetime-local"
        />
        <Field
          defaultValue={value('endsAt', dateTimeInput(selected?.endsAt))}
          error={state.errors?.endsAt}
          label="사용 종료 (비우면 무기한)"
          name="endsAt"
          type="datetime-local"
        />
        <Field
          defaultValue={value('issueLimit', selected?.issueLimit)}
          error={state.errors?.issueLimit}
          label="발급 한도 (비우면 무제한)"
          min={1}
          name="issueLimit"
          type="number"
        />
        <SelectField
          defaultValue={value('status', selected?.status ?? 'active') as string}
          error={state.errors?.status}
          label="상태"
          name="status"
        >
          <option value="active">활성</option>
          <option value="archived">보관 (발급·사용 중단)</option>
        </SelectField>
        <SelectField
          defaultValue={value('gradeBenefit', selected?.gradeBenefit) as string}
          error={state.errors?.gradeBenefit}
          label="등급 혜택 (승급 시 자동 발급)"
          name="gradeBenefit"
        >
          <option value="">해당 없음</option>
          {LOYALTY_GRADES.filter((grade) => grade !== 'welcome').map((grade) => (
            <option key={grade} value={grade}>{loyaltyGradeLabel(grade)} 달성 시</option>
          ))}
        </SelectField>
      </AdminFormGrid>
      <CouponTargetingFields
        recipientSegment={String(value('recipientSegment', selected?.recipientSegment ?? 'all'))}
        goodsScope={String(value('goodsScope', selected?.goodsScope ?? 'all'))}
        targetIds={String(value('targetGoodIds', JSON.stringify(selected?.targetGoodIds ?? [])))}
        targetGoods={selected?.targetGoods ?? []}
        errors={state.errors}
      />
      </fieldset>
      {selected && (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          발급 {selected.issuedCount.toLocaleString('ko-KR')}장
          {selected.issueLimit ? ` / 한도 ${selected.issueLimit.toLocaleString('ko-KR')}장` : ' (무제한)'}
          {' · '}사용 {selected.usedCount.toLocaleString('ko-KR')}건
        </p>
      )}
      <FormShell pending={pending} state={state} />
    </form>
  );
}

export function CouponSection({
  action,
  draft,
  filters,
  onSelect,
  pageSize,
  pending,
  records,
  selected,
  state,
  total,
}: {
  action: (formData: FormData) => void;
  draft: Record<string, string> | null;
  filters: AdminCouponFilters;
  onSelect: (record: { id: string } | null) => void;
  pageSize: number;
  pending: boolean;
  records: AdminCouponRecord[];
  selected: AdminCouponRecord | null;
  state: AdminCouponActionState;
  total: number;
}) {
  return (
    <div className="col" style={{ gap: 14 }}>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.7, margin: 0 }}>
        {loyaltyBasisSummary()} 등급 혜택으로 지정한 쿠폰은 승급 시 자동 발급됩니다.
      </p>
      <ConsoleFilterPanel
        action={ADMIN_COUPON_LIST_PATH}
        hiddenFields={filters.selectedCode ? { couponCode: filters.selectedCode } : undefined}
        resetHref={adminCouponResetHref()}
        search={{
          label: '쿠폰명·코드',
          name: 'q',
          placeholder: '쿠폰 이름 또는 코드를 입력하세요',
          value: filters.query,
        }}
        statusFilter={{
          label: '상태',
          options: ADMIN_COUPON_STATUS_OPTIONS,
          value: filters.status,
        }}
      />
      {filters.inputError ? <p role="alert">{filters.inputError}</p> : null}
      <div className="admin-master-detail">
        <RecordList
          activeId={selected?.id ?? null}
          ariaLabel="쿠폰 목록"
          emptyMessage="조건에 맞는 쿠폰이 없습니다."
          items={records}
          labelFor={couponListLabel}
          newLabel="새 쿠폰"
          onNew={() => onSelect(null)}
          onSelect={onSelect}
        />
        <CouponEditor
          action={action}
          draft={draft}
          pending={pending}
          selected={selected}
          state={state}
        />
      </div>
      {filters.selectedCode && !selected ? (
        <p className="muted" role="status" style={{ fontSize: 12.5, margin: 0 }}>
          선택한 쿠폰을 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 선택해주세요.
        </p>
      ) : null}
      {selected && !records.some((record) => record.id === selected.id) ? (
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
          현재 검색·필터 조건과 다른 선택 쿠폰의 상세를 유지하고 있습니다.
        </p>
      ) : null}
      <ConsolePagination
        hrefForPage={(page) => adminCouponListHref(filters, { page })}
        label="쿠폰 목록 페이지"
        page={filters.page}
        pageSize={pageSize}
        total={total}
      />
    </div>
  );
}
