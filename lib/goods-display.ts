
/* 굿즈 표시 파생. lib/ip-display.ts와 같은 자리의 module이다. */

/**
 * 공개 상품 주소(ADR-0050)를 만드는 데 필요한 값. `id`는 내부 식별자(goods.id — PK·외래키, 바뀌지 않는다),
 * `code`는 상품 자동코드(goods.code, ADR-0048)다. 코드가 없으면(목업·옛 투영·가림 카드) 내부 id 주소를 쓰고,
 * 상세 라우트가 정식 코드 주소로 옮긴다.
 */
export interface GoodAddressRef {
  id: string;
  code?: string | null;
}

/*
 * 주소 끝에 그대로 쓸 수 있는 상품 자동코드. 자동 생성 코드(`HSQ-0059`)와 창고 품번·바코드 꼴은 모두 맞는다.
 * 직접 바꾸기로 공백·한글·기호가 든 코드는 주소로 쓰지 않고 내부 id 주소에 머문다(퍼센트 인코딩·대소문자 변환이 어긋날 수 있다).
 * DB 제약(goods_code_format)과 같은 길이 상한(100자)이다.
 */
const GOOD_PUBLIC_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,99}$/;

/** `/shop` 아래 정적 경로(NEW·BEST 목록). 이 값과 같은 코드는 상세 주소로 쓰지 않는다. */
export const RESERVED_SHOP_SEGMENTS: ReadonlySet<string> = new Set(['new', 'best']);

/**
 * 상품 자동코드의 주소 끝 값(소문자형). 주소로 쓸 수 없는 코드면 null이다.
 * 저장 규칙(`upper(btrim(code))`)과 같게 정규화하므로 편집 중인 소문자·공백 섞인 값도 저장 뒤 주소와 같다.
 */
export function goodCodeSegment(code: string | null | undefined): string | null {
  const normalized = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!normalized || !GOOD_PUBLIC_CODE_PATTERN.test(normalized)) return null;
  const segment = normalized.toLowerCase();
  return RESERVED_SHOP_SEGMENTS.has(segment) ? null : segment;
}

/** 상세 주소 끝 값(정식). 상품 자동코드의 소문자형이 기본이고, 주소로 쓸 수 없는 코드면 내부 id다. */
export function goodPublicSegment(good: GoodAddressRef): string {
  return goodCodeSegment(good.code) ?? good.id;
}

/**
 * 굿즈 상세페이지 경로 (#173 · ADR-0050). 굿즈(또는 id·코드)를 받으면 정식 코드 주소를 만든다.
 * 내부 id 문자열만 있는 호출부(알림·메일·저장된 링크처럼 코드를 모르는 곳)는 `/shop/<id>`가 되고, 상세가 코드 주소로 영구 이동시킨다.
 */
export function goodDetailHref(good: GoodAddressRef | string): string {
  return `/shop/${encodeURIComponent(typeof good === 'string' ? good : goodPublicSegment(good))}`;
}

/** 저장된 내부 링크 `/shop/<값>[?…][#…]`의 끝 값과 뒤쪽(쿼리·해시). 목록 경로(`/shop`·NEW·BEST)는 아니다. */
export function parseGoodDetailLink(href: string): { segment: string; suffix: string } | null {
  const match = /^\/shop\/([^/?#]+)([?#].*)?$/.exec(href);
  if (!match) return null;
  let segment: string;
  try { segment = decodeURIComponent(match[1]); } catch { return null; }
  return RESERVED_SHOP_SEGMENTS.has(segment) ? null : { segment, suffix: match[2] ?? '' };
}

/**
 * 운영자가 저장한 `/shop/<내부 id>` 링크(홈 배너·전시 링크 등)를 이미 읽은 공개 굿즈의 정식 코드 주소로 바꾼다.
 * 모르는 값(코드 주소·공개가 아닌 상품·목록 경로)은 그대로 둔다 — 상세가 다시 판정한다.
 */
export function canonicalGoodLinks(hrefs: readonly string[], goods: readonly GoodAddressRef[]): Map<string, string> {
  const byId = new Map(goods.map(good => [good.id, good]));
  return new Map(hrefs.flatMap(href => {
    const link = parseGoodDetailLink(href);
    const good = link ? byId.get(link.segment) : undefined;
    return link && good ? [[href, goodDetailHref(good) + link.suffix] as const] : [];
  }));
}
