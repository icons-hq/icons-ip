import { randomUUID } from 'node:crypto';
import { CurationScreen } from '@/components/admin/screens/CurationScreen';
import { getAdminGoodOptions, getAdminGoodsByIds, getAdminIpOptionsWith } from '@/lib/admin/catalog-list.server';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { getAdminCurations } from '@/lib/admin/curations.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

/*
 * 홈 큐레이션 (규모 후속). 이동 대상 목록을 만들려고 굿즈·IP **전량**을 읽었다 — 1,000행에서
 * 말없이 잘리는 자리다. 이제 상위 N + **지금 큐레이션이 가리키는 것**만 읽는다. 그 밖의 대상을
 * 가리키던 기존 큐레이션은 「현재 값」 그룹이 그대로 살린다(`adminCurationTargetGroupsFor`) —
 * 조용히 홈으로 바뀌지 않는다. 이벤트는 운영 표라 작아 그대로 읽는다.
 */
function referencedId(linkPath: string | null | undefined, prefix: string): string | null {
  if (!linkPath || !linkPath.startsWith(prefix)) return null;
  const rest = linkPath.slice(prefix.length).split(/[?#/]/)[0];
  return rest ? decodeURIComponent(rest) : null;
}

export default async function AdminDisplayCurationsPage() {
  await requireAdminScreenAccess('/admin/display/curations');

  const [curations, records] = await Promise.all([
    getAdminCurations(),
    getAdminCatalogRecords({ include: ['events'] }),
  ]);
  const linkPaths = curations.map((curation) => curation.linkPath ?? null);
  const referencedGoodIds = linkPaths.map((path) => referencedId(path, '/shop/')).filter((id): id is string => Boolean(id));
  const referencedIpIds = linkPaths.map((path) => referencedId(path, '/ip/')).filter((id): id is string => Boolean(id));

  const [topGoods, referencedGoods, ipOptions] = await Promise.all([
    getAdminGoodOptions(),
    getAdminGoodsByIds(referencedGoodIds),
    getAdminIpOptionsWith(referencedIpIds),
  ]);
  /* 참조분이 먼저, 같은 id 는 한 번만. */
  const seen = new Set<string>();
  const goodOptions = [
    ...referencedGoods.map((good) => ({ id: good.id, title: good.name, archivedAt: good.archivedAt })),
    ...topGoods,
  ].filter((option) => (seen.has(option.id) ? false : (seen.add(option.id), true)));

  return (
    <CurationScreen
      draftActiveFrom={new Date().toISOString()}
      draftId={randomUUID()}
      eventOptions={records.events.map((event) => ({
        id: event.id,
        title: event.title,
        archivedAt: event.archivedAt,
      }))}
      goodOptions={goodOptions}
      ipOptions={ipOptions}
      operationId={randomUUID()}
      records={curations}
    />
  );
}
