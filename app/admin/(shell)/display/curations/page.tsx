import { randomUUID } from 'node:crypto';
import { CurationScreen } from '@/components/admin/screens/CurationScreen';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { getAdminCurations } from '@/lib/admin/curations.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminDisplayCurationsPage() {
  await requireAdminScreenAccess('/admin/display/curations');

  const [curations, records] = await Promise.all([
    getAdminCurations(),
    getAdminCatalogRecords(),
  ]);

  return (
    <CurationScreen
      draftActiveFrom={new Date().toISOString()}
      draftId={randomUUID()}
      eventOptions={records.events.map((event) => ({
        id: event.id,
        title: event.title,
        archivedAt: event.archivedAt,
      }))}
      /* 굿즈 레코드의 표시 이름은 name 이다 — 이동 대상 목록에서는 title 로 맞춘다. */
      goodOptions={records.goods.map((good) => ({
        id: good.id,
        title: good.name,
        archivedAt: good.archivedAt,
      }))}
      ipOptions={records.ips.map((ip) => ({
        id: ip.id,
        title: ip.title,
        archivedAt: ip.archivedAt,
      }))}
      operationId={randomUUID()}
      records={curations}
    />
  );
}
