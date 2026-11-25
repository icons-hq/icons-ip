import type { ComponentProps, ReactNode } from 'react';
import { AdminHelpTip } from './console/AdminHelpTip';
import type { AdminHelp } from '@/lib/admin/help/types';

/*
 * 상품 등록·수정 편집기의 작은 공용 부품 — 템플릿 룩(ADR-0028).
 *
 * 편집기는 저장 시도마다 다시 마운트되고, 로컬 자동복구·고시 적용·HTML 삽입이 DOM 값을 직접 읽고 쓴다
 * (lib/admin/form-capture). 그래서 입력은 kit Input(Base UI)이 아니라 네이티브 입력에 kit Input과 같은 클래스를
 * 입히고 `data-slot`을 붙인다 — 폼 이름·기본값·검증 속성은 네이티브 그대로다(components/admin/fields.tsx와 같은 방식).
 */

/** kit Input과 같은 모양. 네이티브 `<input>`에 `data-slot="input"`과 함께 쓴다. */
export const GOOD_INPUT_CLASS = 'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 read-only:border-dashed read-only:bg-muted/50 read-only:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20';
/** 잠긴 선택칸을 잠긴 입력칸(read-only)과 같은 모양으로 — 점선에 화살표 없이. 선택칸을 감싼 요소에 쓴다(값·name은 그대로 제출된다). */
export const GOOD_LOCKED_SELECTS_CLASS = 'min-w-0 [&_select:disabled]:border-dashed [&_select:disabled]:bg-muted/50 [&_select:disabled]:bg-none [&_select:disabled]:text-muted-foreground';
/** 금액·수량 입력(오른쪽 정렬·고정폭 숫자). */
export const GOOD_NUMBER_INPUT_CLASS = `${GOOD_INPUT_CLASS} text-right tabular-nums`;
/** kit Textarea와 같은 모양. 네이티브 `<textarea>`에 `data-slot="textarea"`와 함께 쓴다. */
export const GOOD_TEXTAREA_CLASS = 'flex min-h-16 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 read-only:border-dashed read-only:bg-muted/50 read-only:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20';
/** 섹션 안 묶음 상자(할인 입력·재고·옵션 입력 등). */
export const GOOD_SUBPANEL_CLASS = 'flex min-w-0 flex-col gap-4 rounded-lg border p-4';
/** 안내·주의 상자. */
export const GOOD_NOTE_CLASS = 'rounded-lg border bg-muted/40 px-3 py-2.5 text-sm';
/** 가로로 넘치는 표의 테두리 상자. 안의 kit Table이 스스로 가로 스크롤한다. */
/** 표 가로 스크롤 영역(role=region·tabIndex=0과 함께 쓴다). 영역이 스크롤해야 화살표 키가 표를 옮긴다 — kit Table의 안쪽 컨테이너는 넘치게 둔다. */
export const GOOD_TABLE_FRAME_CLASS = 'min-w-0 max-w-full overflow-x-auto rounded-lg border outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&>[data-slot=table-container]]:overflow-visible';

/**
 * 설정함/설정안함 같은 하나 고르기. 네이티브 라디오라 폼 제출·기본값이 그대로이고, legend는 흐름 안에 있어
 * 라벨(라디오와 글자 전체)이 누르는 자리를 덮지 않는다(10/27 회의 R11).
 */
export function GoodChoiceGroup({ legend, help, children, className = '', ...props }: Omit<ComponentProps<'fieldset'>, 'children'> & {
  legend: ReactNode; children: ReactNode;
  /** 묶음 이름 옆 "?" 도움말(화면 규칙 3). legend가 글자일 때만 쓴다. */
  help?: AdminHelp | string;
}) {
  return <fieldset className={`m-0 min-w-0 border-0 p-0 ${className}`.trim()} data-good-choice="" {...props}>
    <legend className="float-left mb-2 flex w-full items-center gap-1 p-0 text-sm leading-snug font-medium text-foreground">{legend}{help && typeof legend === 'string' ? <AdminHelpTip help={help} label={legend} /> : null}</legend>
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

/**
 * 선택 카드 묶음(docs/admin-screen-rules.md '글보다 화면' 2·3). 선택지가 둘셋이고 고르기 전에 차이를 알아야 할 때,
 * 설명 문단 대신 선택지마다 이름·한 줄 설명(또는 작은 미리보기)을 카드로 보여 고르게 한다. 네이티브 라디오라 폼 제출은 GoodChoiceGroup과 같다.
 */
export function GoodChoiceCards({ legend, help, children, className = '', ...props }: Omit<ComponentProps<'fieldset'>, 'children'> & {
  legend: ReactNode; children: ReactNode; help?: AdminHelp | string;
}) {
  return <fieldset className={`m-0 min-w-0 border-0 p-0 ${className}`.trim()} data-good-choice="cards" {...props}>
    <legend className="float-left mb-2 flex w-full items-center gap-1 p-0 text-sm leading-snug font-medium text-foreground">{legend}{help && typeof legend === 'string' ? <AdminHelpTip help={help} label={legend} /> : null}</legend>
    <div className="clear-both grid min-w-0 gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr))]">{children}</div>
  </fieldset>;
}

/**
 * GoodChoiceCards의 선택지 하나. `title`은 선택지 이름, `description`은 고르면 어떻게 되는지 한 줄, `children`은 작은 미리보기(선택).
 * 고를 수 없을 때는 `disabled`와 함께 `blockedReason`(왜 못 고르는지·푸는 방법 한 줄)을 준다 — 이유 없이 흐리게만 두지 않는다(규칙 5).
 */
export function GoodChoiceCard({ title, description, blockedReason, children, ...input }: Omit<ComponentProps<'input'>, 'type' | 'children' | 'title'> & {
  title: ReactNode; description?: ReactNode; blockedReason?: ReactNode; children?: ReactNode;
}) {
  return <label className="flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-sm text-foreground transition-colors has-checked:border-primary has-checked:bg-muted/40 has-disabled:cursor-not-allowed has-focus-visible:ring-3 has-focus-visible:ring-ring/50" data-good-choice-card="">
    <span className="flex min-w-0 items-center gap-2 font-medium"><input type="radio" {...input} />{title}</span>
    {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
    {children}
    {input.disabled && blockedReason ? <span className="text-xs text-warning" data-good-choice-blocked="">{blockedReason}</span> : null}
  </label>;
}

/**
 * 입력을 한 줄로 되읽어 주는 요약('글보다 화면' 3). 입력 방법을 설명하는 대신 지금 값이 무슨 뜻인지 보여 준다.
 * 예: "12월 1일 10:00부터 12월 7일 23:59까지 주문받고 12월 20일에 보냅니다."
 */
export function GoodReadback({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`rounded-lg bg-muted/40 px-3 py-2 text-sm text-foreground ${className}`.trim()} data-good-readback="" role="status">{children}</p>;
}
