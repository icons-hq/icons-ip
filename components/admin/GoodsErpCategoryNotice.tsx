'use client';

import type { ErpCategorySuggestion } from '@/lib/admin/goods-erp-suggestion';

/** 옵션의 ERP 품목 선택이 대표 고객 카테고리에 준 영향. 이미 고른 카테고리는 덮어쓰지 않는다. */
export function GoodsErpCategoryNotice({ suggestion, currentCategoryId, onReplace, onReview }: {
  suggestion: ErpCategorySuggestion | null;
  currentCategoryId: string;
  onReplace: (categoryId: string) => void;
  onReview: () => void;
}) {
  if (!suggestion) return null;
  const review = <button type="button" className="btn btn-ghost" onClick={onReview}>대표 카테고리 확인</button>;
  let body;
  switch (suggestion.kind) {
    case 'filled':
      body = <><p>ERP 카테고리로 대표 카테고리를 채웠습니다. 바꿀 수 있습니다. <strong>{suggestion.path}</strong></p>{review}</>;
      break;
    case 'offer':
      body = currentCategoryId === suggestion.categoryId
        ? <><p>대표 카테고리를 ERP 카테고리로 바꿨습니다. 바꿀 수 있습니다. <strong>{suggestion.path}</strong></p>{review}</>
        : <><p>대표 카테고리는 그대로 두었습니다. ERP 품목에 연결된 고객 카테고리는 <strong>{suggestion.path}</strong>입니다.</p>
          <button type="button" className="btn btn-ghost" onClick={() => onReplace(suggestion.categoryId)}>ERP 카테고리 &apos;{suggestion.path}&apos;로 바꾸기</button></>;
      break;
    case 'same':
      body = <p>대표 카테고리가 ERP 카테고리와 같습니다. <strong>{suggestion.path}</strong></p>;
      break;
    case 'unavailable':
      body = <p>ERP 카테고리{suggestion.erpCategory ? ` ${suggestion.erpCategory}` : ''}에 연결된 고객 카테고리가 보관됐거나 하위 분류가 있어 대표 카테고리를 채우지 않았습니다. 고객 카테고리 연결을 확인해주세요.</p>;
      break;
    case 'unmapped':
      body = <p>ERP 카테고리: {suggestion.erpCategory} — ERP 품목 화면에서 고객 카테고리를 연결하면 자동으로 채워집니다.</p>;
      break;
  }
  return <div className="goods-erp-category-notice" role="status">{body}</div>;
}
