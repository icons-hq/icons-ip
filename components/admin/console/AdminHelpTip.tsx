'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { AdminKitPortalContainerProvider } from '@/components/admin/kit/portal-container';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/admin/kit/ui/popover';
import { ADMIN_HELP_PARTS, type AdminHelp } from '@/lib/admin/help/types';

/**
 * 칸 이름 옆의 동그란 "?" 도움말(화면 규칙 3).
 *
 * 마우스를 올리면 열리고, 누르거나(터치 포함) 키보드로 포커스한 뒤 Enter·Space를 눌러도 열린다. Esc와 바깥 누르기로 닫힌다.
 * 버튼은 `<label>` 밖에 둔다 — 라벨 안에 있으면 라벨을 누를 때 도움말이 함께 열린다.
 * 폼 안에 놓이므로 type="button"이고, 네이티브 모달 `<dialog>` 안에서는 팝업을 그 dialog 안에 띄운다(top layer 뒤에 가려지지 않게).
 */
export function AdminHelpTip({ label, help, className }: { label: string; help: AdminHelp | string; className?: string }) {
  const entry: AdminHelp = typeof help === 'string' ? { what: help } : help;
  const [dialog, setDialog] = useState<HTMLElement | undefined>(undefined);
  const locate = useCallback((node: HTMLButtonElement | null) => {
    const next = node?.closest('dialog') ?? undefined;
    setDialog((current) => current === next ? current : next);
  }, []);
  return <Popover>
    <PopoverTrigger
      aria-label={`${label} 도움말`}
      className={`inline-flex size-5 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:text-foreground print:hidden${className ? ` ${className}` : ''}`}
      closeDelay={120}
      data-admin-help=""
      delay={120}
      openOnHover
      ref={locate}
      type="button"
    >
      <CircleHelp aria-hidden="true" className="size-4" />
    </PopoverTrigger>
    <AdminKitPortalContainerProvider container={dialog}>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] gap-1.5 p-3 text-sm leading-normal font-normal" data-admin-help-content="" side="top">
        <p className="text-foreground">{entry.what}</p>
        {ADMIN_HELP_PARTS.map(([key, name]) => entry[key] ? <p className="text-muted-foreground" key={key}>
          <span className="font-medium text-foreground">{name}</span> {entry[key]}
        </p> : null)}
      </PopoverContent>
    </AdminKitPortalContainerProvider>
  </Popover>;
}

/** 칸 이름과 "?"를 한 줄에 놓는다. 이름은 `<label>`·`<legend>`·제목 등 부르는 쪽이 정한 요소다. */
export function AdminLabelWithHelp({ children, label, help }: { children: ReactNode; label: string; help?: AdminHelp | string }) {
  if (!help) return <>{children}</>;
  return <span className="inline-flex min-w-0 items-center gap-1 align-middle" data-admin-help-label="">{children}<AdminHelpTip help={help} label={label} /></span>;
}
