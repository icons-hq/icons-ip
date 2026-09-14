export function usePathname() {
  const pathname = window.location.pathname;
  if (pathname.startsWith('/admin/')) return pathname;
  const view = new URLSearchParams(window.location.search).get('view');
  if (view === 'filter-date') return '/admin/sales/orders';
  if (view === 'options' || view === 'goods') return '/admin/catalog/goods';
  return '/admin';
}
