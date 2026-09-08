import { EventScreen } from '@/components/admin/screens/EventScreen';
import { getAdminIpOptionsWith } from '@/lib/admin/catalog-list.server';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

/* 이벤트 (규모 후속). IP 는 전량이 아니라 상위 N + 이벤트가 참조하는 것만 — 선택기가 나머지를 검색한다. */
export default async function AdminCatalogEventsPage() {
  await requireAdminScreenAccess('/admin/catalog/events');

  const records = await getAdminCatalogRecords({ include: ['events'] });
  const ipOptions = await getAdminIpOptionsWith(
    records.events.map((event) => event.ipId).filter((id): id is string => Boolean(id)),
  );

  return <EventScreen ipOptions={ipOptions} records={records.events} />;
}
