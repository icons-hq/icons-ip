import {
  LAST_BELL_PRODUCT_CATALOG,
  type LastBellCollectibleKey,
} from './last-bell-products';

export const AOUAD_POPUP_PATH = '/games/prototype-last-bell/popup';

export const AOUAD_ZONE_IDS = [
  'classroom',
  'cafeteria',
  'broadcast',
  'theater',
  'store',
  'rooftop',
] as const;

export type AouadZoneId = (typeof AOUAD_ZONE_IDS)[number];
export type AouadRallyZoneId = Exclude<AouadZoneId, 'store'>;

export const AOUAD_RALLY_ZONE_IDS = [
  'classroom',
  'cafeteria',
  'broadcast',
  'theater',
  'rooftop',
] as const satisfies readonly AouadRallyZoneId[];

export function isAouadZoneId(value: string): value is AouadZoneId {
  return (AOUAD_ZONE_IDS as readonly string[]).includes(value);
}

export const AOUAD_IMAGES = {
  hero: '/generated/aouad-campaign/generated/hero-school-night.webp',
  classroom: '/generated/aouad-campaign/official/still-classroom-outbreak.jpg',
  cafeteria: '/generated/aouad-campaign/official/still-zombie-rush.jpg',
  broadcast: '/generated/aouad-campaign/generated/sol/reunion-radio-room-opening.webp',
  theater: '/generated/aouad-campaign/official/poster-duo-dark.jpg',
  store: '/generated/aouad-campaign/official/still-barricade.jpg',
  rooftop: '/generated/aouad-campaign/generated/sol/rooftop-survival-record.webp',
  record: '/generated/aouad-campaign/generated/sol/rooftop-survival-record.webp',
} as const;

export const AOUAD_ZONES: Record<AouadZoneId, {
  id: AouadZoneId;
  name: string;
  subtitle: string;
  image: string;
  tone: 'warm' | 'cool' | 'ember';
}> = {
  classroom: {
    id: 'classroom',
    name: '교실',
    subtitle: '그날의 책상에 남은 기록',
    image: AOUAD_IMAGES.classroom,
    tone: 'warm',
  },
  cafeteria: {
    id: 'cafeteria',
    name: '급식실',
    subtitle: '소리 없이 건너가기',
    image: AOUAD_IMAGES.cafeteria,
    tone: 'warm',
  },
  broadcast: {
    id: 'broadcast',
    name: '방송실',
    subtitle: '끊긴 신호를 다시 잇기',
    image: AOUAD_IMAGES.broadcast,
    tone: 'cool',
  },
  theater: {
    id: 'theater',
    name: 'IF 극장',
    subtitle: '그날, 다른 선택의 끝',
    image: AOUAD_IMAGES.theater,
    tone: 'ember',
  },
  store: {
    id: 'store',
    name: '매점 — 보급소',
    subtitle: '굿즈 진열 미리보기',
    image: AOUAD_IMAGES.store,
    tone: 'warm',
  },
  rooftop: {
    id: 'rooftop',
    name: '옥상',
    subtitle: '개인 수색을 마치는 곳',
    image: AOUAD_IMAGES.rooftop,
    tone: 'ember',
  },
};

export const AOUAD_DESK_RECORDS = [
  { id: 'radio', place: '창가 둘째 줄', item: '낡은 무전기', note: '채널이 맞춰져 있다. 호출 부호는 「다방」.' },
  { id: 'journal', place: '반장의 자리', item: '학급 일지', note: '마지막 장에 친구들의 이름이 남아 있다.' },
  { id: 'coupon', place: '복도 쪽 셋째 줄', item: '치킨집 쿠폰 묶음', note: '도장이 아홉 개. 하나만 더 모으면 됐다.' },
  { id: 'laces', place: '뒷줄 구석', item: '다 쓴 운동화 끈', note: '몇 번이고 다시 묶은 매듭 자국.' },
  { id: 'notice', place: '교실 게시판', item: '기말고사 시간표', note: '그날 아침까지 가장 큰 걱정이었다.' },
] as const;

export const AOUAD_IF_ENDINGS = [
  { id: 'signal', name: '옥상의 신호', description: '하늘에 닿은 짧은 응답.' },
  { id: 'voice', name: '살아 있는 방송', description: '목소리가 목소리를 살렸다.' },
  { id: 'dawn', name: '고요한 새벽', description: '버티는 것도 용기였다.' },
] as const;

export type AouadIfEndingId = (typeof AOUAD_IF_ENDINGS)[number]['id'];

export const AOUAD_STORE_PREVIEW = LAST_BELL_PRODUCT_CATALOG.map((item) => ({
  ...item,
  id: item.key,
  image: item.thumbnailPath,
})) satisfies readonly (typeof LAST_BELL_PRODUCT_CATALOG[number] & {
  id: LastBellCollectibleKey;
  image: string;
})[];

export type AouadStorePreviewId = (typeof AOUAD_STORE_PREVIEW)[number]['id'];

export const AOUAD_AVATAR_IDS = ['navy', 'plum', 'sage', 'umber', 'rose', 'slate'] as const;
export type AouadAvatarId = (typeof AOUAD_AVATAR_IDS)[number];

export const AOUAD_AVATAR_COLORS: Record<AouadAvatarId, readonly [string, string]> = {
  navy: ['#1e2937', '#9fb9d8'],
  plum: ['#33263b', '#c5a4d7'],
  sage: ['#29392f', '#9dcaa1'],
  umber: ['#3c3025', '#d6ae82'],
  rose: ['#3b292a', '#d69a9a'],
  slate: ['#2a3035', '#b8c0c9'],
};
