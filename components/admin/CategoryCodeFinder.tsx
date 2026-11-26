'use client';

import { useRef, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { loadCategoryCodesAction } from '@/app/admin/category-code-actions';
import { CATEGORY_EXPORT_API_PATH } from '@/lib/admin/category';
import { categoryCodeChoices, type CategoryCodeChoice } from '@/lib/admin/category-code-finder';
import { adminPickerLocalPage, type AdminPickerLoader } from '@/lib/admin/picker';
import { AdminPickerDialog, type AdminPickerRowView } from './console/AdminPickerDialog';
import { buttonVariants } from './kit/ui/button';

const LOAD_FAILED = '카테고리 코드를 불러오지 못했습니다. 잠시 뒤 다시 검색해주세요.';
const rowKey = (row: CategoryCodeChoice) => row.id;
const textOf = (row: CategoryCodeChoice) => `${row.path} ${row.code}`;
/* 코드는 한 번 눌러 통째로 선택된다(select-all). 자동 복사가 막힌 환경에서도 줄에서 바로 복사할 수 있다. */
const rowView = (row: CategoryCodeChoice): AdminPickerRowView => ({ title: row.path, meta: <>카테고리 코드 <span className="font-medium text-foreground select-all">{row.code}</span></> });

/** 마지막으로 복사를 시도한 줄과 결과. */
type Copied = { id: string; path: string; ok: boolean } | null;

/**
 * 상품 일괄등록 엑셀의 '고객 카테고리 코드'·'추가 카테고리 코드' 칸에 붙여넣을 코드를 복사하는 창.
 * 공용 선택창(AdminPickerDialog) 하나로 이름·경로·코드를 검색하고, 줄마다 [코드 복사]를 누른다(화면 규칙 1).
 * 목록은 새 상품에 연결할 수 있는 카테고리 — 보관하지 않은 마지막 단계(categoryCodeChoices) — 만 낸다.
 * 카테고리는 창을 열 때 서버 액션으로 한 번 읽고(실패하면 [검색]을 다시 누를 때 다시 읽는다), 검색·페이지는 읽어 둔 목록에서 자른다.
 * 상위·보관 카테고리까지 모두 담은 전체 코드는 CSV로 내려받는다.
 */
export function CategoryCodeFinder({ onClose }: { onClose: () => void }) {
  const choices = useRef<CategoryCodeChoice[] | null>(null);
  const [copied, setCopied] = useState<Copied>(null);
  const load: AdminPickerLoader<CategoryCodeChoice> = async (request) => {
    if (!choices.current) {
      try {
        const result = await loadCategoryCodesAction();
        if (!result.ok) return { error: result.error };
        choices.current = categoryCodeChoices(result.categories);
      } catch { return { error: LOAD_FAILED }; }
    }
    return adminPickerLocalPage(choices.current, request, { textOf });
  };
  async function copy(row: CategoryCodeChoice) {
    try { await navigator.clipboard.writeText(row.code); setCopied({ id: row.id, path: row.path, ok: true }); }
    catch { setCopied({ id: row.id, path: row.path, ok: false }); }
  }
  return <AdminPickerDialog<CategoryCodeChoice>
    description="복사한 코드를 엑스스퀘어 양식의 '고객 카테고리 코드'·'추가 카테고리 코드' 칸에 붙여넣습니다."
    emptyText="일치하는 카테고리가 없습니다."
    excludedNote="하위 카테고리가 있거나 보관한 카테고리는 목록에서 뺐습니다."
    footer={<div className="flex flex-col items-start gap-2">
      {copied && !copied.ok ? <p className="text-sm text-destructive" role="alert">복사하지 못했습니다. 줄에 적힌 카테고리 코드를 직접 선택해 복사해주세요.</p> : null}
      {copied?.ok ? <p className="sr-only" role="status">{copied.path} 카테고리 코드를 복사했습니다.</p> : null}
      <a className={buttonVariants({ variant: 'outline' })} data-slot="button" href={CATEGORY_EXPORT_API_PATH}><Download aria-hidden="true" />전체 카테고리 코드 CSV 내려받기</a>
    </div>}
    load={load}
    onClose={onClose}
    /* 줄 버튼이 [코드 복사]라 [선택]은 쓰지 않는다. */
    onSelect={() => false}
    rowAction={(row, { busy }) => {
      const mine = copied?.id === row.id ? copied : null;
      /* 줄마다 같은 이름의 버튼이 늘어서므로 읽어 주는 이름에는 어느 카테고리인지를 앞에 붙인다. */
      return <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" disabled={busy} onClick={() => void copy(row)} type="button"><Copy aria-hidden="true" /><span className="sr-only">{row.path} </span>{mine ? mine.ok ? '복사됨' : '복사 안 됨' : '코드 복사'}</button>;
    }}
    rowKey={rowKey}
    rowView={rowView}
    searchPlaceholder="카테고리명 또는 코드로 찾기"
    title="카테고리 코드 고르기"
  />;
}
