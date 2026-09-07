import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { PopupSchedule } from '@/lib/popups';

/* 편성 달력 로더 — 창에 **걸치기만 해도** 보여준다(이미 돌고 있는 팝업이 빠지면 뜻이 없다). */

export async function getPopupSchedule(days: number): Promise<PopupSchedule> {
  const supabase = await createClient();
  /* 시작은 오늘 KST 자정. 달력은 사람이 「오늘부터」로 읽는다. */
  const todayKst = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  const from = new Date(`${todayKst}T00:00:00+09:00`);
  const to = new Date(from.getTime() + days * 86_400_000);

  const { data, error } = await supabase.rpc('admin_popup_schedule', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) throw new Error(`Failed to load popup schedule: ${error.message}`);
  return data as PopupSchedule;
}
