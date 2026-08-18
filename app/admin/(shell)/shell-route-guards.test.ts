import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SHELL_ROOT = join(process.cwd(), 'app/admin/(shell)');

function shellPageFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...shellPageFiles(full));
    } else if (entry.name === 'page.tsx') {
      found.push(full);
    }
  }
  return found;
}

const pages = shellPageFiles(SHELL_ROOT);

/*
 * 권한의 진실원은 각 page의 requireAdminScreenAccess다. layout은 pathname을
 * 몰라 로그인 next를 정확히 만들 수 없어서 미인증 처리를 page에 맡긴다.
 * 그러면 page 하나가 게이트를 빼먹는 순간 그 화면이 무방비가 되므로,
 * 셸 아래 모든 page가 게이트를 부르는지 구조로 고정한다.
 */
describe('어드민 셸 라우트 권한 게이트', () => {
  it('셸 아래에 page가 존재한다', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages.map((file) => [file.slice(file.indexOf('app/admin')), file]))(
    '%s 가 requireAdminScreenAccess를 부른다',
    (_label, file) => {
      expect(readFileSync(file, 'utf8')).toContain('requireAdminScreenAccess(');
    },
  );

  /* 게이트는 로더보다 먼저 await 돼야 한다. 순서가 뒤집히면 비스태프가
   * 로더를 실행시키는 창이 열린다 — Next.js는 layout과 page를 병렬 렌더한다. */
  it.each(pages.map((file) => [file.slice(file.indexOf('app/admin')), file]))(
    '%s 는 게이트를 첫 await로 둔다',
    (_label, file) => {
      const source = readFileSync(file, 'utf8');
      const body = source.slice(source.indexOf('export default'));
      const firstAwait = body.indexOf('await ');
      const gateAwait = body.indexOf('await requireAdminScreenAccess(');

      expect(gateAwait).toBeGreaterThan(-1);
      /* searchParams 해석은 게이트보다 앞설 수 있다 — 데이터 접근이 아니다. */
      const beforeGate = body.slice(firstAwait, gateAwait);
      expect(beforeGate).not.toMatch(/await\s+(get|load)[A-Z]/);
    },
  );
});
