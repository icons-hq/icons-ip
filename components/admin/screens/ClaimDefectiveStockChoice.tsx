import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Label } from '@/components/admin/kit/ui/label';
import {
  DEFECTIVE_STOCK_FIELD_NOTE,
  STOCK_DISPOSITION_LABELS,
  stockDispositionField,
  type ClaimDefectiveItem,
} from '@/lib/admin/defective-stock';

/**
 * 반품 환불 확정의 품목별 재고 처리(QNA-035). 기본은 판매 재고 복원이고, 불량으로 고른 품목은 판매 재고에 넣지 않고
 * 불량 재고 목록에 따로 기록한다. 환불 확정 양식 안에 그려 같은 제출로 함께 간다(필드 이름 `stockDisposition:<품목 id>`).
 * 이미 기록된 품목은 바꿀 수 없어 이 칸에 그리지 않는다.
 *
 * 교환 회수품(CLM-046)도 같은 칸을 쓴다. 하자·오배송 교환에서 아직 정하지 않은 출고지는 `requireChoice`로 기본값 없이
 * 품목마다 '판매 재고 복원'과 '불량' 중 하나를 고르게 한다(고르지 않으면 양식이 제출되지 않는다).
 */
export function ClaimDefectiveStockChoice({ items, idPrefix, note = DEFECTIVE_STOCK_FIELD_NOTE, requireChoice = false, legend = '품목별 재고 처리' }: {
  items: ClaimDefectiveItem[];
  idPrefix: string;
  note?: string;
  requireChoice?: boolean;
  legend?: string;
}) {
  const choosable = items.filter((item) => item.state !== 'recorded');
  if (choosable.length === 0) return null;
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 rounded-lg border p-3" data-claim-defective-stock="">
      <legend className="px-1 text-sm font-medium">{legend}</legend>
      <p className="text-xs text-muted-foreground">{note}</p>
      {choosable.map((item) => {
        const id = `${idPrefix}-${item.orderItemId}`;
        const saved = item.defective ? 'defective' : 'restore';
        return (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2" key={item.orderItemId}>
            <Label className="min-w-0 flex-1 whitespace-normal font-normal" htmlFor={id}>
              {item.name}{item.variantName ? ` · ${item.variantName}` : ''} · {item.qty}개
            </Label>
            <NativeSelect className="w-full sm:w-44" defaultValue={requireChoice ? '' : saved} id={id} name={stockDispositionField(item.orderItemId)} required={requireChoice}>
              {requireChoice ? <option disabled value="">선택해주세요</option> : null}
              <option value="restore">{STOCK_DISPOSITION_LABELS.restore}</option>
              <option value="defective">{STOCK_DISPOSITION_LABELS.defective}</option>
            </NativeSelect>
          </div>
        );
      })}
    </fieldset>
  );
}
