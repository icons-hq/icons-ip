'use client';

import type { ReactNode } from 'react';
import { searchGoodsOptionImportAction } from '@/app/admin/goods-option-import-actions';
import type { GoodsOptionImportCandidate } from '@/lib/admin/goods-option-import';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import { AdminPickerDialog, type AdminPickerOption, type AdminPickerPanelProps, type AdminPickerRowView } from './console/AdminPickerDialog';

/*
 * 상품을 고르는 공용 선택창(화면 규칙 1). 사진·상품명·상품 자동코드·카테고리·게시 상태를 보며 20개씩 고른다.
 * 조회는 상품 목록과 같은 검색(보관하지 않은 상품, 등록일 최신순)을 쓴다.
 * 고를 수 없는 상품을 빼야 하는 화면은 그 조건을 건 `load`를 따로 넘긴다(옵션 불러오기: 선택형 옵션이 있는 상품만).
 */

export type AdminGoodsPickerRow = GoodsOptionImportCandidate;

export const ADMIN_GOODS_PICKER_FIELDS: readonly AdminPickerOption[] = [
  { value: 'name', label: '상품명' },
  { value: 'code', label: '상품 자동코드·옵션 자동코드' },
];

/** 상품 검색을 선택창 조회로 잇는다. `accountId`를 주면 그사이 로그인 계정이 바뀐 응답을 받지 않는다. */
export function adminGoodsPickerLoader(options: { accountId?: string } = {}): AdminPickerLoader<AdminGoodsPickerRow> {
  return async (request) => {
    const result = await searchGoodsOptionImportAction({ query: request.query, field: request.field || 'name', categoryId: request.filter, page: request.page });
    if (!result.ok) return { error: result.error };
    if (options.accountId && result.accountId !== options.accountId) return { error: '로그인 계정이 바뀌었습니다. 화면을 새로고침한 뒤 다시 열어주세요.' };
    return result.data;
  };
}

export function adminGoodsPickerRowView(good: AdminGoodsPickerRow): AdminPickerRowView {
  return { title: good.name, meta: `${good.code} · ${good.categoryName ?? '미분류'} · ${good.published ? '공개' : '초안'}`, imageUrl: good.imageUrl };
}

/** 카테고리 조건 선택지. 첫 항목은 '전체'다. */
export function adminGoodsPickerCategoryOptions(categories: readonly { id: string; name: string }[]): AdminPickerOption[] {
  return [{ value: '', label: '전체' }, ...categories.map((category) => ({ value: category.id, label: category.name }))];
}

export function AdminGoodsPicker({ title, description, accountId, categories, load, ...panel }: Omit<AdminPickerPanelProps<AdminGoodsPickerRow>, 'load' | 'rowKey' | 'rowView' | 'description'> & {
  title: string;
  description?: ReactNode;
  accountId?: string;
  /** 주면 카테고리로 좁혀 찾는 조건을 보인다(들여쓴 이름 그대로). */
  categories?: readonly { id: string; name: string }[];
  /** 고를 수 없는 상품을 뺀 조회가 따로 있으면 넘긴다. */
  load?: AdminPickerLoader<AdminGoodsPickerRow>;
}) {
  return <AdminPickerDialog<AdminGoodsPickerRow>
    description={description}
    filterLabel="카테고리"
    filterOptions={categories?.length ? adminGoodsPickerCategoryOptions(categories) : undefined}
    load={load ?? adminGoodsPickerLoader({ accountId })}
    rowKey={(good) => good.id}
    rowView={adminGoodsPickerRowView}
    searchFields={ADMIN_GOODS_PICKER_FIELDS}
    searchPlaceholder="상품명·상품 자동코드"
    showImages
    title={title}
    {...panel}
  />;
}
