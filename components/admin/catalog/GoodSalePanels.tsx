'use client';

import { useActionState, useState } from 'react';
import {
  setGoodCategoriesAction,
  setGoodPricingAction,
  setGoodSaleWindowAction,
  setGoodSearchSeoAction,
  setGoodSwitchAction,
} from '@/app/admin/category-actions';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import {
  GOOD_SALE_STATE_LABELS,
  TAX_TYPES,
  type AdminCategory,
} from '@/lib/admin/categories';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
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
