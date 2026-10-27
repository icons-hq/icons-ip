import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
import { stagingTestToolsRuntimeAllowed } from './staging-test-tools.server';

const staging = { VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: 'https://vjloqfsghxuleabehgpo.supabase.co', SITE_URL: 'https://icons-ip-staging.vercel.app' };
describe('스테이징 테스트 도구의 서버 판별', () => {
  it('스테이징·로컬 개발은 허용한다(DB가 따로 한 번 더 판별한다)', () => {
    expect(stagingTestToolsRuntimeAllowed(staging)).toBe(true);
    expect(stagingTestToolsRuntimeAllowed({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' })).toBe(true);
  });
  it('운영 배포·운영 Supabase·운영 도메인·설정 누락은 거절한다', () => {
    expect(stagingTestToolsRuntimeAllowed({ ...staging, VERCEL_ENV: 'production' })).toBe(false);
    expect(stagingTestToolsRuntimeAllowed({ ...staging, NEXT_PUBLIC_SUPABASE_URL: 'https://sbutbsghcxmxmxgrshwq.supabase.co' })).toBe(false);
    expect(stagingTestToolsRuntimeAllowed({ ...staging, SITE_URL: 'https://iconsip.com' })).toBe(false);
    expect(stagingTestToolsRuntimeAllowed({ ...staging, SITE_URL: 'https://www.iconsip.com/' })).toBe(false);
    expect(stagingTestToolsRuntimeAllowed({ ...staging, SITE_URL: 'not a url' })).toBe(false);
    expect(stagingTestToolsRuntimeAllowed({ VERCEL_ENV: 'preview' })).toBe(false);
  });
});
