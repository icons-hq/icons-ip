'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { CouponFilters } from '@/components/admin/coupons/CouponFilters';
import { CouponStatusAction } from '@/components/admin/coupons/CouponStatusAction';
import { CouponScheduleFields } from '@/components/admin/coupons/CouponScheduleFields';
import { ConsoleGrid } from '@/components/admin/console/ConsoleGrid';
import { SalesResultsHeader } from '@/components/admin/sales/SalesConsole';
import { COUPON_PHASES, COUPON_SORTS, couponPhase, couponIssueEndsAt } from '@/lib/admin/coupons';
import { AdminFormGrid } from '@/components/admin/console/AdminKit';
import { CouponTargetingFields } from '@/components/admin/CouponTargetingFields';
import { adminFormRemountKey } from '@/lib/admin/form-state';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import type { AdminCouponActionState } from '@/app/admin/coupon-actions';
import {
  ADMIN_COUPON_LIST_PATH,
  adminCouponListHref,
  type AdminCouponFilters,
  type AdminCouponRecord,
} from '@/lib/admin/coupons';
import { LOYALTY_GRADES, isLoyaltyGrade, loyaltyBasisSummary, loyaltyGradeLabel } from '@/lib/loyalty';
import type { ConfigurableGrade } from '@/lib/loyalty-policy';
import { Field, FormShell, SelectField } from '../fields';

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

function CouponEditor({
  action,
  pending,
  selected,
  state,
  draft,
  copySource,
  initialGrade,
  onCancel,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  selected: AdminCouponRecord | null;
  state: AdminCouponActionState;
  draft: Record<string, string> | null;
  copySource?: AdminCouponRecord | null;
  initialGrade?: ConfigurableGrade;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(selected || draft ? 2 : 1);
  const [stepError, setStepError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const defaults = selected ?? (copySource ? { ...copySource, code: '', termsRevision: undefined, name: `${copySource.name} 복사` } : null);
  const value = (
    key: string,
    fallback: string | number | null | undefined,
  ) => draft?.[key] ?? fallback ?? '';

  function next() {
    if (pending || !form.current) return;
    const name = form.current.elements.namedItem('name') as HTMLInputElement | null;
    if (!name?.reportValidity()) return;
    if (!name.value.trim()) { setStepError('혜택 이름을 입력해주세요.'); name.focus(); return; }
    const values = new FormData(form.current);
    if (values.get('goodsScope') === 'selected_goods' && values.get('targetGoodIds') === '[]') {
      setStepError('혜택을 적용할 상품을 한 개 이상 선택해주세요.'); return;
    }
    if (values.get('goodsScope') === 'selected_categories' && values.get('targetCategoryIds') === '[]') {
      setStepError('혜택을 적용할 카테고리를 한 개 이상 선택해주세요.'); return;
    }
    if (values.get('goodsScope') === 'selected_ips' && values.get('targetIpIds') === '[]') {
      setStepError('혜택을 적용할 IP를 한 개 이상 선택해주세요.'); return;
    }
    setStepError(''); setStep(2);
    requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>('[name="code"]')?.focus());
  }

  return (
    <form
      ref={form}
      action={action}
      className="admin-coupon-editor wc-admin-kit"
      key={adminFormRemountKey(state, selected)}
      noValidate={step === 1}
      onSubmit={event => { if (step === 1) { event.preventDefault(); next(); } }}
    >
      <input name="previousCode" type="hidden" value={defaults?.code ?? ''} />
      <input name="expectedRevision" type="hidden" value={value('expectedRevision', selected?.termsRevision)} />
      <fieldset disabled={pending} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <legend className="sr-only">쿠폰 정보</legend>
      <AdminFormGrid>
        <Field
          defaultValue={value('name', defaults?.name)}
          error={state.errors?.name}
          label="혜택 이름"
          name="name"
          placeholder="가을 프로모션 3천원"
          required
        />
      </AdminFormGrid>
      <CouponTargetingFields
        recipientSegment={String(value('recipientSegment', defaults?.recipientSegment ?? 'all'))}
        goodsScope={String(value('goodsScope', defaults?.goodsScope ?? 'all'))}
        targetIds={String(value('targetGoodIds', JSON.stringify(defaults?.targetGoodIds ?? [])))}
        targetGoods={defaults?.targetGoods ?? []}
        categoryIds={String(value('targetCategoryIds', JSON.stringify(defaults?.targetCategoryIds ?? [])))}
        targetCategories={defaults?.targetCategories ?? []}
        ipIds={String(value('targetIpIds', JSON.stringify(defaults?.targetIpIds ?? [])))}
        targetIps={defaults?.targetIps ?? []}
        issuanceMode={String(value('issuanceMode', defaults?.issuanceMode ?? 'code'))}
        modeLocked={Boolean(selected?.issuedCount)}
        errors={state.errors}
        showBenefitType
      />
      <div hidden={step === 1} className="admin-coupon-details">
      <h3 className="admin-coupon-step-heading" tabIndex={-1}>할인·발급 조건</h3>
      <p className="admin-note">{loyaltyBasisSummary()} 등급 혜택은 승급 시 자동 발급됩니다. 중복 사용은 스토어 정책과 각 쿠폰의 허용 조건을 모두 따릅니다. 발급 후 상품·배송비 할인 구분과 중복 사용 조건, 발급 방식은 변경할 수 없습니다. 배송비 쿠폰은 대상 상품이 포함된 배송 묶음의 선결제 운송비에 적용하며 설치비·착불 비용은 제외합니다.</p>
      <AdminFormGrid>
        <Field
          defaultValue={value('code', defaults?.code)}
          error={state.errors?.code}
          label="코드 (대문자·숫자·하이픈)"
          name="code"
          placeholder="WELCOME-3000"
          readOnly={Boolean(selected)}
          required
        />
        <SelectField defaultValue={value('benefitKind', defaults?.benefitKind ?? 'goods') as string} label="할인 대상" name="benefitKind" error={state.errors?.benefitKind}>
          <option value="goods">상품 금액</option><option value="shipping">선결제 배송비</option>
        </SelectField>
        <SelectField defaultValue={value('stackable', String(defaults?.stackable ?? false)) as string} label="다른 쿠폰과 중복 사용" name="stackable" error={state.errors?.stackable}>
          <option value="false">허용 안 함</option><option value="true">허용 · 스토어 중복 정책 적용</option>
        </SelectField>
        <SelectField
          defaultValue={value('discountType', defaults?.discountType ?? 'fixed') as string}
          error={state.errors?.discountType}
          label="할인 방식"
          name="discountType"
        >
          <option value="fixed">정액 (원)</option>
          <option value="percent">정률 (%)</option>
        </SelectField>
        <Field
          defaultValue={value('discountValue', defaults?.discountValue)}
          error={state.errors?.discountValue}
          label="할인설정"
          min={1}
          name="discountValue"
          required
          type="number"
        />
        <Field
          defaultValue={value('maxDiscountAmount', defaults?.maxDiscountAmount)}
          error={state.errors?.maxDiscountAmount}
          label="최대 할인액 (정률 전용, 비우면 없음)"
          min={1}
          name="maxDiscountAmount"
          type="number"
        />
        <Field
          defaultValue={value('minSubtotal', defaults?.minSubtotal ?? 0)}
          error={state.errors?.minSubtotal}
          label="최소 주문 금액 (할인 대상 상품 소계 기준)"
          min={0}
          name="minSubtotal"
          type="number"
        />
        <CouponScheduleFields errors={state.errors} values={{
          startsAt: String(value('startsAt', dateTimeInput(defaults?.startsAt) || dateTimeInput(new Date().toISOString()))),
          endsAt: String(value('endsAt', dateTimeInput(defaults?.endsAt))),
          issueStartsAt: String(value('issueStartsAt', dateTimeInput(defaults?.issueStartsAt ?? defaults?.startsAt) || dateTimeInput(new Date().toISOString()))),
          issueEndsAt: String(value('issueEndsAt', dateTimeInput(defaults?.issueStartsAt ? defaults.issueEndsAt : defaults?.endsAt))),
          validityMode: String(value('validityMode', defaults?.validDays ? 'relative' : 'period')),
          validDays: String(value('validDays', defaults?.validDays)),
        }} />
        <Field
          defaultValue={value('issueLimit', defaults?.issueLimit)}
          error={state.errors?.issueLimit}
          label="발급 한도 (비우면 무제한)"
          min={1}
          name="issueLimit"
          type="number"
        />
        <SelectField
          defaultValue={value('status', defaults?.status ?? 'active') as string}
          error={state.errors?.status}
          label="상태"
          name="status"
        >
          <option value="active">활성</option>
          <option value="archived">보관 (발급·사용 중단)</option>
        </SelectField>
        <SelectField
          defaultValue={value('gradeBenefit', defaults ? defaults.gradeBenefit : initialGrade) as string}
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
      </div>
      </fieldset>
      {selected && (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          발급 {selected.issuedCount.toLocaleString('ko-KR')}장
          {selected.issueLimit ? ` / 한도 ${selected.issueLimit.toLocaleString('ko-KR')}장` : ' (무제한)'}
          {' · '}사용 {selected.usedCount.toLocaleString('ko-KR')}건
        </p>
      )}
      {stepError ? <p role="alert">{stepError}</p> : null}
      {step === 1 ? <div className="admin-coupon-step-actions">
        <button type="button" className="wc-admin-kit__button admin-coupon-primary" disabled={pending} onClick={next}>확인</button>
        <button type="button" className="wc-admin-kit__button" disabled={pending} onClick={onCancel}>취소</button>
      </div> : <div className="admin-coupon-step-actions">
        {!selected ? <button type="button" className="wc-admin-kit__button" disabled={pending} onClick={() => { setStep(1); form.current?.scrollIntoView({ block: 'start' }); }}>대상 설정으로</button> : null}
        <FormShell pending={pending} state={state} />
      </div>}
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
  mode = 'list',
  copySource,
  initialGrade,
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
  mode?: 'list' | 'create';
  copySource?: AdminCouponRecord | null;
  initialGrade?: ConfigurableGrade;
}) {
  if (selected || mode === 'create') return <section className="admin-benefits-console wc-admin-kit">
    {selected || copySource ? <div className="admin-coupon-editor-heading"><h2>{copySource ? '복사한 혜택 설정' : '혜택 정보'}</h2><button type="button" className="btn btn-ghost" onClick={() => onSelect(null)}>목록으로</button></div> : null}
    <CouponEditor action={action} draft={draft} pending={pending} selected={selected} copySource={copySource} initialGrade={initialGrade} state={state} onCancel={() => onSelect(null)} />
    {selected ? <Link className="wc-admin-kit__button" href={`${ADMIN_COUPON_LIST_PATH}/issue?couponCode=${encodeURIComponent(selected.code)}`}>지정 고객·세그먼트 발급</Link> : null}
  </section>;
  const href = adminCouponListHref(filters);
  return <section className="admin-benefits-console admin-sales-console wc-admin-kit">
    <CouponFilters key={href} filters={filters} />
    {filters.inputError ? <p role="alert">{filters.inputError}</p> : null}
    {filters.selectedCode ? <p role="alert">선택한 쿠폰을 찾을 수 없습니다.</p> : null}
    <div className="admin-sales-results">
      <SalesResultsHeader currentHref={href} total={total} pageSize={pageSize} pageSizes={[20,50,100]} sort={filters.sort ?? 'created_desc'} sortOptions={COUPON_SORTS}>
        <Link className="btn admin-coupon-primary" href={`${ADMIN_COUPON_LIST_PATH}/new`}>새 고객혜택 등록</Link>
      </SalesResultsHeader>
      <ConsoleGrid caption="혜택 목록" preferencesKey="coupons" columns={[
        { key: 'code', label: '쿠폰 코드', width: '170px' }, { key: 'actions', label: '관리', width: '170px', required: true },
        { key: 'phase', label: '혜택상태', width: '100px' }, { key: 'name', label: '혜택 이름', width: '220px' },
        { key: 'target', label: '타겟팅 대상', width: '140px' }, { key: 'discount', label: '할인설정', width: '130px' },
        { key: 'issuePeriod', label: '혜택 발급기간', width: '210px' }, { key: 'period', label: '사용기간', width: '210px' }, { key: 'counts', label: '발급 / 사용', width: '130px', align: 'end' },
      ]} rows={records.map(coupon => ({ id: coupon.id, cells: [
        coupon.code,
        <div key="actions" className="admin-coupon-row-actions"><CouponStatusAction key={`${coupon.code}-${coupon.termsRevision}-${coupon.status}`} coupon={coupon} /><button type="button" onClick={() => onSelect(coupon)}>수정</button><Link href={`${ADMIN_COUPON_LIST_PATH}/new?copy=${encodeURIComponent(coupon.code)}`}>복사</Link><Link href={`${ADMIN_COUPON_LIST_PATH}/issue?couponCode=${encodeURIComponent(coupon.code)}`}>발급</Link></div>,
        COUPON_PHASES.find(option => option.value === couponPhase(coupon))?.label,
        coupon.name, coupon.issuanceMode === 'targeted' ? '지정 고객' : coupon.gradeBenefit ? `${loyaltyGradeLabel(isLoyaltyGrade(coupon.gradeBenefit) ? coupon.gradeBenefit : 'welcome')} 등급` : coupon.recipientSegment === 'first_purchase' ? '첫구매 고객' : coupon.recipientSegment === 'repeat_purchase' ? '재구매 고객' : '전체 고객',
        <span key="discount">{coupon.benefitKind === 'shipping' ? '배송비 ' : '상품 '}{coupon.discountValue.toLocaleString('ko-KR')}{coupon.discountType === 'percent' ? '%' : '원'}{coupon.maxDiscountAmount ? <small>최대 {coupon.maxDiscountAmount.toLocaleString('ko-KR')}원</small> : null}</span>,
        <span key="issuePeriod">{dateTimeInput(coupon.issueStartsAt ?? coupon.startsAt).replace('T',' ')}<small>~ {couponIssueEndsAt(coupon) ? dateTimeInput(couponIssueEndsAt(coupon)).replace('T',' ') : '무기한'}</small></span>,
        <span key="period">{coupon.validDays ? `발급일로부터 ${coupon.validDays}일 후까지` : <>{dateTimeInput(coupon.startsAt).replace('T',' ')}<small>~ {coupon.endsAt ? dateTimeInput(coupon.endsAt).replace('T',' ') : '무기한'}</small></>}</span>,
        `${coupon.issuedCount.toLocaleString('ko-KR')} / ${coupon.usedCount.toLocaleString('ko-KR')}`,
      ] }))} emptyLabel="조건에 맞는 혜택이 없습니다." />
      <ConsolePagination label="혜택 목록 페이지" page={filters.page} pageSize={pageSize} total={total} hrefForPage={page => adminCouponListHref(filters, { page })} />
    </div>
  </section>;
}
