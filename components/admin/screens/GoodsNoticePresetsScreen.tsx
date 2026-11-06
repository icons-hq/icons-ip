import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import {
  GOODS_NOTICE_PRESET_NAME_MAX, GOODS_NOTICE_PRESET_PAGE_SIZE, GOODS_NOTICE_PRESETS_PATH,
  goodsNoticePresetHref, type GoodsNoticePresetPageData,
} from '@/lib/admin/goods-notice-presets';
import { GoodsNoticePresetDeleteForm, GoodsNoticePresetForm } from './GoodsNoticePresetForm';

const SUMMARY = 'flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden';

export function GoodsNoticePresetsScreen({ data }: { data: GoodsNoticePresetPageData }) {
  const { presets, filters, total } = data;
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="notice-presets">
    <AdminPageHeader title="상품정보제공고시 프리셋" description="자주 사용하는 제조사·소재·A/S 정보를 이름으로 저장합니다. 기존 상품에 입력된 값은 바뀌지 않습니다." />
    <details className="group/create rounded-xl border bg-card text-card-foreground" data-notice-presets="create">
      <summary className={`${SUMMARY} font-medium`}>새 프리셋 등록<ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/create:rotate-180" /></summary><div className="border-t"><GoodsNoticePresetForm /></div>
    </details>
    <form action={GOODS_NOTICE_PRESETS_PATH} className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor="notice-preset-query">프리셋 이름 검색</label>
      <div className="flex flex-wrap items-center gap-2"><Input className="w-full sm:w-80" id="notice-preset-query" name="q" type="search" defaultValue={filters.query} maxLength={GOODS_NOTICE_PRESET_NAME_MAX} placeholder="프리셋 이름" />
        <Button variant="outline" type="submit">검색</Button>
        {filters.query ? <Link className="text-sm underline underline-offset-4" href={GOODS_NOTICE_PRESETS_PATH}>전체 프리셋 보기</Link> : null}</div>
    </form>
    <p className="text-sm text-muted-foreground">총 {total.toLocaleString('ko-KR')}개 · 이름을 열어 7개 항목을 수정할 수 있습니다.</p>
    {presets.length ? <div className="flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground" data-notice-presets="entries">
      {presets.map((preset) => <details key={preset.id} className="group/entry border-b last:border-b-0 open:bg-muted/20">
        <summary className={SUMMARY}><span className="flex min-w-0 flex-col gap-0.5 wrap-anywhere sm:flex-row sm:items-baseline sm:gap-4"><strong className="font-medium">{preset.name}</strong><span className="text-sm text-muted-foreground">{preset.notice.maker} · {preset.notice.origin}</span></span><ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/entry:rotate-180" /></summary>
        <div className="border-t bg-card"><GoodsNoticePresetForm preset={preset} /><GoodsNoticePresetDeleteForm preset={preset} /></div>
      </details>)}
    </div> : <p className="py-12 text-center text-sm text-muted-foreground">{filters.query ? '조건에 맞는 프리셋이 없습니다.' : '아직 등록된 프리셋이 없습니다. 새 프리셋을 등록해주세요.'}</p>}
    <ConsolePagination page={filters.page} pageSize={GOODS_NOTICE_PRESET_PAGE_SIZE} total={total} hrefForPage={(page) => goodsNoticePresetHref(filters, page)} />
  </section>;
}
