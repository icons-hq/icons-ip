'use client';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { Icon } from '@/components/ui/Icon';
import { useState, useTransition } from 'react';
import { searchCouponTargetGoodsAction, type CouponTargetSearch } from '@/app/admin/coupon-target-actions';
import { AdminField, AdminFormGrid } from '@/components/admin/console/AdminKit';
import { SelectField } from '@/components/admin/fields';
import type { CouponTargetCategory, CouponTargetGood } from '@/lib/coupon-targeting';
import { CouponCategoryPicker } from './CouponCategoryPicker';

export function CouponTargetingFields({ recipientSegment, goodsScope, targetIds, targetGoods, errors, showBenefitType = false, issuanceMode = 'code', modeLocked = false, categoryIds = '[]', targetCategories = [] }: {
  recipientSegment: string; goodsScope: string; targetIds: string; targetGoods: CouponTargetGood[]; errors?: Record<string, string | undefined>;
  showBenefitType?: boolean;
  issuanceMode?: string; modeLocked?: boolean; categoryIds?: string; targetCategories?: CouponTargetCategory[];
}) {
  const [segment, setSegment] = useState(issuanceMode === 'targeted' ? 'targeted' : recipientSegment);
  const [scope, setScope] = useState(goodsScope);
  const [selected, setSelected] = useState<CouponTargetGood[]>(() => {
    try {
      const ids: unknown = JSON.parse(targetIds);
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').map(id => targetGoods.find(good => good.id === id) ?? { id, code: '정보 미확인', name: '상품 정보를 확인해주세요.' }) : [];
    } catch { return []; }
  });
  const [query, setQuery] = useState(''); const [result, setResult] = useState<CouponTargetSearch | null>(null);
  const [pending, start] = useTransition();
  function search(page = 1) { start(async () => setResult(await searchCouponTargetGoodsAction(query, page))); }
  return <div className="wc-admin-kit">
    <AdminFormGrid>
      <fieldset className="admin-coupon-targets"><legend>타겟팅 대상</legend><div>
        {[{ value: 'all', label: '전체고객', icon: 'user' }, { value: 'first_purchase', label: '첫구매고객', icon: 'plus' }, { value: 'repeat_purchase', label: '재구매고객', icon: 'bag' }, { value: 'targeted', label: '고객지정', icon: 'user' }].map(option => <label key={option.value} data-selected={segment === option.value || undefined}>
          <input name="couponTargetChoice" type="radio" value={option.value} checked={segment === option.value} disabled={modeLocked && (option.value === 'targeted') !== (issuanceMode === 'targeted')} onChange={() => setSegment(option.value)} /><Icon name={option.icon} size={28} /><span>{option.label}</span>
        </label>)}
      </div>{errors?.recipientSegment || errors?.issuanceMode ? <p role="alert">{errors.recipientSegment || errors.issuanceMode}</p> : null}</fieldset>
      <input name="recipientSegment" type="hidden" value={segment === 'targeted' ? 'all' : segment} />
      <input name="issuanceMode" type="hidden" value={segment === 'targeted' ? 'targeted' : 'code'} />
      {showBenefitType ? <div className="admin-coupon-benefit-kind"><span>혜택종류</span><span>쿠폰</span></div> : null}
      <SelectField name="goodsScope" label="할인 대상 상품" value={scope} onChange={event => setScope(event.target.value)} error={errors?.goodsScope}>
        <option value="all">전체 상품</option><option value="selected_categories">선택한 카테고리</option><option value="selected_goods">선택한 상품</option>
      </SelectField>
    </AdminFormGrid>
    <input type="hidden" name="targetGoodIds" value={JSON.stringify(scope === 'selected_goods' ? selected.map(item => item.id) : [])} />
    {segment === 'targeted' ? <p>저장 후 고객이나 세그먼트를 선택하고 발급 대상을 확인합니다. 직접 발급된 고객만 사용할 수 있으며, 코드 입력으로 새로 받을 수 없습니다.</p> : null}
    <p>{adminGoodsCopy("첫구매·재구매는 전액 취소 완료를 제외한 유효 굿즈 결제 이력으로 판단합니다. 발급 자격과 할인 대상 상품은 별개이며, 등급 혜택도 스토어 정책과 각 쿠폰의 중복 사용 조건을 따릅니다.")}</p>
    {scope === 'selected_goods' ? <>
      <AdminField inputId="coupon-goods-query" label="대상 상품명·상품코드 검색" error={errors?.targetGoodIds}>
        <input id="coupon-goods-query" type="search" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} />
      </AdminField>
      <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => search()}>상품 찾기</button>
      <p>선택 {selected.length}개 · 이 상품들의 기간 할인 후 소계에만 최소금액과 할인을 적용합니다.</p>
      <ul>{selected.map(good => <li key={good.id}>{good.code} · {good.name}{good.archivedAt ? ' (보관 상품)' : ''} <button type="button" className="btn btn-ghost" onClick={() => setSelected(items => items.filter(item => item.id !== good.id))}>제외</button></li>)}</ul>
      {result?.ok ? <>
        <p role="status">검색 결과 전체 {result.total}개 · {result.page}페이지</p>
        <ul>{result.items.map(good => <li key={good.id}>{good.code} · {good.name} <button type="button" className="btn btn-ghost" disabled={selected.some(item => item.id === good.id) || selected.length >= 1000} onClick={() => setSelected(items => [...items, good])}>선택</button></li>)}</ul>
        <div className="wc-admin-kit__actions"><button type="button" disabled={pending || result.page <= 1} onClick={() => search(result.page - 1)}>이전</button><button type="button" disabled={pending || result.page * result.pageSize >= result.total} onClick={() => search(result.page + 1)}>다음</button></div>
      </> : result ? <p role="alert">{result.error}</p> : null}
    </> : null}
    <CouponCategoryPicker active={scope === 'selected_categories'} targetIds={categoryIds} categories={targetCategories} error={errors?.targetCategoryIds} />
  </div>;
}
