// 운영 배포 직후 익명 HTTP 스모크(OPS-060). Node 내장 모듈과 repo 안 .mjs만 쓴다 — deploy job은 npm ci를 하지 않는다.
// Next 16은 notFound()·redirect()도 200 본문으로 내려가므로(soft 404) 상태 코드만 믿지 않고 본문 표지를 함께 본다.
// 새 배포가 전파되는 동안의 일시 실패를 견디도록 경로마다 재시도한다. 모든 경로가 통과해야 종료 코드 0이다.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CANONICAL_SITE_ORIGIN } from '../lib/site-domains.mjs';

// 문구 표지는 <script>를 걷어낸 본문에서만 찾는다. 정상 페이지도 RSC 페이로드(self.__next_f.push)에 404 화면의 문구를 실어 보낸다(운영 실측).
const SOFT_404_TEXT_MARKERS = ['페이지를 찾을 수 없습니다'];
const SOFT_404_RAW_MARKERS = ['NEXT_HTTP_ERROR_FALLBACK;404', 'NEXT_NOT_FOUND'];
const ERROR_MARKERS = ['Application error: a server-side exception', 'NEXT_REDIRECT'];

/** 확인할 경로. html은 앱 셸이 렌더된 응답, health는 /api/health의 JSON이다. */
export const SMOKE_TARGETS = Object.freeze([
  { path: '/', kind: 'html', mustContain: [] },
  { path: '/shop', kind: 'html', mustContain: [] },
  { path: '/login', kind: 'html', mustContain: [] },
  { path: '/api/health', kind: 'health' },
]);

export function stripScripts(body) {
  return body.replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

/** 본문 검사. 통과하면 null, 아니면 사람이 읽을 사유. expectedDeploymentId가 있으면 health의 배포 id와 맞춰 본다. */
export function inspectResponse(target, status, contentType, body, expectedDeploymentId = null) {
  if (status !== 200) return `HTTP ${status}`;
  if (target.kind === 'health') {
    let parsed;
    try { parsed = JSON.parse(body); } catch { return 'health 응답이 JSON이 아님'; }
    if (parsed?.ok !== true || parsed?.database !== 'ok') return 'health ok가 아님';
    // 롤백 등으로 새 배포가 도메인에 붙지 않았으면 다른 배포가 200을 돌려준다. 비교할 값이 없으면 경고만(아래 runSmoke).
    if (expectedDeploymentId && parsed.deploymentId && parsed.deploymentId !== expectedDeploymentId) {
      return `다른 배포가 응답함(기대 ${expectedDeploymentId}, 실제 ${parsed.deploymentId})`;
    }
    return null;
  }
  if (!/text\/html/i.test(contentType ?? '')) return `HTML이 아님(${contentType ?? '없음'})`;
  if (!/<html[^>]*\blang=/i.test(body)) return '앱 셸(<html lang>)이 없음';
  const visible = stripScripts(body);
  const soft = SOFT_404_TEXT_MARKERS.find((marker) => visible.includes(marker)) ?? SOFT_404_RAW_MARKERS.find((marker) => body.includes(marker));
  if (soft) return `soft 404 표지 발견(${soft})`;
  const failed = ERROR_MARKERS.find((marker) => body.includes(marker));
  if (failed) return `오류 표지 발견(${failed})`;
  const missing = (target.mustContain ?? []).find((text) => !body.includes(text));
  return missing ? `기대 문구 없음(${missing})` : null;
}

export async function runSmoke({
  origin = CANONICAL_SITE_ORIGIN,
  targets = SMOKE_TARGETS,
  expectedDeploymentId = null,
  attempts = 5,
  delayMs = 10_000,
  timeoutMs = 10_000,
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
        reason = inspectResponse(target, response.status, response.headers.get('content-type'), await response.text(), expectedDeploymentId);
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

/**
 * 방금 배포한 배포의 id(dpl_…)를 Vercel API로 찾는다. 배포 URL·토큰이 없거나 조회가 안 되면 null — 비교를 건너뛰고 경고만 남긴다.
 * (/api/health는 런타임 시스템 변수 VERCEL_DEPLOYMENT_ID를 돌려준다.)
 */
export async function resolveDeploymentId({ deploymentUrl, token, teamId, fetchImpl = fetch, log = console.log }) {
  if (!deploymentUrl || !token) { log('::warning title=Deployment id check skipped::배포 URL 또는 토큰이 없어 배포 id 비교를 건너뜁니다.'); return null; }
  try {
    const host = new URL(deploymentUrl.trim()).host;
    const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    const response = await fetchImpl(`https://api.vercel.com/v13/deployments/${encodeURIComponent(host)}${query}`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
    });
    const body = response.ok ? await response.json() : null;
    if (typeof body?.id === 'string' && body.id.startsWith('dpl_')) return body.id;
  } catch { /* 아래 경고 */ }
  log('::warning title=Deployment id check skipped::배포 id를 조회하지 못해 비교를 건너뜁니다.');
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const origin = process.env.SMOKE_ORIGIN || CANONICAL_SITE_ORIGIN;
  const expectedDeploymentId = await resolveDeploymentId({
    deploymentUrl: process.env.DEPLOYMENT_URL, token: process.env.VERCEL_TOKEN, teamId: process.env.VERCEL_ORG_ID,
  });
  const outcome = await runSmoke({ origin, expectedDeploymentId });
  if (outcome.ok && expectedDeploymentId) console.log(`배포 id 일치: ${expectedDeploymentId}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(origin, outcome));
  if (!outcome.ok) {
    console.error(`::error title=Post-deploy smoke failed::${outcome.results.filter((r) => !r.ok).map((r) => r.path).join(', ')} — 배포는 이미 올라갔다. 운영 화면을 확인하고 필요하면 이전 배포로 되돌린다.`);
    process.exit(1);
  }
}
