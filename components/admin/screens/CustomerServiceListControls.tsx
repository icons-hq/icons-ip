'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { AdminSelect } from '../console/AdminSelect';

export function CustomerServiceListSelect({ label, value, options }: {
  label: string;
  value: string;
  options: { value: string; label: string; href: string }[];
}) {
  const router = useRouter();
  return <label className="admin-cs-results__select">
    <span className="sr-only">{label}</span>
    <AdminSelect aria-label={label} value={value} onChange={(event) => {
      const option = options.find((entry) => entry.value === event.target.value);
      if (option) router.push(option.href, { scroll: false });
    }}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </AdminSelect>
  </label>;
}

export function CustomerServiceListView({ list, table }: { list: ReactNode; table: ReactNode }) {
  const [view, setView] = useState<'list' | 'table'>('list');
  return <div className="admin-cs-list-view">
    <div className="admin-cs-list-view__controls" role="group" aria-label="상품 문의 표시 방식">
      <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>목록형</button>
      <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>표형</button>
    </div>
    {view === 'list' ? list : table}
  </div>;
}
