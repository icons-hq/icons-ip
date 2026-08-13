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
  | {
      status: 'known_toss';
      purpose: 'order' | 'ticket';
      refId: string;
      amount: number;
      paymentKey: string | null;
      idempotencyKey: string;
    }
  | { status: 'known_other_provider' }
  | { status: 'unknown_compatibility' }
  | { status: 'lookup_failed'; message: string };

/**
 * Owns the database boundary for the temporary Toss compatibility runtime.
 *
 * `unknown_compatibility` is limited to the ticket transition. Goods callbacks
 * require a provider=toss row whose purpose/reference/amount also match the
 * provider inquiry; new goods checkout is permanently closed.
 */
export function createLegacyTossPaymentRepository(service: ServiceClient) {
  return {
    async classifyPaymentKey(paymentKey: string): Promise<LegacyTossPaymentKeyClassification> {
      const { data, error } = await service
        .from('payments')
        .select('provider,purpose,ref_id,amount,payment_key,idempotency_key')
        .eq('idempotency_key', paymentKey)
        .maybeSingle();
      if (error) return { status: 'lookup_failed', message: error.message };
      if (!data) return { status: 'unknown_compatibility' };
      const row = data as {
        provider?: unknown;
        purpose?: unknown;
        ref_id?: unknown;
        amount?: unknown;
        payment_key?: unknown;
        idempotency_key?: unknown;
      };
      if (row.provider !== 'toss') return { status: 'known_other_provider' };
      if (
        (row.purpose !== 'order' && row.purpose !== 'ticket')
        || typeof row.ref_id !== 'string'
        || typeof row.amount !== 'number'
        || !Number.isSafeInteger(row.amount)
        || row.amount <= 0
        || (row.payment_key !== null && typeof row.payment_key !== 'string')
        || typeof row.idempotency_key !== 'string'
      ) return { status: 'lookup_failed', message: 'invalid legacy Toss payment identity' };
      return {
        status: 'known_toss',
        purpose: row.purpose,
        refId: row.ref_id,
        amount: row.amount,
        paymentKey: row.payment_key,
        idempotencyKey: row.idempotency_key,
      };
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
