import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CHANGELOG = 'lib/admin/guide/changes.ts';

function isAdminSurface(file) {
  if (/\.(test|spec)\.[^/]+$/.test(file) || !/\.tsx?$/.test(file)) return false;
  if (file.startsWith('lib/admin/guide/') || /\/AdminGuide[^/]*$/.test(file)
    || /^app\/admin\/\(shell\)\/guide\//.test(file)) return false;
  return file.startsWith('components/admin/')
    || /^app\/admin\/(?:.*\/)?(page|layout|loading|error|not-found)\.tsx$/.test(file)
    || /^lib\/admin\/(navigation|sections)\.ts$/.test(file);
}

export function checkAdminGuideChangelog({ files, body = '' }) {
  const surfaces = files.filter(isAdminSurface);
  if (!surfaces.length) return { ok: true, message: '어드민 화면 변경이 없습니다.' };
  if (files.includes(CHANGELOG)) return { ok: true, message: '어드민 변경 로그가 함께 변경되었습니다.' };
  const reason = body.match(/^guide-changelog: skip[ \t]+—[ \t]*(\S[^\r\n]*)$/m)?.[1]?.trim();
  if (reason) return { ok: true, message: `변경 로그 생략 사유: ${reason}` };
  return {
    ok: false,
    message: `어드민 화면 변경은 ${CHANGELOG}에 운영자 안내를 함께 기록해야 합니다. 순수 버그 수정은 PR 본문에 "guide-changelog: skip — <사유>"를 별도 줄로 적으세요. 대상: ${surfaces.join(', ')}`,
  };
}

function main() {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return;
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const { base, head, body } = event.pull_request;
  if (![base.sha, head.sha].every((sha) => /^[a-f0-9]{40}$/.test(sha))) {
    throw new Error('PR 비교에 필요한 base/head SHA가 올바르지 않습니다.');
  }
  const files = execFileSync('git', [
    'diff', '--name-only', '--no-renames', '-z', `${base.sha}...${head.sha}`, '--',
  ], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const result = checkAdminGuideChangelog({ files, body: body ?? '' });
  console.log(result.message);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
