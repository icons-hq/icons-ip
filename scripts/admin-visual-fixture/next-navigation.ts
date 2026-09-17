export function usePathname() {
  const pathname = window.location.pathname;
  if (pathname.startsWith('/admin/')) return pathname;
  const view = new URLSearchParams(window.location.search).get('view');
  if (view === 'filter-date') return '/admin/sales/orders';
  if (view === 'editor') return '/admin/catalog/goods/new';
  if (view === 'options' || view === 'goods') return '/admin/catalog/goods';
  return '/admin';
}

export const useRouter = () => ({ push() {}, replace() {}, refresh() {} });
export const useSearchParams = () => new URLSearchParams(window.location.search);
