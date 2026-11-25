'use client';

import { listGoodsEventTemplatesAction } from '@/app/admin/goods-benefit-actions';
import { AdminPickerDialog, type AdminPickerRowView } from '@/components/admin/console/AdminPickerDialog';
import { adminConfirm } from '@/lib/admin/confirm';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import type { GoodsEventTemplate } from '@/lib/goods-benefits';

/*
 * 이벤트 템플릿 고르기(공용 선택창, docs/admin-screen-rules.md 규칙 1·2·7).
 * 상품의 사은품·이벤트 안내와 등록 화면이 같이 쓴다. 템플릿은 40자 문구 하나라 줄에는 문구만 보인다.
 */

/** 사용 중인 템플릿을 20개씩 읽는다. 보관한 템플릿은 조회에서 빠진다. */
export const loadEventTemplates: AdminPickerLoader<GoodsEventTemplate> = async (request) => {
  const query = request.query.trim();
  let result = await listGoodsEventTemplatesAction(query, false, request.page);
  /* 그사이 템플릿이 줄어 고른 쪽이 비었으면 마지막 쪽을 다시 읽는다. */
  const last = result.ok ? Math.max(1, Math.ceil(result.value.total / result.value.pageSize)) : 1;
  if (result.ok && request.page > last) result = await listGoodsEventTemplatesAction(query, false, last);
  return result.ok ? { rows: result.value.rows, total: result.value.total, page: result.value.page, pageSize: result.value.pageSize } : { error: result.error };
};

export function eventTemplateRowView(template: GoodsEventTemplate): AdminPickerRowView {
  return { title: template.eventText };
}

export function GoodsEventTemplatePicker({ onClose, onSelect, current }: {
  onClose: () => void;
  onSelect: (template: GoodsEventTemplate) => void;
  /** 지금 적어 둔 이벤트 문구. 다른 문구가 적혀 있으면 바꾸기 전에 묻고, 취소하면 선택창을 그대로 둔다. */
  current?: string;
}) {
  async function choose(template: GoodsEventTemplate): Promise<boolean> {
    const written = current?.trim() ?? '';
    if (written && written !== template.eventText
      && !await adminConfirm({ title: '이벤트 문구를 바꿀까요?', message: `지금 적어 둔 이벤트 문구가 ‘${template.eventText}’ 템플릿 내용으로 바뀝니다.`, confirmLabel: '바꾸기' })) return false;
    onSelect(template);
    return true;
  }
  return <AdminPickerDialog<GoodsEventTemplate>
    description="고르면 이벤트 문구가 템플릿 문구로 바뀝니다."
    emptyText="맞는 템플릿이 없습니다. 템플릿은 ‘이벤트 템플릿 관리’에서 만듭니다."
    excludedNote="보관한 템플릿은 목록에서 뺐습니다."
    load={loadEventTemplates}
    onClose={onClose}
    onSelect={choose}
    rowKey={(template) => template.id}
    rowView={eventTemplateRowView}
    searchPlaceholder="이벤트 문구로 찾기"
    title="이벤트 템플릿 고르기"
  />;
}
