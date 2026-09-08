import type { SupabaseClient } from '@supabase/supabase-js';

export type InquiryRealtimeClient = Pick<SupabaseClient, 'channel' | 'removeChannel'>;
export interface InquiryChange {
  kind: 'thread' | 'message'; inquiryId: string; messageId?: string; author?: 'user' | 'staff';
}

/** Payloads are invalidation signals. Existing authenticated loaders own display data. */
export function observeInquiryChanges(client: InquiryRealtimeClient, options: {
  inquiryId?: string; onChange: (change: InquiryChange) => void; onReady?: () => void; onDisconnected?: () => void;
}) {
  let active = true;
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
        author: row.author === 'staff' ? 'staff' : 'user' });
    }).on('system', {}, (event) => {
      if (!active || event.extension !== 'postgres_changes') return;
      // Channel join precedes the database subscription on a cold/reconnecting
      // tenant. Refresh after the DB handshake to close that missing-event gap.
      if (event.status === 'ok') options.onReady?.();
      else if (event.status === 'error') options.onDisconnected?.();
    }).subscribe((status) => {
      if (!active) return;
      if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) options.onDisconnected?.();
    });
  return () => { active = false; void client.removeChannel(channel); };
}
