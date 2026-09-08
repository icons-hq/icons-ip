'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { observeInquiryChanges, type InquiryRealtimeClient } from '@/lib/inquiry-realtime';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';

export function InquiryLiveUpdates({ inquiryId, audience, clientFactory = createClient }: {
  inquiryId?: string; audience: 'customer' | 'staff'; clientFactory?: () => InquiryRealtimeClient;
}) {
  const router = useRouter();
  const [newMessages, setNewMessages] = useState(0);
  const [disconnected, setDisconnected] = useState(false);
  useEffect(() => {
    if (!getSupabaseConfig().isConfigured) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const seen = new Set<string>();
    const refresh = () => { if (!timer) timer = setTimeout(() => { timer = undefined; router.refresh(); }, 100); };
    const close = observeInquiryChanges(clientFactory(), { inquiryId, onChange: (change) => {
      refresh();
      if (change.kind === 'message' && change.messageId && !seen.has(change.messageId)
        && change.author === (audience === 'staff' ? 'user' : 'staff')) {
        seen.add(change.messageId); setNewMessages((count) => count + 1);
      }
    }, onReady: () => { setDisconnected(false); refresh(); }, onDisconnected: () => setDisconnected(true) });
    return () => { close(); clearTimeout(timer); };
  }, [audience, clientFactory, inquiryId, router]);
  return <div className="inquiry-live" aria-live="polite">
    {newMessages ? <button type="button" onClick={() => setNewMessages(0)}>
      {audience === 'staff' ? '새 문의·답글' : '새 답변'} {newMessages}건 · 확인
    </button> : null}
    {disconnected ? <p>실시간 연결을 다시 시도하고 있습니다. <button type="button" onClick={() => router.refresh()}>지금 새로고침</button></p> : null}
  </div>;
}
