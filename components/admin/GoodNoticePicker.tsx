'use client';
import { useState, useTransition } from 'react';
import { findGoodNoticePresets, loadLastSavedGoodNotice } from '@/app/admin/good-notice-actions';
import type { GoodsNoticePresetPageData } from '@/lib/admin/goods-notice-presets';
import type { GoodsNoticeInfo } from '@/lib/goods-notice';
export function GoodNoticePicker({ onApply }: { onApply: (notice: GoodsNoticeInfo) => void }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<GoodsNoticePresetPageData | null>(null);
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  function search(number = 1) { start(async () => {
    const result = await findGoodNoticePresets(query, number);
    if ('error' in result) { setMessage(result.error); return; }
    setPage(result); setMessage(result.total ? '' : '일치하는 프리셋이 없습니다.');
  }); }
  return <div className="col" style={{ gap: 10 }}>
    <div className="row" style={{ flexWrap: 'wrap' }}>
      <label>프리셋 이름 <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={80} /></label>
      <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => search()}>프리셋 찾기</button>
      <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => start(async () => {
        const result = await loadLastSavedGoodNotice();
        if (result.notice) { onApply(result.notice); setMessage(`${result.name}의 최근 저장값 7개를 복사했습니다.`); }
        else setMessage(result.error ?? '최근 값이 없습니다.');
      })}>최근 저장된 상품에서 복사</button>
    </div>
    <p>선택하면 현재 고시정보 7개를 모두 바꿉니다. 저장 후에는 복사한 값이 상품에 독립적으로 남습니다.</p>
    {page && <div className="row" style={{ flexWrap: 'wrap' }}>{page.presets.map((preset) => <button type="button" className="btn btn-ghost" key={preset.id} onClick={() => { onApply(preset.notice); setMessage(`${preset.name} 프리셋의 7개 항목을 복사했습니다.`); }}>{preset.name} 적용</button>)}</div>}
    {page && page.total > 20 && <div><button className="btn btn-ghost" type="button" disabled={pending || page.filters.page <= 1} onClick={() => search(page.filters.page - 1)}>이전</button><span>{page.filters.page} 페이지</span><button className="btn btn-ghost" type="button" disabled={pending || page.filters.page * 20 >= page.total} onClick={() => search(page.filters.page + 1)}>다음</button></div>}
    {message && <p role="status">{message}</p>}
  </div>;
}
