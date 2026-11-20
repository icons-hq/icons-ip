/**
 * 스토리 슬롯과 정적 원화의 단일 연결점.
 * 서사/판정 데이터는 파일 경로를 모르고, 화면만 이 매니페스트를 사용한다.
 *
 * v2 원화는 원작 기반 캐릭터 시트와 8라운드 개편 시나리오를 기준으로 전량
 * 재제작했다. 구 4막 원화는 롤백·비교를 위해 디스크에 남기되 런타임에서 참조하지 않는다.
 */
export const ART_ASSET_URLS = {
  /* ── 라운드 배경 ───────────────────────────────────────────────────── */
  'r1-bg': '/generated/hong-sil-vn-v2/scenes/r1-bg.webp',
  'r2-bg': '/generated/hong-sil-vn-v2/scenes/r2-bg.webp',
  'r3-bg': '/generated/hong-sil-vn-v2/scenes/r3-bg.webp',
  'r4-bg': '/generated/hong-sil-vn-v2/scenes/r4-bg.webp',
  'r5-bg': '/generated/hong-sil-vn-v2/scenes/r5-bg.webp',
  'r6-bg': '/generated/hong-sil-vn-v2/scenes/r6-bg.webp',
  'r7-bg': '/generated/hong-sil-vn-v2/scenes/r7-bg.webp',
  'rf-bg': '/generated/hong-sil-vn-v2/scenes/rf-bg.webp',

  /* ── 선택지 컷 ─────────────────────────────────────────────────────── */
  'r1-c1': '/generated/hong-sil-vn-v2/choices/r1-c1.webp',
  'r1-c2': '/generated/hong-sil-vn-v2/choices/r1-c2.webp',
  'r1-c3': '/generated/hong-sil-vn-v2/choices/r1-c3.webp',
  'r2-c1': '/generated/hong-sil-vn-v2/choices/r2-c1.webp',
  'r2-c2': '/generated/hong-sil-vn-v2/choices/r2-c2.webp',
  'r2-c3': '/generated/hong-sil-vn-v2/choices/r2-c3.webp',
  'r3-c1': '/generated/hong-sil-vn-v2/choices/r3-c1.webp',
  'r3-c2': '/generated/hong-sil-vn-v2/choices/r3-c2.webp',
  'r3-c3': '/generated/hong-sil-vn-v2/choices/r3-c3.webp',
  'r4-c1': '/generated/hong-sil-vn-v2/choices/r4-c1.webp',
  'r4-c2': '/generated/hong-sil-vn-v2/choices/r4-c2.webp',
  'r4-c3': '/generated/hong-sil-vn-v2/choices/r4-c3.webp',
  'r5-c1': '/generated/hong-sil-vn-v2/choices/r5-c1.webp',
  'r5-c2': '/generated/hong-sil-vn-v2/choices/r5-c2.webp',
  'r5-c3': '/generated/hong-sil-vn-v2/choices/r5-c3.webp',
  'r6-c1': '/generated/hong-sil-vn-v2/choices/r6-c1.webp',
  'r6-c2': '/generated/hong-sil-vn-v2/choices/r6-c2.webp',
  'r6-c3': '/generated/hong-sil-vn-v2/choices/r6-c3.webp',
  'r7-c1': '/generated/hong-sil-vn-v2/choices/r7-c1.webp',
  'r7-c2': '/generated/hong-sil-vn-v2/choices/r7-c2.webp',
  'r7-c3': '/generated/hong-sil-vn-v2/choices/r7-c3.webp',
  'rf-c1': '/generated/hong-sil-vn-v2/choices/rf-c1.webp',
  'rf-c2': '/generated/hong-sil-vn-v2/choices/rf-c2.webp',
  'rf-c3': '/generated/hong-sil-vn-v2/choices/rf-c3.webp',

  /* ── 엔딩 서사 컷 ──────────────────────────────────────────────────── */
  'end-01': '/generated/hong-sil-vn-v2/endings/end-01.webp',
  'end-02': '/generated/hong-sil-vn-v2/endings/end-02.webp',
  'end-03': '/generated/hong-sil-vn-v2/endings/end-03.webp',
  'end-04': '/generated/hong-sil-vn-v2/endings/end-04.webp',
  'end-05': '/generated/hong-sil-vn-v2/endings/end-05.webp',
  'end-06': '/generated/hong-sil-vn-v2/endings/end-06.webp',
  'end-07': '/generated/hong-sil-vn-v2/endings/end-07.webp',
  'end-08': '/generated/hong-sil-vn-v2/endings/end-08.webp',
  'end-09': '/generated/hong-sil-vn-v2/endings/end-09.webp',
  'end-10': '/generated/hong-sil-vn-v2/endings/end-10.webp',
  'end-11': '/generated/hong-sil-vn-v2/endings/end-11.webp',
  'end-12': '/generated/hong-sil-vn-v2/endings/end-12.webp',
  'end-13': '/generated/hong-sil-vn-v2/endings/end-13.webp',
  'end-14': '/generated/hong-sil-vn-v2/endings/end-14.webp',
  'end-15': '/generated/hong-sil-vn-v2/endings/end-15.webp',
  'end-16': '/generated/hong-sil-vn-v2/endings/end-16.webp',
  'end-17': '/generated/hong-sil-vn-v2/endings/end-17.webp',
  'end-18': '/generated/hong-sil-vn-v2/endings/end-18.webp',
  'end-19': '/generated/hong-sil-vn-v2/endings/end-19.webp',
  'end-20': '/generated/hong-sil-vn-v2/endings/end-20.webp',
  'end-21': '/generated/hong-sil-vn-v2/endings/end-21.webp',

  /* ── 엔딩 카드 원화 ───────────────────────────────────────────────── */
  'card-01': '/generated/hong-sil-vn-v2/cards/card-01.webp',
  'card-02': '/generated/hong-sil-vn-v2/cards/card-02.webp',
  'card-03': '/generated/hong-sil-vn-v2/cards/card-03.webp',
  'card-04': '/generated/hong-sil-vn-v2/cards/card-04.webp',
  'card-05': '/generated/hong-sil-vn-v2/cards/card-05.webp',
  'card-06': '/generated/hong-sil-vn-v2/cards/card-06.webp',
  'card-07': '/generated/hong-sil-vn-v2/cards/card-07.webp',
  'card-08': '/generated/hong-sil-vn-v2/cards/card-08.webp',
  'card-09': '/generated/hong-sil-vn-v2/cards/card-09.webp',
  'card-10': '/generated/hong-sil-vn-v2/cards/card-10.webp',
  'card-11': '/generated/hong-sil-vn-v2/cards/card-11.webp',
  'card-12': '/generated/hong-sil-vn-v2/cards/card-12.webp',
  'card-13': '/generated/hong-sil-vn-v2/cards/card-13.webp',
  'card-14': '/generated/hong-sil-vn-v2/cards/card-14.webp',
  'card-15': '/generated/hong-sil-vn-v2/cards/card-15.webp',
  'card-16': '/generated/hong-sil-vn-v2/cards/card-16.webp',
  'card-17': '/generated/hong-sil-vn-v2/cards/card-17.webp',
  'card-18': '/generated/hong-sil-vn-v2/cards/card-18.webp',
  'card-19': '/generated/hong-sil-vn-v2/cards/card-19.webp',
  'card-20': '/generated/hong-sil-vn-v2/cards/card-20.webp',
  'card-21': '/generated/hong-sil-vn-v2/cards/card-21.webp',
} as const satisfies Record<string, `/${string}.webp`>;

type ArtSlot = keyof typeof ART_ASSET_URLS;

export function artAssetUrl(slot: string): string | undefined {
  return ART_ASSET_URLS[slot as ArtSlot];
}

/** 전량 재제작 및 연결 완료. 테스트가 0을 고정해 회귀를 막는다. */
export const ART_SLOTS_PENDING = 0;
