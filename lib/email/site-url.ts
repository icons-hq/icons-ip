import 'server-only';

/** Transactional links follow the environment's public site URL. */
export function emailSiteUrl() {
  const configured = process.env.SITE_URL?.trim();
  const previewHost = process.env.VERCEL_ENV === 'preview' ? process.env.VERCEL_URL?.trim() : '';
  return (configured || (previewHost ? `https://${previewHost}` : 'https://iconsip.com')).replace(/\/+$/, '');
}
