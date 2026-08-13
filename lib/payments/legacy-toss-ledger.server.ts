import 'server-only';

import type { createServiceClient } from '@/lib/supabase/service';

type ServiceClient = ReturnType<typeof createServiceClient>;
type LegacyTossQueryError = { message: string } | null;

interface LegacyTossSelectQuery<T> extends PromiseLike<{
  data: T[] | null;
  error: LegacyTossQueryError;
}> {
  eq(column: string, value: unknown): LegacyTossSelectQuery<T>;
  order(column: string, options: { ascending: boolean }): LegacyTossSelectQuery<T>;
  maybeSingle(): Promise<{ data: T | null; error: LegacyTossQueryError }>;
}

export type LegacyTossPaymentKeyClassification =
  | { status: 'known_toss' }
  | { status: 'known_other_provider' }
  | { status: 'unknown_compatibility' }
  | { status: 'lookup_failed'; message: string };

/**
 * Owns the database boundary for the temporary Toss compatibility runtime.
 *
 * `unknown_compatibility` is a classification result, not an authorization.
 * Both new checkout paths are closed to Toss; webhook callers must reject this
 * state before any provider inquiry or local write.
 */
export function createLegacyTossPaymentRepository(service: ServiceClient) {
  return {
    async classifyPaymentKey(paymentKey: string): Promise<LegacyTossPaymentKeyClassification> {
      const { data, error } = await service
        .from('payments')
        .select('provider')
        .eq('idempotency_key', paymentKey)
        .maybeSingle();
      if (error) return { status: 'lookup_failed', message: error.message };
      if (!data) return { status: 'unknown_compatibility' };
      return (data as { provider?: unknown }).provider === 'toss'
        ? { status: 'known_toss' }
        : { status: 'known_other_provider' };
    },

    select<T = Record<string, unknown>>(columns: string) {
      return service
        .from('payments')
        .select(columns)
        .eq('provider', 'toss') as unknown as LegacyTossSelectQuery<T>;
    },

    update(values: Record<string, unknown>) {
      return service
        .from('payments')
        .update(values)
        .eq('provider', 'toss');
    },

    upsert(
      values: Record<string, unknown>,
      options: { onConflict?: string; ignoreDuplicates?: boolean } = {},
    ) {
      return service
        .from('payments')
        .upsert({ ...values, provider: 'toss' }, options);
    },
  };
}
