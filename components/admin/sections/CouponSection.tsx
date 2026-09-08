'use client';

import { useState } from 'react';
import type { AdminCouponActionState } from '@/app/admin/coupon-actions';
import { GoodPicker } from '@/components/admin/catalog/IpPicker';
import { COUPON_TARGET_KINDS, couponTargetLabel, type AdminCouponRecord } from '@/lib/admin/coupons';
import type { AdminCurationTargetRecord } from '@/lib/admin/curation-targets';
import { LOYALTY_GRADES, loyaltyBasisSummary, loyaltyGradeLabel } from '@/lib/loyalty';
import { Field, FormShell, RecordList, SelectField } from '../fields';
import { SeededForm } from '@/components/admin/form-seed';

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
  const target = coupon.targetKind === 'all' ? '' : ` · ${couponTargetLabel(coupon)}`;
  return `${coupon.code} · ${coupon.name} · ${benefit}${target}${state}`;
}

function CouponEditor({
  action,
  goodOptions,
  pending,
  selected,
  state,
}: {
  action: (formData: FormData) => void;
  goodOptions: readonly AdminCurationTargetRecord[];
  pending: boolean;
  selected: AdminCouponRecord | null;
  state: AdminCouponActionState;
}) {
  /* 「이 상품을 산 고객만」일 때만 상품 선택기를 연다. 늘 열어 두면 조건과 상관없는 값이
     남아, 나중에 조건을 바꾼 사람이 안 지운 채 저장한다. */
  const [targetKind, setTargetKind] = useState(
    state.values?.targetKind ?? selected?.targetKind ?? 'all',
  );
  const selectedGoodId = state.values?.targetGoodId ?? selected?.targetGoodId ?? '';
  const selectedGood = goodOptions.find((option) => option.id === selectedGoodId) ?? null;

  return (
    <SeededForm values={state.values} action={action} className="card col" style={{ borderRadius: 10, gap: 14, padding: 16 }}>
      <input name="previousCode" type="hidden" value={selected?.code ?? ''} />
      <div className="admin-form-grid">
        <Field
          defaultValue={selected?.code ?? ''}
          error={state.errors?.code}
          label="코드 (대문자·숫자·하이픈)"
          name="code"
          placeholder="WELCOME-3000"
          readOnly={Boolean(selected)}
          required
        />
        <Field
          defaultValue={selected?.name ?? ''}
          error={state.errors?.name}
          label="쿠폰 이름"
          name="name"
          placeholder="가을 프로모션 3천원"
          required
        />
        <SelectField
          defaultValue={selected?.discountType ?? 'fixed'}
          error={state.errors?.discountType}
          label="할인 방식"
          name="discountType"
        >
          <option value="fixed">정액 (원)</option>
          <option value="percent">정률 (%)</option>
        </SelectField>
        <Field
          defaultValue={selected?.discountValue ?? ''}
          error={state.errors?.discountValue}
          label="할인 값"
          min={1}
          name="discountValue"
          required
          type="number"
        />
        <Field
          defaultValue={selected?.maxDiscountAmount ?? ''}
          error={state.errors?.maxDiscountAmount}
          label="최대 할인액 (정률 전용, 비우면 없음)"
          min={1}
          name="maxDiscountAmount"
          type="number"
        />
        <Field
          defaultValue={selected?.minSubtotal ?? 0}
          error={state.errors?.minSubtotal}
          label="최소 주문 금액 (굿즈 소계 기준)"
          min={0}
          name="minSubtotal"
          type="number"
        />
        <Field
          defaultValue={dateTimeInput(selected?.startsAt) || dateTimeInput(new Date().toISOString())}
          error={state.errors?.startsAt}
          label="사용 시작"
          name="startsAt"
          required
          type="datetime-local"
        />
        <Field
          defaultValue={dateTimeInput(selected?.endsAt)}
          error={state.errors?.endsAt}
          label="사용 종료 (비우면 무기한)"
          name="endsAt"
          type="datetime-local"
        />
        <Field
          defaultValue={selected?.issueLimit ?? ''}
          error={state.errors?.issueLimit}
          label="발급 한도 (비우면 무제한)"
          min={1}
          name="issueLimit"
          type="number"
        />
        <SelectField
          defaultValue={selected?.status ?? 'active'}
          error={state.errors?.status}
          label="상태"
          name="status"
        >
          <option value="active">활성</option>
          <option value="archived">보관 (발급·사용 중단)</option>
        </SelectField>
        <SelectField
          defaultValue={selected?.gradeBenefit ?? ''}
          error={state.errors?.gradeBenefit}
          label="등급 혜택 (승급 시 자동 발급)"
          name="gradeBenefit"
        >
          <option value="">해당 없음</option>
          {LOYALTY_GRADES.filter((grade) => grade !== 'welcome').map((grade) => (
            <option key={grade} value={grade}>{loyaltyGradeLabel(grade)} 달성 시</option>
          ))}
        </SelectField>
      </div>
      <div className="col" style={{ gap: 10 }}>
        <SelectField
          defaultValue={selected?.targetKind ?? 'all'}
          error={state.errors?.targetKind}
          label="받을 수 있는 사람 (발급 시점에 한 번 판정)"
          name="targetKind"
          onChange={(event) => setTargetKind(event.target.value)}
        >
          {COUPON_TARGET_KINDS.map((entry) => (
            <option key={entry.value} value={entry.value}>{entry.label}</option>
          ))}
        </SelectField>
        {targetKind === 'bought_good' ? (
          <GoodPicker
            defaultOptions={goodOptions}
            error={state.errors?.targetGoodId}
            label="기준 상품"
            name="targetGoodId"
            required
            selected={selectedGood}
          />
        ) : null}
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.7, margin: 0 }}>
          자격은 <strong>받는 순간</strong>에만 봅니다 — 이미 받은 쿠폰은 조건에서 벗어나도
          그대로 쓸 수 있습니다.
        </p>
      </div>
      {selected && (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          발급 {selected.issuedCount.toLocaleString('ko-KR')}장
          {selected.issueLimit ? ` / 한도 ${selected.issueLimit.toLocaleString('ko-KR')}장` : ' (무제한)'}
          {' · '}사용 {selected.usedCount.toLocaleString('ko-KR')}건 — 사용 이력은 주문과
          coupon_redemptions 원장으로 연결됩니다.
        </p>
      )}
      <FormShell pending={pending} state={state} />
    </SeededForm>
  );
}

export function CouponSection({
  action,
  goodOptions = [],
  onSelect,
  pending,
  records,
  selected,
  state,
}: {
  action: (formData: FormData) => void;
  goodOptions?: readonly AdminCurationTargetRecord[];
  onSelect: (record: { id: string } | null) => void;
  pending: boolean;
  records: AdminCouponRecord[];
  selected: AdminCouponRecord | null;
  state: AdminCouponActionState;
}) {
  return (
    <div className="col" style={{ gap: 14 }}>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.7, margin: 0 }}>
        {loyaltyBasisSummary()} 등급 혜택으로 지정한 쿠폰은 승급 시 자동 발급됩니다.
      </p>
      <div className="admin-master-detail">
        <RecordList
          activeId={selected?.id ?? null}
          ariaLabel="쿠폰 목록"
          emptyMessage="등록된 쿠폰이 없습니다."
          items={records}
          labelFor={couponListLabel}
          newLabel="새 쿠폰"
          onNew={() => onSelect(null)}
          onSelect={onSelect}
        />
        <CouponEditor
          action={action}
          goodOptions={goodOptions}
          key={selected ? selected.code : 'new-coupon'}
          pending={pending}
          selected={selected}
          state={state}
        />
      </div>
    </div>
  );
}
