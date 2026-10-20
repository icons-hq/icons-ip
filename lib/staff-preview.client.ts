import { createClient } from '@/lib/supabase/client';

/** 비공개 ICONS 시연 진입점의 현재 업무 권한 확인. 권한은 각 라우트 서버 게이트가 별도로 확인한다. */
export async function fetchStaffPreviewVisible(): Promise<boolean> {
  try {
    const { data, error } = await createClient().rpc('has_operator_capability', { p_capability: 'platform.manage' });
    return error === null && data === true;
  } catch {
    return false;
  }
}
