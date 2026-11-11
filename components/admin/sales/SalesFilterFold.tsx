'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/admin/kit/ui/button';

/**
 * 조회 조건을 한 줄로 두고 매일 쓰지 않는 조건을 접는다 — 조건 카드가 처리할 표를 첫 화면 아래로 밀지 않게 한다.
 * 접어도 입력은 DOM에 남아 검색할 때 값이 그대로 간다.
 */
export function SalesFilterFold({ id, fields, more, actions, defaultOpen = false }: {
  id: string; fields: ReactNode; more: ReactNode; actions: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = `${id}-more-filters`;
  return <>
    <div className="flex flex-wrap items-start gap-x-3 gap-y-3">
      {fields}
      <div className="ml-auto flex items-center gap-1.5 self-end">
        <Button aria-controls={regionId} aria-expanded={open} onClick={() => setOpen((value) => !value)} type="button" variant="ghost">
          조건 더보기<ChevronDown aria-hidden="true" className={`transition-transform${open ? ' rotate-180' : ''}`} />
        </Button>
        {actions}
      </div>
    </div>
    <div className={open ? 'flex flex-wrap items-start gap-x-5 gap-y-3 border-t pt-3' : 'hidden'} data-sales-more-filters="" id={regionId}>{more}</div>
  </>;
}
