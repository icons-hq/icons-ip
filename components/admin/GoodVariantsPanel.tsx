'use client';

import { useActionState, useState } from 'react';
import { setGoodsVariantActiveAction } from '@/app/admin/goods-variant-actions';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';

function VariantAvailabilityForm({ variant, basePrice }: { variant: AdminGoodsVariant; basePrice: number }) {
  const [state, action, pending] = useActionState(setGoodsVariantActiveAction, {});
  const [price, setPrice] = useState(String(variant.price));
  const restoring = Boolean(variant.archivedAt);
  return <form action={action} className="col goods-variant-action" style={{ gap: 6, alignItems: 'flex-start' }}>
    <input type="hidden" name="goodId" value={variant.goodId} />
    <input type="hidden" name="variantId" value={variant.id} />
    <input type="hidden" name="active" value={String(restoring)} />
    <input type="hidden" name="expectedUpdatedAt" value={variant.updatedAt ?? ''} />
    {restoring && <label>복원 판매가
      <input aria-label={`${variant.name} 복원 판매가`} name="price" type="number" value={price} onChange={(event) => setPrice(event.target.value)} min={basePrice} max={2147483647} step={1} required />
      {variant.price < basePrice && <small>현재 기준 판매가 {basePrice.toLocaleString('ko-KR')}원 이상으로 입력해주세요.</small>}
    </label>}
    <button className="btn btn-ghost" disabled={pending || !variant.updatedAt}>{pending ? '저장 중…' : restoring ? '복원' : '사용 중지'}</button>
    {state.error && <p role="alert">{state.error}</p>}
    {state.message && <p role="status">{state.message}</p>}
  </form>;
}

function VariantDetailsTable({ variants }: { variants: AdminGoodsVariant[] }) {
  return <details className="goods-option-secondary goods-variants-secondary">
    <summary>옵션 상세 정보 · 코드·ERP·바코드·안전재고</summary>
    <p className="wc-admin-option-artwork__secondary-hint">
      옵션코드와 외부 식별자는 주문·물류 참조를 위해 보존된 값입니다. 안전재고는 판매 가능 수량에서 차감하지 않고 부족 경보에만 사용합니다.
    </p>
    <div className="goods-option-secondary__table" role="region" aria-label="저장된 옵션 외부 식별자와 안전재고 상세" tabIndex={0}>
      <table className="wc-admin-table goods-option-secondary-table">
        <caption className="sr-only">저장된 옵션의 코드·ERP 식별자·안전재고</caption>
        <thead><tr>
          <th scope="col">옵션</th>
          <th scope="col">옵션코드</th>
          <th scope="col">ERP 코드</th>
          <th scope="col">ERP 품명</th>
          <th scope="col">바코드</th>
          <th scope="col">안전재고 기준</th>
        </tr></thead>
        <tbody>{variants.map((variant) => <tr key={variant.id} data-variant-id={variant.id}>
          <td>{variant.name}{variant.isDefault && variant.name !== '기본 옵션' ? ' (기본)' : ''}</td>
          <td>{variant.code}</td>
          <td>{variant.erpCode ?? '미설정'}</td>
          <td>{variant.erpName ?? '미설정'}</td>
          <td>{variant.barcode ?? '미설정'}</td>
          <td>{variant.lowStockThreshold == null ? '미설정' : <>
            {variant.lowStockThreshold.toLocaleString('ko-KR')}개
            {variant.stockQty <= variant.lowStockThreshold && <strong className="goods-variant-low-stock">재고 부족</strong>}
          </>}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </details>;
}

export function GoodVariantsPanel({ goodId, variants, basePrice }: { goodId: string; variants: AdminGoodsVariant[]; basePrice: number }) {
  const selectedVariants = variants.filter((variant) => variant.goodId === goodId);
  const activeVariants = selectedVariants.filter((variant) => !variant.archivedAt);
  const activeAllocatedStock = activeVariants.reduce((sum, variant) => sum + variant.stockQty, 0);
  const totalAllocatedStock = selectedVariants.reduce((sum, variant) => sum + variant.stockQty, 0);
  return (
    <section aria-labelledby={`good-variants-${goodId}`} className="card col wc-admin-option-artwork" style={{ borderRadius: 10, gap: 14, padding: 18 }} data-variant-panel={goodId}>
      <div>
        <h2 id={`good-variants-${goodId}`} style={{ fontSize: 18, margin: 0 }}>옵션 목록</h2>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '8px 0 0' }}>
          옵션명·판매가·할당 재고·사용 상태를 먼저 확인합니다. 외부 식별자와 안전재고는 접힌 상세 정보에서 확인하며, 사용 중지와 복원은 즉시 반영되고 위 상품 폼의 수정은 별도로 저장합니다.
        </p>
      </div>
      {selectedVariants.length ? <>
        <div className="goods-variants-summary" aria-label="옵션 재고 요약">
          <div><span>사용 중 옵션</span><strong>{activeVariants.length}개 · 할당 재고 {activeAllocatedStock.toLocaleString('ko-KR')}개</strong></div>
          <div><span>전체 옵션</span><strong>{selectedVariants.length}개 · 할당 재고 {totalAllocatedStock.toLocaleString('ko-KR')}개</strong></div>
          <p>전체 옵션 합계에는 사용 중지 옵션의 보존 재고가 포함됩니다. 실제 판매 가능 수량과 예약 가용 수량은 서버 판정값을 따릅니다.</p>
        </div>
        <div className="goods-option-primary-table goods-variants-primary-table" role="region" aria-label="저장된 옵션 핵심 정보" tabIndex={0}>
          <table className="wc-admin-table">
            <caption className="sr-only">저장된 옵션명·판매가·할당 재고·사용 상태</caption>
            <thead><tr>
              <th scope="col">옵션명</th>
              <th scope="col">옵션 판매가</th>
              <th scope="col">할당 재고</th>
              <th scope="col">사용 상태</th>
              <th scope="col">사용 설정</th>
            </tr></thead>
            <tbody>{selectedVariants.map((variant) => <tr key={variant.id} data-variant-id={variant.id}>
              <td>{variant.name}{variant.isDefault && variant.name !== '기본 옵션' ? ' (기본)' : ''}</td>
              <td className="goods-option-primary-table__price">{variant.price.toLocaleString('ko-KR')}원</td>
              <td>{variant.stockQty.toLocaleString('ko-KR')}개</td>
              <td>{variant.archivedAt ? '사용 중지' : '사용 중'}</td>
              <td><VariantAvailabilityForm variant={variant} basePrice={basePrice} /></td>
            </tr>)}</tbody>
          </table>
        </div>
        <VariantDetailsTable variants={selectedVariants} />
      </> : <p className="muted" style={{ margin: 0 }}>등록된 옵션이 없습니다.</p>}
    </section>
  );
}
