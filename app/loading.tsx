/* 데스크톱 그리드 4열 기준 두 줄 분량이라, 로딩이 끝나도 레이아웃이 크게 튀지 않는다. */
const SKELETON_CARDS = [0, 1, 2, 3, 4, 5, 6, 7];

/* wc-root 래퍼는 White Catalog 토큰을 전역(:root)으로 승격하기 전까지 스코프를 이 표면 안에 가둔다. */
export default function Loading() {
  return (
    <div className="wc-root" aria-busy="true">
      <div className="wc-container wc-loading">
        <p className="wc-sr-only">불러오는 중</p>
        <div className="wc-skeleton wc-loading__heading" />
        <div className="wc-loading__grid">
          {SKELETON_CARDS.map((index) => (
            <div key={index}>
              <div className="wc-skeleton wc-loading__media" />
              <div className="wc-skeleton wc-loading__line" />
              <div className="wc-skeleton wc-loading__line" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
