'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { CHAT_PERIOD_OPTIONS, inquiryChatHref, type InquiryChatData, type InquiryChatFilters } from '@/lib/admin/inquiry-chat';

/* 좁은 대화 목록 칸(2열)에 맞춘 작은 kit 선택 상자. 선택값이 잘리지 않게 글자·여백을 줄인다. */
const SELECT_CLASS = 'w-full [&_select]:pr-7 [&_select]:pl-2 [&_select]:text-xs';

export function InquiryChatControls({ filters, staffOptions }: { filters: InquiryChatFilters; staffOptions: InquiryChatData['staffOptions'] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /* 담당자·기간·읽음은 조회 조건이라 초안으로 두고 [검색]을 눌러야 조회한다(ADM-016 #13). 정렬은 결과 표시 방식이라 바로 바뀐다. */
  const [draft, setDraft] = useState({ assignee: filters.assignee, period: filters.period, read: filters.read });
  const appliedKey = `${filters.assignee}|${filters.period}|${filters.read}`;
  const [seenKey, setSeenKey] = useState(appliedKey);
  if (seenKey !== appliedKey) {
    setSeenKey(appliedKey);
    setDraft({ assignee: filters.assignee, period: filters.period, read: filters.read });
  }
  function change(patch: Partial<InquiryChatFilters>) {
    startTransition(() => router.push(inquiryChatHref(filters, { ...patch, page: 1 }), { scroll: false }));
  }
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    change(draft);
  }
  return <form onSubmit={search}><fieldset className="grid min-w-0 shrink-0 grid-cols-2 gap-2 border-b bg-muted/30 px-3 py-2.5 disabled:opacity-60" disabled={pending} aria-label="대화 필터">
    <label className="min-w-0"><span className="sr-only">담당자</span><NativeSelect className={SELECT_CLASS} size="sm" aria-label="담당자" value={draft.assignee} onChange={event => setDraft({ ...draft, assignee: event.target.value })}>
      <option value="all">담당자 전체</option><option value="me">내 담당 상담</option><option value="unassigned">담당자 미배정</option>
      {draft.assignee !== 'all' && draft.assignee !== 'me' && draft.assignee !== 'unassigned' && !staffOptions.some(staff => staff.id === draft.assignee)
        ? <option value={draft.assignee}>이전 담당자</option> : null}
      {staffOptions.map(staff => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
    </NativeSelect></label>
    <label className="min-w-0"><span className="sr-only">대화 기간</span><NativeSelect className={SELECT_CLASS} size="sm" aria-label="대화 기간" value={draft.period} onChange={event => setDraft({ ...draft, period: event.target.value as InquiryChatFilters['period'] })}>
      {CHAT_PERIOD_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </NativeSelect></label>
    <label className="min-w-0"><span className="sr-only">읽음 여부</span><NativeSelect className={SELECT_CLASS} size="sm" aria-label="읽음 여부" value={draft.read} onChange={event => setDraft({ ...draft, read: event.target.value as InquiryChatFilters['read'] })}>
      <option value="all">읽음 여부 전체</option><option value="unread">안 읽음</option><option value="read">읽음</option>
    </NativeSelect></label>
    <label className="min-w-0"><span className="sr-only">대화 정렬</span><NativeSelect className={SELECT_CLASS} size="sm" aria-label="대화 정렬" value={filters.sort} onChange={event => change({ sort: event.target.value as InquiryChatFilters['sort'] })}>
      <option value="recent">최근 대화순</option><option value="oldest">오래된 대화순</option>
    </NativeSelect></label>
    <Button className="col-span-2" size="sm" type="submit" variant="soft">검색</Button>
  </fieldset></form>;
}
