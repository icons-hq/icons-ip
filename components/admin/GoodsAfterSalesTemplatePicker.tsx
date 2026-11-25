'use client';

import { listGoodsAfterSalesTemplatesAction } from '@/app/admin/goods-after-sales-actions';
import { AdminPickerDialog, type AdminPickerRowView } from '@/components/admin/console/AdminPickerDialog';
import { adminConfirm } from '@/lib/admin/confirm';
import { templateExcerpt } from '@/lib/admin/goods-template-save';
import { kstDateTimeText } from '@/lib/admin/list-export';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import type { GoodsAfterSalesTemplate, GoodsAfterSalesValues } from '@/lib/goods-after-sales';

/*
 * A/S 템플릿 고르기(공용 선택창, docs/admin-screen-rules.md 규칙 1·2·7).
 * 상품의 A/S 안내·등록 화면·그룹 공통정보가 같이 쓴다. A/S 템플릿에는 이름이 없어 안내 첫 줄과 전화번호로 알아본다.
 */

/** 사용 중인 템플릿을 20개씩 읽는다. 검색어는 전화번호·안내·특이사항에서 찾는다. 보관한 템플릿은 조회에서 빠진다. */
export const loadAfterSalesTemplates: AdminPickerLoader<GoodsAfterSalesTemplate> = async (request) => {
  const query = request.query.trim();
  let result = await listGoodsAfterSalesTemplatesAction(query, false, request.page);
  /* 그사이 템플릿이 줄어 고른 쪽이 비었으면 마지막 쪽을 다시 읽는다. */
  const last = result.ok ? Math.max(1, Math.ceil(result.value.total / result.value.pageSize)) : 1;
  if (result.ok && request.page > last) result = await listGoodsAfterSalesTemplatesAction(query, false, last);
  return result.ok ? { rows: result.value.rows, total: result.value.total, page: result.value.page, pageSize: result.value.pageSize } : { error: result.error };
};

/** 줄 하나: 안내 첫 줄 / 전화번호 · 등록일. */
export function afterSalesTemplateRowView(template: GoodsAfterSalesTemplate): AdminPickerRowView {
  const day = kstDateTimeText(template.createdAt).slice(0, 10).replaceAll('-', '.');
  return { title: templateExcerpt(template.guide), meta: [template.phone, day ? `${day} 등록` : ''].filter(Boolean).join(' · ') };
}

/** 세 칸 가운데 적어 둔 것이 있는가. */
export function afterSalesHasInput(values: GoodsAfterSalesValues): boolean {
  return Boolean(values.phone.trim() || values.guide.trim() || values.sellerSpecialNotes.trim());
}

export function GoodsAfterSalesTemplatePicker({ onClose, onSelect, current }: {
  onClose: () => void;
  onSelect: (template: GoodsAfterSalesTemplate) => void;
  /** 지금 적어 둔 A/S 안내. 적어 둔 것이 있으면 바꾸기 전에 묻고, 취소하면 선택창을 그대로 둔다. */
  current?: GoodsAfterSalesValues;
}) {
  async function choose(template: GoodsAfterSalesTemplate): Promise<boolean> {
    if (current && afterSalesHasInput(current)
      && !await adminConfirm({ title: 'A/S 안내를 바꿀까요?', message: `지금 적어 둔 A/S 전화번호·A/S 안내·판매자 특이사항이 ‘${templateExcerpt(template.guide)}’ 템플릿 내용으로 바뀝니다.`, confirmLabel: '바꾸기' })) return false;
    onSelect(template);
    return true;
  }
  return <AdminPickerDialog<GoodsAfterSalesTemplate>
    description="고르면 A/S 전화번호·A/S 안내·판매자 특이사항이 템플릿 내용으로 바뀝니다."
    emptyText="맞는 템플릿이 없습니다. 템플릿은 ‘A/S 템플릿 관리’에서 만듭니다."
    excludedNote="보관한 템플릿은 목록에서 뺐습니다."
    load={loadAfterSalesTemplates}
    onClose={onClose}
    onSelect={choose}
    rowKey={(template) => template.id}
    rowView={afterSalesTemplateRowView}
    searchPlaceholder="전화번호·안내·특이사항으로 찾기"
    title="A/S 템플릿 고르기"
  />;
}
