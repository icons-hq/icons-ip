'use client';
import { useEffect, useState, useTransition } from 'react';
import { ListChecks, Search } from 'lucide-react';
import { findGoodNoticePresets, loadLastSavedGoodNotice } from '@/app/admin/good-notice-actions';
import type { GoodsNoticePresetPageData, GoodsKcPresetTemplate } from '@/lib/admin/goods-notice-presets';
import type { GoodsNoticeInfo } from '@/lib/goods-notice';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { Button } from '@/components/admin/kit/ui/button';
import { GOOD_INPUT_CLASS } from './GoodEditorParts';

type Preset = GoodsNoticePresetPageData['presets'][number];

/*
 * 상품 폼 안에 놓이므로 버튼은 모두 type="button"이다(kit Button 기본값). 검색칸은 이름이 없어 제출되지 않는다.
 * 템플릿 목록은 열면 바로 보이고, 상품 유형에 맞는 템플릿은 제안만 한다 — 고시는 법정 표시라 사람이 누를 때만 적용한다.
 */
export function GoodNoticePicker({ onApply, readOnly=false, copyKcTemplate=true, suggestType='' }: {
  onApply: (notice: GoodsNoticeInfo, kcTemplate?:GoodsKcPresetTemplate|null) => void;readOnly?:boolean;copyKcTemplate?:boolean;
  /** 고른 상품 유형. 비어 있으면 제안하지 않는다. */
  suggestType?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<GoodsNoticePresetPageData | null>(null);
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  const [suggestion, setSuggestion] = useState<{ type: string; preset: Preset } | null>(null);
  const [dismissed, setDismissed] = useState('');
  useEffect(() => {
    if (!suggestType || readOnly || dismissed === suggestType) return;
    let alive = true;
    findGoodNoticePresets(suggestType, 1).then((result) => {
      if (alive) setSuggestion('error' in result || !result.presets[0] ? null : { type: suggestType, preset: result.presets[0] });
    }).catch(() => { if (alive) setSuggestion(null); });
    return () => { alive = false; };
  }, [suggestType, readOnly, dismissed]);
  function search(number = 1) { start(async () => {
    const result = await findGoodNoticePresets(query, number);
    if ('error' in result) { setMessage(result.error); return; }
    setPage(result); setMessage(result.total ? '' : '일치하는 템플릿이 없습니다.');
  }); }
  function apply(preset: Preset) {
    onApply(preset.notice,copyKcTemplate?preset.kcTemplate:undefined);
    setDismissed(suggestion?.type ?? ''); setSuggestion(null);
    /* TKT-006: 등록 화면과 저장된 상품 모두 KC 틀을 같은 화면 KC 정보의 새 미검토 모델로 채운다(공개 판정은 그대로). */
    setMessage(`${preset.name} 템플릿의 7개 항목을 복사했습니다.${copyKcTemplate&&preset.kcTemplate?' KC 유형 틀을 KC 정보의 새 미검토 모델로 불러옵니다. 옵션·번호·사업자는 이 상품에 맞게 확인해 입력해주세요.':''}`);
  }
  const shown = suggestion && suggestion.type === suggestType && !readOnly ? suggestion : null;
  return <div className="flex min-w-0 flex-col gap-3" data-good-notice-picker="">
    {shown ? <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary-soft-foreground" data-good-notice-suggestion="">
      <span className="min-w-0">카테고리 상품 유형 ‘{shown.type}’에 맞는 템플릿이 있습니다.</span>
      <Button type="button" variant="outline" size="sm" onClick={() => apply(shown.preset)}>{shown.preset.name} 적용</Button>
    </div> : null}
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Button type="button" variant="outline" aria-expanded={open} disabled={pending && !open} onClick={() => { const next = !open; setOpen(next); if (next && !page) search(); }}><ListChecks aria-hidden="true" />템플릿에서 가져오기</Button>
      <Button type="button" variant="outline" disabled={pending||readOnly} onClick={() => start(async () => {
        const result = await loadLastSavedGoodNotice();
        if (result.notice) {
          /* 어느 상품에서 오는지 보고 고르게 한다 — 담당자가 여럿이면 방금 저장한 상품이 내 상품이 아닐 수 있다. */
          if (!window.confirm(`‘${result.name}’의 고시정보 7개로 지금 입력을 모두 바꿀까요?`)) return;
          onApply(result.notice); setMessage(`${result.name}의 최근 저장값 7개를 복사했습니다.`);
        }
        else setMessage(result.error ?? '최근 값이 없습니다.');
      })}>최근 저장된 상품에서 복사</Button>
      <p className="basis-full text-sm text-muted-foreground">선택하면 현재 고시정보 7개를 모두 바꿉니다. 저장 후에는 복사한 값이 상품에 독립적으로 남습니다.</p>
    </div>
    {open ? <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" data-good-notice-presets="">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <input aria-label="템플릿 이름 검색" className={`${GOOD_INPUT_CLASS} min-w-0 flex-1 basis-48`} data-slot="input" placeholder="템플릿 이름으로 찾기" type="search" value={query} maxLength={80}
          onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); search(); } }} />
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => search()}><Search aria-hidden="true" />찾기</Button>
      </div>
      {page ? <div className="flex flex-wrap gap-2">{page.presets.map((preset) => <Button type="button" variant="outline" size="sm" disabled={readOnly} key={preset.id} onClick={() => apply(preset)}>{preset.name} 적용</Button>)}</div> : message ? null : <p className="text-sm text-muted-foreground" role="status">템플릿을 불러오고 있습니다.</p>}
      {page && page.total > 20 && <ConsolePagination label="고시정보 템플릿 페이지" page={page.filters.page} pageSize={20} total={page.total} unit="개" disabled={pending} onPageChange={search} />}
    </div> : null}
    {message && <p className="text-sm text-foreground" role="status">{message}</p>}
  </div>;
}
