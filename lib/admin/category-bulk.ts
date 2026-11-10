/*
 * 카테고리 일괄 등록(R9, 10/27 회의) — 붙여넣은 `대>중>소` 경로 목록과 `admin_bulk_create_categories` 결과 계약.
 *
 * 경로 해석·중복 판정·코드 생성은 DB가 한다(supabase/migrations/20261028130000_category_bulk_create_and_erp_path_link.sql).
 * 브라우저와 서버 액션은 빈 줄을 빼고, 결과표 번호를 붙여넣은 원래 줄로 되돌리는 일만 한다.
 */

/** DB 상한과 같다. ERP 제상품 분류표(297줄)를 한 번에 넣을 수 있다. */
export const CATEGORY_BULK_LINE_LIMIT = 1000;
/** 서버 액션 본문 상한(next.config.ts 3MB) 안에서 넉넉히 자른다. 한 줄은 DB에서 1,000자까지. */
export const CATEGORY_BULK_TEXT_LIMIT = 300_000;

export interface CategoryBulkInput {
  /** 빈 줄을 뺀 경로. 앞뒤 공백만 걷고 나머지는 DB가 다듬는다. */
  paths: string[];
  /** paths[i]가 붙여넣은 글의 몇 번째 줄인지(1부터). */
  sourceLines: number[];
}

export function parseCategoryBulkText(text: string): CategoryBulkInput {
  const paths: string[] = [];
  const sourceLines: number[] = [];
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const path = raw.trim();
    if (!path) return;
    paths.push(path);
    sourceLines.push(index + 1);
  });
  return { paths, sourceLines };
}

export type CategoryBulkLineStatus = 'created' | 'skipped' | 'failed';

export interface CategoryBulkLine {
  line: number;
  path: string;
  status: CategoryBulkLineStatus;
  /** 이 줄에서 새로 만든 카테고리 수 */
  created: number;
  reason: string | null;
}

export interface CategoryBulkResult {
  createdCategories: number;
  createdLines: number;
  skippedLines: number;
  failedLines: number;
  lines: CategoryBulkLine[];
}

const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export function parseCategoryBulkResult(value: unknown): CategoryBulkResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (!count(result.createdCategories) || !count(result.createdLines) || !count(result.skippedLines) || !count(result.failedLines)
    || !Array.isArray(result.lines)) return null;
  const lines: CategoryBulkLine[] = [];
  for (const raw of result.lines) {
    if (!raw || typeof raw !== 'object') return null;
    const line = raw as Record<string, unknown>;
    if (!Number.isSafeInteger(line.line) || (line.line as number) < 1 || typeof line.path !== 'string'
      || (line.status !== 'created' && line.status !== 'skipped' && line.status !== 'failed')
      || !count(line.created) || (line.reason !== null && typeof line.reason !== 'string')) return null;
    lines.push({ line: line.line as number, path: line.path, status: line.status, created: line.created, reason: line.reason as string | null });
  }
  return {
    createdCategories: result.createdCategories,
    createdLines: result.createdLines,
    skippedLines: result.skippedLines,
    failedLines: result.failedLines,
    lines,
  };
}

const RESULT_LABELS: Record<CategoryBulkLineStatus, string> = { created: '처리됨', skipped: '건너뜀', failed: '실패' };

export function categoryBulkResultLabel(status: CategoryBulkLineStatus): string {
  return RESULT_LABELS[status];
}

const REASONS: Record<string, string> = {
  invalid_category_path: '빈 단계가 있습니다. ‘대>중>소’처럼 이름 사이를 ‘>’ 하나로 나눠 입력하세요.',
  category_depth_exceeded: '카테고리는 최대 4단계까지만 만들 수 있습니다.',
  invalid_category_name: '카테고리 이름은 120자까지 입력할 수 있습니다.',
  category_has_goods: '상품이 연결된 카테고리 아래에는 하위 카테고리를 만들 수 없습니다. 상품의 카테고리를 먼저 옮기세요.',
  category_path_ambiguous: '같은 위치에 같은 이름의 카테고리가 둘 이상 있어 어디에 넣을지 정할 수 없습니다. 카테고리 트리를 먼저 정리하세요.',
};

export function categoryBulkReason(line: CategoryBulkLine): string {
  if (line.status === 'created') return `새 카테고리 ${line.created.toLocaleString('ko-KR')}개를 만들었습니다.`;
  if (line.status === 'skipped') return '이미 등록된 경로입니다.';
  return (line.reason && Object.hasOwn(REASONS, line.reason) ? REASONS[line.reason] : null) ?? '등록하지 못했습니다. 경로를 확인하세요.';
}
