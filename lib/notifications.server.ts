import 'server-only';

import { toNotificationItem, type NotificationItem, type NotificationRow } from './notifications';
import { createClient } from '@/lib/supabase/server';

export async function loadNotifications(userId: string): Promise<NotificationItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('notifications')
    .select('id,type,title,body,link_path,read_at,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(50);

  if (error) throw new Error('Failed to load notifications');

  return ((data ?? []) as NotificationRow[]).map(toNotificationItem);
}
