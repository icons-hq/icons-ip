'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { bulkCreateAdminCategoriesAction } from '@/app/admin/category-actions';
import {
  CATEGORY_BULK_LINE_LIMIT,
  categoryBulkReason,
  categoryBulkResultLabel,
  parseCategoryBulkText,
  type CategoryBulkResult,
} from '@/lib/admin/category-bulk';

/**
 * 카테고리 일괄 등록(R9). ERP 분류표처럼 `대>중>소` 경로를 줄마다 붙여넣으면 없는 단계만 만든다.
 * 응답을 받지 못한 요청은 같은 작업 번호로 다시 보내 DB가 첫 결과를 돌려주게 한다(중복 생성 방지).
 */
export function CategoryBulkCreatePanel() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CategoryBulkResult | null>(null);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const running = useRef(false);
  const lineCount = parseCategoryBulkText(text).paths.length;

  async function submit() {
    if (running.current || !lineCount) return;
    running.current = true; setPending(true); setError('');
    try {
      const response = await bulkCreateAdminCategoriesAction({ operationId, text });
      /* 확정된 응답(성공·거절)을 받았으니 다음 요청은 새 작업 번호를 쓴다. */
      setOperationId(crypto.randomUUID());
      if (!response.ok) { setError(response.error); return; }
      setResult(response.result);
      router.refresh();
    } catch {
      setError('등록 결과를 확인하지 못했습니다. 같은 내용으로 다시 누르면 이미 만든 카테고리는 다시 만들지 않습니다.');
    } finally {
      running.current = false; setPending(false);
    }
  }

  const total = result ? result.createdLines + result.skippedLines + result.failedLines : 0;
  return <div className="col" style={{ gap: 10 }}>
    <label className="col" style={{ gap: 5 }}>경로 붙여넣기
      <textarea aria-label="카테고리 경로" className="admin-field-control" rows={8} value={text} disabled={pending} spellCheck={false}
        placeholder={'문구>노트>스프링노트\n문구>메모/수첩>메모지\n화장품/미용>뷰티소품2'}
        onChange={(event) => { setText(event.target.value); setOperationId(crypto.randomUUID()); }} />
    </label>
    <p className="wc-admin-kit__hint" style={{ margin: 0 }}>
      한 줄에 경로 하나를 ‘대&gt;중&gt;소’처럼 ‘&gt;’로 나눠 입력합니다(최대 4단계, 2단계 줄도 됩니다). 같은 부모 아래 같은 이름은 새로 만들지 않고 건너뜁니다. 이름에 든 ‘/’는 이름 그대로 들어갑니다. 한 번에 {CATEGORY_BULK_LINE_LIMIT.toLocaleString('ko-KR')}줄까지 등록할 수 있습니다.
    </p>
    <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
      <button className="wc-admin-kit__button" type="button" disabled={pending || !lineCount} onClick={() => { void submit(); }}>{pending ? '등록 중' : '일괄 등록'}</button>
      <span role="status" className="wc-admin-kit__hint">경로 {lineCount.toLocaleString('ko-KR')}줄</span>
    </div>
    {error ? <p role="alert" className="wc-admin-kit__error" style={{ margin: 0 }}>{error}</p> : null}
    {result ? <>
      <p role="status" style={{ margin: 0 }}>
        경로 {total.toLocaleString('ko-KR')}줄 중 처리 {result.createdLines.toLocaleString('ko-KR')} · 건너뜀 {result.skippedLines.toLocaleString('ko-KR')} · 실패 {result.failedLines.toLocaleString('ko-KR')} · 새 카테고리 {result.createdCategories.toLocaleString('ko-KR')}개
      </p>
      <div role="region" aria-label="일괄 등록 결과" tabIndex={0} style={{ maxHeight: 360, overflow: 'auto' }}>
        <table className="admin-console-grid-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <caption className="wc-admin-kit__hint" style={{ textAlign: 'start' }}>줄 번호는 붙여넣은 글의 줄입니다.</caption>
          <thead><tr><th scope="col">번호</th><th scope="col">결과</th><th scope="col">사유</th></tr></thead>
          <tbody>{result.lines.map((line) => <tr key={line.line}>
            <th scope="row" style={{ textAlign: 'start', fontWeight: 400 }}>{line.line} · {line.path}</th>
            <td>{categoryBulkResultLabel(line.status)}</td>
            <td>{categoryBulkReason(line)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </> : null}
  </div>;
}
