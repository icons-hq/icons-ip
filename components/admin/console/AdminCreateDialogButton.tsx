'use client';

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/admin/kit/ui/button';
import { CustomerServiceDialog } from '@/components/admin/screens/CustomerServiceDialog';
import { adminConfirm } from '@/lib/admin/confirm';

type AdminCreateDialogBusyReport = (source: string, busy: boolean) => void;
const AdminCreateDialogBusyReporter = createContext<AdminCreateDialogBusyReport | null>(null);
const AdminCreateDialogCloser = createContext<(() => void) | null>(null);

/** 등록 팝업 안 폼이 저장에 성공하면 팝업을 닫는다. 팝업 밖(목록 안 수정 폼)에서는 null이다. 묻지 않고 닫는다(confirmDiscard와 무관). */
export function useAdminCreateDialogClose(): (() => void) | null {
  return useContext(AdminCreateDialogCloser);
}

/**
 * 등록 팝업 안 폼이 저장(서버 액션)을 기다리는 동안 팝업을 닫지 못하게 알린다. ×·Esc로 닫으면 폼이 사라져 저장 결과
 * (검증 오류·완료 안내)와 입력을 잃는다 — 고객문의 팝업(useInquiryPreviewBusy)과 같은 방식이다. 팝업 밖(목록 안 수정
 * 폼)에서는 아무 일도 하지 않는다.
 */
export function useAdminCreateDialogBusy(busy: boolean) {
  const report = useContext(AdminCreateDialogBusyReporter);
  const source = useId();
  useEffect(() => {
    if (!report || !busy) return;
    report(source, true);
    return () => report(source, false);
  }, [busy, report, source]);
}

/** 닫기 전에 묻는 말. 템플릿 편집 창(lib/admin/goods-template-save.ts의 TEMPLATE_CLOSE_DIRTY_CONFIRM)과 같은 말이다. */
export const ADMIN_CREATE_DIALOG_DISCARD_CONFIRM = {
  title: '적은 내용을 저장하지 않고 닫을까요?', message: '지금 적은 내용이 사라집니다.', confirmLabel: '저장하지 않고 닫기',
} as const;

type InputControl = { name: string; type: string; value: string; checked?: boolean };

/**
 * 팝업 안 입력칸의 지금 값을 한 줄로 만든다. 팝업을 열었을 때와 닫으려 할 때의 값이 다르면 '적은 내용이 있다'로 본다 —
 * 적었다가 도로 지운 칸, 처음부터 채워져 있던 기본값은 적은 내용이 아니다. 숨은 칸도 본다(선택창·업로드로 고른 값이 거기 담긴다).
 */
export function adminCreateDialogInputs(root: { querySelectorAll(selectors: string): ArrayLike<unknown> }): string {
  return Array.from(root.querySelectorAll('input, textarea, select') as ArrayLike<InputControl>, (control) => (
    `${control.name}\u0001${control.type === 'checkbox' || control.type === 'radio' ? String(Boolean(control.checked)) : control.value}`
  )).join('\u0000');
}

/**
 * 화면 머리(AdminPageHeader actions) 오른쪽의 등록 버튼과 등록 팝업. 템플릿 화면군은 등록을 모두 이 자리·크기에서
 * 시작한다 — 서버 화면은 등록 폼을 children으로 넘기고, 폼의 저장·결과 표시는 폼이 그대로 소유한다. 폼이 저장을
 * 기다리는 동안(useAdminCreateDialogBusy)에는 팝업을 닫지 않는다.
 */
export function AdminCreateDialogButton({ children, confirmDiscard = false, disabled = false, label, title, wide = false }: {
  /** 팝업 안에 그릴 등록 폼. 팝업을 열 때만 그린다. */
  children: ReactNode;
  /**
   * 켜면, 팝업을 연 뒤 입력칸 값이 바뀌었을 때 ×·Esc로 닫기 전에 확인창으로 묻는다(화면 규칙 7). 폼이 저장에 성공해
   * 스스로 닫을 때(useAdminCreateDialogClose)는 묻지 않는다. 기본은 꺼짐 — 지금까지처럼 묻지 않고 닫는다.
   */
  confirmDiscard?: boolean;
  disabled?: boolean;
  /** 버튼 문구(예: '새 템플릿 등록'). */
  label: string;
  /** 팝업 제목. */
  title: string;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busySources, setBusySources] = useState<readonly string[]>([]);
  const report = useCallback<AdminCreateDialogBusyReport>((source, busy) => {
    setBusySources((current) => {
      if (current.includes(source) === busy) return current;
      return busy ? [...current, source] : current.filter((value) => value !== source);
    });
  }, []);
  const busy = busySources.length > 0;
  const close = useCallback(() => setOpen(false), []);
  /** confirmDiscard일 때만 쓴다: 팝업 본문과, 팝업을 열었을 때의 입력칸 값. */
  const body = useRef<HTMLDivElement | null>(null);
  const openedInputs = useRef('');
  const captureBody = useCallback((node: HTMLDivElement | null) => {
    body.current = node;
    openedInputs.current = node ? adminCreateDialogInputs(node) : '';
  }, []);
  const requestClose = useCallback(() => {
    if (busy) return;
    const root = body.current;
    if (!root || adminCreateDialogInputs(root) === openedInputs.current) { setOpen(false); return; }
    /* Esc를 거듭 누르면 브라우저가 창을 먼저 닫는다. 적은 내용을 보면서 고르도록 다시 띄운 뒤 묻는다(닫힌 채 두면 같은 버튼으로 다시 열 수도 없다). */
    const dialog = root.closest('dialog');
    if (dialog && dialog.isConnected && !dialog.open) { try { dialog.showModal(); } catch { /* 문서에서 빠지는 중이면 그대로 둔다. */ } }
    void adminConfirm(ADMIN_CREATE_DIALOG_DISCARD_CONFIRM).then((ok) => { if (ok) setOpen(false); });
  }, [busy]);
  return <>
    <Button disabled={disabled} onClick={() => setOpen(true)} type="button"><Plus aria-hidden="true" />{label}</Button>
    {open ? <AdminCreateDialogBusyReporter.Provider value={report}><AdminCreateDialogCloser.Provider value={close}>
      <CustomerServiceDialog busy={busy} onClose={requestClose} title={title} wide={wide}>
        {confirmDiscard ? <div className="contents" data-admin-create-dialog-body="" ref={captureBody}>{children}</div> : children}
      </CustomerServiceDialog>
    </AdminCreateDialogCloser.Provider></AdminCreateDialogBusyReporter.Provider> : null}
  </>;
}
