'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateInquiryChatTagAction } from '@/app/admin/inquiry-chat-actions';

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
  return <section className="admin-inquiry-chat__context-card admin-inquiry-chat__tags"><h2>태그</h2>
    <ul>{tags.map(tag => <li key={tag}><span>{tag}</span><button type="button" disabled={pending} aria-label={`${tag} 태그 삭제`} onClick={() => update(tag, false)}>×</button></li>)}</ul>
    <form onSubmit={event => { event.preventDefault(); if (!pending) update(draft, true); }}>
      <input aria-label="새 상담 태그" maxLength={20} value={draft} onChange={event => setDraft(event.target.value)} placeholder="태그 입력" disabled={pending || tags.length >= 10} required />
      <button type="submit" disabled={pending || tags.length >= 10}>{pending ? '저장 중' : '+ 태그 추가'}</button>
    </form><span className="admin-inquiry-chat__tag-count">{tags.length}/10 · 운영자에게만 표시</span>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
