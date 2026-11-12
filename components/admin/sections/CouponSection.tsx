'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { CouponFilters } from '@/components/admin/coupons/CouponFilters';
import { CouponRowActions } from '@/components/admin/coupons/CouponRowActions';
import { CouponScheduleFields } from '@/components/admin/coupons/CouponScheduleFields';
import { ConsoleGrid } from '@/components/admin/console/ConsoleGrid';
import { SalesResultsHeader } from '@/components/admin/sales/SalesConsole';
import { COUPON_PHASES, COUPON_SORTS, couponPhase, couponIssueEndsAt } from '@/lib/admin/coupons';
import { AdminFormGrid, AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
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
import { statusTone } from '@/lib/admin/status-tone';
import { formatOrderDateTime } from '@/lib/orders';
import {
  GRADE_BENEFIT_CADENCE_LABELS, LOYALTY_GRADES, isLoyaltyGrade, loyaltyBasisSummary, loyaltyGradeLabel, type GradeBenefitCadence,
} from '@/lib/loyalty';
import type { ConfigurableGrade } from '@/lib/loyalty-policy';
import { Field, FormShell, SelectField } from '../fields';
import { useAdminLeaveGuard } from '../useAdminLeaveGuard';
import { confirmAdminLeave } from '@/lib/admin/leave-guard';
import { ArrowLeft, ArrowRight, Plus } from 'lucide-react';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';

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

/** 기간 칸 — 시작과 끝을 한 줄씩(두 줄 고정)만 쓴다. 다른 화면과 같은 날짜 표기다. */
function CouponPeriod({ from, to }: { from: string; to: string | null | undefined }) {
  return <span className="block text-xs whitespace-nowrap tabular-nums">{formatOrderDateTime(from)}<span className="block text-muted-foreground">~ {to ? formatOrderDateTime(to) : '무기한'}</span></span>;
}

function CouponPhaseBadge({ coupon }: { coupon: AdminCouponRecord }) {
  const phase = couponPhase(coupon);
  return <AdminStatusBadge tone={statusTone('couponPhase', phase)}>{COUPON_PHASES.find(option => option.value === phase)?.label}</AdminStatusBadge>;
}

/*
 * 등급 혜택과 지급 방식(S36-062). 등급을 고른 폼만 지급 방식을 보낸다 — '해당 없음'이면 칸을 그리지 않고
 * 서버가 '승급 시 1회'로 둔다. 매월 지급의 대상·시점·소급 없음은 DB 정본(run_monthly_grade_coupons)과 같은 말이다.
 */
function GradeBenefitFields({ grade, cadence, errors }: { grade: string; cadence: GradeBenefitCadence; errors?: Record<string, string> }) {
  const [selectedGrade, setSelectedGrade] = useState(grade);
  return <>
    <SelectField
      defaultValue={grade}
      error={errors?.gradeBenefit}
      label="등급 혜택"
      name="gradeBenefit"
      onChange={(event) => setSelectedGrade(event.target.value)}
    >
      <option value="">해당 없음</option>
      {LOYALTY_GRADES.filter((option) => option !== 'welcome').map((option) => (
        <option key={option} value={option}>{loyaltyGradeLabel(option)} 등급</option>
      ))}
    </SelectField>
    {selectedGrade ? <>
      <SelectField defaultValue={cadence} error={errors?.gradeBenefitCadence} label="등급 혜택 지급 방식" name="gradeBenefitCadence">
        <option value="upgrade">{GRADE_BENEFIT_CADENCE_LABELS.upgrade} (이 등급에 오를 때)</option>
        <option value="monthly">{GRADE_BENEFIT_CADENCE_LABELS.monthly} (그 시점 이 등급 이상 회원)</option>
      </SelectField>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-xs leading-relaxed text-muted-foreground [grid-column:1/-1]" data-grade-cadence-help="">
        <li>승급 시 1회: 이 등급에 오를 때(건너뛰어 오를 때 포함) 한 번 발급하고, 이미 받은 회원에게는 다시 발급하지 않습니다.</li>
        <li>매월 1일: 매월 1일 0시(한국 시간)에 그 시점 이 등급 이상인 회원에게 한 장씩 발급하고 알림을 보냅니다. 지급 직전에 대상 회원의 등급을 최근 90일 실적으로 다시 계산하므로 실적이 줄어든 회원은 그때 강등되어 받지 않습니다. 지난달 몫은 소급하지 않으며, 이번 달 지급이 끝난 뒤 바꾸면 다음 달 1일부터 발급합니다. 발급 한도는 모든 달을 합친 장수입니다.</li>
      </ul>
    </> : null}
  </>;
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
  /* 저장 실패 뒤에는 폼이 제출값으로 새로 그려진다 — draft가 있는 동안은 폼 값이 기준과 같아도 저장 전이다. */
  const { formRef: leaveFormRef } = useAdminLeaveGuard({ serverState: state, preserved: Boolean(draft) });
  const attachForm = useCallback((node: HTMLFormElement | null) => {
    form.current = node;
    const detach = leaveFormRef(node);
    return () => { form.current = null; detach?.(); };
  }, [leaveFormRef]);
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
  function toTargets() { setStep(1); form.current?.scrollIntoView({ block: 'start' }); }

  return (
    <form
      ref={attachForm}
      action={action}
      className="flex min-w-0 flex-col rounded-xl border bg-card text-sm text-card-foreground"
      key={adminFormRemountKey(state, selected)}
      noValidate={step === 1}
      onSubmit={event => { if (step === 1) { event.preventDefault(); next(); } }}
    >
      <input name="previousCode" type="hidden" value={defaults?.code ?? ''} />
      <input name="expectedRevision" type="hidden" value={value('expectedRevision', selected?.termsRevision)} />
      <fieldset disabled={pending} className="flex min-w-0 flex-col">
        <legend className="sr-only">쿠폰 정보</legend>
      {/* 1027T-027: 단계 표시는 누르면 그 단계로 간다. '할인·발급 조건'은 [다음]과 같은 확인을 거쳐 펼치고, '대상 설정'은 [대상 설정으로]와 같다. */}
      {!selected ? <ol aria-label="혜택 등록 단계" className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-2.5 py-2 text-sm sm:px-4.5" data-coupon-steps="">
        {['대상 설정', '할인·발급 조건'].map((label, index) => <li aria-current={step === index + 1 ? 'step' : undefined} className="group/step flex" key={label}>
          <Button className="h-auto gap-2 px-1.5 py-1 font-normal text-muted-foreground group-aria-[current=step]/step:font-semibold group-aria-[current=step]/step:text-primary-soft-foreground" onClick={index === 0 ? toTargets : next} size="sm" variant="ghost">
            <span aria-hidden="true" className="grid size-5 place-items-center rounded-full bg-muted text-xs tabular-nums group-aria-[current=step]/step:bg-primary group-aria-[current=step]/step:text-primary-foreground">{index + 1}</span>{label}
          </Button>
        </li>)}
      </ol> : null}
      <div className="p-4 sm:p-6"><div className="max-w-xl"><AdminFormGrid>
        <Field
          defaultValue={value('name', defaults?.name)}
          error={state.errors?.name}
          label="혜택 이름"
          name="name"
          placeholder="예: 가을 프로모션 3천원"
          required
        />
      </AdminFormGrid></div></div>
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
      <div hidden={step === 1} className="border-t">
      <h3 className="border-b px-4 py-5 text-base font-medium outline-none sm:px-6" tabIndex={-1}>할인·발급 조건</h3>
      <p className="border-b bg-muted/40 px-4 py-4 text-xs leading-relaxed text-muted-foreground sm:px-6">{loyaltyBasisSummary()} 등급 혜택은 고른 지급 방식에 따라 승급할 때 한 번 또는 매월 1일에 자동 발급됩니다. 중복 사용은 스토어 정책과 각 쿠폰의 허용 조건을 모두 따릅니다. 발급 후 상품·배송비 할인 구분과 중복 사용 조건, 발급 방식은 변경할 수 없습니다. 배송비 쿠폰은 대상 상품이 포함된 배송 묶음의 선결제 운송비에 적용하며 설치비·착불 비용은 제외합니다.</p>
      <div className="p-4 sm:p-6"><AdminFormGrid>
        <Field
          defaultValue={value('code', defaults?.code)}
          error={state.errors?.code}
          label="코드 (대문자·숫자·하이픈)"
          name="code"
          placeholder="예: WELCOME-3000"
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
        <GradeBenefitFields
          cadence={String(value('gradeBenefitCadence', defaults?.gradeBenefitCadence ?? 'upgrade')) === 'monthly' ? 'monthly' : 'upgrade'}
          errors={state.errors}
          grade={String(value('gradeBenefit', defaults ? defaults.gradeBenefit : initialGrade))}
        />
      </AdminFormGrid></div>
      </div>
      </fieldset>
      {selected && (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground tabular-nums sm:px-6">
          발급 {selected.issuedCount.toLocaleString('ko-KR')}장
          {selected.issueLimit ? ` / 한도 ${selected.issueLimit.toLocaleString('ko-KR')}장` : ' (무제한)'}
          {' · '}사용 {selected.usedCount.toLocaleString('ko-KR')}건
        </p>
      )}
      {stepError ? <p className="border-t px-4 pt-3 text-sm text-destructive sm:px-6" role="alert">{stepError}</p> : null}
      {step === 1 ? <div className="flex flex-wrap justify-center gap-3 border-t p-4 sm:p-5">
        <Button type="button" disabled={pending} onClick={next}>다음: 할인·발급 조건<ArrowRight aria-hidden="true" /></Button>
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>취소</Button>
      </div> : <div className="flex flex-wrap items-start justify-center gap-3 border-t p-4 sm:p-5">
        {!selected ? <Button type="button" variant="outline" disabled={pending} onClick={toTargets}><ArrowLeft aria-hidden="true" />대상 설정으로</Button> : null}
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
  /* 취소·목록으로는 링크가 아니라 router.replace로 떠나 공용 경고가 클릭을 가로채지 못한다. 같은 확인을 직접 거친다. */
  const leaveEditor = () => { if (confirmAdminLeave()) onSelect(null); };
  if (selected || mode === 'create') return <section className="flex min-w-0 flex-col gap-3">
    {selected || copySource ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3.5 sm:px-6"><h2 className="text-lg font-semibold tracking-tight">{copySource ? '복사한 혜택 설정' : '혜택 정보'}</h2><Button type="button" variant="outline" onClick={leaveEditor}>목록으로</Button></div> : null}
    <CouponEditor action={action} draft={draft} pending={pending} selected={selected} copySource={copySource} initialGrade={initialGrade} state={state} onCancel={leaveEditor} />
    {selected ? <Link className={buttonVariants({ variant: 'outline', className: 'self-start' })} data-slot="button" href={`${ADMIN_COUPON_LIST_PATH}/issue?couponCode=${encodeURIComponent(selected.code)}`}>지정 고객·세그먼트 발급</Link> : null}
  </section>;
  const href = adminCouponListHref(filters);
  return <section className="flex min-w-0 flex-col gap-4">
    <CouponFilters key={href} filters={filters} />
    {filters.inputError ? <AdminNotice role="alert" tone="danger">{filters.inputError}</AdminNotice> : null}
    {filters.selectedCode ? <AdminNotice role="alert" tone="danger">선택한 쿠폰을 찾을 수 없습니다.</AdminNotice> : null}
    <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
      <div className="flex min-w-0 flex-col gap-3 p-4">
        <ConsoleGrid caption="혜택 목록" preferencesKey="coupons" columns={[
          { key: 'name', label: '혜택 이름', width: '170px' }, { key: 'phase', label: '혜택상태', width: '80px' },
          { key: 'code', label: '쿠폰 코드', width: '104px' }, { key: 'actions', label: '관리', width: '136px', required: true },
          { key: 'target', label: '타겟팅 대상', width: '96px' }, { key: 'discount', label: '할인설정', width: '120px' },
          { key: 'issuePeriod', label: '혜택 발급기간', width: '148px' }, { key: 'period', label: '사용기간', width: '148px' }, { key: 'counts', label: '발급 / 사용', width: '84px', align: 'end' },
        ]} rows={records.map(coupon => ({ id: coupon.id, href: adminCouponListHref(filters, { selectedCode: coupon.id }), cells: [
          coupon.name,
          <CouponPhaseBadge coupon={coupon} key="phase" />,
          coupon.code,
          <CouponRowActions key={`${coupon.code}-${coupon.termsRevision}-${coupon.status}`} copyHref={`${ADMIN_COUPON_LIST_PATH}/new?copy=${encodeURIComponent(coupon.code)}`} coupon={coupon} issueHref={`${ADMIN_COUPON_LIST_PATH}/issue?couponCode=${encodeURIComponent(coupon.code)}`} onEdit={() => onSelect(coupon)} />,
          coupon.issuanceMode === 'targeted' ? '지정 고객' : coupon.gradeBenefit ? <span key="target">{loyaltyGradeLabel(isLoyaltyGrade(coupon.gradeBenefit) ? coupon.gradeBenefit : 'welcome')} 등급<small className="block text-xs text-muted-foreground">{GRADE_BENEFIT_CADENCE_LABELS[coupon.gradeBenefitCadence ?? 'upgrade']}</small></span> : coupon.recipientSegment === 'first_purchase' ? '첫구매 고객' : coupon.recipientSegment === 'repeat_purchase' ? '재구매 고객' : '전체 고객',
          <span key="discount">{coupon.benefitKind === 'shipping' ? '배송비 ' : '상품 '}{coupon.discountValue.toLocaleString('ko-KR')}{coupon.discountType === 'percent' ? '%' : '원'}{coupon.maxDiscountAmount ? <small className="block text-xs text-muted-foreground">최대 {coupon.maxDiscountAmount.toLocaleString('ko-KR')}원</small> : null}</span>,
          <CouponPeriod from={coupon.issueStartsAt ?? coupon.startsAt} key="issuePeriod" to={couponIssueEndsAt(coupon)} />,
          coupon.validDays ? <span className="text-xs" key="period">발급일로부터 {coupon.validDays}일 후까지</span> : <CouponPeriod from={coupon.startsAt} key="period" to={coupon.endsAt} />,
          `${coupon.issuedCount.toLocaleString('ko-KR')} / ${coupon.usedCount.toLocaleString('ko-KR')}`,
        ] }))} emptyLabel="조건에 맞는 혜택이 없습니다.">
          {/* 머리와 조회항목 설정을 한 줄에 둔다 — 설정 버튼 혼자 한 줄을 차지하면 표가 밀린다. */}
          <SalesResultsHeader currentHref={href} total={total} pageSize={pageSize} pageSizes={[20,50,100]} sort={filters.sort ?? 'created_desc'} sortOptions={COUPON_SORTS}>
            <Link className={buttonVariants()} data-slot="button" href={`${ADMIN_COUPON_LIST_PATH}/new`}><Plus aria-hidden="true" />새 고객혜택 등록</Link>
          </SalesResultsHeader>
        </ConsoleGrid>
        <ConsolePagination label="혜택 목록 페이지" page={filters.page} pageSize={pageSize} total={total} hrefForPage={page => adminCouponListHref(filters, { page })} />
      </div>
    </div>
  </section>;
}
