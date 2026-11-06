'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { updateInquiryChatTagAction } from '@/app/admin/inquiry-chat-actions';
import { Button } from '@/components/admin/kit/ui/button';
import { CHAT_CONTEXT_CARD_CLASS, KIT_INPUT_CLASS } from './cs-kit-classes';

export function InquiryChatTags({ accountId, inquiryId, tags }: { accountId: string; inquiryId: string; tags: string[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  function update(label: string, present: boolean) {
    startTransition(async () => {
      setError('');
      try {
        const result = await updateInquiryChatTagAction({ accountId, inquiryId, label, present });
        if (result.error) { setError(result.error); return; }
        if (present) setDraft('');
        router.refresh();
      } catch { setError('태그 저장 결과를 확인하지 못했습니다. 입력은 유지됩니다. 같은 내용으로 다시 시도해주세요.'); }
    });
  }
  /* 입력은 네이티브 input(kit 모양)이다 — 비제어 재시도·값 보존을 그대로 지킨다. */
  return <section className={CHAT_CONTEXT_CARD_CLASS}><h2 className="text-sm font-medium text-foreground">태그</h2>
    <ul className="flex flex-wrap gap-1.5">{tags.map(tag => <li className="inline-flex max-w-full items-center gap-0.5 rounded-full border bg-muted/50 py-0.5 pr-0.5 pl-2.5 text-xs wrap-anywhere" key={tag}><span>{tag}</span><Button aria-label={`${tag} 태그 삭제`} className="rounded-full" disabled={pending} onClick={() => update(tag, false)} size="icon-xs" type="button" variant="ghost"><X aria-hidden="true" /></Button></li>)}</ul>
    <form className="flex gap-1.5" onSubmit={event => { event.preventDefault(); if (!pending) update(draft, true); }}>
      <input aria-label="새 상담 태그" className={KIT_INPUT_CLASS} data-slot="input" maxLength={20} value={draft} onChange={event => setDraft(event.target.value)} placeholder="태그 입력" disabled={pending || tags.length >= 10} required />
      <Button disabled={pending || tags.length >= 10} type="submit" variant="outline">{pending ? '저장 중' : '+ 태그 추가'}</Button>
    </form><span className="text-xs text-muted-foreground tabular-nums">{tags.length}/10 · 운영자에게만 표시</span>
    {error ? <p className="bg-transparent text-sm text-destructive" role="alert">{error}</p> : null}
  </section>;
}
