export function usePathname() {
  const pathname = window.location.pathname;
  if (pathname.startsWith('/admin/')) return pathname;
  const view = new URLSearchParams(window.location.search).get('view');
  if (view === 'orders' || view === 'items') return '/admin/sales/orders';
  if (view === 'claims') return '/admin/sales/claims/returns';
  if (view === 'filter-date') return '/admin/sales/orders';
  if (view === 'cs-qna') return '/admin/cs/qna';
  if (view === 'cs-reviews') return '/admin/cs/reviews';
  if (view === 'cs-inquiries') return '/admin/cs/inquiries';
  if (view === 'store-editor') return '/admin/display/curations';
  if (view === 'editor') return '/admin/catalog/goods';
  if (view === 'options' || view === 'goods') return '/admin/catalog/goods';
  return '/admin';
}

function navigate(href: string, replace = false) {
  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin) throw new Error('Fixture navigation must remain on loopback.');
  if (replace) window.location.replace(url.href);
  else window.location.assign(url.href);
}
export const useRouter = () => ({ push: (href: string) => navigate(href), replace: (href: string) => navigate(href, true), refresh: () => window.location.reload() });
export function useSearchParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('view') === 'editor' && !params.has('create') && !params.has('goodId')) params.set('create', '1');
  return params;
}
