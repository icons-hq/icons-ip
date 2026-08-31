'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isOnboarded, onboardingPath, safeNextPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { normalizeIpFollowIntent } from '@/lib/ip-follow';
import { createClient } from '@/lib/supabase/server';

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function loginPath(next: string) {
  return `/login?next=${encodeURIComponent(safeNextPath(next))}`;
}

function followErrorPath(next: string) {
  const url = new URL(safeNextPath(next), 'https://icons.local');
  url.searchParams.set('follow_error', '1');
  return `${url.pathname}${url.search}${url.hash}`;
}

function notificationErrorPath(next: string) {
  const url = new URL(safeNextPath(next), 'https://icons.local');
  url.searchParams.set('notification_error', '1');
  return `${url.pathname}${url.search}${url.hash}`;
}

function notificationSuccessPath(next: string) {
  const url = new URL(safeNextPath(next), 'https://icons.local');
  if (
    url.pathname === '/notifications/settings'
    || /^\/(?:ip|events|offline-popups)(?:\/[^/]+)?$/.test(url.pathname)
  ) {
    url.searchParams.set('notification_saved', '1');
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function readOptionalCheckbox(formData: FormData, key: string, setBoth: boolean): boolean | null {
  const value = formData.get(key);
  if (value === null) return setBoth ? false : null;
  return value === '1' || value === 'on' || value === 'true';
}

function detailRevalidationPath(next: string) {
  const pathname = new URL(safeNextPath(next), 'https://icons.local').pathname;
  return /^\/(?:events|offline-popups|ip)\/[^/]+$/.test(pathname) ? pathname : null;
}

export async function toggleIpFollowAction(formData: FormData) {
  const ipId = readString(formData, 'ipId').trim();
  const fallbackNext = ipId ? `/ip/${encodeURIComponent(ipId)}` : '/ip';
  const rawNext = formData.get('next');
  const next = typeof rawNext === 'string' && rawNext.trim() ? safeNextPath(rawNext) : fallbackNext;

  if (!ipId) redirect('/ip');

  const auth = await getCurrentAuthState();

  if (!auth.isConfigured || !auth.user) {
    redirect(loginPath(next));
  }

  if (!isOnboarded(auth.profile, auth.user.email)) {
    redirect(onboardingPath(next));
  }

  const supabase = await createClient();
  const intent = normalizeIpFollowIntent(formData.get('intent'));
  const rpcName = intent === 'unfollow' ? 'unfollow_ip' : 'follow_ip';
  const { error } = await supabase.rpc(rpcName, { target_ip_id: ipId });

  if (error) redirect(followErrorPath(next));

  revalidatePath('/');
  revalidatePath('/ip');
  revalidatePath(`/ip/${ipId}`);
  redirect(next);
}

export async function setIpNotificationPreferencesAction(formData: FormData) {
  const ipId = readString(formData, 'ipId').trim();
  const fallbackNext = ipId ? `/ip/${encodeURIComponent(ipId)}` : '/ip';
  const rawNext = formData.get('next');
  const next = typeof rawNext === 'string' && rawNext.trim() ? safeNextPath(rawNext) : fallbackNext;

  if (!ipId) redirect('/ip');

  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user) {
    redirect(loginPath(next));
  }
  if (!isOnboarded(auth.profile, auth.user.email)) {
    redirect(onboardingPath(next));
  }

  const setBoth = readString(formData, 'setBoth') === '1';
  const notifyDrops = readOptionalCheckbox(formData, 'notifyDrops', setBoth);
  const notifyEvents = readOptionalCheckbox(formData, 'notifyEvents', setBoth);
  const autoFollow = readString(formData, 'autoFollow') === '1';
  const supabase = await createClient();

  const { error } = await supabase.rpc('set_ip_notification_preferences', {
    target_auto_follow: autoFollow,
    target_ip_id: ipId,
    target_notify_drops: notifyDrops,
    target_notify_events: notifyEvents,
  });
  if (error) redirect(notificationErrorPath(next));

  const paths = ['/', '/ip', `/ip/${ipId}`, '/events', '/offline-popups', '/notifications/settings'];
  const nextDetailPath = detailRevalidationPath(next);
  if (nextDetailPath && !paths.includes(nextDetailPath)) paths.push(nextDetailPath);
  for (const path of paths) revalidatePath(path);
  redirect(notificationSuccessPath(next));
}
