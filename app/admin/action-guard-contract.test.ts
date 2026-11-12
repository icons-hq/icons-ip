import { describe, expect, it } from 'vitest';
import { exportedFunctions, isServerActionSource, scanSources, type ExportedFunctionInfo, type FlowEvent } from './contract-scan';

/*
 * 어드민 서버 액션 가드 계약(TKT-036·037). 'use server' 파일의 export 함수는 모두 `requireAdminActionAccess` 하나로 권한을 판정한다 —
 * 미로그인은 로그인 이동, 권한 없음은 호출자가 폼 오류로 표시한다. 액션마다 자체 가드를 다시 쓰면 이동 경로·오류 문구가
 * 갈라지고 새 액션이 가드를 빠뜨린다.
 *
 * 판정은 TypeScript AST로 export 함수마다 한다(파일 단위가 아니다 — 가드 있는 파일에 무가드 액션을 더해도 걸려야 한다).
 * - 같은 파일의 로컬 함수 호출은 본문까지 따라가 가드가 불리는지 본다.
 * - 가드 호출의 결과를 써야 한다(`void`·식 문장으로 버리면 위반). 주석·문자열 안의 이름은 호출이 아니라 세지 않는다.
 * - 가드가 supabase `.rpc`·`.from`·`.storage`·`fetch` 부수효과보다 먼저 와야 한다.
 * - getCurrentAdminAuthState·requireAdminScreenAccess·로그인 redirect 같은 자체 판정도 함수 단위로 막는다.
 * 예외는 아래 `파일:함수` 키의 이유 상수에 적고, 더는 위반하지 않는 예외는 이 테스트가 실패시켜 걷게 한다.
 */

const ADMIN_GUARD = 'requireAdminActionAccess';
const SELF_AUTH_NAMES = new Set(['getCurrentAdminAuthState', 'requireAdminScreenAccess']);
const LOGIN_REDIRECT = /^[`'"]\/login/;

const ARTWORK_REASON =
  '업로드 흐름이 시작한 운영자에 묶인다. expectedActorId 대조가 권한 판정보다 먼저여야 하고(계정 바뀜 오류), 취소는 스태프 자격을 잃은 뒤에도 허용한다(artwork-actions.test.ts).';

/** 가드 호출이 없거나 부수효과 뒤에 와도 되는 함수와 그 이유. 키는 `파일:함수`. */
const NO_GUARD_EXEMPT: Record<string, string> = {
  'app/admin/artwork-actions.ts:prepareAdminArtworkUploadAction': ARTWORK_REASON,
  'app/admin/artwork-actions.ts:cancelAdminArtworkUploadAction': ARTWORK_REASON,
  'app/admin/artwork-actions.ts:verifyAdminArtworkUploadAction': ARTWORK_REASON,
  'app/admin/goods-media-actions.ts:cancelGoodsMediaAction':
    '업로드 취소는 스태프 자격을 잃은 뒤에도 자기 업로드를 풀 수 있어야 해서 로그인 여부만 읽는다(RPC가 service_role 전용·actor로 범위가 좁혀져 있다).',
  'app/admin/erp-item-actions.ts:searchErpItemsAction':
    '상품 편집 중 백그라운드로 부르는 제안 검색은 세션이 끝나도 로그인으로 옮기지 않는다 — 헬퍼와 같은 판정(설정·로그인·스태프·catalog.manage)을 직접 하고 이동만 뺀다. 입력은 두고 저장 액션의 가드가 이동시킨다.',
};

/** 가드 외에 인증 상태를 직접 읽어도 되는 함수. NO_GUARD_EXEMPT와 같은 이유다(검증 단계는 자체 판정 없이 RPC가 신원을 증명한다). */
const SELF_AUTH_EXEMPT: Record<string, string> = Object.fromEntries(
  Object.entries(NO_GUARD_EXEMPT).filter(([key]) => !key.endsWith(':verifyAdminArtworkUploadAction')),
);

/**
 * 가드에 `onUnauthenticated: 'error'`(미로그인에도 로그인 이동 대신 거절 결과)를 쓸 수 있는 함수. 화면이 백그라운드로 부르는 읽기 전용 액션뿐이다.
 * 쓰기 액션이 이 옵션을 쓰면 세션 만료가 조용한 오류로 묻히므로 막는다. 키는 `파일:함수`.
 */
const BACKGROUND_READ_EXEMPT: Record<string, string> = {
  'app/admin/shipment-actions.ts:shipmentBarcodeGapsAction': '출고 화면이 선택 변경마다 useEffect로 부르는 바코드 누락 경고(읽기 전용). 실패는 경고 생략(null)이다.',
  'app/admin/shipment-actions.ts:originBarcodeGapsAction': '출고지 탭을 열 때 useEffect로 부르는 바코드 누락 경고(읽기 전용). 실패는 경고 생략(null)이다.',
  'app/admin/cs-draft-actions.ts:readCsReplySourceAction': '답변 초안 편집 중 현재 저장본을 읽는 백그라운드 읽기. 입력 중인 초안을 두고 오류만 보인다.',
  'app/admin/cs-draft-actions.ts:readCsReplyOperationAction': '답변 초안 편집 중 저장 결과를 읽는 백그라운드 읽기. 입력 중인 초안을 두고 오류만 보인다.',
  'app/admin/inquiry-file-actions.ts:loadInquiryFileLibraryAction': '상담 파일 보관함을 마운트 때 읽는 백그라운드 읽기. 상담 입력을 두고 오류만 보인다.',
};

const sources = scanSources(['app/admin', 'lib/admin']).filter(({ text }) => isServerActionSource(text));
const functions = sources.flatMap(exportedFunctions);
const byKey = new Map(functions.map((fn) => [fn.key, fn]));

type Call = Extract<FlowEvent, { kind: 'call' }>;
const guardCalls = (fn: ExportedFunctionInfo) => fn.events.filter((e): e is Call => e.kind === 'call' && e.name === ADMIN_GUARD);
const usedGuardIndex = (fn: ExportedFunctionInfo) => fn.events.findIndex((e) => e.kind === 'call' && e.name === ADMIN_GUARD && e.used);
const hasBackgroundOption = (call: Call) => call.node.arguments[1]?.getText().includes('onUnauthenticated') ?? false;

/** 가드 없음·결과 미사용·부수효과 뒤 가드 중 하나라도 있으면 설명을 돌려준다. */
function guardViolation(fn: ExportedFunctionInfo): string | null {
  const calls = guardCalls(fn);
  if (!calls.length) return `${ADMIN_GUARD}(...) 호출이 없다`;
  const guardAt = usedGuardIndex(fn);
  if (guardAt < 0) return `${ADMIN_GUARD}(...) 결과를 쓰지 않는다(void·식 문장으로 버림)`;
  const effectAt = fn.events.findIndex((e) => e.kind === 'effect');
  if (effectAt >= 0 && effectAt < guardAt) return `${ADMIN_GUARD}(...)가 부수효과(${(fn.events[effectAt] as { text: string }).text})보다 늦다`;
  return null;
}

function selfAuthViolation(fn: ExportedFunctionInfo): string | null {
  for (const e of fn.events) {
    if (e.kind !== 'call') continue;
    if (SELF_AUTH_NAMES.has(e.name)) return `${e.name}를 직접 부른다`;
    if (e.name === 'redirect' && LOGIN_REDIRECT.test(e.node.arguments[0]?.getText() ?? '')) return '로그인 redirect를 직접 쓴다';
  }
  return null;
}

const backgroundViolation = (fn: ExportedFunctionInfo) => guardCalls(fn).some(hasBackgroundOption);

describe('어드민 서버 액션 가드 계약', () => {
  it("'use server' 파일의 export 함수 전수를 스캔한다", () => {
    expect(sources.length).toBeGreaterThan(120);
    expect(functions.length).toBeGreaterThan(400);
    expect(functions.some(({ path }) => path === 'app/admin/claim-actions.ts')).toBe(true);
  });

  it.each(functions.map(({ key }) => key))('%s는 requireAdminActionAccess로 권한을 먼저 판정하고 결과를 쓴다', (key) => {
    if (NO_GUARD_EXEMPT[key]) return;
    expect(guardViolation(byKey.get(key)!), key).toBeNull();
  });

  it.each(functions.map(({ key }) => key))('%s는 자체 가드를 만들지 않는다', (key) => {
    if (SELF_AUTH_EXEMPT[key]) return;
    expect(selfAuthViolation(byKey.get(key)!), `${key}: 자체 가드는 안 된다 — requireAdminActionAccess를 쓰세요`).toBeNull();
  });

  it.each(functions.map(({ key }) => key))("%s는 허용된 백그라운드 읽기가 아니면 onUnauthenticated 옵션을 쓰지 않는다", (key) => {
    if (BACKGROUND_READ_EXEMPT[key]) return;
    expect(backgroundViolation(byKey.get(key)!), `${key}: onUnauthenticated는 백그라운드 읽기 전용 예외다 — 쓰기 액션은 로그인으로 이동해야 한다`).toBe(false);
  });

  it('예외 목록에는 이유가 있고 아직 위반하는 함수만 남는다', () => {
    for (const [key, reason] of Object.entries(NO_GUARD_EXEMPT)) {
      const fn = byKey.get(key);
      expect(reason.length, key).toBeGreaterThan(10);
      expect(fn, `${key}는 'use server' 파일의 export 함수가 아니다`).toBeDefined();
      expect(guardViolation(fn!) !== null || selfAuthViolation(fn!) !== null, `${key}는 이제 가드 규칙을 지킨다 — NO_GUARD_EXEMPT에서 걷어주세요`).toBe(true);
    }
    for (const [key, reason] of Object.entries(SELF_AUTH_EXEMPT)) {
      const fn = byKey.get(key);
      expect(reason.length, key).toBeGreaterThan(10);
      expect(fn, `${key}는 'use server' 파일의 export 함수가 아니다`).toBeDefined();
      expect(selfAuthViolation(fn!), `${key}는 이제 자체 가드가 없다 — SELF_AUTH_EXEMPT에서 걷어주세요`).not.toBeNull();
    }
    for (const [key, reason] of Object.entries(BACKGROUND_READ_EXEMPT)) {
      const fn = byKey.get(key);
      expect(reason.length, key).toBeGreaterThan(10);
      expect(fn, `${key}는 'use server' 파일의 export 함수가 아니다`).toBeDefined();
      expect(backgroundViolation(fn!), `${key}는 onUnauthenticated를 쓰지 않는다 — BACKGROUND_READ_EXEMPT에서 걷어주세요`).toBe(true);
    }
  });
});
