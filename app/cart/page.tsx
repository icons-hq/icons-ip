import { Cart } from '@/components/screens/Cart';
import { getCatalogSnapshot } from '@/lib/catalog';

export default async function Page() {
  const catalog = await getCatalogSnapshot();

  return <Cart catalog={{ goods: catalog.goods, ips: catalog.ips }} />;
}
