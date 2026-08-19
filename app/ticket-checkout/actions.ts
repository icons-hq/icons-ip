'use server';

import { isAccountSuspended, isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import { ticketCheckoutPaymentsEnabled } from '@/lib/payments/ticket-checkout-availability';
import { createRuntimeTicketPaymentCheckout } from '@/lib/payments/ticket-checkout.runtime.server';
import { normalizeTicketReference } from '@/lib/ticketing';
import { loadTicketOrder } from '@/lib/ticketing.server';

export interface PrepareTicketPaymentActionState {
  readonly prepared?: PreparedCheckout;
  readonly error?: 'auth_required' | 'not_found' | 'not_payable' | 'payment_unavailable';
}

export async function prepareTicketPaymentAction(
  _state: PrepareTicketPaymentActionState,
  formData: FormData,
): Promise<PrepareTicketPaymentActionState> {
  const ticketOrderId = normalizeTicketReference(formData.get('ticketOrderId'));
  if (!ticketOrderId) return { error: 'not_found' };

  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user) return { error: 'auth_required' };
  if (
    isAccountSuspended(auth.profile)
    || !isOnboarded(auth.profile, auth.user.email)
  ) return { error: 'auth_required' };
  if (!ticketCheckoutPaymentsEnabled(auth.user.id)) return { error: 'payment_unavailable' };

  const order = await loadTicketOrder(auth.user.id, ticketOrderId);
  if (!order) return { error: 'not_found' };
  if (
    order.status !== 'pending'
    || order.paymentStatus !== null
    || !order.expiresAt
    || Date.parse(order.expiresAt) <= Date.now()
  ) return { error: 'not_payable' };

  try {
    const prepared = await createRuntimeTicketPaymentCheckout().prepare({
      userId: auth.user.id,
      ticketOrderId: order.id,
    });
    if (Date.parse(prepared.expiresAt) <= Date.now()) return { error: 'not_payable' };
    return { prepared };
  } catch {
    return { error: 'payment_unavailable' };
  }
}
