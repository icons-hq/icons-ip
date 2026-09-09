/* 세컨더리 마켓(굿즈 마켓·카드 트레이드) 스태프 전용 시연 스위치와 mock 매물.
 *
 * 마켓·트레이드는 v2 범위다(PRD §2 · CONTEXT.md). 공개 표면(`/market`·`/exchange`)은 v2까지
 * 플레이스홀더를 유지하고, 같은 라우트가 로그인한 staff/admin에게만 이 mock 시연 화면을
 * 렌더한다 — 외부 발표에서 C2C 구상을 시연하기 위한 표면이지 실거래 배선이 아니다.
 * 결제·에스크로·입찰·체결은 전부 화면 로컬 상태에서 끝나고 서버·DB·PG를 건드리지 않는다.
 *
 * 되돌리기는 이 상수 한 줄이다 — `false` 면 서버 게이트·푸터 진입점이 함께 닫히고 공개
 * 플레이스홀더만 남는다. 매물 데이터는 옛 프로토타입(94df3ab 이전 lib/data.ts)의 mock 을
 * 현재 IP·이미지 자산에 맞춰 되살린 것이다. */

import { grad } from './data';
import type { RarityKey } from './rarity';

export const SECONDARY_MARKET_DEMO_ENABLED = true;

/* lib/data.ts 의 비공개 헬퍼와 같은 모양 — 시연 데이터가 카탈로그 mock 에 기대지 않도록 사본을 둔다. */
const imageBg = (src: string, fallback: string) =>
  `url("${src}") center / cover no-repeat, ${fallback}`;

/* 시연용 예시 수수료율. 실제 수수료·정산 정책은 마켓 정식 오픈 시 확정된다 — 화면은 반드시 "예시"로 표기한다. */
export const MARKET_FEE_RATE = 0.05;

/* 경매 입찰 단위(원). 다음 입찰 하한은 현재가 + 이 값이다. */
export const BID_STEP = 500;

export type ListingCondition = '미개봉' | '미사용' | 'A급' | 'B급' | '개봉/전시';

export interface MarketListing {
  id: string;
  name: string;
  ip: string;
  type: string;
  price: number;
  cond: ListingCondition;
  seller: string;
  /** 검수센터 통과 여부. false 는 "검수 대기" — 신규 등록 매물이 여기서 시작한다. */
  verified: boolean;
  bg: string;
}

export const MARKET_LISTINGS: MarketListing[] = [
  { id: 'm1', name: '리락쿠마 낮잠 쿠션 (미개봉)', ip: 'rilakkuma', type: '쿠션', price: 39000, cond: '미개봉', seller: 'relax_seller', verified: true, bg: imageBg('/generated/goods/g1.png', grad('#5a3517', '#D68A2D', '#FFD84D')) },
  { id: 'm2', name: '메이플 몬스터 키링 4종 풀세트', ip: 'maplestory', type: '키링', price: 24000, cond: 'A급', seller: 'maple_shop', verified: true, bg: imageBg('/generated/goods/g4.png', grad('#0d5e66', '#38F0C0', '#8B5CFF')) },
  { id: 'm3', name: '담곰이 말랑 쿠션', ip: 'nongdamgom', type: '쿠션', price: 30000, cond: '개봉/전시', seller: 'gom_store', verified: true, bg: imageBg('/generated/goods/g7.png', grad('#51343f', '#F7A8C7', '#FFD84D')) },
  { id: 'm4', name: '춘식이 수면 파우치', ip: 'kakao-friends', type: '파우치', price: 18000, cond: '미사용', seller: 'choonsik_fan', verified: false, bg: imageBg('/generated/goods/g8.png', grad('#66421d', '#FFD84D', '#FFF3D6')) },
  { id: 'm5', name: '리바이 아크릴 스탠드', ip: 'attack-on-titan', type: '아크릴 스탠드', price: 31000, cond: '개봉/전시', seller: 'levi_case', verified: true, bg: imageBg('/generated/goods/g11.png', grad('#2b251f', '#6B705C', '#A981FF')) },
  { id: 'm6', name: '카카오프렌즈 피크닉 세트 일부 구성', ip: 'kakao-friends', type: '한정 세트', price: 48000, cond: 'B급', seller: 'picnic_box', verified: true, bg: imageBg('/generated/goods/g9.png', grad('#66421d', '#FFD84D', '#FF9AAF')) },
];

/* 안전 거래 프로세스 — 시연 화면 하단 안내와 구매 다이얼로그 타임라인이 같은 순서를 공유한다. */
export const ESCROW_STEPS = [
  { no: '01', title: '검수센터 입고', desc: '판매 굿즈는 ICONS 검수센터로 먼저 보내요. 가품·상태를 확인해요.' },
  { no: '02', title: '에스크로 결제', desc: '구매 대금은 에스크로에 보관되고, 검수 통과 후 배송돼요.' },
  { no: '03', title: '확정 후 정산', desc: '구매자가 수령을 확정하면 판매자에게 정산돼요.' },
] as const;

export type TradeKind = '직거래' | '경매';

interface TradeBase {
  id: string;
  card: string;
  ip: string;
  rarity: RarityKey;
  user: string;
  bg: string;
}

export interface DirectTrade extends TradeBase {
  kind: '직거래';
  /** 판매자가 원하는 카드·조건. */
  want: string;
}

export interface AuctionTrade extends TradeBase {
  kind: '경매';
  /** 현재가(원). */
  bid: number;
  bids: number;
  /** 마감까지 남은 초. 화면이 1초 단위로 깎아 내려간다. */
  endsInSec: number;
}

export type TradeListing = DirectTrade | AuctionTrade;

export const TRADE_LISTINGS: TradeListing[] = [
  { id: 'x1', kind: '직거래', card: '핑크빈 · 스테이지', ip: 'maplestory', rarity: 'HOLO', want: '주황버섯 SSR 또는 제안', user: 'pinkbean_stage', bg: imageBg('/generated/cards/c5.png', grad('#6b2a5b', '#F7A8C7', '#A981FF')) },
  { id: 'x2', kind: '경매', card: '리바이 · 조사병단', ip: 'attack-on-titan', rarity: 'SSR', bid: 12000, bids: 14, endsInSec: 3 * 3600 + 21 * 60 + 40, user: 'survey_buyer', bg: imageBg('/generated/cards/c12.png', grad('#201c18', '#4C5A3F', '#A981FF')) },
  { id: 'x3', kind: '직거래', card: '리락쿠마 · 낮잠 시간', ip: 'rilakkuma', rarity: 'HOLO', want: '코리락쿠마 SR', user: 'relax_trade', bg: imageBg('/generated/cards/c1.png', grad('#5a3517', '#D68A2D', '#FFD84D')) },
  { id: 'x4', kind: '경매', card: '라이언 · 피크닉', ip: 'kakao-friends', rarity: 'SSR', bid: 4300, bids: 6, endsInSec: 11 * 3600 + 48 * 60 + 2, user: 'picnic_pull', bg: imageBg('/generated/cards/c8.png', grad('#66421d', '#FFD84D', '#FFF3D6')) },
  { id: 'x5', kind: '직거래', card: '담곰이 · 산책', ip: 'nongdamgom', rarity: 'R', want: '담곰이 오리친구 또는 제안', user: 'gom_walk', bg: imageBg('/generated/cards/c7.png', grad('#51343f', '#F7A8C7', '#FFD84D')) },
  { id: 'x6', kind: '경매', card: '슬라임 · 말랑 에너지', ip: 'maplestory', rarity: 'R', bid: 2600, bids: 9, endsInSec: 6 * 3600 + 2 * 60 + 55, user: 'slime_energy', bg: imageBg('/generated/cards/c4.png', grad('#0d5e66', '#38F0C0', '#2DE2FF')) },
];

/** 다음 입찰 하한 — 현재가에 입찰 단위를 더한다. */
export const minNextBid = (current: number) => current + BID_STEP;

/** 남은 초를 `HH:MM:SS` 로. 마감이 지나면 00:00:00 에서 멈춘다. */
export function formatCountdown(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/** 판매자 정산 예정액(예시 수수료 차감, 원 단위 내림). */
export const sellerPayout = (price: number) => Math.floor(price * (1 - MARKET_FEE_RATE));
