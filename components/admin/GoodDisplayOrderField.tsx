'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { listGoodsDisplayOrderAction, readGoodsDisplayOrderSlotAction } from '@/app/admin/goods-display-order-actions';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import {
  displayOrderAnchorReadback, displayOrderBefore, displayOrderSlotReadback, parseDisplayOrderText,
  type GoodsDisplayOrderRow, type GoodsDisplayOrderSlot,
} from '@/lib/admin/goods-display-order';
import { GOOD_EDITOR_HELP } from '@/lib/admin/help/good-editor';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import { AdminField } from './console/AdminKit';
import { AdminPickerDialog } from './console/AdminPickerDialog';
import { GOOD_INPUT_CLASS, GoodReadback } from './GoodEditorParts';

/*
 * 추가 설정의 진열 순서(고객 화면 '추천순' 자리). 칸은 번호를 직접 넣어도 되고, 주된 방법은 [지금 순서 보기]에서 지금 순서를 보며
 * 둘 자리 바로 뒤 상품의 [이 앞에 두기]를 누르는 것이다. 번호를 넣으면 같은 번호를 이미 쓰는 상품이 있는지 한 줄로 되읽어 준다.
 * 폼 이름 `displayOrder`·빈 값 = 값 없음·0 이상의 정수는 그대로다. 제출은 번호 칸(비제어 입력)이 하고, 선택창이 넣는 값은
 * 입력 이벤트를 내서 편집기의 변경 감지·요약·미리보기가 새 값을 읽게 한다.
 */
const HINT = '숫자가 작을수록 앞 · 비우면 숫자를 넣은 상품 뒤';
/** 번호를 멈추고 이 시간이 지나면 같은 번호를 쓰는 상품이 있는지 묻는다. */
const SLOT_DELAY_MS = 400;

/** 값을 React가 모르게 바꾸면 값 추적이 놓치므로 입력 요소의 원래 value 설정자로 바꾼다(자동복구와 같은 방식). */
function setNativeValue(input: HTMLInputElement, value: string) {
  const setter = typeof HTMLInputElement === 'undefined' ? undefined : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value); else input.value = value;
}

/** `goodId`는 저장된 상품의 번호(상품 URL)이고 새 상품은 null이다. 화면에는 보이지 않고, 목록에서 '이 상품'을 가리는 데만 쓴다. */
export function GoodDisplayOrderField({ defaultValue, error, goodId }: { defaultValue?: string | number | null; error?: string; goodId: string | null }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const initial = defaultValue === null || defaultValue === undefined ? '' : String(defaultValue);
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(false);
  /* [이 앞에 두기]로 넣은 번호가 어느 상품 앞인지. 번호를 직접 고치면 맞지 않아 쓰지 않는다. */
  const [anchor, setAnchor] = useState<{ name: string; order: number } | null>(null);
  const [slot, setSlot] = useState<GoodsDisplayOrderSlot | null>(null);
  const order = parseDisplayOrderText(value);
  const changed = value.trim() !== initial.trim();
  useEffect(() => {
    if (order === null || !changed) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      void readGoodsDisplayOrderSlotAction({ order, goodId }).then((result) => { if (live) setSlot(result.ok ? result.slot : null); })
        .catch(() => { if (live) setSlot(null); });
    }, SLOT_DELAY_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [order, changed, goodId]);
  const shownSlot = slot && order !== null && changed && slot.order === order ? slot : null;
  const readback = anchor && order !== null && order === anchor.order - 1 ? displayOrderAnchorReadback(anchor)
    : shownSlot ? displayOrderSlotReadback(shownSlot) : null;
  function place(row: GoodsDisplayOrderRow, next: number) {
    const input = inputRef.current;
    if (input) {
      setNativeValue(input, String(next));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setValue(String(next));
    setAnchor({ name: row.name, order: row.order });
    setOpen(false);
  }
  const load: AdminPickerLoader<GoodsDisplayOrderRow> = async (request) => {
    const result = await listGoodsDisplayOrderAction({ query: request.query, page: request.page });
    return result.ok ? result.data : { error: result.error };
  };
  const hintId = `${inputId}-hint`, errorId = `${inputId}-error`;
  return <AdminField error={error} help={GOOD_EDITOR_HELP.displayOrder} hint={HINT} inputId={inputId} label="진열 순서 (선택)">
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <input aria-describedby={error ? `${hintId} ${errorId}` : hintId} aria-invalid={Boolean(error)} className={`${GOOD_INPUT_CLASS} max-w-40`} data-slot="input" defaultValue={initial} id={inputId}
        min={0} name="displayOrder" onChange={(event) => setValue(event.currentTarget.value)} ref={inputRef} type="number" />
      <button className={buttonVariants({ variant: 'outline' })} data-slot="button" onClick={() => setOpen(true)} type="button">지금 순서 보기</button>
    </div>
    {readback ? <GoodReadback>{readback}</GoodReadback> : null}
    {open ? <AdminPickerDialog<GoodsDisplayOrderRow>
      description="숫자가 작은 상품부터 고객 화면의 추천순 앞쪽에 나옵니다. [이 앞에 두기]를 누르면 그 상품보다 한 칸 앞 번호가 진열 순서 칸에 들어갑니다."
      emptyText="진열 순서를 넣은 상품이 아직 없습니다."
      excludedNote="보관한 상품과 진열 순서를 넣지 않은 상품은 목록에서 뺐습니다."
      load={load}
      onClose={() => setOpen(false)}
      onSelect={() => undefined}
      rowAction={(row) => {
        if (row.id === goodId) return <span className="text-xs font-medium text-muted-foreground">이 상품</span>;
        const placement = displayOrderBefore(row);
        return 'reason' in placement ? <span className="text-xs text-muted-foreground">{placement.reason}</span>
          : <button aria-label={`${row.name} 앞에 두기`} className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" onClick={() => place(row, placement.order)} type="button">이 앞에 두기</button>;
      }}
      rowKey={(row) => row.id}
      rowView={(row) => ({ title: row.name, meta: `${row.order}번${row.published ? '' : ' · 초안'}`, imageUrl: row.imageUrl })}
      searchPlaceholder="상품명"
      showImages
      title="지금 진열 순서"
      unit="개"
    /> : null}
  </AdminField>;
}
