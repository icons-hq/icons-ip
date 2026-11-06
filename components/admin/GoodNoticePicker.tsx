'use client';
import { useState, useTransition } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { findGoodNoticePresets, loadLastSavedGoodNotice } from '@/app/admin/good-notice-actions';
import type { GoodsNoticePresetPageData, GoodsKcPresetTemplate } from '@/lib/admin/goods-notice-presets';
import type { GoodsNoticeInfo } from '@/lib/goods-notice';
import { Button } from '@/components/admin/kit/ui/button';
import { GOOD_INPUT_CLASS } from './GoodEditorParts';

/* 상품 폼 안에 놓이므로 버튼은 모두 type="button"이다(kit Button 기본값). 검색칸은 이름이 없어 제출되지 않는다. */
export function GoodNoticePicker({ onApply, readOnly=false, copyKcTemplate=true }: { onApply: (notice: GoodsNoticeInfo, kcTemplate?:GoodsKcPresetTemplate|null) => void;readOnly?:boolean;copyKcTemplate?:boolean }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<GoodsNoticePresetPageData | null>(null);
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  function search(number = 1) { start(async () => {
    const result = await findGoodNoticePresets(query, number);
    if ('error' in result) { setMessage(result.error); return; }
    setPage(result); setMessage(result.total ? '' : '일치하는 프리셋이 없습니다.');
  }); }
  return <div className="flex min-w-0 flex-col gap-3" data-good-notice-picker="">
    <div className="flex min-w-0 flex-wrap items-end gap-2">
      <label className="flex min-w-0 flex-1 basis-56 flex-col gap-2 text-sm leading-snug font-medium text-foreground">프리셋 이름 <input className={GOOD_INPUT_CLASS} data-slot="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={80} /></label>
      <Button type="button" variant="outline" disabled={pending} onClick={() => search()}><Search aria-hidden="true" />프리셋 찾기</Button>
      <Button type="button" variant="outline" disabled={pending||readOnly} onClick={() => start(async () => {
        const result = await loadLastSavedGoodNotice();
        if (result.notice) { onApply(result.notice); setMessage(`${result.name}의 최근 저장값 7개를 복사했습니다.`); }
        else setMessage(result.error ?? '최근 값이 없습니다.');
      })}>최근 저장된 상품에서 복사</Button>
    </div>
    <p className="text-sm text-muted-foreground">선택하면 현재 고시정보 7개를 모두 바꿉니다. 저장 후에는 복사한 값이 상품에 독립적으로 남습니다.</p>
    {page && <div className="flex flex-wrap gap-2">{page.presets.map((preset) => <Button type="button" variant="outline" size="sm" disabled={readOnly} key={preset.id} onClick={() => { onApply(preset.notice,copyKcTemplate?preset.kcTemplate:undefined); setMessage(`${preset.name} 프리셋의 7개 항목을 복사했습니다.${copyKcTemplate&&preset.kcTemplate?' KC 유형 틀을 새 미검토 모델로 불러옵니다. 신규 상품은 초안을 저장한 뒤 KC 영역에서 입력을 이어가세요.':''}`); }}>{preset.name} 적용</Button>)}</div>}
    {page && page.total > 20 && <div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={pending || page.filters.page <= 1} onClick={() => search(page.filters.page - 1)}><ChevronLeft aria-hidden="true" />이전</Button><span className="text-sm tabular-nums">{page.filters.page} 페이지</span><Button type="button" variant="outline" size="sm" disabled={pending || page.filters.page * 20 >= page.total} onClick={() => search(page.filters.page + 1)}>다음<ChevronRight aria-hidden="true" /></Button></div>}
    {message && <p className="text-sm text-foreground" role="status">{message}</p>}
  </div>;
}
