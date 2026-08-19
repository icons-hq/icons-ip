import 'server-only';

import { getServiceRoleConfig } from '@/lib/supabase/service';
import { createEmailDispatcher, type EmailDispatcher } from './dispatcher';
import { resendEmailProviderFromEnvironment } from './resend-provider.server';
import {
  createSupabaseEmailDispatcherRepository,
  getEmailDispatchHmacConfig,
} from './supabase-dispatcher-repository.server';

export function emailDispatcherFromEnvironment(): EmailDispatcher | null {
  if (!getServiceRoleConfig().isConfigured) return null;
  if (!getEmailDispatchHmacConfig().isConfigured) return null;
  const provider = resendEmailProviderFromEnvironment();
  if (!provider) return null;
  return createEmailDispatcher({
    repository: createSupabaseEmailDispatcherRepository(),
    provider,
  });
}

export function emailProviderEventReducerFromEnvironment(): Pick<EmailDispatcher, 'reduceProviderEvent'> | null {
  if (!getServiceRoleConfig().isConfigured) return null;
  if (!getEmailDispatchHmacConfig().isConfigured) return null;
  const repository = createSupabaseEmailDispatcherRepository();
  return {
    reduceProviderEvent(input) {
      return repository.reduceProviderEvent(input);
    },
  };
}
