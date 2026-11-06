'use client';

import { useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/admin/kit/ui/button';
import { CustomerServiceDialog } from '@/components/admin/screens/CustomerServiceDialog';

/**
 * 화면 머리(AdminPageHeader actions) 오른쪽의 등록 버튼과 등록 팝업. 템플릿 화면군은 등록을 모두 이 자리·크기에서
 * 시작한다 — 서버 화면은 등록 폼을 children으로 넘기고, 폼의 저장·결과 표시는 폼이 그대로 소유한다.
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
  return <>
    <Button disabled={disabled} onClick={() => setOpen(true)} type="button"><Plus aria-hidden="true" />{label}</Button>
    {open ? <CustomerServiceDialog onClose={() => setOpen(false)} title={title} wide={wide}>{children}</CustomerServiceDialog> : null}
  </>;
}
