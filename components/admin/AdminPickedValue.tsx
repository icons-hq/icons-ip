'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { buttonVariants } from '@/components/admin/kit/ui/button';

/*
 * 폼 안에서 "공용 선택창으로 하나를 골라 넣는 칸"의 공통 부분(docs/admin-screen-rules.md 규칙 1).
 * 고른 것의 이름을 읽기 전용 상자에 보이고, 값(내부 번호)은 숨은 칸으로 제출한다. 선택창은 부르는 쪽이 연다.
 * 대표 카테고리 칸(GoodCategoryFields)과 같은 모양이다 — 상자를 누르거나 Enter·Space·↓를 눌러도 선택창이 열린다.
 */

/* 고른 것을 보이는 상자. 입력칸 모양이지만 직접 적지 않는다. */
const PICK_BOX_CLASS = 'h-8 min-w-0 flex-1 basis-56 cursor-pointer truncate rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20';
/* 잠긴 칸은 편집기의 다른 잠긴 입력칸(읽기 전용)과 같은 점선 상자다. */
const LOCKED_BOX_CLASS = 'h-8 min-w-0 flex-1 basis-56 truncate rounded-lg border border-dashed border-input bg-muted/50 px-2.5 py-1 text-sm text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

/**
 * 선택창에서 고른 값을 숨은 칸으로 제출하는 칸의 값 상태.
 *
 * 값이 바뀌어 화면에 반영된 뒤 그 숨은 칸에서 input 이벤트를 보낸다. 폼 값을 읽는 쪽(상품 편집기의 미리보기·요약·브라우저 자동복구·
 * 이탈 경고)은 폼의 input 이벤트를 듣고 값을 다시 읽으므로, 반영 전에 보내면 옛 값을 읽는다.
 * 숨은 칸에는 `defaultValue`를 쓰지 않는다 — 다시 그릴 때 React가 처음 값으로 되돌린다. 값은 이 상태가 갖는다.
 */
export function useAdminPickedValue(initial: string) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const announced = useRef(initial);
  useEffect(() => {
    if (announced.current === value) return;
    announced.current = value;
    inputRef.current?.dispatchEvent(new Event('input', { bubbles: true }));
  }, [value]);
  return { value, setValue, inputRef };
}

/**
 * 고른 것을 보이는 상자 + [○○ 고르기] 버튼 + 숨은 제출 칸. 칸 이름·"?"·오류 글은 감싸는 `AdminField`가 그린다(`inputId`를 같이 준다).
 * `locked`면 고를 수 없는 칸이다: 점선 상자만 보이고 버튼은 없다. 값은 그대로 제출한다.
 */
export function AdminPickedBox({ inputId, name, value, inputRef, text, placeholder, pickLabel, onOpen, locked = false, invalid = false, children }: {
  /** 상자의 id. 칸 이름(label)이 이 상자를 가리킨다. */
  inputId: string;
  /** 숨은 칸의 이름(제출 값). */
  name: string;
  value: string;
  inputRef: RefObject<HTMLInputElement | null>;
  /** 상자에 보일 글(고른 것의 이름). 내부 번호를 넣지 않는다(화면 규칙 8). */
  text: string;
  /** 아직 고르지 않았을 때 상자에 보일 글. */
  placeholder: string;
  /** 선택창을 여는 버튼 이름(예: 'IP 고르기'). */
  pickLabel: string;
  onOpen: () => void;
  locked?: boolean;
  invalid?: boolean;
  /** 같은 줄에 더 놓을 동작(되돌리기 버튼·새 탭 링크). */
  children?: ReactNode;
}) {
  return <div className="flex min-w-0 max-w-2xl flex-wrap items-center gap-x-3 gap-y-2" data-admin-picked={name}>
    <input aria-describedby={invalid ? `${inputId}-error` : undefined} aria-haspopup={locked ? undefined : 'dialog'} aria-invalid={invalid ? 'true' : undefined}
      className={locked ? LOCKED_BOX_CLASS : PICK_BOX_CLASS} data-slot="input" id={inputId} placeholder={placeholder} readOnly type="text" value={text}
      onClick={locked ? undefined : onOpen}
      /* 입력칸이 아니라 폼 저장으로 번지지 않게 Enter는 늘 막는다. */
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') { event.preventDefault(); if (!locked) onOpen(); } }} />
    {/*
      버튼에도 칸 이름을 준다. 저장 오류가 난 칸으로 포커스를 옮기는 쪽(focusGoodWorkspaceTarget)이 칸 이름으로 포커스할 곳을 찾는데 숨은 칸은 포커스를 받지 못한다.
      type="button"은 누른 제출 버튼이 아니라 폼 값(FormData)에 들어가지 않는다.
    */}
    {locked ? null : <button aria-haspopup="dialog" className={buttonVariants({ variant: 'outline' })} data-slot="button" name={name} onClick={onOpen} type="button">{pickLabel}</button>}
    {children}
    <input type="hidden" name={name} value={value} ref={inputRef} />
  </div>;
}
