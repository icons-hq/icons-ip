'use client';

import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/admin/kit/ui/button';

const PANEL_ID = 'erp-item-import';

/**
 * ERP 품목 화면의 주 행동. 품목 반입은 매일 보는 표가 밀리지 않게 접혀 있어, 화면 머리에서 펼쳐 입력 칸으로 데려간다.
 * 펼쳐 있으면 그 안의 버튼이 주 행동이라 외곽선으로 물러난다(등록 버튼 RecordNewButton과 같은 규칙).
 */
export function ErpItemsImportButton({ defaultOpen }: { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const panel = document.getElementById(PANEL_ID);
    if (!(panel instanceof HTMLDetailsElement)) return undefined;
    const sync = () => setOpen(panel.open);
    panel.addEventListener('toggle', sync);
    return () => panel.removeEventListener('toggle', sync);
  }, []);
  return <Button onClick={() => {
    const panel = document.getElementById(PANEL_ID);
    if (!(panel instanceof HTMLDetailsElement)) return;
    panel.open = true;
    panel.scrollIntoView({ block: 'start' });
    panel.querySelector('textarea')?.focus({ preventScroll: true });
  }} type="button" variant={open ? 'outline' : 'default'}><Upload aria-hidden="true" />품목 반입</Button>;
}
