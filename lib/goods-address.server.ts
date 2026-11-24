import 'server-only';

import { resolveCatalogSource } from '@/lib/catalog-source';
import { goodPublicSegment } from '@/lib/goods-display';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

/**
 * 공개 상품 주소(ADR-0050) 해석. 상세 라우트 `/shop/[goodId]`의 끝 값을 내부 id와 정식 주소 끝 값으로 바꾼다.
 * - 상품 자동코드(대소문자 무시)로 찾으면 그 상품이다. 정식 끝 값은 코드의 소문자형이다.
 * - 옛 주소(내부 id)로 찾아도 같은 상품이고, 끝 값이 정식과 다르므로 상세가 정식 주소로 영구 이동시킨다.
 * - 공개 상품(19금은 19금 판매 표면이 켜졌을 때)만 답한다 — 이름·이미지는 읽지 않는다. 볼 수 있는지는 상세 로더가 다시 판정한다.
 */
export interface PublicGoodAddress {
  /** 내부 식별자(goods.id). 상세 로더·리뷰·Q&A·찜은 계속 이 값으로 읽고 쓴다. */
  goodId: string;
  /** 정식 주소 끝 값(`goodPublicSegment`). 요청한 끝 값과 다르면 상세가 이 주소로 옮긴다. */
  segment: string;
}

/** 내부 id·상품 자동코드의 길이 상한(goods.id 200자, goods.code 100자)보다 긴 값은 묻지 않는다. */
const MAX_SEGMENT_LENGTH = 200;

interface GoodsAddressRow {
  id: unknown;
  code: unknown;
}

/**
 * 화면 주소에서 읽은 굿즈 대상(분석·회원 활동 기록)을 내부 id로 바꾼다. 기록·리포트·마케팅 링크 대조는 내부 id 기준이다.
 * 풀지 못하면(없는 값·조회 실패) 받은 값 그대로 — 받는 쪽 DB가 지금처럼 판정한다.
 */
export async function internalGoodTarget(value: string): Promise<string> {
  return (await resolvePublicGoodAddress(value).catch(() => null))?.goodId ?? value;
}

export async function resolvePublicGoodAddress(value: string): Promise<PublicGoodAddress | null> {
  if (!value || value.length > MAX_SEGMENT_LENGTH) return null;
  /* 목업 카탈로그에는 상품 자동코드가 없다 — 끝 값을 그대로 내부 id로 넘기고 상세 로더가 없는 상품을 404로 보낸다.
     판정은 상세 로더(lib/catalog getCatalogSource)와 같다. */
  if (resolveCatalogSource({ isSupabaseConfigured: getSupabaseConfig().isConfigured }) !== 'supabase') return { goodId: value, segment: value };

  const supabase = await createClient({ storefrontReadCache: true });
  const { data, error } = await supabase.rpc('resolve_public_goods_address', { p_value: value });
  if (error) throw new Error(`Failed to resolve goods address: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : null) as GoodsAddressRow | null | undefined;
  if (!row || typeof row.id !== 'string' || !row.id) return null;
  return { goodId: row.id, segment: goodPublicSegment({ id: row.id, code: typeof row.code === 'string' ? row.code : null }) };
}
