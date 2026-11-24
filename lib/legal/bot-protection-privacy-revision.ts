import revisionDates from './bot-protection-privacy-revision.json';
import { kstToday } from './privacy-address-book-revision';

/*
 * 개인정보처리방침 개정 — 가입·로그인 봇 차단(docs/runbooks/signup-contact-channels.md §13).
 *
 *  · Cloudflare Turnstile 자동 가입 방지 확인: 회원가입·로그인·가입 확인 메일 재전송·비밀번호 재설정 화면(components/auth/TurnstileField.tsx)에서
 *    Cloudflare, Inc.가 접속 IP·브라우저 정보를 처리한다 — 제5조 위탁·제6조 국외 이전에 더한다. 운영 사이트 키
 *    (NEXT_PUBLIC_TURNSTILE_SITE_KEY)는 이 개정이 시행된 배포와 함께 켠다.
 *  · 요청 남용 방지 기록(private.auth_mail_abuse_attempts — supabase/migrations/20261119106000_auth_mail_abuse_limits.sql):
 *    가입·재전송·재설정 요청의 종류·일시와 IP·이메일 HMAC 다이제스트, 2일 뒤 삭제 — 제1조·제3조에 밝힌다.
 *
 * 방침 제13조는 시행 7일 전 공지를 정하지만, 2026-11-24 운영 책임자(사용자)가 정식 오픈 전이라 실사용 회원이 없다는 이유로
 * 즉시 시행을 결정했다 — JSON의 `noticeWaiver`가 그 결정 기록이고, production 빌드 가드(scripts/check-vercel-build-env.mjs)는
 * 이 기록이 있을 때만 7일보다 짧은 공지(공지일 = 시행일 포함)를 받는다.
 * 동작은 다른 예약 개정과 같다 — 공지일부터 시행일 전까지 사전 공지, 시행일부터 이전 판 보존(documents.ts).
 *
 * 날짜는 JSON 한 곳(bot-protection-privacy-revision.json)에 둔다 — 앱과 production 빌드 가드가 같은 값을 읽는다.
 * 공지일·시행일은 이 개정이 실제로 운영에 나간 날(KST)이다.
 */
export interface BotProtectionPrivacyRevision {
  /** 사전 공지를 시작하는 날(KST `YYYY-MM-DD`) — 실제 운영 배포일. */
  announcedDate: string;
  /** 바뀐 본문이 현행이 되는 날(KST `YYYY-MM-DD`) — 공지일 + 7일 이상, 또는 noticeWaiver 기록이 있으면 공지일 이후. */
  effectiveDate: string;
}

export const BOT_PROTECTION_PRIVACY_REVISION: BotProtectionPrivacyRevision | null =
  typeof revisionDates.announcedDate === 'string' && typeof revisionDates.effectiveDate === 'string'
    ? { announcedDate: revisionDates.announcedDate, effectiveDate: revisionDates.effectiveDate }
    : null;

/** 봇 차단 개정을 사전 공지하는 중인가(공지일 0시 KST 부터 시행일 전날까지). 예약이 없으면 늘 false. */
export function botProtectionPrivacyRevisionAnnounced(
  today: string = kstToday(),
  revision: BotProtectionPrivacyRevision | null = BOT_PROTECTION_PRIVACY_REVISION,
): boolean {
  return revision !== null && today >= revision.announcedDate && today < revision.effectiveDate;
}

/** 봇 차단 개정이 시행 중인가(시행일 당일 0시 KST 부터). 예약이 없으면 늘 false. */
export function botProtectionPrivacyRevisionInEffect(
  today: string = kstToday(),
  revision: BotProtectionPrivacyRevision | null = BOT_PROTECTION_PRIVACY_REVISION,
): boolean {
  return revision !== null && today >= revision.effectiveDate;
}
