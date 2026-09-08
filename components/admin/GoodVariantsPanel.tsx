import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';

export function GoodVariantsPanel({ goodId, variants }: { goodId: string; variants: AdminGoodsVariant[] }) {
  const selectedVariants = variants.filter((variant) => variant.goodId === goodId);
  return (
    <section aria-labelledby={`good-variants-${goodId}`} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <div>
        <h2 id={`good-variants-${goodId}`} style={{ fontSize: 18, margin: 0 }}>옵션 목록</h2>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '8px 0 0' }}>
          읽기 전용 · 옵션별 판매가와 할당 재고를 확인합니다.
        </p>
      </div>
      {selectedVariants.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 13, textAlign: 'left', width: '100%' }}>
            <thead><tr>{['옵션명', '판매가', '할당 재고', '상태'].map((label) => (
              <th key={label} scope="col" style={{ borderBottom: '1px solid var(--line)', padding: '8px 6px', whiteSpace: 'nowrap' }}>{label}</th>
            ))}</tr></thead>
            <tbody>{selectedVariants.map((variant) => (
              <tr key={variant.id}>
                <td style={{ padding: '10px 6px' }}>{variant.name}{variant.isDefault && variant.name !== '기본 옵션' ? ' (기본)' : ''}</td>
                <td style={{ padding: '10px 6px', whiteSpace: 'nowrap' }}>{variant.price.toLocaleString('ko-KR')}원</td>
                <td style={{ padding: '10px 6px', whiteSpace: 'nowrap' }}>{variant.stockQty.toLocaleString('ko-KR')}개</td>
                <td style={{ padding: '10px 6px', whiteSpace: 'nowrap' }}>{variant.archivedAt ? '보관' : '사용 중'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="muted" style={{ margin: 0 }}>등록된 옵션이 없습니다.</p>}
    </section>
  );
}
