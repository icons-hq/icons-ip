'use client';

import { useActionState, useState } from 'react';
import { setGoodsVariantActiveAction } from '@/app/admin/goods-variant-actions';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';

function VariantAvailabilityForm({ variant, basePrice }: { variant: AdminGoodsVariant; basePrice: number }) {
  const [state, action, pending] = useActionState(setGoodsVariantActiveAction, {});
  const [price, setPrice] = useState(String(variant.price));
  const restoring = Boolean(variant.archivedAt);
  return <form action={action} className="col" style={{ gap: 6, alignItems: 'flex-start' }}>
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

export function GoodVariantsPanel({ goodId, variants, basePrice }: { goodId: string; variants: AdminGoodsVariant[]; basePrice: number }) {
  const selectedVariants = variants.filter((variant) => variant.goodId === goodId);
  return (
    <section aria-labelledby={`good-variants-${goodId}`} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <div>
        <h2 id={`good-variants-${goodId}`} style={{ fontSize: 18, margin: 0 }}>옵션 목록</h2>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '8px 0 0' }}>
          저장된 옵션의 판매가·할당 재고·안전재고를 확인합니다. 사용 중지와 복원은 즉시 반영되며, 위 상품 폼의 수정은 별도로 저장합니다.
        </p>
      </div>
      {selectedVariants.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 13, textAlign: 'left', width: '100%' }}>
            <thead><tr>{['옵션명', '옵션코드', 'ERP 코드', 'ERP 품명', '바코드', '판매가', '할당 재고', '안전재고 기준', '상태', '사용 설정'].map((label) => (
              <th key={label} scope="col" style={{ borderBottom: '1px solid var(--line)', padding: '8px 6px', whiteSpace: 'nowrap' }}>{label}</th>
            ))}</tr></thead>
            <tbody>{selectedVariants.map((variant) => (
              <tr key={variant.id}>
                <td style={{ padding: '10px 6px' }}>{variant.name}{variant.isDefault && variant.name !== '기본 옵션' ? ' (기본)' : ''}</td>
                <td style={{ padding: '10px 6px' }}>{variant.code}</td>
                <td style={{ padding: '10px 6px' }}>{variant.erpCode ?? '미설정'}</td>
                <td style={{ padding: '10px 6px' }}>{variant.erpName ?? '미설정'}</td>
                <td style={{ padding: '10px 6px' }}>{variant.barcode ?? '미설정'}</td>
                <td style={{ padding: '10px 6px', whiteSpace: 'nowrap' }}>{variant.price.toLocaleString('ko-KR')}원</td>
                <td style={{ padding: '10px 6px', whiteSpace: 'nowrap' }}>{variant.stockQty.toLocaleString('ko-KR')}개</td>
                <td style={{ padding: '10px 6px', whiteSpace: 'nowrap' }}>{variant.lowStockThreshold == null ? '미설정' : <>
                  {variant.lowStockThreshold.toLocaleString('ko-KR')}개
                  {variant.stockQty <= variant.lowStockThreshold && <strong style={{ display: 'block' }}>재고 부족</strong>}
                </>}</td>
                <td style={{ padding: '10px 6px', whiteSpace: 'nowrap' }}>{variant.archivedAt ? '사용 중지' : '사용 중'}</td>
                <td style={{ padding: '10px 6px' }}><VariantAvailabilityForm variant={variant} basePrice={basePrice} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="muted" style={{ margin: 0 }}>등록된 옵션이 없습니다.</p>}
    </section>
  );
}
