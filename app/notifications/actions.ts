'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { isSafeNotificationLink, notificationOpenedPath } from '@/lib/notifications';
import { createClient } from '@/lib/supabase/server';

const NOTIFICATIONS_PATH = '/notifications';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function openErrorPath() {
  return `${NOTIFICATIONS_PATH}?open_error=1`;
}

export async function openNotificationAction(notificationId: string): Promise<void> {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(NOTIFICATIONS_PATH)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) {
    redirect(onboardingPath(NOTIFICATIONS_PATH));
  }

  if (!UUID_PATTERN.test(notificationId)) redirect(openErrorPath());

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('open_notification', {
    target_notification_id: notificationId,
  });

  if (error || !isSafeNotificationLink(data)) redirect(openErrorPath());

  revalidatePath(NOTIFICATIONS_PATH);
  redirect(notificationOpenedPath(data, crypto.randomUUID()));
}
