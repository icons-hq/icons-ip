'use server';

import { isAccountSuspended, isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { checkoutPaymentsEnabled } from '@/lib/payments/checkout-availability';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  mapReserveTicketsError,
  normalizeReserveTicketsInput,
  normalizeTicketReference,
  type ReserveTicketsErrorCode,
} from '@/lib/ticketing';

interface TicketEligibilityRow {
  id: string;
  price: number;
  events: { status: string } | { status: string }[] | null;
}

export type ReserveTicketsActionResult =
  | { ok: true; orderId: string }
  | { ok: false; error: ReserveTicketsErrorCode };

function eventStatus(value: TicketEligibilityRow['events']): string | null {
  if (Array.isArray(value)) return value[0]?.status ?? null;
  return value?.status ?? null;
}

export async function reserveTicketsAction(inputValue: unknown): Promise<ReserveTicketsActionResult> {
  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user) return { ok: false, error: 'auth_required' };
  if (isAccountSuspended(auth.profile)) return { ok: false, error: 'account_suspended' };
  if (!isOnboarded(auth.profile, auth.user.email)) {
    return { ok: false, error: 'onboarding_required' };
  }

  const input = normalizeReserveTicketsInput(inputValue);
  if (!input) return { ok: false, error: 'invalid_request' };
  if (!checkoutPaymentsEnabled()) return { ok: false, error: 'payment_unavailable' };

  try {
    const supabase = await createClient();
    const { data: eligibilityData, error: eligibilityError } = await supabase
      .from('ticket_types')
      .select('id,price,events!inner(status)')
      .eq('id', input.ticketTypeId)
      .maybeSingle<TicketEligibilityRow>();

    if (eligibilityError) return { ok: false, error: 'unavailable' };
    if (
      !eligibilityData
      || normalizeTicketReference(eligibilityData.id) !== input.ticketTypeId
      || !Number.isInteger(eligibilityData.price)
      || eligibilityData.price <= 0
      || eventStatus(eligibilityData.events) !== '예매중'
    ) {
      return { ok: false, error: 'not_bookable' };
    }

    const service = createServiceClient();
    const { data, error } = await service.rpc('reserve_tickets', {
      p_ticket_type_id: input.ticketTypeId,
      p_qty: input.qty,
      p_reservation_key: input.reservationKey,
      p_user_id: auth.user.id,
    });

    if (error) return { ok: false, error: mapReserveTicketsError(error.message) };
    const orderId = normalizeTicketReference(data);
    return orderId
      ? { ok: true, orderId }
      : { ok: false, error: 'unavailable' };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}
