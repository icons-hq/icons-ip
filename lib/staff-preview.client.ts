import { createClient } from '@/lib/supabase/client';

/** 진입점 표시용 기존 is_staff readback. 권한은 각 라우트 서버 게이트가 별도로 확인한다. */
export async function fetchStaffPreviewVisible(): Promise<boolean> {
  try {
    const { data, error } = await createClient().rpc('is_staff');
    return error === null && data === true;
  } catch {
    return false;
  }
}
