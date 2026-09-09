'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FaqEntry } from '@/lib/faq';

export function FaqSuggestionList({ entries }: { entries: FaqEntry[] }) {
  return <div className="wc-help__entries">{entries.map((entry) => (
    <details className="wc-help__entry" key={entry.id}>
      <summary>{entry.question}</summary><p>{entry.answer}</p>
    </details>
  ))}</div>;
}

/** A failed or slow FAQ request never blocks submitting the actual inquiry. */
export function FaqSuggestions({ title }: { title: string }) {
  const [result, setResult] = useState<{ query: string; entries: FaqEntry[]; failed: boolean } | null>(null);
  const query = title.trim();
  useEffect(() => {
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/help?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error('faq_request_failed');
        const data = await response.json() as { entries: FaqEntry[] };
        if (!controller.signal.aborted) setResult({ query, entries: data.entries, failed: false });
      } catch {
        if (!controller.signal.aborted) setResult({ query, entries: [], failed: true });
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  const current = result?.query === query && query.length >= 2 ? result : null;
  return <section className="wc-help__suggestions" aria-label="문의 전 자주 묻는 질문">
    <div className="wc-help__suggestions-head"><h2>자주 묻는 질문</h2><Link href="/help" target="_blank" rel="noopener noreferrer">전체 FAQ 보기 (새 창)</Link></div>
    {current?.entries.length ? <FaqSuggestionList entries={current.entries} /> : (
      <p role="status">{query.length < 2 ? '문의 제목을 입력하면 관련된 답변을 먼저 찾아드려요.' : !current ? '관련 질문을 찾고 있어요.' : current.failed ? 'FAQ를 불러오지 못했습니다. 아래에서 문의를 계속 작성해주세요.' : '관련 질문이 없습니다. 아래에서 문의를 계속 작성해주세요.'}</p>
    )}
  </section>;
}
