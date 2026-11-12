import { describe, expect, it } from 'vitest';
import { isServerActionSource, patternLiterals, revalidatePathCalls, scanSources } from './contract-scan';

/*
 * 어드민 식별자·재검증 계약(TKT-061·062). UUID 형식 판정은 `lib/uuid.ts`의 `isUuid` 하나이고, 상품 노출면 재검증은
 * `revalidateGoodsSurfaces()` 하나다. 파일마다 정규식 리터럴이나 부분 재검증 목록을 다시 쓰면 판정이 갈라지고
 * 노출면 한 곳이 갱신에서 빠진다.
 *
 * 판정은 TypeScript AST로 한다 — 정규식·문자열 리터럴과 `revalidatePath` 호출만 보고 주석은 보지 않는다.
 * 예외는 이유 상수에 `파일:함수|상수` 키로 적고, 더는 위반하지 않는 예외는 걷게 한다.
 */

const all = scanSources(['app/admin', 'app/api/admin', 'lib/admin']);
const serverFiles = all.filter(({ text }) => isServerActionSource(text));

/**
 * 36자 UUID 형식 패턴. 문자 클래스 표기(`[0-9a-f]`·`[a-f0-9]`·`[A-Fa-f0-9]`·`\h`·`\da-f` 어느 순서든)와 무관하게
 * 하이픈 구분 8-4-4-4-12 자릿수 구조(`{8}`·`{4}`·`{12}`가 한 패턴에 함께 있고 하이픈이 있다. 반복 그룹 `(…{4}-){3}`도 포함)나 하이픈 포함 36자 클래스(`[…-]{36}`)로 판정한다.
 */
const UUID_LOOSE_CLASS = /\[[^\]]*-[^\]]*\]\{36\}/;
export const isUuidPattern = (pattern: string) => {
  const flat = pattern.replaceAll('\\', '');
  return (flat.includes('{8}') && flat.includes('{4}') && flat.includes('{12}') && flat.includes('-')) || UUID_LOOSE_CLASS.test(flat.replace(/\\/g, ''));
};

const STORAGE_PATH_REASON = '규칙이 Storage 경로(public-media/catalog/<종류>/<uuid>.<ext>)다. v4 고정·확장자까지 한 번에 검사한다.';
/** UUID 패턴을 직접 가져도 되는 곳과 이유. 키는 `파일:감싼 함수·상수`. */
const UUID_EXEMPT: Record<string, string> = {
  'app/admin/erp-item-actions.ts:ROW_KEY': '행 키는 `<uuid>:price|barcode` 합성 형식이라 UUID 판정이 아니라 키 파서다.',
  'app/admin/category-display-actions.ts:NODE_IMAGE_PATH': `카테고리 이미지 ${STORAGE_PATH_REASON}`,
  'lib/admin/artwork.ts:UUID_V4_REGEX': '업로드 경로 규칙이다. 경로를 만드는 nonce와 경로 파서가 같은 v4 패턴을 써야 해서 isUuid로 느슨하게 만들 수 없다.',
  'lib/admin/artwork.ts:UUID_V4_PATTERN': '업로드 경로 규칙이다. 경로 정규식을 조립하는 v4 조각이라 isUuid로 대체할 수 없다.',
  'lib/admin/curations.ts:CURATION_IMAGE_PATTERN': `큐레이션 이미지 ${STORAGE_PATH_REASON}`,
  'lib/admin/goods-drafts.ts:image': `상품 이미지 ${STORAGE_PATH_REASON}`,
  'lib/admin/marketing-messages.ts:parseMarketingContent': `마케팅 메시지 이미지 ${STORAGE_PATH_REASON}`,
  'lib/admin/digital-assets.server.ts:cleanupDigitalAssets': '디지털 자산 Storage 객체 경로(<uuid>/<uuid>.<확장자>)를 지우기 전에 확장자 허용 목록까지 한 번에 검사한다. 경로 규칙이지 UUID 판정이 아니다.',
};

const uuidHits = all.flatMap((source) =>
  patternLiterals(source).filter(({ pattern }) => isUuidPattern(pattern)).map(({ owner, line }) => ({ key: `${source.path}:${owner ?? '<최상위>'}`, path: source.path, line })));

/** `/shop`·`/ip` 아래 경로. 상품 노출면(목록·상세·레이아웃)을 부분 갱신하는 호출을 모두 잡는다. */
const PARTIAL_PATH = /^\/(?:shop|ip)(?:\/|$)/;
const IP_REASON = 'IP 노출·상세 갱신은 IP 목록과 상세만 바꾼다. 상품 상세·목록·장바구니는 바뀌는 내용이 없다.';
const REVIEW_REASON = '리뷰 게시·답변·베스트 설정은 상품 상세의 리뷰 영역(과 홈 리뷰 띠)만 바꾼다.';
/** 상품 노출면을 직접 갱신해도 되는 곳과 이유. 키는 `파일:함수`. */
const REVALIDATION_EXEMPT: Record<string, string> = {
  'app/admin/qna-actions.ts:revalidateQuestionSurfaces': '문의 답변은 상품 상세의 문의 영역만 바꾼다. 홈·목록·장바구니는 갱신할 내용이 없다.',
  'app/admin/review-actions.ts:replyToReviewAction': REVIEW_REASON,
  'app/admin/review-actions.ts:setReviewStatusAction': REVIEW_REASON,
  'app/admin/review-best-actions.ts:setBestReviewAction': REVIEW_REASON,
  'app/admin/review-best-actions.ts:saveBestReviewSettingsAction': REVIEW_REASON,
  'app/admin/review-event-actions.ts:execute': '리뷰 적립 이벤트는 상품 상세의 리뷰 안내와 적립금 화면만 바꾼다.',
  'app/admin/customer-reward-actions.ts:readBestReviewRewardAction': '리뷰 적립 처리는 상품 상세의 리뷰 영역과 적립금 화면만 바꾼다.',
  'app/admin/cs-draft-actions.ts:readCsReplyOperationAction': 'CS 답변 초안 저장 결과 복구는 상품 상세의 문의·리뷰 영역만 바꾼다.',
  'app/admin/category-display-actions.ts:updateCategoryDisplayTreeAction': '카테고리 표시 구조는 `/shop` 목록과 메뉴만 바꾼다. 상품 상세·장바구니는 바뀌지 않는다.',
  'app/admin/category-display-actions.ts:saveCategoryDisplayAction': '카테고리 표시 구조는 `/shop` 목록과 메뉴만 바꾼다. 상품 상세·장바구니는 바뀌지 않는다.',
  'app/admin/ip-banner-actions.ts:saveAdminIpHallBannerAction': IP_REASON,
  'app/admin/ip-directory-actions.ts:saveIpDirectoryAction': IP_REASON,
  'app/admin/ip-publish-actions.ts:revalidateIpPublishSurfaces': 'IP 공개 상태는 IP 목록·상세·홈·이벤트·게임을 바꾸고 그 목록을 이 함수가 직접 갱신한다. 상품 상세·장바구니는 바뀌지 않는다.',
};
const partialHits = serverFiles.flatMap((source) =>
  revalidatePathCalls(source)
    // 구체 id 하나를 가리키는 템플릿(`/ip/${id}`·`/shop/${goodId}`)은 목록이 아니라 그 한 건의 갱신이라 대상이 아니다.
    .filter(({ path, literal }) => (literal ? PARTIAL_PATH.test(path) : /^[`'"]?\/(?:shop|ip)\/?[`'"]?$|\/\[/.test(path)))
    .map(({ fn, line }) => ({ key: `${source.path}:${fn ?? '<최상위>'}`, line })));

describe('어드민 UUID 판정 계약', () => {
  it('어드민 소스 전수를 스캔한다', () => {
    expect(all.length).toBeGreaterThan(300);
    expect(all.some(({ path }) => path === 'lib/admin/orders.ts')).toBe(true);
  });

  it('UUID 패턴 판정은 문자 클래스 표기 순서와 무관하다', () => {
    for (const pattern of [
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',
      '^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$', '^\\h{8}-\\h{4}-\\h{4}-\\h{4}-\\h{12}$',
      '^[\\da-f]{8}-[\\da-f]{4}-[\\da-f]{4}-[\\da-f]{4}-[\\da-f]{12}$', '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$', '^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$',
      '^[0-9a-f-]{36}$', '^[a-f0-9-]{36}$',
    ]) expect(isUuidPattern(pattern), pattern).toBe(true);
    for (const pattern of ['^[0-9a-f]{64}$', '^\\d{4}-\\d{2}-\\d{2}$', '^[a-z0-9-]{3,40}$']) expect(isUuidPattern(pattern), pattern).toBe(false);
  });

  it('UUID 정규식 리터럴 대신 isUuid를 쓴다', () => {
    const violations = uuidHits.filter(({ key }) => !UUID_EXEMPT[key]).map(({ key, line }) => `${key} (${line}행)`);
    expect(violations, 'UUID 형식 판정은 lib/uuid.ts의 isUuid를 쓰세요').toEqual([]);
  });

  it('예외 목록에는 이유가 있고 아직 위반하는 곳만 남는다', () => {
    const keys = new Set(uuidHits.map(({ key }) => key));
    for (const [key, reason] of Object.entries(UUID_EXEMPT)) {
      expect(reason.length, key).toBeGreaterThan(10);
      expect(keys.has(key), `${key}는 이제 UUID 리터럴이 없다 — 예외를 걷어주세요`).toBe(true);
    }
  });
});

describe('어드민 상품 노출면 재검증 계약', () => {
  it("'use server' 파일은 `/shop`·`/ip` 경로를 직접 갱신하지 않고 revalidateGoodsSurfaces를 쓴다", () => {
    const violations = partialHits.filter(({ key }) => !REVALIDATION_EXEMPT[key]).map(({ key, line }) => `${key} (${line}행)`);
    expect(violations, "`/shop`·`/ip`(상세·레이아웃 포함)를 직접 갱신하지 말고 revalidateGoodsSurfaces()를 부르세요").toEqual([]);
  });

  it('예외 목록에는 이유가 있고 아직 위반하는 곳만 남는다', () => {
    const keys = new Set(partialHits.map(({ key }) => key));
    for (const [key, reason] of Object.entries(REVALIDATION_EXEMPT)) {
      expect(reason.length, key).toBeGreaterThan(10);
      expect(keys.has(key), `${key}는 이제 부분 목록이 없다 — 예외를 걷어주세요`).toBe(true);
    }
  });
});
