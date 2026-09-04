import { OptionMasterConsole } from '@/components/admin/catalog/OptionMasterConsole';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { isUuid } from '@/lib/admin/variants';
import { getAdminOptionMasters } from '@/lib/admin/variants.server';

/* 옵션 마스터 — 목록과 편집(`?selected=`)은 같은 라우트의 두 얼굴이다(카탈로그 콘솔 문법). */
export default async function AdminCatalogOptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess('/admin/catalog/options');
  const query = await searchParams;
  const selectedParam = typeof query.selected === 'string' ? query.selected.trim() : '';
  const masters = await getAdminOptionMasters({ includeArchived: true });
  const selected = selectedParam === 'new'
    ? 'new' as const
    : isUuid(selectedParam) ? masters.find((master) => master.id === selectedParam.toLowerCase()) ?? null : null;

  return <OptionMasterConsole masters={masters} selected={selected} />;
}
