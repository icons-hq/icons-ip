import type { ComponentProps, ReactNode } from 'react';

/*
 * 상품 등록·수정 편집기의 작은 공용 부품 — 템플릿 룩(ADR-0028).
 *
 * 편집기는 저장 시도마다 다시 마운트되고, 로컬 자동복구·고시 적용·HTML 삽입이 DOM 값을 직접 읽고 쓴다
 * (lib/admin/form-capture). 그래서 입력은 kit Input(Base UI)이 아니라 네이티브 입력에 kit Input과 같은 클래스를
 * 입히고 `data-slot`을 붙인다 — 폼 이름·기본값·검증 속성은 네이티브 그대로다(components/admin/fields.tsx와 같은 방식).
 */

/** kit Input과 같은 모양. 네이티브 `<input>`에 `data-slot="input"`과 함께 쓴다. */
export const GOOD_INPUT_CLASS = 'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 read-only:border-dashed read-only:bg-muted/50 read-only:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20';
/** 금액·수량 입력(오른쪽 정렬·고정폭 숫자). */
export const GOOD_NUMBER_INPUT_CLASS = `${GOOD_INPUT_CLASS} text-right tabular-nums`;
/** kit Textarea와 같은 모양. 네이티브 `<textarea>`에 `data-slot="textarea"`와 함께 쓴다. */
export const GOOD_TEXTAREA_CLASS = 'flex min-h-16 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 read-only:border-dashed read-only:bg-muted/50 read-only:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20';
/** 섹션 안 묶음 상자(할인 입력·재고·옵션 입력 등). */
export const GOOD_SUBPANEL_CLASS = 'flex min-w-0 flex-col gap-4 rounded-lg border p-4';
/** 안내·주의 상자. */
export const GOOD_NOTE_CLASS = 'rounded-lg border bg-muted/40 px-3 py-2.5 text-sm';
/** 가로로 넘치는 표의 테두리 상자. 안의 kit Table이 스스로 가로 스크롤한다. */
export const GOOD_TABLE_FRAME_CLASS = 'min-w-0 max-w-full overflow-hidden rounded-lg border';

/**
 * 설정함/설정안함 같은 하나 고르기. 네이티브 라디오라 폼 제출·기본값이 그대로이고, legend는 흐름 안에 있어
 * 라벨(라디오와 글자 전체)이 누르는 자리를 덮지 않는다(10/27 회의 R11).
 */
export function GoodChoiceGroup({ legend, children, className = '', ...props }: Omit<ComponentProps<'fieldset'>, 'children'> & { legend: ReactNode; children: ReactNode }) {
  return <fieldset className={`m-0 min-w-0 border-0 p-0 ${className}`.trim()} data-good-choice="" {...props}>
    <legend className="float-left mb-2 w-full p-0 text-sm leading-snug font-medium text-foreground">{legend}</legend>
    <div className="clear-both flex flex-wrap items-center gap-x-6 gap-y-1">{children}</div>
  </fieldset>;
}

/** GoodChoiceGroup의 선택지 하나. `children`이 라벨 글자다. */
export function GoodChoiceOption({ children, ...input }: Omit<ComponentProps<'input'>, 'type' | 'children'> & { children: ReactNode }) {
  return <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm text-foreground has-disabled:cursor-not-allowed has-disabled:opacity-50">
    <input type="radio" {...input} />{children}
  </label>;
}

/**
 * 금액·수량 입력 뒤에 단위(원·개)를 붙인다. `children`은 GOOD_NUMBER_INPUT_CLASS를 쓴 입력(과 단위 선택)이다.
 * 블록 요소라 `<label>` 안이 아니라 AdminField 같은 묶음 안에 둔다.
 */
export function GoodAmountField({ unit, children, className = '' }: { unit?: ReactNode; children: ReactNode; className?: string }) {
  return <div className={`flex w-full max-w-xs min-w-0 items-center gap-2 ${className}`.trim()}>
    {children}
    {unit ? <span aria-hidden="true" className="shrink-0 text-sm text-muted-foreground">{unit}</span> : null}
  </div>;
}
