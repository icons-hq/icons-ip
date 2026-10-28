import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  refIndex: 0,
  effects: [] as (() => void | (() => void))[],
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
    useId: () => 'dialog-title',
    useRef: (initial: unknown) => {
      const index = hooks.refIndex++;
      hooks.refs[index] ??= { current: initial };
      return hooks.refs[index];
    },
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { CustomerServiceDialog } from './CustomerServiceDialog';

beforeEach(() => {
  hooks.refs = [];
  hooks.refIndex = 0;
  hooks.effects = [];
});

type DialogElement = ReactElement<{ onCancel: (event: unknown) => void; onClose: (event: unknown) => void; children?: ReactNode }>;
type NativeDialog = { open: boolean; isConnected: boolean; showModal: ReturnType<typeof vi.fn> };

function cancel(dialog: DialogElement, target: object, currentTarget: object, cancelable?: boolean) {
  const event = { target, currentTarget, cancelable, preventDefault: vi.fn() };
  dialog.props.onCancel(event);
  return event;
}

function nativeDialog(state: Partial<NativeDialog> = {}): NativeDialog {
  return { open: false, isConnected: true, showModal: vi.fn(), ...state };
}

function close(dialog: DialogElement, target: object, currentTarget: NativeDialog) {
  dialog.props.onClose({ target, currentTarget });
}

function all(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
  return [element, ...all(element.props.children)];
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

/* m27 G4-4: 처리 중(busy)에는 Esc·×로 닫히지 않아야 한다. Chrome close watcher는 사용자 활성화 없이 다시
   누른 Esc의 cancel을 취소할 수 없게(cancelable=false) 보내 native dialog를 그냥 닫는다. 그러면 React의
   열림 상태는 남고 화면에서는 사라져, 같은 버튼으로 다시 열 수 없었다. */
describe('CustomerServiceDialog native close 동기화', () => {
  it('처리 중에는 × 닫기 버튼도 누를 수 없다', () => {
    const dialog = CustomerServiceDialog({ title: '선택 건 처리', onClose: vi.fn(), busy: true, children: null }) as DialogElement;
    const button = all(dialog).find((element) => element.type === 'button' && element.props['aria-label'] === '닫기');
    expect(button?.props.disabled).toBe(true);
  });

  it('브라우저가 dialog를 닫으면 열림 상태를 닫힘으로 맞춰 같은 버튼으로 다시 열 수 있게 한다', () => {
    const onClose = vi.fn();
    const dialog = CustomerServiceDialog({ title: '답변 템플릿', onClose, children: null }) as DialogElement;
    const element = nativeDialog();
    close(dialog, element, element);
    expect(onClose).toHaveBeenCalledOnce();
    expect(element.showModal).not.toHaveBeenCalled();
  });

  it('처리 중에 브라우저가 닫으면 다시 열어 처리 결과를 볼 수 있게 한다', () => {
    const onClose = vi.fn();
    const dialog = CustomerServiceDialog({ title: '선택 건 처리', onClose, busy: true, children: null }) as DialogElement;
    const element = nativeDialog();
    close(dialog, element, element);
    expect(element.showModal).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('취소할 수 없는 cancel은 바로 닫지 않고 뒤따르는 close에서 한 번만 맞춘다', () => {
    const onClose = vi.fn();
    const dialog = CustomerServiceDialog({ title: '답변 템플릿', onClose, children: null }) as DialogElement;
    const element = nativeDialog({ open: true });
    cancel(dialog, element, element, false);
    expect(onClose).not.toHaveBeenCalled();
    element.open = false;
    close(dialog, element, element);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('안쪽 dialog의 close, 다시 열린 dialog(StrictMode 재마운트), 언마운트 정리 close는 무시한다', () => {
    const onClose = vi.fn();
    const busyClose = vi.fn();
    const dialog = CustomerServiceDialog({ title: '고객문의 상세 · 답변', onClose, children: null }) as DialogElement;
    const busyDialog = CustomerServiceDialog({ title: '선택 건 처리', onClose: busyClose, busy: true, children: null }) as DialogElement;
    const outer = nativeDialog();
    close(dialog, nativeDialog(), outer);
    close(busyDialog, nativeDialog(), outer);
    const reopened = nativeDialog({ open: true });
    close(dialog, reopened, reopened);
    const removed = nativeDialog({ isConnected: false });
    close(dialog, removed, removed);
    close(busyDialog, removed, removed);
    expect(onClose).not.toHaveBeenCalled();
    expect(busyClose).not.toHaveBeenCalled();
    expect(outer.showModal).not.toHaveBeenCalled();
    expect(removed.showModal).not.toHaveBeenCalled();
  });

  /* 정리 단계(언마운트·StrictMode 재실행·Activity 숨김)에서 우리가 직접 close()한 dialog는 문서에 남아
     있어도 브라우저가 닫은 것이 아니다. 그 close로 onClose(router.replace 등)를 부르면 안 된다. */
  it('정리 단계에서 직접 닫은 close는 열림 상태를 바꾸지 않고, 다시 열리면 다시 맞춘다', () => {
    const onClose = vi.fn();
    const element = { ...nativeDialog({ open: true }), close: vi.fn(() => { element.open = false; }) };
    vi.stubGlobal('document', { activeElement: null, body: { style: { overflow: '' } } });
    vi.stubGlobal('HTMLElement', class {});
    try {
      hooks.refIndex = 0;
      const dialog = CustomerServiceDialog({ title: '답변 템플릿', onClose, children: null }) as DialogElement;
      hooks.refs[0].current = element;
      const cleanup = hooks.effects.splice(0)[0]() as () => void;
      expect(element.showModal).toHaveBeenCalledOnce();

      cleanup();
      expect(element.close).toHaveBeenCalledOnce();
      close(dialog, element, element);
      expect(onClose).not.toHaveBeenCalled();

      /* 다시 열린 뒤(StrictMode 재실행)에는 브라우저가 닫은 close를 다시 맞춘다. */
      hooks.refIndex = 0;
      CustomerServiceDialog({ title: '답변 템플릿', onClose, children: null });
      hooks.effects.splice(0)[0]();
      element.open = false;
      close(dialog, element, element);
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
