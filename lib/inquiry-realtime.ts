import type { SupabaseClient } from '@supabase/supabase-js';
import { inquiryMessageAuthor, type InquiryMessageAuthor } from './inquiries';

export type InquiryRealtimeClient = Pick<SupabaseClient, 'channel' | 'removeChannel'>;
export interface InquiryChange {
  kind: 'thread' | 'message'; inquiryId: string; messageId?: string; author?: InquiryMessageAuthor;
}

/** Payloads are invalidation signals. Existing authenticated loaders own display data. */
export function observeInquiryChanges(client: InquiryRealtimeClient, options: {
  inquiryId?: string; onChange: (change: InquiryChange) => void; onReady?: () => void; onDisconnected?: () => void;
  onResync?: () => void;
}) {
  let active = true;
  let pending = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resync = () => {
    if (!active || !pending || !options.onResync) return;
    if ((typeof document === 'undefined' || document.visibilityState === 'visible')
      && (typeof navigator === 'undefined' || navigator.onLine !== false)) options.onResync();
    timer = setTimeout(resync, 5000);
  };
  const disconnected = () => {
    pending = true;
    if (!timer && options.onResync) timer = setTimeout(resync, 5000);
    options.onDisconnected?.();
  };
  if (options.onResync) timer = setTimeout(resync, 5000);
  const channel = client.channel(`inquiry:${options.inquiryId ?? 'queue'}:${crypto.randomUUID()}`);
  const thread = { schema: 'public', table: 'inquiries', ...(options.inquiryId ? { filter: `id=eq.${options.inquiryId}` } : {}) };
  const onThread = ({ new: row }: { new: Record<string, unknown> }) => {
    if (active && typeof row.id === 'string') options.onChange({ kind: 'thread', inquiryId: row.id });
  };
  channel.on('postgres_changes', { ...thread, event: 'INSERT' }, onThread)
    .on('postgres_changes', { ...thread, event: 'UPDATE' }, onThread)
    .on('postgres_changes', { schema: 'public', table: 'inquiry_messages', event: 'INSERT',
      ...(options.inquiryId ? { filter: `inquiry_id=eq.${options.inquiryId}` } : {}) }, ({ new: row }) => {
      if (!active || typeof row.id !== 'string' || typeof row.inquiry_id !== 'string') return;
      options.onChange({ kind: 'message', inquiryId: row.inquiry_id, messageId: row.id,
        author: inquiryMessageAuthor(row.author) });
    }).on('system', {}, (event) => {
      if (!active || event.extension !== 'postgres_changes') return;
      // Channel join precedes the database subscription on a cold/reconnecting
      // tenant. Refresh after the DB handshake to close that missing-event gap.
      if (event.status === 'ok') { pending = false; clearTimeout(timer); timer = undefined; options.onReady?.(); }
      else if (event.status === 'error') disconnected();
    }).subscribe((status) => {
      if (!active) return;
      if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) disconnected();
    });
  return () => { active = false; clearTimeout(timer); void client.removeChannel(channel); };
}
