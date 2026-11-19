import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CRON_JOBS, PG_CRON_JOB_LABELS, systemJobLabel } from './cron-jobs';

const root = path.resolve(__dirname, '../..');
const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8')) as { crons: { path: string; schedule: string }[] };

/** DB private.cron_schedule_minutes와 같은 규칙(매분·N분마다·매시·매일). */
function scheduleMinutes(schedule: string): number | null {
  if (schedule === '* * * * *') return 1;
  const everyN = /^\*\/(\d+) \* \* \* \*$/.exec(schedule);
  if (everyN) return Number(everyN[1]);
  if (/^\d{1,2} \* \* \* \*$/.test(schedule)) return 60;
  if (/^\d{1,2} \d{1,2} \* \* \*$/.test(schedule)) return 1440;
  return null;
}

describe('자동 작업 목록', () => {
  it('vercel.json cron과 작업 목록이 같은 작업·주기다', () => {
    const fromVercel = Object.fromEntries(vercel.crons.map(cron => [cron.path.replace(/^\/api\/cron\//, ''), scheduleMinutes(cron.schedule)]));
    const fromRegistry = Object.fromEntries(Object.entries(CRON_JOBS).map(([key, job]) => [key, job.intervalMinutes]));
    expect(fromVercel).toEqual(fromRegistry);
    expect(vercel.crons.every(cron => cron.path.startsWith('/api/cron/'))).toBe(true);
  });

  it('cron 라우트는 모두 목록에 있고, 인증 뒤 실행 기록을 열며, 예외를 기록 없이 삼키지 않는다', () => {
    const routes = readdirSync(path.join(root, 'app/api/cron'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    expect(routes).toEqual(Object.keys(CRON_JOBS).sort());
    for (const key of routes) {
      const source = readFileSync(path.join(root, 'app/api/cron', key, 'route.ts'), 'utf8');
      expect(source, key).toContain(`startCronRun('${key}')`);
      expect(source.match(/startCronRun\(/g), key).toHaveLength(1);
      expect(source, key).not.toMatch(/catch\s*\{/);
      expect(source, key).toMatch(/run\.fail\(error,/);
      // 인증 실패(401) 응답은 기록을 열기 전에 돌려준다.
      expect(source.indexOf('401'), key).toBeLessThan(source.indexOf('startCronRun('));
    }
  });

  it('작업 이름은 운영자 말로 보이고 모르는 잡은 잡 이름 그대로다', () => {
    expect(systemJobLabel('gifts', 'vercel_cron')).toBe('선물 만료·정리');
    expect(systemJobLabel('expire-stale-checkouts', 'pg_cron')).toBe('결제 기한 만료 정리');
    expect(systemJobLabel('new-job', 'pg_cron')).toBe('new-job');
    expect(systemJobLabel('renamed-job', 'vercel_cron', '옛 이름')).toBe('옛 이름');
    expect(Object.values(CRON_JOBS).every(job => job.label.length <= 60)).toBe(true);
    expect(Object.keys(PG_CRON_JOB_LABELS)).toContain('system-job-records-maintenance');
    expect(systemJobLabel('auth-mail-abuse-retention', 'pg_cron', null)).toBe('가입·재설정 요청 기록 정리');
  });
});
