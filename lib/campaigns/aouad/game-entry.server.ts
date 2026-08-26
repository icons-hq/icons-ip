import 'server-only';

import { getCurrentAuthState } from '@/lib/auth/server';
import {
  LAST_BELL_VERIFIED_EXPERIENCE_PATH,
  lastBellGameHref,
  type AouadGameEntryContext,
} from './game-entry';

export async function getAouadGameEntryContext(): Promise<AouadGameEntryContext> {
  const [auth, gameHref] = await Promise.all([
    getCurrentAuthState(),
    Promise.resolve(lastBellGameHref()),
  ]);

  return {
    gameHref,
    authority: gameHref === LAST_BELL_VERIFIED_EXPERIENCE_PATH ? 'verified-candidate' : 'local-qa',
    authConfigured: auth.isConfigured,
    isAuthenticated: auth.user !== null,
    displayName: auth.profile?.nickname ?? auth.user?.email ?? null,
  };
}
