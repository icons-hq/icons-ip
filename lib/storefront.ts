/*
 * 스토어프론트 읽기 계약의 상수 (규모 ⑤).
 *
 * 서버 모듈과 나눠 둔 이유: 어드민 액션은 저장 뒤 **태그만** 무효화하면 되는데, 태그를 얻자고
 * `storefront.server` 를 import 하면 `server-only`·`unstable_cache` 까지 딸려 온다.
 */

/** 굿즈 집계(개수·facet·가격 상한) 캐시 태그. 굿즈·진열이 바뀌면 무효화한다. */
export const STOREFRONT_GOODS_CACHE_TAG = 'catalog:goods';
/** IP 목록 캐시 태그. */
export const STOREFRONT_IPS_CACHE_TAG = 'catalog:ips';

/** 첫 화면에 담아 보내는 줄 수. 「더 보기」 한 번(20)의 세 배 = 대개 첫 스크롤에서 안 끊긴다. */
export const STOREFRONT_PAGE_SIZE = 60;
