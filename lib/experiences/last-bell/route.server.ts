import 'server-only';

import { NextResponse } from 'next/server';
import { isAccountSuspended, isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCurrentAccountDeletionWriteFenceState } from '@/lib/account-deletion.server';
import {
  getLastBellGuestRunToken,
  type LastBellRuntimeEventInput,
} from './contract';

export function lastBellError(status: number, code: string) {
  const response = NextResponse.json({ error: { code } }, { status });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export function lastBellJson(value: unknown, status = 200) {
  const response = NextResponse.json(value, { status });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export function isSameOriginLastBellMutation(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const requestUrl = new URL(request.url);
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    const host = forwardedHost || request.headers.get('host');
    const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const protocol = forwardedProtocol || requestUrl.protocol.slice(0, -1);
    if (!host || (protocol !== 'http' && protocol !== 'https')) return false;

    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

export async function readLastBellJson(request: Request): Promise<unknown | null> {
  const raw = await request.text();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export type LastBellWriteIdentity =
  | { readonly userId: string | null }
  | { readonly error: { readonly status: number; readonly code: string } };

/**
 * Account-backed verified-run mutations use the same active, deletion, and
 * onboarding fences as the protected account actions. Anonymous story runs
 * remain allowed. The RPC repeats every check to close races after this
 * request-time preflight.
 */
export async function getLastBellWriteIdentity(requireAuthenticatedAccount = false): Promise<LastBellWriteIdentity> {
  const auth = await getCurrentAuthState();
  if (!auth.isConfigured) return { error: { status: 503, code: 'not_configured' } };
  if (!auth.user) {
    return requireAuthenticatedAccount
      ? { error: { status: 401, code: 'auth_required' } }
      : { userId: null };
  }
  if (isAccountSuspended(auth.profile)) return { error: { status: 403, code: 'account_suspended' } };
  if (await getCurrentAccountDeletionWriteFenceState() !== 'clear') {
    return { error: { status: 409, code: 'account_deletion_write_fenced' } };
  }
  if (!isOnboarded(auth.profile, auth.user.email)) {
    return { error: { status: 409, code: 'onboarding_required' } };
  }
  return { userId: auth.user.id };
}

export function isLastBellWriteFailure(
  identity: LastBellWriteIdentity,
): identity is Extract<LastBellWriteIdentity, { readonly error: unknown }> {
  return 'error' in identity;
}

export function getLastBellGuestDigestInput(request: Request): string | null {
  return getLastBellGuestRunToken(request.headers.get('cookie'));
}

export function lastBellEventRpcInput(event: LastBellRuntimeEventInput) {
  return event;
}
