import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: vi.fn() }) }));
import { visibilityOnContextChange } from './StaffPreviewAvailability';

const CLOSED = { adminConsole: false, isStaff: false, secondaryMarketDemo: false, communityPreview: false };
const OPEN = { adminConsole: true, isStaff: true, secondaryMarketDemo: true, communityPreview: true };

describe('스태프 진입점 — presence·경로가 바뀐 렌더의 즉시 값', () => {
  /* 같은 브라우저에서 스태프가 나가고 다른 계정이 들어와도 이전 결과가 새 세션에 한 렌더도 새지 않는다. */
  it('presence 가 바뀌면 관리자 페이지 바로가기까지 전부 닫는다', () => {
    expect(visibilityOnContextChange(OPEN, true)).toEqual(CLOSED);
  });

  /* 유틸 메뉴 맨 앞의 관리자 페이지 링크는 이동할 때마다 깜빡이지 않는다 — 새 readback 이 오면 그 값으로 바뀐다.
   * 시연·커뮤니티 프리뷰 진입점은 지금처럼 경로마다 닫았다가 다시 연다. */
  it('경로만 바뀌면 관리자 페이지 바로가기만 직전 값을 두고 나머지는 닫는다', () => {
    expect(visibilityOnContextChange(OPEN, false)).toEqual({ ...CLOSED, adminConsole: true });
  });

  it('닫혀 있던 바로가기는 경로가 바뀌어도 열리지 않는다', () => {
    expect(visibilityOnContextChange(CLOSED, false)).toEqual(CLOSED);
    expect(visibilityOnContextChange({ ...CLOSED, isStaff: true, communityPreview: true }, false)).toEqual(CLOSED);
  });
});
