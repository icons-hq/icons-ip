import 'server-only';

/** Transactional links follow the environment's public site URL. */
export function emailSiteUrl() {
  const configured = process.env.SITE_URL?.trim();
  return (configured || 'https://iconsip.com').replace(/\/+$/, '');
}
