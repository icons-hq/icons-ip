import { describe, expect, it } from 'vitest';
import { isServerActionSource, scanSources } from './contract-scan';

/*
 * 어드민 식별자·재검증 계약(TKT-061·062). UUID 형식 판정은 `lib/uuid.ts`의 `isUuid` 하나이고, 상품 노출면 재검증은
 * `revalidateGoodsSurfaces()` 하나다. 파일마다 정규식 리터럴이나 부분 재검증 목록을 다시 쓰면 판정이 갈라지고
 * 노출면 한 곳이 갱신에서 빠진다. 예외는 이유 상수로 적고, 더는 위반하지 않는 예외는 걷게 한다.
 */

const all = scanSources(['app/admin', 'app/api/admin', 'lib/admin']);
const serverFiles = all.filter(({ text }) => isServerActionSource(text));

/** 36자 UUID 형식 정규식 리터럴(전체 형태·느슨한 형태 모두). */
const UUID_LITERAL = /\[0-9a-f\]\{8\}-|\[0-9a-f-\]\{36\}/;
const UUID_EXEMPT: Record<string, string> = {
  'app/admin/erp-item-actions.ts': '행 키는 `<uuid>:price|barcode` 합성 형식이라 UUID 판정이 아니라 키 파서다.',
  'app/admin/category-display-actions.ts': 'Storage 경로(public-media/catalog/curation/<uuid>.<ext>) 규칙이다. v4 고정·확장자까지 한 번에 검사한다.',
  'lib/admin/artwork.ts': '업로드 경로 규칙이다. 경로를 만드는 nonce와 경로 파서가 같은 v4 패턴을 써야 해서 isUuid로 느슨하게 만들 수 없다.',
  'lib/admin/curations.ts': 'Storage 경로(public-media/catalog/curation/<uuid>.<ext>) 규칙이다. v4 고정·확장자까지 한 번에 검사한다.',
  'lib/admin/goods-drafts.ts': 'Storage 경로(public-media/catalog/good/<uuid>.<ext>) 규칙이다. v4 고정·확장자까지 한 번에 검사한다.',
  'lib/admin/marketing-messages.ts': 'Storage 경로(public-media/catalog/curation/<uuid>.<ext>) 규칙이다. v4 고정·확장자까지 한 번에 검사한다.',
};

/** 상품 노출면 재검증의 부분 목록: 상품 상세 동적 라우트와 `/shop`·`/ip` 레이아웃을 직접 갱신하는 호출. */
const PARTIAL_REVALIDATION = /revalidatePath\(\s*'\/shop\/\[goodId\]'|revalidatePath\(\s*'\/(?:shop|ip)'\s*,\s*'layout'/;
const REVALIDATION_EXEMPT: Record<string, string> = {
  'app/admin/qna-actions.ts': '문의 답변은 상품 상세의 문의 영역만 바꾼다. 홈·목록·장바구니는 갱신할 내용이 없다.',
  'app/admin/review-actions.ts': '리뷰 게시·답변은 상품 상세의 리뷰 영역(과 홈 리뷰 띠)만 바꾼다.',
  'app/admin/review-best-actions.ts': '베스트 리뷰 설정은 상품 상세의 리뷰 영역만 바꾼다.',
  'app/admin/review-event-actions.ts': '리뷰 적립 이벤트는 상품 상세의 리뷰 안내와 적립금 화면만 바꾼다.',
  'app/admin/customer-reward-actions.ts': '리뷰 적립 처리는 상품 상세의 리뷰 영역과 적립금 화면만 바꾼다.',
  'app/admin/cs-draft-actions.ts': 'CS 답변 초안 저장은 상품 상세의 문의·리뷰 영역만 바꾼다.',
};

const violatesUuid = (text: string) => UUID_LITERAL.test(text);
const violatesRevalidation = (text: string) => PARTIAL_REVALIDATION.test(text);

describe('어드민 UUID 판정 계약', () => {
  it('어드민 소스 전수를 스캔한다', () => {
    expect(all.length).toBeGreaterThan(300);
    expect(all.some(({ path }) => path === 'lib/admin/orders.ts')).toBe(true);
  });

  it('UUID 정규식 리터럴 대신 isUuid를 쓴다', () => {
    const violations = all.filter(({ path, text }) => violatesUuid(text) && !UUID_EXEMPT[path]).map(({ path }) => path);
    expect(violations, 'UUID 형식 판정은 lib/uuid.ts의 isUuid를 쓰세요').toEqual([]);
  });

  it('예외 목록에는 이유가 있고 아직 위반하는 파일만 남는다', () => {
    for (const [path, reason] of Object.entries(UUID_EXEMPT)) {
      const file = all.find((entry) => entry.path === path);
      expect(reason.length, path).toBeGreaterThan(10);
      expect(file, `${path}를 찾을 수 없다`).toBeDefined();
      expect(violatesUuid(file!.text), `${path}는 이제 UUID 리터럴이 없다 — 예외를 걷어주세요`).toBe(true);
    }
  });
});

describe('어드민 상품 노출면 재검증 계약', () => {
  it("'use server' 파일은 상품 노출면 부분 목록 대신 revalidateGoodsSurfaces를 쓴다", () => {
    const violations = serverFiles.filter(({ path, text }) => violatesRevalidation(text) && !REVALIDATION_EXEMPT[path]).map(({ path }) => path);
    expect(violations, "상품 상세·'/shop'·'/ip' 레이아웃을 직접 갱신하지 말고 revalidateGoodsSurfaces()를 부르세요").toEqual([]);
  });

  it('예외 목록에는 이유가 있고 아직 위반하는 파일만 남는다', () => {
    for (const [path, reason] of Object.entries(REVALIDATION_EXEMPT)) {
      const file = serverFiles.find((entry) => entry.path === path);
      expect(reason.length, path).toBeGreaterThan(10);
      expect(file, `${path}는 'use server' 파일이 아니다`).toBeDefined();
      expect(violatesRevalidation(file!.text), `${path}는 이제 부분 목록이 없다 — 예외를 걷어주세요`).toBe(true);
    }
  });
});
