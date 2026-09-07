'use client';

import { useActionState, useState } from 'react';
import {
  setGoodCategoriesAction,
  setGoodComplianceAction,
  setGoodDiscountAction,
  setGoodPricingAction,
  setGoodPurchaseLimitsAction,
  setGoodSaleWindowAction,
  setGoodSearchSeoAction,
  setGoodSwitchAction,
} from '@/app/admin/category-actions';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import {
  GOOD_DISCOUNT_KINDS,
  GOOD_KC_STATUSES,
  GOOD_SALE_STATE_LABELS,
  TAX_TYPES,
  type AdminCategory,
} from '@/lib/admin/categories';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import { setGoodShippingPolicyAction } from '@/app/admin/shipping-policy-actions';
import {
  shippingPolicySummary,
  type AdminShippingPolicy,
} from '@/lib/admin/shipping-policies';
import { Icon } from '@/components/ui/Icon';
import { Field, FormShell, InlineNotice, SelectField, TextArea } from '../fields';
import { SeededForm } from '@/components/admin/form-seed';

/*
 * 굿즈 편집 화면의 D-9/D-10 카드들.
 *
 * 저장 폼(admin_upsert_good)은 이미 인자가 21개라 값 하나를 고치려고 고시정보 7칸을 다시 제출하게 만들지 않는다.
 * 판매 기간·스위치·검색/SEO·공급가·분류는 각각 자기 RPC 를 가진 행 단위 setter 다(무통장 토글과 같은 등급).
 */

const emptyState: AdminCatalogActionState = {};

/** timestamptz → `datetime-local` 입력값(로컬 시각 분 단위). */
function toLocalInput(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function GoodSalePanel({ good }: { good: AdminGoodRecord }) {
  const [windowState, windowAction, windowPending] = useActionState(setGoodSaleWindowAction, emptyState);
  const [switchState, switchAction, switchPending] = useActionState(setGoodSwitchAction, emptyState);
  const [pricingState, pricingAction, pricingPending] = useActionState(setGoodPricingAction, emptyState);
  const [saleMode, setSaleMode] = useState(good.saleMode);
  const stopped = good.stoppedAt !== null;
  const hidden = good.hiddenAt !== null;

  return (
    <section aria-labelledby={`sale-${good.id}`} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <div className="row" style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <span className="eyebrow">SALE</span>
          <h2 id={`sale-${good.id}`} style={{ fontSize: 18, margin: '6px 0 0' }}>판매 기간 · 상태</h2>
        </div>
        <span className="admin-badge" data-sale-state={good.saleState}>
          {GOOD_SALE_STATE_LABELS[good.saleState] ?? good.saleState}
        </span>
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        상태는 저장되지 않고 그때그때 계산됩니다 — 보관 › 진열 안 함 › 판매 중지 › 기간 만료 › 판매 예정 › 품절 › 선주문 › 판매중 순으로 앞선 것이 이깁니다.
      </p>

      <SeededForm values={windowState.values} action={windowAction} className="col" style={{ gap: 10 }}>
        <input name="goodId" type="hidden" value={good.id} />
        <div className="admin-form-grid">
          <Field defaultValue={toLocalInput(good.saleStartsAt)} error={windowState.errors?.startsAt} label="판매 시작 (비우면 즉시)" name="startsAt" type="datetime-local" />
          <Field defaultValue={toLocalInput(good.saleEndsAt)} error={windowState.errors?.endsAt} label="판매 종료 (비우면 무기한)" name="endsAt" type="datetime-local" />
          <SelectField
            defaultValue={good.saleMode}
            error={windowState.errors?.saleMode}
            label="판매 방식"
            name="saleMode"
            onChange={(event) => setSaleMode(event.target.value)}
          >
            <option value="regular">일반 판매</option>
            <option value="preorder">선주문 (기간 내 결제 · 예정일 출고)</option>
          </SelectField>
          {saleMode === 'preorder' ? (
            <Field
              defaultValue={good.preorderShipsAt ?? ''}
              error={windowState.errors?.preorderShipsAt}
              label="출고 예정일"
              name="preorderShipsAt"
              required
              type="date"
            />
          ) : null}
        </div>
        <InlineNotice state={windowState} />
        <button className="btn btn-holo" disabled={windowPending} style={{ justifySelf: 'start', minWidth: 150 }}>
          <Icon name="check" size={15} /> {windowPending ? '저장 중' : '판매 기간 저장'}
        </button>
      </SeededForm>

      <SeededForm values={switchState.values} action={switchAction} className="col" style={{ gap: 10 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>판매 · 진열 스위치</h3>
        <input name="goodId" type="hidden" value={good.id} />
        <div className="admin-form-grid">
          <SelectField defaultValue="selling" label="대상" name="switch">
            <option value="selling">판매 {stopped ? '(지금 중지됨)' : '(지금 판매)'}</option>
            <option value="visible">진열 {hidden ? '(지금 숨김)' : '(지금 진열)'}</option>
          </SelectField>
          <SelectField defaultValue={stopped || hidden ? 'true' : 'false'} label="바꿀 값" name="enabled">
            <option value="true">켜기 (판매/진열)</option>
            <option value="false">끄기 (중지/숨김)</option>
          </SelectField>
          <Field error={switchState.errors?.reason} label="사유 (끌 때 필수)" name="reason" placeholder="공급 지연, 라이선스 검토 등" />
        </div>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
          진열을 끄면 스토어 목록·검색·상세에서 빠지고, 판매를 끄면 보이되 살 수 없습니다. 둘 다 주문 게이트가 다시 검사합니다.
        </p>
        <InlineNotice state={switchState} />
        <button className="btn btn-holo" disabled={switchPending} style={{ justifySelf: 'start', minWidth: 150 }}>
          <Icon name="check" size={15} /> {switchPending ? '적용 중' : '상태 적용'}
        </button>
      </SeededForm>

      <SeededForm values={pricingState.values} action={pricingAction} className="col" style={{ gap: 10 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>공급가 · 과세 구분</h3>
        <input name="goodId" type="hidden" value={good.id} />
        <div className="admin-form-grid">
          <Field defaultValue={good.supplyPrice ?? ''} error={pricingState.errors?.supplyPrice} label="공급가 (원)" min={0} name="supplyPrice" step={1} type="number" />
          <SelectField defaultValue={good.taxType} error={pricingState.errors?.taxType} label="과세 구분" name="taxType">
            {TAX_TYPES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </SelectField>
        </div>
        <InlineNotice state={pricingState} />
        <button className="btn btn-holo" disabled={pricingPending} style={{ justifySelf: 'start', minWidth: 150 }}>
          <Icon name="check" size={15} /> {pricingPending ? '저장 중' : '공급가 저장'}
        </button>
      </SeededForm>
    </section>
  );
}

/*
 * 할인.
 *
 * **할인가는 저장하지 않는다** — 판매가와 할인 조건만 두고 지금 팔리는 값은 조회 시 계산한다
 * (`good_effective_price`). 정각에 값을 갈아치우는 배치를 두면 그 배치가 늦은 만큼 가격이
 * 틀리고, 늦었는지조차 알기 어렵다. 그리고 **주문이 같은 함수를 다시 부른다** — 표시가와
 * 청구가가 다른 경로로 계산되면 언젠가 갈리고, 그건 돈 사고다.
 */
export function GoodDiscountPanel({ good }: { good: AdminGoodRecord }) {
  const [state, action, pending] = useActionState(setGoodDiscountAction, emptyState);
  const [kind, setKind] = useState(good.discountKind);
  const discounted = kind !== 'none';

  return (
    <section aria-labelledby={`discount-${good.id}`} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <div>
        <span className="eyebrow">DISCOUNT</span>
        <h2 id={`discount-${good.id}`} style={{ fontSize: 18, margin: '6px 0 0' }}>할인</h2>
      </div>
      <SeededForm values={state.values} action={action} className="col" style={{ gap: 10 }}>
        <input name="goodId" type="hidden" value={good.id} />
        <div className="admin-form-grid">
          <SelectField
            defaultValue={good.discountKind}
            error={state.errors?.discountKind}
            label="할인 종류"
            name="discountKind"
            onChange={(event) => setKind(event.target.value)}
          >
            {GOOD_DISCOUNT_KINDS.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </SelectField>
          {discounted ? (
            <Field
              defaultValue={good.discountValue || ''}
              error={state.errors?.discountValue}
              label={kind === 'percent' ? '할인율 (%)' : '할인액 (원)'}
              min={1}
              name="discountValue"
              step={1}
              type="number"
            />
          ) : null}
        </div>
        {discounted ? (
          <>
            <div className="admin-form-grid">
              <Field
                defaultValue={toLocalInput(good.discountStartsAt)}
                error={state.errors?.discountStartsAt}
                label="할인 시작 (비우면 즉시)"
                name="discountStartsAt"
                type="datetime-local"
              />
              <Field
                defaultValue={toLocalInput(good.discountEndsAt)}
                error={state.errors?.discountEndsAt}
                label="할인 종료 (비우면 무기한)"
                name="discountEndsAt"
                type="datetime-local"
              />
            </div>
            <label className="row" style={{ gap: 8 }}>
              <input defaultChecked={good.discountShowsRate} name="discountShowsRate" type="checkbox" />
              <span style={{ fontSize: 13 }}>상품 화면에 할인율(%)을 표시한다</span>
            </label>
          </>
        ) : null}
        <InlineNotice state={state} />
        <button className="btn btn-holo" disabled={pending} style={{ justifySelf: 'start', minWidth: 150 }}>
          <Icon name="check" size={15} /> {pending ? '저장 중' : '할인 저장'}
        </button>
      </SeededForm>
    </section>
  );
}

/*
 * 고시·표기 — KC 인증 · 성인 전용 · 바코드.
 *
 * KC 는 **「없음」과 「미확인」을 나눈다**. 빈 값이 곧 「인증 없음」이 되면 표기 누락이
 * 조용히 생기고, 그건 표시 의무 위반이다.
 */
export function GoodCompliancePanel({ good }: { good: AdminGoodRecord }) {
  const [state, action, pending] = useActionState(setGoodComplianceAction, emptyState);

  return (
    <section aria-labelledby={`compliance-${good.id}`} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <div>
        <span className="eyebrow">COMPLIANCE</span>
        <h2 id={`compliance-${good.id}`} style={{ fontSize: 18, margin: '6px 0 0' }}>KC 인증 · 표기</h2>
      </div>
      <SeededForm values={state.values} action={action} className="col" style={{ gap: 10 }}>
        <input name="goodId" type="hidden" value={good.id} />
        <div className="admin-form-grid">
          <SelectField
            defaultValue={good.kcStatus}
            error={state.errors?.kcStatus}
            label="KC 인증 상태"
            name="kcStatus"
          >
            {GOOD_KC_STATUSES.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </SelectField>
          <Field defaultValue={good.kcType ?? ''} label="인증 구분" name="kcType" placeholder="안전확인 · 공급자적합성확인 등" />
          <Field
            defaultValue={good.kcNumber ?? ''}
            error={state.errors?.kcNumber}
            label="인증번호"
            name="kcNumber"
            placeholder="XU12345-67890"
          />
          <Field defaultValue={good.kcCompany ?? ''} label="인증 상호" name="kcCompany" />
          <Field defaultValue={good.barcode ?? ''} label="바코드 (조회용)" name="barcode" placeholder="8801234567890" />
        </div>
        <label className="row" style={{ gap: 8 }}>
          <input defaultChecked={good.adultOnly} name="adultOnly" type="checkbox" />
          <span style={{ fontSize: 13 }}>성인 전용 — 생년월일이 없거나 19세 미만이면 주문을 막는다</span>
        </label>
        <InlineNotice state={state} />
        <button className="btn btn-holo" disabled={pending} style={{ justifySelf: 'start', minWidth: 150 }}>
          <Icon name="check" size={15} /> {pending ? '저장 중' : '고시·표기 저장'}
        </button>
      </SeededForm>
    </section>
  );
}

/*
 * 구매 조건 — 최소·최대 수량과 계정당 상한.
 *
 * 계정당 상한은 **취소·반품분을 빼고** 센다 — 취소한 만큼 다시 못 사면 그게 더 이상하다.
 * 판정은 장바구니·결제 준비·주문 생성이 같은 함수를 본다(`good_purchase_block_reason`).
 */
export function GoodPurchaseLimitPanel({ good }: { good: AdminGoodRecord }) {
  const [state, action, pending] = useActionState(setGoodPurchaseLimitsAction, emptyState);

  return (
    <section aria-labelledby={`limits-${good.id}`} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <div>
        <span className="eyebrow">PURCHASE</span>
        <h2 id={`limits-${good.id}`} style={{ fontSize: 18, margin: '6px 0 0' }}>구매 조건</h2>
      </div>
      <SeededForm values={state.values} action={action} className="col" style={{ gap: 10 }}>
        <input name="goodId" type="hidden" value={good.id} />
        <div className="admin-form-grid">
          <Field
            defaultValue={good.minOrderQty}
            error={state.errors?.minOrderQty}
            label="최소 구매 수량"
            min={1}
            name="minOrderQty"
            step={1}
            type="number"
          />
          <Field
            defaultValue={good.maxOrderQty ?? ''}
            error={state.errors?.maxOrderQty}
            label="1회 최대 수량 (비우면 제한 없음)"
            min={1}
            name="maxOrderQty"
            step={1}
            type="number"
          />
          <Field
            defaultValue={good.maxQtyPerAccount ?? ''}
            error={state.errors?.maxQtyPerAccount}
            label="계정당 상한 (비우면 제한 없음)"
            min={1}
            name="maxQtyPerAccount"
            step={1}
            type="number"
          />
        </div>
        <InlineNotice state={state} />
        <button className="btn btn-holo" disabled={pending} style={{ justifySelf: 'start', minWidth: 150 }}>
          <Icon name="check" size={15} /> {pending ? '저장 중' : '구매 조건 저장'}
        </button>
      </SeededForm>
    </section>
  );
}

export function GoodSearchSeoPanel({ good }: { good: AdminGoodRecord }) {
  const [state, action, pending] = useActionState(setGoodSearchSeoAction, emptyState);
  return (
    <section aria-labelledby={`seo-${good.id}`} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <div>
        <span className="eyebrow">SEARCH · SEO</span>
        <h2 id={`seo-${good.id}`} style={{ fontSize: 18, margin: '6px 0 0' }}>요약 · 검색어 · SEO</h2>
      </div>
      <SeededForm values={state.values} action={action} className="col" style={{ gap: 10 }}>
        <input name="goodId" type="hidden" value={good.id} />
        <Field defaultValue={good.summary ?? ''} error={state.errors?.summary} label="한 줄 요약 (120자 · 목록 카드와 상세 상단)" name="summary" />
        <TextArea
          defaultValue={good.searchKeywords.join(', ')}
          error={state.errors?.keywords}
          label="검색어 (쉼표나 줄바꿈으로 구분 · 50개까지)"
          name="keywords"
          placeholder="라이언, 어피치, 피크닉"
        />
        <div className="admin-form-grid">
          <Field defaultValue={good.seoTitle ?? ''} error={state.errors?.seoTitle} label="SEO 제목 (70자 · 비우면 상품명)" name="seoTitle" />
          <Field defaultValue={good.imageAlt ?? ''} error={state.errors?.imageAlt} label="대표 이미지 설명 (125자)" name="imageAlt" />
        </div>
        <TextArea defaultValue={good.seoDescription ?? ''} error={state.errors?.seoDescription} label="SEO 설명 (160자 · 비우면 요약)" maxLength={160} name="seoDescription" />
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
          검색어는 저장할 때 공백을 정리하고 소문자로 바꿔 중복을 지웁니다. 상품명·요약과 함께 검색 원문이 됩니다.
        </p>
        <FormShell pending={pending} state={state} />
      </SeededForm>
    </section>
  );
}

export function GoodCategoriesPanel({
  categories,
  good,
  memberships,
}: {
  categories: readonly AdminCategory[];
  good: AdminGoodRecord;
  memberships: readonly { categoryId: string; isPrimary: boolean }[];
}) {
  const [state, action, pending] = useActionState(setGoodCategoriesAction, emptyState);
  const selectedIds = new Set(memberships.map((entry) => entry.categoryId));
  const primary = memberships.find((entry) => entry.isPrimary)?.categoryId ?? '';
  const usable = categories.filter((category) => !category.archivedAt);

  return (
    <section aria-labelledby={`categories-${good.id}`} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <div>
        <span className="eyebrow">CATEGORIES</span>
        <h2 id={`categories-${good.id}`} style={{ fontSize: 18, margin: '6px 0 0' }}>분류</h2>
      </div>
      <SeededForm values={state.values} action={action} className="col" style={{ gap: 10 }}>
        <input name="goodId" type="hidden" value={good.id} />
        <SelectField defaultValue={primary} error={state.errors?.primaryCategoryId} label="대표 분류" name="primaryCategoryId">
          <option value="">지정 안 함</option>
          {usable.map((category) => (
            <option key={category.id} value={category.id}>{'— '.repeat(category.depth - 1)}{category.name}</option>
          ))}
        </SelectField>
        <fieldset className="admin-variant-options">
          <legend className="mono" style={{ color: 'var(--dim)', fontSize: 11, padding: '0 6px' }}>추가 분류</legend>
          <div className="admin-variant-values">
            {usable.map((category) => (
              <label className="admin-variant-value" key={category.id}>
                <input defaultChecked={selectedIds.has(category.id)} name="categoryIds" type="checkbox" value={category.id} />
                {'— '.repeat(category.depth - 1)}{category.name}
              </label>
            ))}
            {usable.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>분류가 없습니다. 상품 › 분류에서 먼저 만드세요.</span> : null}
          </div>
        </fieldset>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
          대표 분류는 하나뿐입니다. 체크하지 않아도 대표로 고른 분류는 자동으로 포함됩니다.
        </p>
        <FormShell pending={pending} state={state} />
      </SeededForm>
    </section>
  );
}

/*
 * 배송 정책 연결 (현업 슬라이스 2).
 *
 * 상품에 배송비를 적지 않고 **정책을 가리킨다** — 값이 바뀔 때 상품 수천 개를 고칠 수는 없다.
 * 비워 두면 기본 정책을 쓴다.
 */
export function GoodShippingPolicyPanel({
  good,
  policies,
}: {
  good: AdminGoodRecord;
  policies: AdminShippingPolicy[];
}) {
  const [state, action, pending] = useActionState(setGoodShippingPolicyAction, emptyState);
  const applied = policies.find((policy) => policy.id === good.shippingPolicyId)
    ?? policies.find((policy) => policy.isDefault)
    ?? null;

  return (
    <section aria-labelledby={`shipping-${good.id}`} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <div>
        <span className="eyebrow">SHIPPING</span>
        <h2 id={`shipping-${good.id}`} style={{ fontSize: 18, margin: '6px 0 0' }}>배송·교환반품</h2>
        {applied ? (
          <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '6px 0 0' }}>
            지금 적용: <strong>{applied.name}</strong> — {shippingPolicySummary(applied)}
            {applied.returnFee > 0 ? ` · 반품 배송비 ${applied.returnFee.toLocaleString('ko-KR')}원` : ''}
          </p>
        ) : null}
      </div>
      <SeededForm values={state.values} action={action} className="col" style={{ gap: 10 }}>
        <input name="goodId" type="hidden" value={good.id} />
        <SelectField
          defaultValue={good.shippingPolicyId ?? ''}
          error={state.errors?.shippingPolicyId}
          label="배송 정책"
          name="shippingPolicyId"
        >
          <option value="">기본 정책 사용</option>
          {policies.filter((policy) => !policy.isDefault).map((policy) => (
            <option key={policy.id} value={policy.id}>{policy.name}</option>
          ))}
        </SelectField>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          정책 자체는 <a href="/admin/settings/shipping">출고지·배송 정책</a> 에서 만듭니다.
        </p>
        <InlineNotice state={state} />
        <button className="btn btn-holo" disabled={pending} style={{ justifySelf: 'start', minWidth: 150 }}>
          <Icon name="check" size={15} /> {pending ? '저장 중' : '배송 정책 연결'}
        </button>
      </SeededForm>
    </section>
  );
}
