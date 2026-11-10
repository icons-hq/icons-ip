/*
 * 서버 렌더 HTML 안에서만 실행되는 인라인 스크립트(Next 16 가이드 'Preventing Flash Before Hydration').
 * 하드 로드에서는 HTML 파싱 중 동기 실행돼 첫 페인트 전에 DOM을 고친다. 클라이언트 렌더에서는 type을
 * text/plain으로 바꿔 실행하지 않는다(React는 클라이언트가 만든 script를 실행하지 않고, 실행 가능한 script를
 * 렌더하면 개발 경고를 낸다). 서버·클라이언트의 type 차이는 suppressHydrationWarning이 받아 준다.
 * html은 데이터를 끼워 넣지 않은 고정 소스여야 한다 — 운영 입력이 스크립트를 닫지 못하게.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      dangerouslySetInnerHTML={{ __html: html }}
      suppressHydrationWarning
      type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
    />
  );
}
