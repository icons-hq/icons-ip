'use client';

import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/admin/kit/ui/button';
import { CustomerServiceDialog } from '@/components/admin/screens/CustomerServiceDialog';

type AdminCreateDialogBusyReport = (source: string, busy: boolean) => void;
const AdminCreateDialogBusyReporter = createContext<AdminCreateDialogBusyReport | null>(null);

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

/**
 * 화면 머리(AdminPageHeader actions) 오른쪽의 등록 버튼과 등록 팝업. 템플릿 화면군은 등록을 모두 이 자리·크기에서
 * 시작한다 — 서버 화면은 등록 폼을 children으로 넘기고, 폼의 저장·결과 표시는 폼이 그대로 소유한다. 폼이 저장을
 * 기다리는 동안(useAdminCreateDialogBusy)에는 팝업을 닫지 않는다.
 */
export function AdminCreateDialogButton({ children, disabled = false, label, title, wide = false }: {
  /** 팝업 안에 그릴 등록 폼. 팝업을 열 때만 그린다. */
  children: ReactNode;
  disabled?: boolean;
  /** 버튼 문구(예: '새 프리셋 등록'). */
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
  return <>
    <Button disabled={disabled} onClick={() => setOpen(true)} type="button"><Plus aria-hidden="true" />{label}</Button>
    {open ? <AdminCreateDialogBusyReporter.Provider value={report}>
      <CustomerServiceDialog busy={busy} onClose={() => { if (!busy) setOpen(false); }} title={title} wide={wide}>{children}</CustomerServiceDialog>
    </AdminCreateDialogBusyReporter.Provider> : null}
  </>;
}
