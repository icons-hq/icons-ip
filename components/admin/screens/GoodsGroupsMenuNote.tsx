/** 그룹상품은 메뉴에서 숨긴 화면이라(회의 결정) 왼쪽 메뉴 줄이 이 화면을 여는 동안에만 보인다 — 왜 다른 화면에는 없는지, 어떻게 다시 오는지 말한다. */
export function GoodsGroupsMenuNote({ className = '' }: { className?: string }) {
  return <p className={`text-xs text-muted-foreground ${className}`} data-goods-groups="menu-note">그룹상품 메뉴는 이 화면을 여는 동안에만 왼쪽에 보입니다. 다시 올 때는 이 주소를 즐겨찾기해 두세요.</p>;
}
