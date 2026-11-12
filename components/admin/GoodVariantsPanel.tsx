'use client';

import { useActionState, useState } from 'react';
import { setGoodsVariantActiveAction } from '@/app/admin/goods-variant-actions';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import { Button } from '@/components/admin/kit/ui/button';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { GOOD_NUMBER_INPUT_CLASS, GOOD_TABLE_FRAME_CLASS } from './GoodEditorParts';

/*
 * 템플릿 룩(ADR-0028). 저장된 옵션의 핵심 정보와 사용 중지·복원만 둔다. ADM-004 #313: 코드·ERP·바코드·안전재고 읽기 전용 표는 편집기 판매 정보 카드의
 * 옵션 상세 정보 표와 겹쳐 뺐다(안전재고 부족 경보는 재고수량 칸에 남긴다).
 */
const HEAD_CLASS = 'px-3 text-xs font-medium whitespace-normal text-muted-foreground';
const CELL_CLASS = 'px-3 py-2.5 align-top whitespace-normal';

/** 사용 중지 옵션은 판매 정보 카드의 옵션 상세 정보 표에 없어, 식별자(옵션코드·ERP 코드·바코드)를 이 목록에 작게 남긴다. */
function ArchivedVariantIdentifiers({ variant }: { variant: AdminGoodsVariant }) {
  const identifiers = [['옵션코드', variant.code], ['ERP 코드', variant.erpCode], ['바코드', variant.barcode]].filter(([, value]) => value);
  if (!variant.archivedAt || !identifiers.length) return null;
  return <small className="mt-1 flex min-w-0 flex-col text-xs font-normal text-muted-foreground" data-variant-identifiers="">
    {identifiers.map(([label, value]) => <span key={label} className="wrap-anywhere">{label} {value}</span>)}
  </small>;
}

function VariantAvailabilityForm({ variant, basePrice }: { variant: AdminGoodsVariant; basePrice: number }) {
  const [state, action, pending] = useActionState(setGoodsVariantActiveAction, {});
  const [price, setPrice] = useState(String(variant.price));
  const restoring = Boolean(variant.archivedAt);
  return <form action={action} className="flex min-w-0 flex-col items-start gap-1.5" data-good-variant-action="">
    <input type="hidden" name="goodId" value={variant.goodId} />
    <input type="hidden" name="variantId" value={variant.id} />
    <input type="hidden" name="active" value={String(restoring)} />
    <input type="hidden" name="expectedUpdatedAt" value={variant.updatedAt ?? ''} />
    {restoring && <label className="flex w-full max-w-44 flex-col gap-1 text-xs text-muted-foreground">복원 판매가
      <input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" aria-label={`${variant.name} 복원 판매가`} name="price" type="number" value={price} onChange={(event) => setPrice(event.target.value)} min={basePrice} max={2147483647} step={1} required />
      {variant.price < basePrice && <small className="text-[11px] leading-normal text-[var(--wc-warning)]">현재 기준 판매가 {basePrice.toLocaleString('ko-KR')}원 이상으로 입력해주세요.</small>}
    </label>}
    <Button disabled={pending || !variant.updatedAt} size="sm" type="submit" variant="outline">{pending ? '저장 중…' : restoring ? '복원' : '사용 중지'}</Button>
    {state.error && <p className="text-xs text-destructive" role="alert">{state.error}</p>}
    {state.message && <p className="text-xs text-[var(--wc-success)]" role="status">{state.message}</p>}
  </form>;
}

export function GoodVariantsPanel({ goodId, variants, basePrice }: { goodId: string; variants: AdminGoodsVariant[]; basePrice: number }) {
  const selectedVariants = variants.filter((variant) => variant.goodId === goodId);
  const activeVariants = selectedVariants.filter((variant) => !variant.archivedAt);
  const activeAllocatedStock = activeVariants.reduce((sum, variant) => sum + variant.stockQty, 0);
  const totalAllocatedStock = selectedVariants.reduce((sum, variant) => sum + variant.stockQty, 0);
  return (
    <section aria-labelledby={`good-variants-${goodId}`} className="flex min-w-0 flex-col gap-4 rounded-lg border p-4 text-sm" data-variant-panel={goodId}>
      <div className="flex flex-col gap-1">
        <h2 id={`good-variants-${goodId}`} className="text-base leading-snug font-medium">옵션 목록</h2>
        <p className="text-sm text-muted-foreground">
          옵션명·판매가·재고수량·사용 상태를 확인합니다. 옵션코드·ERP·바코드·안전재고는 위 판매 정보 카드의 옵션 상세 정보에서 확인·수정하고(사용 중지 옵션의 코드는 이 목록에 남습니다), 사용 중지와 복원은 즉시 반영되고 위 상품 폼의 수정은 별도로 저장합니다.
        </p>
      </div>
      {selectedVariants.length ? <>
        <div className="grid min-w-0 gap-2.5 sm:grid-cols-2" role="group" aria-label="옵션 재고 요약">
          <div className="flex flex-col gap-1 rounded-lg bg-muted/50 p-3"><span className="text-xs text-muted-foreground">사용 중 옵션</span><strong className="text-sm font-semibold tabular-nums">{activeVariants.length}개 · 재고수량 {activeAllocatedStock.toLocaleString('ko-KR')}개</strong></div>
          <div className="flex flex-col gap-1 rounded-lg bg-muted/50 p-3"><span className="text-xs text-muted-foreground">전체 옵션</span><strong className="text-sm font-semibold tabular-nums">{selectedVariants.length}개 · 재고수량 {totalAllocatedStock.toLocaleString('ko-KR')}개</strong></div>
          <p className="text-xs text-muted-foreground sm:col-span-2">전체 옵션 합계에는 사용 중지 옵션의 보존 재고가 포함됩니다. 실제 판매 가능 수량과 예약 가용 수량은 서버 판정값을 따릅니다.</p>
        </div>
        <div className={GOOD_TABLE_FRAME_CLASS} role="region" aria-label="저장된 옵션 핵심 정보" tabIndex={0}>
          <Table className="min-w-[36rem] table-fixed">
            <TableCaption className="sr-only">저장된 옵션명·판매가·재고수량·사용 상태</TableCaption>
            <TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent">
              <TableHead scope="col" className={`w-[28%] ${HEAD_CLASS}`}>옵션명</TableHead>
              <TableHead scope="col" className={`w-[17%] text-right ${HEAD_CLASS}`}>옵션 판매가</TableHead>
              <TableHead scope="col" className={`w-[16%] text-right ${HEAD_CLASS}`}>재고수량</TableHead>
              <TableHead scope="col" className={`w-[15%] ${HEAD_CLASS}`}>사용 상태</TableHead>
              <TableHead scope="col" className={`w-[24%] ${HEAD_CLASS}`}>사용 설정</TableHead>
            </TableRow></TableHeader>
            <TableBody>{selectedVariants.map((variant) => <TableRow key={variant.id} data-variant-id={variant.id}>
              <TableCell className={`${CELL_CLASS} wrap-anywhere`}>{variant.name}{variant.isDefault && variant.name !== '기본 옵션' ? ' (기본)' : ''}
                <ArchivedVariantIdentifiers variant={variant} /></TableCell>
              <TableCell className={`${CELL_CLASS} text-right font-medium tabular-nums`}>{variant.price.toLocaleString('ko-KR')}원</TableCell>
              <TableCell className={`${CELL_CLASS} text-right tabular-nums`}>{variant.stockQty.toLocaleString('ko-KR')}개
                {variant.lowStockThreshold != null && variant.stockQty <= variant.lowStockThreshold && <strong className="ml-1.5 text-xs font-medium text-[var(--wc-warning)]" data-tone="warning">재고 부족</strong>}</TableCell>
              <TableCell className={variant.archivedAt ? `${CELL_CLASS} text-muted-foreground` : CELL_CLASS}>{variant.archivedAt ? '사용 중지' : '사용 중'}</TableCell>
              <TableCell className={CELL_CLASS}><VariantAvailabilityForm variant={variant} basePrice={basePrice} /></TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </div>
      </> :<p className="text-sm text-muted-foreground">등록된 옵션이 없습니다.</p>}
    </section>
  );
}
