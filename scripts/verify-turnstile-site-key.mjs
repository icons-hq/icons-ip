/*
 * Supabase Auth CAPTCHA(Turnstile)를 켜거나 바꾸기 전에, 배포된 앱(Vercel production env)이 같은 사이트 키로 위젯을 그리는지 대조한다.
 *
 * 앱 위젯이 만든 토큰은 그 사이트 키의 비밀 키로만 검증된다. GitHub 변수(NEXT_PUBLIC_TURNSTILE_SITE_KEY)와 Vercel production env의 값이
 * 다르면 CAPTCHA를 켠 순간 로그인·가입·재설정(어드민 포함)이 모두 막힌다. 값은 로그에 찍지 않고 SHA-256 해시 앞 8자로만 비교·표시한다.
 *
 * 사용법: node scripts/verify-turnstile-site-key.mjs <vercel env pull 결과 파일>
 *   EXPECTED_TURNSTILE_SITE_KEY  GitHub 변수 값. 비어 있으면(키를 관리하지 않음) 아무것도 확인하지 않고 통과한다.
 * Node 내장 모듈만 쓴다(deploy-vercel job은 npm 설치 없이 이 스크립트를 돌린다).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const NAME = 'NEXT_PUBLIC_TURNSTILE_SITE_KEY';

export function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

/** `vercel env pull`이 쓰는 dotenv 줄(KEY="value" 또는 KEY=value)에서 값을 읽는다. */
export function readDotenvValue(source, name) {
  for (const line of source.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match || match[1] !== name) continue;
    let value = match[2].trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    return value.trim();
  }
  return '';
}

/** 통과하면 { ok: true, managed }, 아니면 { ok: false, reason }. 값 자체는 결과에 넣지 않는다. */
export function checkTurnstileSiteKey({ expected, actual }) {
  const want = (expected ?? '').trim();
  if (!want) return { ok: true, managed: false };
  const have = (actual ?? '').trim();
  if (!have) {
    return { ok: false, reason: `Vercel production has no ${NAME}, but the GitHub variable is set (${fingerprint(want)}). Enabling Auth CAPTCHA now would block every sign-in.` };
  }
  if (have !== want) {
    return { ok: false, reason: `Vercel production ${NAME} (${fingerprint(have)}) differs from the GitHub variable (${fingerprint(want)}). Enabling Auth CAPTCHA now would block every sign-in.` };
  }
  return { ok: true, managed: true, fingerprint: fingerprint(want) };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error('::error title=Turnstile site key check::usage: verify-turnstile-site-key.mjs <env file>');
    process.exit(1);
  }
  const result = checkTurnstileSiteKey({
    expected: process.env.EXPECTED_TURNSTILE_SITE_KEY,
    actual: readDotenvValue(readFileSync(file, 'utf8'), NAME),
  });
  if (!result.ok) {
    console.error(`::error title=Turnstile site key mismatch::${result.reason}`);
    process.exit(1);
  }
  console.log(result.managed
    ? `Turnstile site key matches the deployed app (${result.fingerprint}).`
    : 'No Turnstile site key managed by GitHub; Auth CAPTCHA is left untouched.');
}
