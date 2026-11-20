import { afterEach, expect, it, vi } from 'vitest';
import { createClient } from './server';

const url = 'https://example.supabase.co';
const { createServerClient } = vi.hoisted(() => ({ createServerClient: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('bounds only the first verified user read and preserves caller cancellation', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key');
  const network = vi.fn<typeof fetch>().mockResolvedValue(new Response());
  vi.stubGlobal('fetch', network);
  await createClient({ firstUserLookupTimeoutMs: 800 });
  const request: typeof fetch = createServerClient.mock.lastCall![2].global.fetch;
  const controller = new AbortController();
  await request(url + '/auth/v1/token', { method: 'POST' });
  await request(url + '/auth/v1/user', { method: 'PUT' });
  await request(new Request(url + '/auth/v1/user', { signal: controller.signal }));
  await request(url + '/auth/v1/user');

  expect(network.mock.calls[0][1]?.signal).toBeUndefined();
  expect(network.mock.calls[1][1]?.signal).toBeUndefined();
  const firstSignal = network.mock.calls[2][1]?.signal;
  expect(firstSignal?.aborted).toBe(false);
  controller.abort();
  expect(firstSignal?.aborted).toBe(true);
  expect(network.mock.calls[3][1]?.signal).toBeUndefined();
});
