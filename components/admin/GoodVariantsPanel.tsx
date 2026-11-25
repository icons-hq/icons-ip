'use client';

import { useActionState, useState } from 'react';
import { setGoodsVariantActiveAction } from '@/app/admin/goods-variant-actions';
import { GOODS_OPTION_NONE_LABEL } from '@/lib/admin/goods-option-editor';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import { Button } from '@/components/admin/kit/ui/button';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { GOOD_NUMBER_INPUT_CLASS, GOOD_TABLE_FRAME_CLASS } from './GoodEditorParts';

/*
 * 템플릿 룩(ADR-0028). 저장된 옵션의 핵심 정보와 사용 중지·다시 사용만 둔다. ADM-004 #313: 코드·ERP·바코드·안전재고 읽기 전용 표는 편집기 판매 정보 카드의
 * 옵션 상세 정보 표와 겹쳐 뺐다(안전재고 부족 경보는 재고수량 칸에 남긴다).
 *
 * 이름(화면 규칙 4): 이 패널을 담는 작업 섹션의 이름은 '옵션 사용 중지·다시 사용'(GOODS_OPTION_STOP_PANEL_TITLE — 상품 편집의 옵션목록이
 * 사용 중지한 옵션이 옮겨지는 곳으로 이 이름을 가리킨다)이고, 안쪽 제목은 '저장된 옵션'이다. 상품 편집의 '옵션목록'(저장해야 반영)과 이름을 나눠,
 * 누르면 바로 반영되는 이 패널과 헷갈리지 않게 한다. 옵션의 상태는 '사용 중'·'사용 중지', 되돌리기는 '다시 사용'이다('보관'·'복원'은 상품·IP의 말).
 */
const HEAD_CLASS = 'px-3 text-xs font-medium whitespace-normal text-muted-foreground';
const CELL_CLASS = 'px-3 py-2.5 align-top whitespace-normal';

/**
 * 화면에 보이는 옵션 이름. 옵션 없이 파는 상품의 한 줄(옵션값이 없고 저장된 이름이 '기본 옵션' 그대로)은 '옵션 없음'으로 부른다 —
 * 같은 대상을 '기본 옵션'·'옵션 없음' 두 이름으로 부르지 않는다(화면 규칙 4). 운영자가 이름을 바꿨으면 그 이름을 쓴다.
 */
function variantLabel(variant: AdminGoodsVariant): string {
  return variant.name === '기본 옵션' && !Object.keys(variant.attributes ?? {}).length ? GOODS_OPTION_NONE_LABEL : variant.name;
}

/** 사용 중지 옵션은 판매 정보 카드의 옵션 상세 정보 표에 없어, 식별자(옵션코드·ERP 코드·바코드)를 이 목록에 작게 남긴다. */
function ArchivedVariantIdentifiers({ variant }: { variant: AdminGoodsVariant }) {
  const identifiers = [['옵션 자동코드', variant.code], ['ERP 코드', variant.erpCode], ['바코드', variant.barcode]].filter(([, value]) => value);
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
    {restoring && <label className="flex w-full max-w-44 flex-col gap-1 text-xs text-muted-foreground">다시 사용할 판매가
      <input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" aria-label={`${variantLabel(variant)} 다시 사용할 판매가`} name="price" type="number" value={price} onChange={(event) => setPrice(event.target.value)} min={basePrice} max={2147483647} step={1} required />
      {variant.price < basePrice && <small className="text-[11px] leading-normal text-[var(--wc-warning)]">지금 상품 판매가 {basePrice.toLocaleString('ko-KR')}원 이상으로 입력해주세요.</small>}
    </label>}
    <Button disabled={pending || !variant.updatedAt} size="sm" type="submit" variant="outline">{pending ? '저장 중…' : restoring ? '다시 사용' : '사용 중지'}</Button>
    {state.error && <p className="text-xs text-destructive" role="alert">{state.error}</p>}
    {state.message && <p className="text-xs text-[var(--wc-success)]" role="status">{state.message}</p>}
  </form>;
}

export function GoodVariantsPanel({ goodId, variants, basePrice }: { goodId: string; variants: AdminGoodsVariant[]; basePrice: number }) {
  const selectedVariants = variants.filter((variant) => variant.goodId === goodId);
  const activeVariants = selectedVariants.filter((variant) => !variant.archivedAt);
  const stoppedVariants = selectedVariants.filter((variant) => variant.archivedAt);
  const stockOf = (list: AdminGoodsVariant[]) => list.reduce((sum, variant) => sum + variant.stockQty, 0);
  return (
    <section aria-labelledby={`good-variants-${goodId}`} className="flex min-w-0 flex-col gap-4 rounded-lg border p-4 text-sm" data-variant-panel={goodId}>
      <div className="flex flex-col gap-1">
        <h2 id={`good-variants-${goodId}`} className="text-base leading-snug font-medium">저장된 옵션</h2>
        {/* 화면에 보이지 않는 결과만 한 줄로 남긴다: 위 상품 폼과 달리 이 버튼은 저장 없이 바로 반영된다. */}
        <p className="text-sm text-muted-foreground">[사용 중지]·[다시 사용]은 누르면 바로 반영됩니다.</p>
      </div>
      {selectedVariants.length ? <>
        {/* 합계 설명 대신 사용 중·사용 중지 재고를 나눠 보인다(사용 중지한 옵션에 남은 재고도 눈에 보인다). */}
        <div className="grid min-w-0 gap-2.5 sm:grid-cols-2" role="group" aria-label="옵션 재고 요약">
          <div className="flex flex-col gap-1 rounded-lg bg-muted/50 p-3"><span className="text-xs text-muted-foreground">사용 중 옵션</span><strong className="text-sm font-semibold tabular-nums">{activeVariants.length}개 · 재고수량 {stockOf(activeVariants).toLocaleString('ko-KR')}개</strong></div>
          <div className="flex flex-col gap-1 rounded-lg bg-muted/50 p-3"><span className="text-xs text-muted-foreground">사용 중지 옵션</span><strong className="text-sm font-semibold tabular-nums">{stoppedVariants.length}개 · 남은 재고수량 {stockOf(stoppedVariants).toLocaleString('ko-KR')}개</strong></div>
        </div>
        <div className={GOOD_TABLE_FRAME_CLASS} role="region" aria-label="저장된 옵션 핵심 정보" tabIndex={0}>
          <Table className="min-w-[36rem] table-fixed">
            <TableCaption className="sr-only">저장된 옵션·판매가·재고수량·사용 상태</TableCaption>
            <TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent">
              <TableHead scope="col" className={`w-[28%] ${HEAD_CLASS}`}>옵션</TableHead>
              <TableHead scope="col" className={`w-[17%] text-right ${HEAD_CLASS}`}>옵션 판매가</TableHead>
              <TableHead scope="col" className={`w-[16%] text-right ${HEAD_CLASS}`}>재고수량</TableHead>
              <TableHead scope="col" className={`w-[15%] ${HEAD_CLASS}`}>사용 상태</TableHead>
              <TableHead scope="col" className={`w-[24%] ${HEAD_CLASS}`}>바꾸기</TableHead>
            </TableRow></TableHeader>
            <TableBody>{selectedVariants.map((variant) => <TableRow key={variant.id} data-variant-id={variant.id}>
              <TableCell className={`${CELL_CLASS} wrap-anywhere`}>{variantLabel(variant)}{variant.isDefault && variant.name !== '기본 옵션' ? ' (첫 옵션)' : ''}
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
