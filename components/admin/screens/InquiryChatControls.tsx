'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { CHAT_PERIOD_OPTIONS, inquiryChatHref, type InquiryChatData, type InquiryChatFilters } from '@/lib/admin/inquiry-chat';

export function InquiryChatControls({ filters, staffOptions }: { filters: InquiryChatFilters; staffOptions: InquiryChatData['staffOptions'] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function change(patch: Partial<InquiryChatFilters>) {
    startTransition(() => router.push(inquiryChatHref(filters, { ...patch, page: 1 }), { scroll: false }));
  }
  return <fieldset className="admin-inquiry-chat__filters" disabled={pending} aria-label="대화 필터">
    <label><span className="sr-only">담당자</span><select aria-label="담당자" value={filters.assignee} onChange={event => change({ assignee: event.target.value })}>
      <option value="all">담당자 전체</option><option value="me">내 담당 상담</option><option value="unassigned">담당자 미배정</option>
      {filters.assignee !== 'all' && filters.assignee !== 'me' && filters.assignee !== 'unassigned' && !staffOptions.some(staff => staff.id === filters.assignee)
        ? <option value={filters.assignee}>이전 담당자</option> : null}
      {staffOptions.map(staff => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
    </select></label>
    <label><span className="sr-only">대화 기간</span><select aria-label="대화 기간" value={filters.period} onChange={event => change({ period: event.target.value as InquiryChatFilters['period'] })}>
      {CHAT_PERIOD_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>
    <label><span className="sr-only">읽음 여부</span><select aria-label="읽음 여부" value={filters.read} onChange={event => change({ read: event.target.value as InquiryChatFilters['read'] })}>
      <option value="all">읽음 여부 전체</option><option value="unread">안읽음</option><option value="read">읽음</option>
    </select></label>
    <label><span className="sr-only">대화 정렬</span><select aria-label="대화 정렬" value={filters.sort} onChange={event => change({ sort: event.target.value as InquiryChatFilters['sort'] })}>
      <option value="recent">최근 대화순</option><option value="oldest">오래된 대화순</option>
    </select></label>
  </fieldset>;
}
