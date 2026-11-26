'use client';

import { listGoodsSizeTemplatesAction } from '@/app/admin/goods-size-chart-actions';
import { AdminPickerDialog, type AdminPickerRowView } from '@/components/admin/console/AdminPickerDialog';
import { adminConfirm } from '@/lib/admin/confirm';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import type { GoodsSizeChart, GoodsSizeTemplate } from '@/lib/goods-size-chart';

/*
 * 사이즈 템플릿 고르기(공용 선택창, docs/admin-screen-rules.md 규칙 1·2·7).
 * 상품의 사이즈 안내·등록 화면·그룹 공통정보가 같이 쓴다. 템플릿을 만들고 고치는 일은 '사이즈 템플릿 관리'에서 한다.
 */

/** 사용 중인 템플릿을 20개씩 읽는다. 보관한 템플릿은 조회에서 빠진다. */
export const loadSizeTemplates: AdminPickerLoader<GoodsSizeTemplate> = async (request) => {
  const query = request.query.trim();
  let result = await listGoodsSizeTemplatesAction(query, false, request.page);
  /* 그사이 템플릿이 줄어 고른 쪽이 비었으면 마지막 쪽을 다시 읽는다. */
  const last = result.ok ? Math.max(1, Math.ceil(result.value.total / result.value.pageSize)) : 1;
  if (result.ok && request.page > last) result = await listGoodsSizeTemplatesAction(query, false, last);
  return result.ok ? { rows: result.value.rows, total: result.value.total, page: result.value.page, pageSize: result.value.pageSize } : { error: result.error };
};

/** 줄 하나: 이름 아래에 사이즈·측정 항목·단위를 보여 이름이 같은 템플릿도 구분되게 한다. */
export function sizeTemplateRowView(template: GoodsSizeTemplate): AdminPickerRowView {
  const { sizes, measurements, unit } = template.chart;
  return { title: template.name, meta: `${sizes.join(', ')} · ${measurements.map(row => row.name).join(', ')} · ${unit}` };
}

/** 사이즈표에 적어 둔 것이 있는가(사이즈·측정 항목 이름, 치수, 측정 안내). 단위만 고른 빈 표는 없는 것으로 본다. */
export function sizeChartHasInput(chart: GoodsSizeChart): boolean {
  return Boolean(chart.note.trim()) || chart.sizes.some(size => size.trim())
    || chart.measurements.some(row => row.name.trim() || row.values.some(value => value.trim()));
}

export function GoodsSizeTemplatePicker({ onClose, onSelect, current }: {
  onClose: () => void;
  onSelect: (template: GoodsSizeTemplate) => void;
  /** 지금 적어 둔 사이즈표. 적어 둔 것이 있으면 바꾸기 전에 묻고, 취소하면 선택창을 그대로 둔다. */
  current?: GoodsSizeChart;
}) {
  async function choose(template: GoodsSizeTemplate): Promise<boolean> {
    if (current && sizeChartHasInput(current)
      && !await adminConfirm({ title: '사이즈표를 바꿀까요?', message: `지금 적어 둔 사이즈표가 ‘${template.name}’ 템플릿 내용으로 바뀝니다.`, confirmLabel: '바꾸기' })) return false;
    onSelect(template);
    return true;
  }
  return <AdminPickerDialog<GoodsSizeTemplate>
    description="고르면 사이즈표가 템플릿 내용으로 바뀝니다."
    emptyText="맞는 템플릿이 없습니다. 템플릿은 ‘사이즈 템플릿 관리’에서 만듭니다."
    excludedNote="보관한 템플릿은 목록에서 뺐습니다."
    load={loadSizeTemplates}
    onClose={onClose}
    onSelect={choose}
    rowKey={(template) => template.id}
    rowView={sizeTemplateRowView}
    searchPlaceholder="템플릿 이름으로 찾기"
    title="사이즈 템플릿 고르기"
  />;
}
