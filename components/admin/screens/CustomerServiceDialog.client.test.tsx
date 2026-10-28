import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useEffect: () => {}, useId: () => 'dialog-title', useRef: () => ({ current: null }) };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { CustomerServiceDialog } from './CustomerServiceDialog';

type DialogElement = ReactElement<{ onCancel: (event: unknown) => void }>;

function cancel(dialog: DialogElement, target: object, currentTarget: object) {
  const event = { target, currentTarget, preventDefault: vi.fn() };
  dialog.props.onCancel(event);
  return event;
}

/* React는 native cancel(버블링하지 않음)도 컴포넌트 트리를 따라 바깥 dialog의 onCancel까지 전달한다.
   고객문의 팝업 안에서 연 답변 템플릿 창을 Esc로 닫으면 바깥 팝업까지 닫혀 작성 화면을 잃었다(R4 중첩 showModal). */
describe('CustomerServiceDialog Esc 닫기', () => {
  it('자기 dialog의 Esc만 닫고, 안쪽 dialog에서 올라온 cancel은 무시한다', () => {
    const onClose = vi.fn();
    const dialog = CustomerServiceDialog({ title: '고객문의 상세 · 답변', onClose, children: null }) as DialogElement;
    const outer = {}; const inner = {};
    const fromInner = cancel(dialog, inner, outer);
    expect(onClose).not.toHaveBeenCalled();
    expect(fromInner.preventDefault).not.toHaveBeenCalled();
    const own = cancel(dialog, outer, outer);
    expect(own.preventDefault).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('처리 중이면 Esc를 막고 닫지 않는다', () => {
    const onClose = vi.fn();
    const dialog = CustomerServiceDialog({ title: '선택 건 처리', onClose, busy: true, children: null }) as DialogElement;
    const self = {};
    const event = cancel(dialog, self, self);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });
});
