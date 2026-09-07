import { PopupScheduleScreen } from '@/components/admin/screens/PopupScheduleScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getPopupSchedule } from '@/lib/admin/popup-schedule.server';
import { POPUP_SCHEDULE_WINDOW_DAYS } from '@/lib/popups';

/* 팝업 편성 달력 — 여러 팝업의 페이즈를 한 시간축에. */
export default async function AdminPopupSchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess('/admin/popups/schedule');
  const query = await searchParams;
  const raw = Number.parseInt(typeof query.days === 'string' ? query.days : '', 10);
  const days = (POPUP_SCHEDULE_WINDOW_DAYS as readonly number[]).includes(raw) ? raw : 14;

  const schedule = await getPopupSchedule(days);
  return <PopupScheduleScreen days={days} schedule={schedule} />;
}
