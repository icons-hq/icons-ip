import type { Good, Ip } from './data';
import type { GoodsNoticeInfo } from './goods-notice';

/*
 * 굿즈 상세페이지가 그리는 값 묶음 (#173).
 *
 * lib/catalog.ts 는 server-only 라서 타입을 여기 둔다. 어드민 미리보기(#184)는
 * 저장 전 입력값으로 같은 모양을 클라이언트에서 조립해 같은 화면을 그린다.
 */
export interface GoodDetailContent {
  good: Good;
  ip: Ip | null;
  description: string | null;
  /** 대표 이미지와 같은 CSS background 규약. 배열 순서가 곧 노출 순서다. */
  gallery: string[];
  /** 긴 세로 이미지는 크롭하지 않고 <img> 로 그린다. */
  detailImageUrl: string | null;
  notice: GoodsNoticeInfo;
}
