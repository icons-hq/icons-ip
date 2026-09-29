import 'server-only';

/** Keep the origin stable across provider retries and application redeployments. */
export function emailSiteUrl() {
  const configured = process.env.SITE_URL?.trim();
  if (!configured && process.env.VERCEL_ENV === 'preview') {
    throw new Error('email_site_url_required');
  }
  return (configured || 'https://iconsip.com').replace(/\/+$/, '');
}
