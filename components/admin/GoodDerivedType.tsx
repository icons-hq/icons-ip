import Link from 'next/link';
import type { ReactNode } from 'react';
import { CATEGORY_PATH, type AdminCategoryNode } from '@/lib/admin/category';
import type { GoodTypeFromCategory } from '@/lib/admin/good-workspace';

/**
 * 상품 유형(SHEET-003·ADR-0037). 입력칸 없이 대표 카테고리(없으면 가까운 상위)의 연결값을 읽기 전용으로 보인다.
 * 공개 중이면 저장된 유형이고(잠금), 그룹 상품은 그룹 공통정보가 정한다. 제출 값은 편집기의 숨은 type 칸이다.
 */
export function GoodDerivedType({ state, storedType, published, groupOwned = false, categoryId, categories }: {
  state: GoodTypeFromCategory; storedType: string; published: boolean; groupOwned?: boolean; categoryId: string;
  categories: readonly Pick<AdminCategoryNode, 'id' | 'name'>[];
}) {
  const source = state.category;
  const sourceName = source.categoryId ? categories.find((category) => category.id === source.categoryId)?.name : undefined;
  let kind: 'group' | 'published' | 'category' | 'no-category' | 'unlinked';
  let value: string;
  let hint: ReactNode = null;
  if (groupOwned) {
    kind = 'group'; value = storedType || '없음'; hint = '그룹 공통정보의 카테고리에서 정해집니다.';
  } else if (published) {
    kind = 'published'; value = `${storedType} · 공개 중 잠금`;
  } else if (source.type) {
    kind = 'category'; value = `${source.type}(카테고리에서)`;
    if (source.inherited && sourceName) hint = `상위 카테고리 ‘${sourceName}’에 연결된 유형입니다.`;
  } else if (!categoryId) {
    kind = 'no-category'; value = '대표 카테고리를 고르면 정해집니다';
    hint = '상품 유형이 연결된 카테고리를 골라야 공개할 수 있습니다.';
  } else {
    kind = 'unlinked'; value = '연결된 상품 유형 없음';
    hint = <>이 카테고리(또는 상위)에 상품 유형이 연결되어 있지 않아 공개할 수 없습니다. <Link className="text-foreground underline underline-offset-4" href={CATEGORY_PATH} rel="noreferrer" target="_blank">카테고리 관리에서 연결 (새 탭)</Link></>;
  }
  /* 연결이 없는 초안에 예전에 저장한 유형이 남아 있으면 공개에 쓰지 않는다는 것을 함께 말한다. */
  const legacy = (kind === 'no-category' || kind === 'unlinked') && storedType ? ` 예전에 저장된 유형 ‘${storedType}’은 공개에 쓰이지 않습니다.` : '';
  return <dl className="flex min-w-0 flex-col gap-2" data-good-type-derived={kind}>
    <dt className="text-sm leading-snug font-medium text-foreground">상품 유형</dt>
    <dd className={`m-0 flex min-h-8 items-center rounded-lg border border-dashed bg-muted/50 px-2.5 py-1 text-sm ${kind === 'category' || kind === 'published' || kind === 'group' ? 'text-foreground' : 'text-muted-foreground'}`}>{value}</dd>
    {hint || legacy ? <dd className="m-0 text-xs text-muted-foreground">{hint}{legacy}</dd> : null}
  </dl>;
}
