'use client';

import { useLayoutEffect, useRef, type ComponentProps, type Ref } from 'react';

/** 화면 칸의 글자와 상태 값이 같은 숫자를 가리키는가. '010'과 '10', '1e1'과 '10'은 같은 값이다. 빈 칸은 빈 값하고만 같다. */
export function sameNumberText(dom: string, value: string): boolean {
  if (dom === value) return true;
  if (dom === '' || value === '') return false;
  const left = Number(dom), right = Number(value);
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}

type StableNumberInputProps = Omit<ComponentProps<'input'>, 'value' | 'defaultValue' | 'type' | 'ref'> & {
  /** 상태가 가진 값(빈 값은 ''). */
  value: string;
  ref?: Ref<HTMLInputElement>;
};

/**
 * 상품 등록·수정 화면의 숫자 칸(원장 재작업 알려진 후속 6, 2026-11-16).
 *
 * 제어 입력(`value` prop)은 폼이 다시 그려질 때마다 화면 칸을 상태 값으로 되돌린다. Chrome의 숫자 칸은 글자를 넣은 뒤 input 이벤트를
 * 늦게 보내는 틈이 있고, 큰 등록 폼은 바로 앞 입력(판매가 등)으로 시작된 렌더가 그 틈에 커밋될 수 있다. 그러면 방금 친 재고·판매가가
 * 옛 상태('')로 지워지고 input 이벤트도 빈 값을 읽었다(카테고리 선택 직후 자동 입력 속도·CPU 부하에서 재현, 저장은 '재고수량을 입력해주세요'로 막힘).
 *
 * 여기서는 칸을 비제어로 두고, 상태 값이 실제로 바뀌었을 때만(외부에서 값을 넣는 일괄 수정·ERP 판매가·옵션 다시 만들기 등) 화면 칸을 고친다.
 * 같은 값으로 다시 그려지는 렌더는 화면 칸을 건드리지 않으므로, 입력 도중의 렌더가 친 글자를 지우지 않는다. `onChange`는 그대로 상태를 고친다.
 *
 * 2026-11-26 덧붙임: 그 '틈'에 끼어든 렌더는 편집 폼의 `onInputCapture`가 캡처 단계에서 상태를 바꿔 생긴 것이었다(같은 input 이벤트의 onChange보다
 * 먼저 커밋된다). 그 핸들러는 버블 단계로 옮겼다(GoodEditor.tsx, `npm run test:admin-option-typing-browser`). 이 부품은 방어선으로 그대로 둔다.
 */
export function StableNumberInput({ value, ref, ...props }: StableNumberInputProps) {
  const own = useRef<HTMLInputElement | null>(null);
  useLayoutEffect(() => {
    const node = own.current;
    if (node && !sameNumberText(node.value, value)) node.value = value;
  }, [value]);
  return <input {...props} type="number" defaultValue={value} ref={(node) => {
    own.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as { current: HTMLInputElement | null }).current = node;
  }} />;
}
