/*
 * 메일 발신자 표시 이름(받은편지함의 보낸 사람). 서비스 이름은 제품 상수라 코드가 정하고, env(EMAIL_FROM·RESEND_FROM)는
 * 환경마다 다른 보내는 주소만 정한다 — env에 예전 표시 이름(예: `ICONS <no-reply@…>`)이 남아 있어도 주소만 쓴다.
 *
 * 영문 'X SQUARE'인 이유(2026-11-24 사용자 결정): Resend 공식 문서가 비ASCII 표시 이름의 처리(인코딩)를 밝히지 않아
 * 한글 이름은 받은편지함에서 깨질 위험이 있다. 로고·카카오 알림톡([X SQUARE])·문자 인증 서비스 이름과도 같다.
 * Supabase Auth 메일의 발신자 이름(smtp_sender_name)도 배포 때 같은 값으로 맞춘다(pipeline.yml SMTP_SENDER_NAME).
 */
export const EMAIL_SENDER_NAME = 'X SQUARE';

const BRACKETED = /<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/;
const BARE = /^[^<>\s"]+@[^<>\s"]+$/;

/** env의 발신자 값에서 주소만 꺼내 서비스 표시 이름을 붙인다. 주소를 찾지 못하면 받은 값을 그대로 돌려준다(설정 오류를 숨기지 않는다). */
export function brandedSender(from: string): string {
  const value = from.trim();
  const address = value.match(BRACKETED)?.[1] ?? (BARE.test(value) ? value : null);
  return address ? `${EMAIL_SENDER_NAME} <${address}>` : value;
}
