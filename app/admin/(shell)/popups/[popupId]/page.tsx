import { notFound } from 'next/navigation';
import { PopupEditorScreen } from '@/components/admin/screens/PopupEditorScreen';
import { getAdminIpOptions } from '@/lib/admin/catalog-list.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getAdminPopupDetail, getPopupPreview } from '@/lib/admin/popups.server';

/* 팝업 편성 — 언제·어디에·무엇을, 그리고 미리보기. */
export default async function AdminPopupEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ popupId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess('/admin/popups');
  const { popupId } = await params;
  const query = await searchParams;

  const detail = await getAdminPopupDetail(popupId);
  if (!detail) notFound();

  /* 폼이 보낸 KST 값을 고정 오프셋으로 못 박는다 — 서버 타임존에 기대지 않는다. */
  const rawAsOf = typeof query.asOf === 'string' ? query.asOf.trim() : '';
  const asOf = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(rawAsOf) ? `${rawAsOf}:00+09:00` : null;

  const [preview, ipOptions] = await Promise.all([
    getPopupPreview(popupId, asOf),
    getAdminIpOptions({ selectedId: (detail.popup as Record<string, string>).ip_id }),
  ]);

  return (
    <PopupEditorScreen
      detail={detail}
      ipOptions={ipOptions.map((ip) => ({ id: ip.id, title: ip.title }))}
      preview={preview}
      previewAsOf={asOf ?? preview?.serverNow ?? new Date().toISOString()}
    />
  );
}
