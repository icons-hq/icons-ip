/* ICONS — mock data (ported from the design prototype's data.js) */

import { RARITY_META } from './rarity';

export type { Rarity, RarityKey } from './rarity';

import type { RarityKey } from './rarity';

export type Stock = 'low' | 'ok' | 'soldout';

export interface Vertical {
  key: string;
  label: string;
  color: string;
}
export interface Ip {
  id: string;
  title: string;
  sub: string;
  v: Vertical;
  glyph: string;
  bg: string;
  fans: number;
  goods: number;
  cards: number;
  featured: boolean;
  tagline: string;
  synopsis: string;
}
export interface Good {
  id: string;
  name: string;
  ip: string;
  type: string;
  price: number;
  badge: string | null;
  stock: Stock;
  stockQty: number;
  img: string;
}
export interface Card {
  id: string;
  ip: string;
  name: string;
  no: string;
  rarity: RarityKey;
  owned: boolean;
  bg: string;
}
/* 웹 참여형 게임 카탈로그 — card variant 실배선은 play_game(#64). */
export type GameVariant =
  | { kind: 'card'; rarityLineup: RarityKey[] } // 구슬 = 등급 확률 극장, 보상 = 무상 카드
  | { kind: 'goods'; goodsIds: string[] }; // retired mock label 목록 — 실물 경품·구매권 경로 아님

export interface Game {
  id: string;
  type: 'marble_roulette';
  title: string;
  ip: string | null; // 카드 보상 풀 스코프(card variant) — goods variant는 크로스오버라 null
  event: string | null; // popup_id 대용(연결 이벤트)
  config: {
    marbleCount: number;
    variant: GameVariant;
  };
}

export interface FandomEvent {
  id: string;
  title: string;
  ip: string | null;
  mode: string;
  status: string;
  date: string;
  loc: string;
  accent: string;
  img: string;
}
export interface Post {
  id: string;
  user: string;
  ipName: string;
  avatar: string;
  text: string;
  likes: number;
  comments: number;
  time: string;
  tag: string;
  img: string | null;
}
export interface Exchange {
  id: string;
  kind: '직거래' | '경매';
  card: string;
  rarity: RarityKey;
  want?: string;
  bid?: number;
  bids?: number;
  endsIn?: string;
  user: string;
  bg: string;
  fee: number;
}
export interface MarketItem {
  id: string;
  name: string;
  ip: string;
  type: string;
  price: number;
  cond: string;
  seller: string;
  verified: boolean;
  bg: string;
}

/* vertical accent map */
const V: Record<string, Vertical> = {
  character: { key: 'character', label: '캐릭터 IP', color: '#FFD84D' },
  game: { key: 'game', label: '게임', color: '#38F0C0' },
  anime: { key: 'anime', label: '애니메이션', color: '#A981FF' },
};

/* poster gradient by 3 spectrum stops */
export const grad = (a: string, b: string, c: string) =>
  `linear-gradient(150deg, ${a}, ${b} 55%, ${c})`;

const imageBg = (src: string, fallback: string) =>
  `url("${src}") center / cover no-repeat, ${fallback}`;

const IPS: Ip[] = [
  { id: 'rilakkuma', title: '리락쿠마', sub: 'San-X · 캐릭터 IP', v: V.character, glyph: '리락\n쿠마', bg: imageBg('/generated/ip/rilakkuma.png', grad('#5a3517', '#D68A2D', '#FFD84D')), fans: 124500, goods: 2, cards: 2, featured: true,
    tagline: '느긋한 하루를 수집하는 시간', synopsis: '리락쿠마의 포근한 방을 ICONS 굿즈, 카드, 팝업으로 재구성한 라이선스 mock 컬렉션입니다.' },
  { id: 'maplestory', title: '메이플스토리', sub: 'NEXON · 게임', v: V.game, glyph: 'MAPLE', bg: imageBg('/generated/ip/maplestory.png', grad('#0d5e66', '#38F0C0', '#FFD84D')), fans: 198000, goods: 3, cards: 3, featured: true,
    tagline: '몬스터즈가 굿즈로 튀어나오는 순간', synopsis: '주황버섯, 슬라임, 핑크빈을 중심으로 한 메이플스토리 몬스터 굿즈와 카드 라인업입니다.' },
  { id: 'nongdamgom', title: '담곰이', sub: '캐릭터 IP', v: V.character, glyph: '담곰이', bg: imageBg('/generated/ip/nongdamgom.png', grad('#70485a', '#F7A8C7', '#FFF3D6')), fans: 52300, goods: 2, cards: 2, featured: true,
    tagline: '말랑한 농담처럼 가벼운 굿즈', synopsis: '담곰이와 오리친구의 단순하고 귀여운 결을 데스크 굿즈, 쿠션, 카드로 풀어낸 컬렉션입니다.' },
  { id: 'kakao-friends', title: '카카오프렌즈', sub: 'Kakao · 캐릭터 IP', v: V.character, glyph: 'KAKAO', bg: imageBg('/generated/ip/kakao-friends.png', grad('#66421d', '#FFD84D', '#FF9AAF')), fans: 214000, goods: 2, cards: 3, featured: true,
    tagline: '친구들과 떠나는 피크닉 컬렉션', synopsis: '라이언, 춘식이, 어피치 등 카카오프렌즈 감성의 피크닉 굿즈와 소품 mock 라인입니다.' },
  { id: 'attack-on-titan', title: '진격의 거인', sub: '리바이 에디션 · 애니메이션', v: V.anime, glyph: 'LEVI', bg: imageBg('/generated/ip/attack-on-titan.png', grad('#2b251f', '#6B705C', '#A981FF')), fans: 176400, goods: 1, cards: 2, featured: true,
    tagline: '리바이 에디션으로 완성하는 전시형 컬렉션', synopsis: '진격의 거인 리바이의 차분한 전투 전야 무드를 아크릴과 카드로 구성한 mock 컬렉션입니다.' },
  { id: 'hong-sil-quest', title: '홍실 퀘스트', sub: 'SOOP2RANG · 캐릭터 IP', v: V.character, glyph: '홍실\n퀘스트', bg: imageBg('/generated/ip/hong-sil-quest.webp', grad('#300008', '#9C001D', '#FF2E63')), fans: 0, goods: 3, cards: 0, featured: false,
    tagline: '붉은 실을 따라 시작되는 특별한 퀘스트', synopsis: '홍실 퀘스트의 현대·전생·스페셜 라운드를 실제 팝업 굿즈로 잇는 공식 IP 컬렉션입니다.' },
];

const ipById = (id: string | null | undefined) => IPS.find((i) => i.id === id);

const GOODS_TYPES = ['봉제인형', '쿠션', '키링', '아크릴 키링', '아크릴 블록', '아크릴 스탠드', '문구', '파우치', '인형', '한정 세트'];

const GOODS: Good[] = [
  { id: 'g1', name: '리락쿠마 낮잠 쿠션', ip: 'rilakkuma', type: '쿠션', price: 42000, badge: '한정', stock: 'low', stockQty: 7, img: imageBg('/generated/goods/g1.png', grad('#5a3517', '#D68A2D', '#FFD84D')) },
  { id: 'g2', name: '코리락쿠마 미니 키링', ip: 'rilakkuma', type: '키링', price: 15000, badge: '신상', stock: 'ok', stockQty: 120, img: imageBg('/generated/goods/g2.png', grad('#7d4a2a', '#F3B6C8', '#FFF3D6')) },
  { id: 'g3', name: '주황버섯 봉제인형', ip: 'maplestory', type: '봉제인형', price: 28000, badge: '신상', stock: 'ok', stockQty: 90, img: imageBg('/generated/goods/g3.png', grad('#98440f', '#FF8C32', '#FFD84D')) },
  { id: 'g4', name: '메이플 몬스터 키링 4종', ip: 'maplestory', type: '키링', price: 18000, badge: '한정', stock: 'low', stockQty: 12, img: imageBg('/generated/goods/g4.png', grad('#0d5e66', '#38F0C0', '#8B5CFF')) },
  { id: 'g5', name: '핑크빈 아크릴 디오라마', ip: 'maplestory', type: '아크릴 스탠드', price: 33000, badge: '예약', stock: 'ok', stockQty: 80, img: imageBg('/generated/goods/g5.png', grad('#6b2a5b', '#F7A8C7', '#A981FF')) },
  { id: 'g6', name: '담곰이 오리친구 데스크 매트', ip: 'nongdamgom', type: '문구', price: 22000, badge: '신상', stock: 'ok', stockQty: 110, img: imageBg('/generated/goods/g6.png', grad('#70485a', '#F7A8C7', '#FFF3D6')) },
  { id: 'g7', name: '담곰이 말랑 쿠션', ip: 'nongdamgom', type: '쿠션', price: 36000, badge: null, stock: 'ok', stockQty: 60, img: imageBg('/generated/goods/g7.png', grad('#51343f', '#F7A8C7', '#FFD84D')) },
  { id: 'g8', name: '춘식이 수면 파우치', ip: 'kakao-friends', type: '파우치', price: 24000, badge: '신상', stock: 'ok', stockQty: 100, img: imageBg('/generated/goods/g8.png', grad('#66421d', '#FFD84D', '#FFF3D6')) },
  { id: 'g9', name: '라이언&어피치 피크닉 세트', ip: 'kakao-friends', type: '한정 세트', price: 59000, badge: '한정', stock: 'low', stockQty: 8, img: imageBg('/generated/goods/g9.png', grad('#724a1f', '#FFD84D', '#FF9AAF')) },
  { id: 'g11', name: '리바이 아크릴 스탠드', ip: 'attack-on-titan', type: '아크릴 스탠드', price: 26000, badge: '예약', stock: 'ok', stockQty: 70, img: imageBg('/generated/goods/g11.png', grad('#2b251f', '#6B705C', '#A981FF')) },
  { id: 'g13', name: '아크릴 블록', ip: 'hong-sil-quest', type: '아크릴 블록', price: 12000, badge: '신상', stock: 'soldout', stockQty: 0, img: imageBg('/generated/goods/g13.webp', grad('#300008', '#9C001D', '#FF2E63')) },
  { id: 'g14', name: '오로라 아크릴 키링', ip: 'hong-sil-quest', type: '아크릴 키링', price: 9000, badge: '신상', stock: 'soldout', stockQty: 0, img: imageBg('/generated/goods/g14.webp', grad('#300008', '#9C001D', '#FF2E63')) },
  { id: 'g15', name: '마그넷 인형 세트', ip: 'hong-sil-quest', type: '인형', price: 27000, badge: '신상', stock: 'soldout', stockQty: 0, img: imageBg('/generated/goods/g15.webp', grad('#300008', '#9C001D', '#FF2E63')) },
];

const RARITY = RARITY_META;

const CARDS: Card[] = [
  { id: 'c1', ip: 'rilakkuma', name: '리락쿠마 · 낮잠 시간', no: '001/080', rarity: 'HOLO', owned: true, bg: imageBg('/generated/cards/c1.png', grad('#5a3517', '#D68A2D', '#FFD84D')) },
  { id: 'c2', ip: 'rilakkuma', name: '코리락쿠마 · 딸기 우유', no: '014/080', rarity: 'SR', owned: true, bg: imageBg('/generated/cards/c2.png', grad('#7d4a2a', '#F3B6C8', '#FFF3D6')) },
  { id: 'c3', ip: 'maplestory', name: '주황버섯 · 점프!', no: '003/120', rarity: 'SSR', owned: true, bg: imageBg('/generated/cards/c3.png', grad('#98440f', '#FF8C32', '#FFD84D')) },
  { id: 'c4', ip: 'maplestory', name: '슬라임 · 말랑 에너지', no: '018/120', rarity: 'R', owned: true, bg: imageBg('/generated/cards/c4.png', grad('#0d5e66', '#38F0C0', '#2DE2FF')) },
  { id: 'c5', ip: 'maplestory', name: '핑크빈 · 스테이지', no: '041/120', rarity: 'HOLO', owned: false, bg: imageBg('/generated/cards/c5.png', grad('#6b2a5b', '#F7A8C7', '#A981FF')) },
  { id: 'c6', ip: 'nongdamgom', name: '담곰이 · 오리친구', no: '009/060', rarity: 'SSR', owned: true, bg: imageBg('/generated/cards/c6.png', grad('#70485a', '#F7A8C7', '#FFF3D6')) },
  { id: 'c7', ip: 'nongdamgom', name: '담곰이 · 산책', no: '027/060', rarity: 'R', owned: true, bg: imageBg('/generated/cards/c7.png', grad('#51343f', '#F7A8C7', '#FFD84D')) },
  { id: 'c8', ip: 'kakao-friends', name: '라이언 · 피크닉', no: '012/100', rarity: 'SSR', owned: false, bg: imageBg('/generated/cards/c8.png', grad('#66421d', '#FFD84D', '#FFF3D6')) },
  { id: 'c9', ip: 'kakao-friends', name: '춘식이 · 낮잠', no: '033/100', rarity: 'HOLO', owned: false, bg: imageBg('/generated/cards/c9.png', grad('#724a1f', '#FFD84D', '#FF9AAF')) },
  { id: 'c10', ip: 'kakao-friends', name: '어피치 · 스윗팝', no: '054/100', rarity: 'SR', owned: false, bg: imageBg('/generated/cards/c10.png', grad('#7d344d', '#FF9AAF', '#FFD84D')) },
  { id: 'c11', ip: 'attack-on-titan', name: '리바이 · 결전 전야', no: '001/070', rarity: 'HOLO', owned: true, bg: imageBg('/generated/cards/c11.png', grad('#2b251f', '#6B705C', '#A981FF')) },
  { id: 'c12', ip: 'attack-on-titan', name: '리바이 · 조사병단', no: '017/070', rarity: 'SSR', owned: false, bg: imageBg('/generated/cards/c12.png', grad('#201c18', '#4C5A3F', '#A981FF')) },
];

const GAMES: Game[] = [
  {
    id: 'marble-maple',
    type: 'marble_roulette',
    title: '메이플 마블 룰렛',
    ip: 'maplestory',
    event: 'e2',
    config: {
      marbleCount: 10,
      variant: {
        kind: 'card',
        // 풀(maplestory CARDS)에 실존하는 등급만, mock 가중치 비례로 — 공시=추첨 일치(Gacha poolRates와 같은 규율)
        rarityLineup: ['R', 'R', 'R', 'R', 'R', 'R', 'R', 'SSR', 'SSR', 'HOLO'],
      },
    },
  },
  {
    id: 'goods-marble',
    type: 'marble_roulette',
    title: '굿즈 마블 룰렛',
    ip: null, // 5개 IP 크로스오버
    event: null,
    config: {
      marbleCount: 9,
      variant: {
        kind: 'goods',
        // 구슬 1:1 — 활성 mock 굿즈 9종
        goodsIds: ['g1', 'g2', 'g3', 'g5', 'g6', 'g7', 'g8', 'g9', 'g11'],
      },
    },
  },
];

const EVENTS: FandomEvent[] = [
  { id: 'e1', title: '리락쿠마 포근한 방 팝업스토어', ip: 'rilakkuma', mode: '오프라인', status: '진행중', date: '7.01 - 7.21', loc: '성수 ICONS 스튜디오', accent: '#FFD84D', img: imageBg('/generated/events/e1.png', grad('#5a3517', '#D68A2D', '#FFD84D')) },
  { id: 'e2', title: '메이플스토리 몬스터즈 온라인 팝업', ip: 'maplestory', mode: '온라인', status: '예매중', date: '7.12 20:00', loc: 'ICONS Live', accent: '#38F0C0', img: imageBg('/generated/events/e2.png', grad('#0d5e66', '#38F0C0', '#FFD84D')) },
  { id: 'e3', title: '담곰이 드로잉 굿즈 팝업', ip: 'nongdamgom', mode: '오프라인', status: '예정', date: '7.19 - 8.02', loc: '홍대 ICONS 팝업', accent: '#F7A8C7', img: imageBg('/generated/events/e3.png', grad('#70485a', '#F7A8C7', '#FFF3D6')) },
  { id: 'e4', title: '카카오프렌즈 피크닉 팝업', ip: 'kakao-friends', mode: '오프라인', status: '예매중', date: '7.26 - 8.11', loc: '여의도 ICONS 팝업', accent: '#FFD84D', img: imageBg('/generated/events/e4.png', grad('#66421d', '#FFD84D', '#FF9AAF')) },
  { id: 'e5', title: '진격의 거인 리바이 에디션 온라인 팝업', ip: 'attack-on-titan', mode: '온라인', status: '예정', date: '8.08 21:00', loc: 'ICONS Live', accent: '#A981FF', img: imageBg('/generated/events/e5.png', grad('#2b251f', '#6B705C', '#A981FF')) },
];

const POSTS: Post[] = [
  { id: 'p1', user: 'relax_room', ipName: '리락쿠마', avatar: '#FFD84D', text: '리락쿠마 낮잠 쿠션 실물감 너무 좋아요. 포근한 방 팝업에서 바로 안고 나왔습니다', likes: 342, comments: 48, time: '12분 전', tag: '팝업인증', img: imageBg('/generated/events/e1.png', grad('#5a3517', '#D68A2D', '#FFD84D')) },
  { id: 'p2', user: 'mushroom_jump', ipName: '메이플스토리', avatar: '#38F0C0', text: '주황버섯 봉제인형이랑 몬스터 키링 4종 같이 샀습니다. 핑크빈 디오라마 예약도 열렸네요', likes: 218, comments: 33, time: '41분 전', tag: '한정굿즈', img: null },
  { id: 'p3', user: 'gom_duck', ipName: '담곰이', avatar: '#F7A8C7', text: '담곰이 오리친구 카드 SSR 떴어요. 데스크 매트랑 같이 놓으니까 귀여움이 딱 맞습니다', likes: 503, comments: 91, time: '1시간 전', tag: '카드자랑', img: imageBg('/generated/cards/c6.png', grad('#70485a', '#F7A8C7', '#FFF3D6')) },
  { id: 'p4', user: 'picnic_friends', ipName: '카카오프렌즈', avatar: '#FFD84D', text: '피크닉 세트 구성 좋네요. 라이언이랑 어피치 소품을 같이 진열하기 좋습니다', likes: 189, comments: 27, time: '2시간 전', tag: '굿즈인증', img: imageBg('/generated/goods/g9.png', grad('#66421d', '#FFD84D', '#FF9AAF')) },
  { id: 'p5', user: 'levi_display', ipName: '진격의 거인', avatar: '#A981FF', text: '리바이 아크릴 스탠드 예약했습니다. 카드 배경이 차분해서 같이 전시하기 좋겠어요', likes: 421, comments: 57, time: '34분 전', tag: '예약인증', img: imageBg('/generated/goods/g11.png', grad('#2b251f', '#6B705C', '#A981FF')) },
  { id: 'p6', user: 'pinkbean_stage', ipName: '메이플스토리', avatar: '#38F0C0', text: '핑크빈 스테이지 HOLO 아직 못 얻었습니다. 주황버섯 점프 카드랑 교환 가능하신 분 찾습니다', likes: 287, comments: 39, time: '1시간 전', tag: '카드교환', img: null },
];

const EXCHANGES: Exchange[] = [
  { id: 'x1', kind: '직거래', card: '핑크빈 · 스테이지', rarity: 'HOLO', want: '주황버섯 SSR 또는 제안', user: 'pinkbean_stage', bg: imageBg('/generated/cards/c5.png', grad('#6b2a5b', '#F7A8C7', '#A981FF')), fee: 50 },
  { id: 'x2', kind: '경매', card: '리바이 · 조사병단', rarity: 'SSR', bid: 1200, bids: 14, endsIn: '03:21:40', user: 'survey_buyer', bg: imageBg('/generated/cards/c12.png', grad('#201c18', '#4C5A3F', '#A981FF')), fee: 50 },
  { id: 'x3', kind: '직거래', card: '리락쿠마 · 낮잠 시간', rarity: 'HOLO', want: '코리락쿠마 SR', user: 'relax_trade', bg: imageBg('/generated/cards/c1.png', grad('#5a3517', '#D68A2D', '#FFD84D')), fee: 50 },
  { id: 'x4', kind: '경매', card: '라이언 · 피크닉', rarity: 'SSR', bid: 430, bids: 6, endsIn: '11:48:02', user: 'picnic_pull', bg: imageBg('/generated/cards/c8.png', grad('#66421d', '#FFD84D', '#FFF3D6')), fee: 50 },
  { id: 'x5', kind: '직거래', card: '담곰이 · 산책', rarity: 'R', want: '담곰이 오리친구 또는 제안', user: 'gom_walk', bg: imageBg('/generated/cards/c7.png', grad('#51343f', '#F7A8C7', '#FFD84D')), fee: 50 },
  { id: 'x6', kind: '경매', card: '슬라임 · 말랑 에너지', rarity: 'R', bid: 260, bids: 9, endsIn: '06:02:55', user: 'slime_energy', bg: imageBg('/generated/cards/c4.png', grad('#0d5e66', '#38F0C0', '#2DE2FF')), fee: 50 },
];

const MARKET: MarketItem[] = [
  { id: 'm1', name: '리락쿠마 낮잠 쿠션 (미개봉)', ip: 'rilakkuma', type: '쿠션', price: 39000, cond: '미개봉', seller: 'relax_seller', verified: true, bg: imageBg('/generated/goods/g1.png', grad('#5a3517', '#D68A2D', '#FFD84D')) },
  { id: 'm2', name: '메이플 몬스터 키링 4종 풀세트', ip: 'maplestory', type: '키링', price: 24000, cond: 'A급', seller: 'maple_shop', verified: true, bg: imageBg('/generated/goods/g4.png', grad('#0d5e66', '#38F0C0', '#8B5CFF')) },
  { id: 'm3', name: '담곰이 말랑 쿠션', ip: 'nongdamgom', type: '쿠션', price: 30000, cond: '개봉/전시', seller: 'gom_store', verified: true, bg: imageBg('/generated/goods/g7.png', grad('#51343f', '#F7A8C7', '#FFD84D')) },
  { id: 'm4', name: '춘식이 수면 파우치', ip: 'kakao-friends', type: '파우치', price: 18000, cond: '미사용', seller: 'choonsik_fan', verified: false, bg: imageBg('/generated/goods/g8.png', grad('#66421d', '#FFD84D', '#FFF3D6')) },
  { id: 'm5', name: '리바이 아크릴 스탠드 예약권', ip: 'attack-on-titan', type: '아크릴 스탠드', price: 31000, cond: '예약권', seller: 'levi_case', verified: true, bg: imageBg('/generated/goods/g11.png', grad('#2b251f', '#6B705C', '#A981FF')) },
  { id: 'm6', name: '카카오프렌즈 피크닉 세트 일부 구성', ip: 'kakao-friends', type: '한정 세트', price: 48000, cond: 'B급', seller: 'picnic_box', verified: true, bg: imageBg('/generated/goods/g9.png', grad('#66421d', '#FFD84D', '#FF9AAF')) },
];

const TRENDING = ['#리락쿠마', '#메이플스토리', '#담곰이', '#카카오프렌즈', '#리바이', '#팝업인증', '#한정굿즈', '#카드교환', '#피크닉세트', '#낮잠쿠션'];

const STATS = { fans: '76.5만', ips: 6, goods: '13', events: 5 };

export const DATA = {
  V,
  IPS,
  ipById,
  GOODS,
  GOODS_TYPES,
  RARITY,
  CARDS,
  GAMES,
  EVENTS,
  POSTS,
  EXCHANGES,
  MARKET,
  TRENDING,
  STATS,
};
