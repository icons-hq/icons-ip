'use server';

import { getAdminIpOptions } from '@/lib/admin/catalog-list.server';
import type { IpPickerOption } from '@/lib/admin/ip-picker';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';

export interface IpPickerSearchResult {
  options: IpPickerOption[];
  error?: string;
}

/*
 * 선택기의 검색 한 번. 화면이 타자마다 부르므로 **읽기만** 하고 아무것도 바꾸지 않는다.
 *
 * 권한을 여기서 다시 본다 — 클라이언트 컴포넌트가 부르는 액션이라 화면이 staff 전용
 * 레이아웃 안에 있다는 것만으로는 보장이 되지 않는다(서버 액션은 URL 이 없을 뿐 공개 문이다).
 * 실패는 던지지 않고 메시지로 돌려준다: 타자 중에 예외가 나면 폼 전체가 날아간다.
 */
export async function searchAdminIpsAction(
  query: string,
  selectedId: string | null,
): Promise<IpPickerSearchResult> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user || !auth.isStaff) {
    return { options: [], error: '관리자 권한이 필요합니다.' };
  }

  try {
    const options = await getAdminIpOptions({ query: query.trim() || null, selectedId });
    return { options };
  } catch {
    return { options: [], error: 'IP를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}
