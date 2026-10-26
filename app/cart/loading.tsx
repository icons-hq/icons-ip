import { CartSubheader } from '@/components/cart/CartSubheader';

/*
 * 장바구니 라우트 로딩 경계(L9 QA — CT-03 첫 페인트). 루트 경계(app/loading.tsx)의 굿즈 그리드 스켈레톤 대신
 * 카트 첫 렌더(아직 카트를 읽기 전 '불러오는 중')와 같은 지면을 그린다 — 모바일은 첫 페인트부터 서브헤더 크롬이라
 * 전역 헤더가 잠깐 보였다 사라지지 않고(wc-catalog.css :has 규칙), 불러오는 중 블록이 빈 상태와 같은 높이를 잡아
 * 푸터가 첫 화면에 올라오지 않는다. 본문이 오면 같은 자리의 같은 블록으로 바뀐다(Cart.test 가 두 마크업을 맞춘다).
 */
export default function Loading() {
  return (
    <div aria-busy="true" className="wc-root wc-cart">
      <CartSubheader />
      <div className="wc-container">
        <h1 className="wc-cart__title">장바구니</h1>
        <p aria-live="polite" className="wc-cart__loading" role="status">장바구니를 불러오는 중이에요.</p>
      </div>
    </div>
  );
}
