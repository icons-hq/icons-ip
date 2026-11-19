// 운영 배포 직후 익명 HTTP 스모크(OPS-060). Node 내장 모듈과 repo 안 .mjs만 쓴다 — deploy job은 npm ci를 하지 않는다.
// Next 16은 notFound()·redirect()도 200 본문으로 내려가므로(soft 404) 상태 코드만 믿지 않고 본문 표지를 함께 본다.
// 새 배포가 전파되는 동안의 일시 실패를 견디도록 경로마다 재시도한다. 모든 경로가 통과해야 종료 코드 0이다.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CANONICAL_SITE_ORIGIN } from '../lib/site-domains.mjs';

const SOFT_404_MARKERS = ['페이지를 찾을 수 없습니다', 'NEXT_HTTP_ERROR_FALLBACK;404', 'NEXT_NOT_FOUND'];
const ERROR_MARKERS = ['Application error: a server-side exception', 'NEXT_REDIRECT'];

/** 확인할 경로. html은 앱 셸이 렌더된 응답, health는 /api/health의 JSON이다. */
export const SMOKE_TARGETS = Object.freeze([
  { path: '/', kind: 'html', mustContain: [] },
  { path: '/shop', kind: 'html', mustContain: [] },
  { path: '/login', kind: 'html', mustContain: [] },
  { path: '/api/health', kind: 'health' },
]);

/** 본문 검사. 통과하면 null, 아니면 사람이 읽을 사유. */
export function inspectResponse(target, status, contentType, body) {
  if (status !== 200) return `HTTP ${status}`;
  if (target.kind === 'health') {
    let parsed;
    try { parsed = JSON.parse(body); } catch { return 'health 응답이 JSON이 아님'; }
    return parsed?.ok === true && parsed?.database === 'ok' ? null : 'health ok가 아님';
  }
  if (!/text\/html/i.test(contentType ?? '')) return `HTML이 아님(${contentType ?? '없음'})`;
  if (!/<html[^>]*\blang=/i.test(body)) return '앱 셸(<html lang>)이 없음';
  const soft = SOFT_404_MARKERS.find((marker) => body.includes(marker));
  if (soft) return `soft 404 표지 발견(${soft})`;
  const failed = ERROR_MARKERS.find((marker) => body.includes(marker));
  if (failed) return `오류 표지 발견(${failed})`;
  const missing = (target.mustContain ?? []).find((text) => !body.includes(text));
  return missing ? `기대 문구 없음(${missing})` : null;
}

export async function runSmoke({
  origin = CANONICAL_SITE_ORIGIN,
  targets = SMOKE_TARGETS,
  attempts = 5,
  delayMs = 10_000,
  timeoutMs = 20_000,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
} = {}) {
  const results = [];
  for (const target of targets) {
    const url = new URL(target.path, origin).toString();
    let reason = 'no attempt';
    let ok = false;
    for (let attempt = 1; attempt <= attempts && !ok; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          redirect: 'follow',
          cache: 'no-store',
          headers: { 'user-agent': 'iconsip-post-deploy-smoke/1' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        reason = inspectResponse(target, response.status, response.headers.get('content-type'), await response.text());
      } catch (error) {
        reason = `요청 실패(${error?.name ?? 'Error'})`;
      }
      ok = reason === null;
      if (!ok && attempt < attempts) {
        log(`retry ${attempt}/${attempts} ${target.path}: ${reason}`);
        await sleep(delayMs);
      }
    }
    results.push({ path: target.path, ok, reason });
    log(`${ok ? 'PASS' : 'FAIL'} ${target.path}${ok ? '' : `: ${reason}`}`);
  }
  return { ok: results.every((result) => result.ok), results };
}

export function summaryMarkdown(origin, { results }) {
  return [
    `### Post-deploy smoke (${origin})`,
    '',
    ...results.map((result) => `- ${result.ok ? 'PASS' : 'FAIL'} \`${result.path}\`${result.ok ? '' : ` — ${result.reason}`}`),
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const origin = process.env.SMOKE_ORIGIN || CANONICAL_SITE_ORIGIN;
  const outcome = await runSmoke({ origin });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(origin, outcome));
  if (!outcome.ok) {
    console.error(`::error title=Post-deploy smoke failed::${outcome.results.filter((r) => !r.ok).map((r) => r.path).join(', ')} — 배포는 이미 올라갔다. 운영 화면을 확인하고 필요하면 이전 배포로 되돌린다.`);
    process.exit(1);
  }
}
