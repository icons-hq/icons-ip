import 'server-only';

import { CANONICAL_SITE_ORIGIN } from '@/lib/site-domains.mjs';

/** Keep the origin stable across provider retries and application redeployments. */
export function emailSiteUrl() {
  const configured = process.env.SITE_URL?.trim();
  if (!configured && process.env.VERCEL_ENV === 'preview') {
    throw new Error('email_site_url_required');
  }
  return (configured || CANONICAL_SITE_ORIGIN).replace(/\/+$/, '');
}
