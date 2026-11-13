/*
 * 전체 화면 경험(오로드 프레젠테이션·효산의 기억 플레이)은 안쪽 스크롤러·터치 조작이 휠·터치 스크롤을 가져가서
 * 마우스·터치 사용자가 페이지 아래 사업자 정보·법정 고지 푸터(SiteFooter)에 닿지 못한다(1014-X36).
 * 경험 화면 안의 '사업자 정보·약관' 링크가 이 함수로 문서를 푸터까지 내린다. 문서 스크롤은 막혀 있지 않으니
 * scrollIntoView 가 그대로 듣고, 대상은 푸터 한 곳이다. 푸터가 없으면(스크립트 전 등) 기본 해시 이동에 맡긴다.
 */
export const SITE_FOOTER_ID = 'site-footer';
export const SITE_FOOTER_HREF = `#${SITE_FOOTER_ID}`;

export function jumpToSiteFooter(event: { preventDefault(): void }): void {
  const footer = document.getElementById(SITE_FOOTER_ID);
  if (!footer) return;
  event.preventDefault();
  footer.scrollIntoView({ block: 'start' });
  footer.focus({ preventScroll: true });
}
