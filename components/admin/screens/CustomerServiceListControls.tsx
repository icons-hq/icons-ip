'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { AdminSelect } from '../console/AdminSelect';
import { KIT_SEGMENT_CLASS, KIT_SEGMENT_ITEM_CLASS } from './cs-kit-classes';

export function CustomerServiceListSelect({ label, value, options }: {
  label: string;
  value: string;
  options: { value: string; label: string; href: string }[];
}) {
  const router = useRouter();
  return <label className="block w-32 min-w-0" data-cs-list-select="">
    <span className="sr-only">{label}</span>
    <AdminSelect aria-label={label} value={value} onChange={(event) => {
      const option = options.find((entry) => entry.value === event.target.value);
      if (option) router.push(option.href, { scroll: false });
    }}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </AdminSelect>
  </label>;
}

/* 목록형·표형 전환. 버튼은 네이티브 그대로 두고 구분 선택 모양(kit)을 입는다 — 한쪽 처리 UI만 마운트한다. */
export function CustomerServiceListView({ list, table }: { list: ReactNode; table: ReactNode }) {
  const [view, setView] = useState<'list' | 'table'>('list');
  return <div className="flex min-w-0 flex-col gap-3" data-cs-list-view="">
    <div className={`${KIT_SEGMENT_CLASS} self-end`} role="group" aria-label="상품 문의 표시 방식">
      <button className={KIT_SEGMENT_ITEM_CLASS} data-slot="button" type="button" onClick={() => setView('list')} aria-pressed={view === 'list'}>목록형</button>
      <button className={KIT_SEGMENT_ITEM_CLASS} data-slot="button" type="button" onClick={() => setView('table')} aria-pressed={view === 'table'}>표형</button>
    </div>
    {view === 'list' ? list : table}
  </div>;
}
