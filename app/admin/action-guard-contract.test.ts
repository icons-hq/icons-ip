import { describe, expect, it } from 'vitest';
import { isServerActionSource, scanSources } from './contract-scan';

/*
 * 어드민 서버 액션 가드 계약(TKT-036·037). 'use server' 파일은 모두 `requireAdminActionAccess` 하나로 권한을 판정한다 —
 * 미로그인은 로그인 이동, 권한 없음은 호출자가 폼 오류로 표시한다. 액션마다 자체 가드를 다시 쓰면 이동 경로·오류 문구가
 * 갈라지고 새 액션이 가드를 빠뜨린다. 예외는 아래 이유 상수에 적고, 더는 위반하지 않는 예외는 이 테스트가 실패시켜 걷게 한다.
 */

const ADMIN_GUARD = 'requireAdminActionAccess';

/** 가드 호출이 없어도 되는 파일과 그 이유. */
const NO_GUARD_EXEMPT: Record<string, string> = {
  'app/admin/artwork-actions.ts':
    '업로드 흐름이 시작한 운영자에 묶인다. expectedActorId 대조가 권한 판정보다 먼저여야 하고(계정 바뀜 오류), 취소는 스태프 자격을 잃은 뒤에도 허용한다(artwork-actions.test.ts).',
};

/** 가드 외에 인증 상태를 직접 읽어도 되는 파일과 그 이유. */
const SELF_AUTH_EXEMPT: Record<string, string> = {
  'app/admin/artwork-actions.ts': NO_GUARD_EXEMPT['app/admin/artwork-actions.ts'],
  'app/admin/goods-media-actions.ts':
    '업로드 취소(cancelGoodsMediaAction)는 스태프 자격을 잃은 뒤에도 자기 업로드를 풀 수 있어야 해서 로그인 여부만 읽는다.',
  'app/admin/erp-item-actions.ts':
    '상품 편집 중 백그라운드로 부르는 제안 검색(searchErpItemsAction)은 세션이 끝나도 로그인으로 옮기지 않는다 — 입력은 두고 저장 액션의 가드가 이동시킨다.',
};

const SELF_AUTH = /\b(?:getCurrentAdminAuthState|requireAdminScreenAccess)\b/;
const SELF_LOGIN_REDIRECT = /redirect\(\s*[`'"]\/login/;

const files = scanSources(['app/admin', 'lib/admin']).filter(({ text }) => isServerActionSource(text));
const violatesNoGuard = (text: string) => !text.includes(`${ADMIN_GUARD}(`);
const violatesSelfAuth = (text: string) => SELF_AUTH.test(text) || SELF_LOGIN_REDIRECT.test(text);

describe('어드민 서버 액션 가드 계약', () => {
  it("'use server' 파일 전수를 스캔한다", () => {
    expect(files.length).toBeGreaterThan(120);
    expect(files.some(({ path }) => path === 'app/admin/claim-actions.ts')).toBe(true);
  });

  it.each(files.map(({ path }) => path))('%s는 requireAdminActionAccess로 권한을 판정한다', (path) => {
    if (NO_GUARD_EXEMPT[path]) return;
    const { text } = files.find((file) => file.path === path)!;
    expect(violatesNoGuard(text), `${path}: ${ADMIN_GUARD}(...) 호출이 없다`).toBe(false);
  });

  it.each(files.map(({ path }) => path))('%s는 자체 가드를 만들지 않는다', (path) => {
    if (SELF_AUTH_EXEMPT[path]) return;
    const { text } = files.find((file) => file.path === path)!;
    expect(violatesSelfAuth(text), `${path}: getCurrentAdminAuthState·requireAdminScreenAccess·로그인 redirect를 직접 쓴다`).toBe(false);
  });

  it('예외 목록에는 이유가 있고 아직 위반하는 파일만 남는다', () => {
    const byPath = new Map(files.map((file) => [file.path, file.text]));
    for (const [path, reason] of Object.entries(NO_GUARD_EXEMPT)) {
      expect(reason.length, path).toBeGreaterThan(10);
      expect(byPath.has(path), `${path}는 'use server' 파일이 아니다`).toBe(true);
      expect(violatesNoGuard(byPath.get(path)!), `${path}는 이제 가드를 쓴다 — 예외를 걷어주세요`).toBe(true);
    }
    for (const [path, reason] of Object.entries(SELF_AUTH_EXEMPT)) {
      expect(reason.length, path).toBeGreaterThan(10);
      expect(byPath.has(path), `${path}는 'use server' 파일이 아니다`).toBe(true);
      expect(violatesSelfAuth(byPath.get(path)!), `${path}는 이제 자체 가드가 없다 — 예외를 걷어주세요`).toBe(true);
    }
  });
});
