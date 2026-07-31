export type RarityKey = 'N' | 'R' | 'SR' | 'SSR' | 'HOLO';

export interface Rarity {
  label: string;
  color: string;
  foil: boolean;
}

export const RARITY_META: Record<RarityKey, Rarity> = {
  N: { label: 'N', color: '#7E7AA0', foil: false },
  R: { label: 'R', color: '#2DE2FF', foil: false },
  SR: { label: 'SR', color: '#8B5CFF', foil: false },
  SSR: { label: 'SSR', color: '#FF4D9D', foil: true },
  HOLO: { label: 'HOLO', color: '#C6FF3D', foil: true },
};

/** 희귀도 내림차순. 대표 카드 고르기와 등급별 정렬이 화면마다 갈리지 않게 여기서 정한다. */
export const RARITY_ORDER: readonly RarityKey[] = ['HOLO', 'SSR', 'SR', 'R', 'N'];

/* `value in RARITY_META`는 프로토타입 체인까지 훑어 'toString'·'constructor'를
   등급으로 인정한다. 그러면 RARITY_META[rarity]가 Rarity가 아닌 함수를 돌려줘
   등급 배지와 카드 렌더가 깨진다. 자체 키만 본다. */
export const isRarityKey = (value: unknown): value is RarityKey =>
  typeof value === 'string' && (RARITY_ORDER as readonly string[]).includes(value);

export interface RarityTag {
  color: string;
  bg: string;
  ring: string;
}

/* 등급 배지의 표시 파생. RARITY_META의 색은 다크 표면 전제라 배지 배경으로 쓰면
   그 위 글자 대비가 등급마다 달라진다. 그래서 배경 알파와 글자색을 여기서 함께 정한다. */
export function rarityTag(rarity: RarityKey): RarityTag {
  if (rarity === 'HOLO') return { color: '#0A0813', bg: 'var(--holo)', ring: `${RARITY_META.HOLO.color}99` };
  if (rarity === 'N') return { color: 'var(--text)', bg: 'rgba(8,6,15,.75)', ring: 'rgba(255,255,255,.18)' };
  const c = RARITY_META[rarity].color;
  const ink = rarity === 'R'; // cyan 위엔 잉크색이 읽힌다
  return { color: ink ? '#0A0813' : 'var(--text)', bg: `${c}${ink ? 'E6' : 'D9'}`, ring: `${c}73` };
}
