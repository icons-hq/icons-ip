'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { KIT_SEGMENT_CLASS, KIT_SEGMENT_ITEM_CLASS } from './cs-kit-classes';

/* 목록 머리의 정렬·목록 수 선택 상자(kit 작은 선택 상자). 너비를 고정하지 않아 가장 긴 선택지
   (예: 문의등록일 오래된순)에 맞춰 자라므로 선택값이 잘리지 않는다 — 잘림 안내 줄도 필요 없다. */
export function CustomerServiceListSelect({ label, value, options }: {
  label: string;
  value: string;
  options: { value: string; label: string; href: string }[];
}) {
  const router = useRouter();
  return <label className="block max-w-full" data-cs-list-select="">
    <span className="sr-only">{label}</span>
    <NativeSelect className="max-w-full" size="sm" aria-label={label} value={value} onChange={(event) => {
      const option = options.find((entry) => entry.value === event.target.value);
      if (option) router.push(option.href, { scroll: false });
    }}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </NativeSelect>
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
